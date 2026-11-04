// Audio analysis for the visualizers: punchy bars + kick detection that still moves on dense,
// loud masters (where a raw spectrum just sits near the top).
//
// - Log-spaced bands from ~35 Hz to ~14 kHz, read in dB.
// - Per-band auto gain: each band is stretched between its own slow floor and slow ceiling,
//   so a wall of sound still shows contrast; what moves is the change, not the loudness.
// - Envelope: instant attack, gravity-style fall (bars snap up and drop down, NCS-style).
// - Kick: spectral flux over 40-140 Hz vs. its recent mean + k·std, with a short cooldown.
//   `beat` jumps up on each kick (harder hit = higher) and decays, so anything can scale/glow with it.
// - With no analyser (CDN without CORS) a 120 BPM simulation keeps things alive.

export class BeatAnalyser {
  constructor(nBands = 48, opts = {}) {
    this.n = nBands;
    // defaults tuned on 8 previews (hardstyle, brostep, metalcore, edm, dnb, electro house, lullaby, shoegaze):
    // bars average ~0.45 with ~0.95 swing; kick tempo matches the real BPM on 4-on-the-floor tracks
    this.o = Object.assign({ gamma: 2, floorMul: 1, kickK: 1.8, kickMin: 0.01, cooldown: 210, hist: 50 }, opts);
    this.bands = new Float32Array(nBands);   // 0..1, what to draw
    this.peaks = new Float32Array(nBands);   // falling peak caps
    this._peakHold = new Float32Array(nBands);
    this._floor = new Float32Array(nBands).fill(0.3);
    this._ceil = new Float32Array(nBands).fill(0.7);
    this.bass = 0;      // 0..1 smoothed low-end level (after auto gain)
    this.beat = 0;      // 0..1, 1 right on a kick
    this.kick = false;  // true only on the frame a kick is detected
    this.kicks = 0;     // running count, lets other loops notice kicks they didn't see
    this.energy = 0;    // 0..1 overall level
    this._fluxHist = [];
    this._lastKick = -1e9;
    this._lastT = 0;
    this._edges = null;
  }

  reset() {
    this.bands.fill(0); this.peaks.fill(0); this._peakHold.fill(0);
    this.bass = this.beat = this.energy = 0; this.kick = false;
    this._fluxHist.length = 0;
  }

  _buildEdges(analyser) {
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const lo = 35, hi = 14000, nb = analyser.frequencyBinCount;
    const edges = [];
    let prev = -1;
    for (let k = 0; k <= this.n; k++) {
      let b = Math.round((lo * Math.pow(hi / lo, k / this.n)) / binHz);
      b = Math.min(nb - 1, Math.max(b, prev + 1));   // at least one bin per band
      edges.push(b); prev = b;
    }
    this._edges = edges;
    this._bassBins = [Math.max(1, Math.round(40 / binHz)), Math.max(2, Math.round(140 / binHz))];
    this._db = new Float32Array(nb);
    this._key = analyser.fftSize + ":" + analyser.context.sampleRate;
  }

  /** Call once per animation frame. `analyser` may be null (simulation). */
  update(t, analyser, playing) {
    const dt = Math.min(0.1, Math.max(0.001, (t - (this._lastT || t - 16)) / 1000));
    this._lastT = t;
    this.kick = false;

    if (!playing) {
      // let everything fall back down smoothly after pause
      for (let k = 0; k < this.n; k++) { this.bands[k] = Math.max(0, this.bands[k] - dt * 2.2); this.peaks[k] = Math.max(0, this.peaks[k] - dt * 1.2); }
      this.beat = Math.max(0, this.beat - dt * 4); this.bass *= Math.exp(-dt * 6); this.energy *= Math.exp(-dt * 6);
      return this;
    }

    const raw = analyser ? this._readReal(analyser) : this._readSim(t);
    const xs = this._xs || (this._xs = new Float32Array(this.n));
    for (let k = 0; k < this.n; k++) {
      const v = raw[k];
      // slow auto gain: ceiling follows peaks quickly up and slowly down, floor follows the average
      const c = this._ceil[k], f = this._floor[k];
      this._ceil[k] = v > c ? c + (v - c) * Math.min(1, dt * 12) : c - (c - v) * dt * 0.25;
      this._floor[k] = f + (v - f) * dt * (v < f ? 3 : 0.6);
      const span = Math.max(0.12, this._ceil[k] - this._floor[k]);
      const x = Math.max(0, Math.min(1, (v - this._floor[k] * this.o.floorMul) / span));
      xs[k] = Math.pow(x, this.o.gamma);     // more contrast: quiet stays low, hits jump
    }
    let sum = 0;
    for (let k = 0; k < this.n; k++) {
      // blur with neighbours so the shape flows like a wave instead of random spikes
      const x = 0.25 * xs[Math.max(0, k - 1)] + 0.5 * xs[k] + 0.25 * xs[Math.min(this.n - 1, k + 1)];
      // instant attack, gravity fall
      const cur = this.bands[k];
      this.bands[k] = x > cur ? x : Math.max(x, cur - dt * (1.6 + cur * 1.8));
      // peak caps: hold briefly then drop
      if (this.bands[k] >= this.peaks[k]) { this.peaks[k] = this.bands[k]; this._peakHold[k] = 0.22; }
      else if ((this._peakHold[k] -= dt) <= 0) this.peaks[k] = Math.max(this.bands[k], this.peaks[k] - dt * 0.9);
      sum += this.bands[k];
    }
    this.energy = sum / this.n;

    // kick detection on the bass band (spectral flux, adaptive threshold)
    return this._kickFrom(this._binFlux || 0, t, dt);
  }

  _kickFrom(flux, t, dt) {
    const o = this.o, h = this._fluxHist;
    h.push(flux); if (h.length > o.hist) h.shift();
    let mean = 0; for (const x of h) mean += x; mean /= h.length;
    let vr = 0; for (const x of h) vr += (x - mean) ** 2; vr /= h.length;
    const thr = mean + o.kickK * Math.sqrt(vr) + o.kickMin;
    let strength = 0;
    if (h.length > 10 && flux > thr && t - this._lastKick > o.cooldown) {
      this.kick = true; this._lastKick = t;
      strength = Math.min(1, 0.45 + 0.55 * (flux - thr) / (thr + 1e-6));   // soft onsets bounce less
    }
    if (this._simKick) { this.kick = true; this._simKick = false; this._lastKick = t; strength = 0.9; }
    if (this.kick) this.kicks++;
    this.beat = Math.max(strength, this.beat * Math.exp(-dt * 7.5));
    this.kickStrength = strength || this.kickStrength || 0;

    let b = 0; for (let k = 0; k < 6; k++) b += this.bands[k]; b /= 6;
    this.bass = Math.max(b, this.bass * Math.exp(-dt * 8));
    return this;
  }

  _readReal(analyser) {
    const key = analyser.fftSize + ":" + analyser.context.sampleRate;
    if (!this._edges || this._key !== key) this._buildEdges(analyser);
    const db = this._db;
    analyser.getFloatFrequencyData(db);
    const lo = analyser.minDecibels, range = analyser.maxDecibels - lo;
    const out = this._raw || (this._raw = new Float32Array(this.n));
    const e = this._edges;
    for (let k = 0; k < this.n; k++) {
      let m = -Infinity;
      for (let j = e[k]; j < e[k + 1]; j++) if (db[j] > m) m = db[j];   // max is punchier than mean
      // tilt: highs are naturally quieter, lift them so the right side isn't dead
      const v = (m - lo) / range + (k / this.n) * 0.12;
      out[k] = Math.max(0, Math.min(1, v));
    }
    // kick onset: per-bin positive dB change across 40-140 Hz (ignores sustained bass, catches the hit)
    const pb = this._prevDb || (this._prevDb = new Float32Array(db.length));
    let fl = 0, c = 0;
    for (let j = this._bassBins[0]; j <= this._bassBins[1]; j++) { const d = db[j] - pb[j]; if (d > 0 && isFinite(d)) fl += d; c++; }
    this._binFlux = fl / c / range;
    pb.set(db);
    return out;
  }

  _readSim(t) {
    const out = this._raw || (this._raw = new Float32Array(this.n));
    const period = 500;                                   // 120 BPM
    const phase = (t % period) / period;
    const beatIdx = Math.floor(t / period);
    if (beatIdx !== this._simBeat) { this._simBeat = beatIdx; this._simKick = true; }
    const hit = Math.exp(-phase * 6);
    for (let k = 0; k < this.n; k++) {
      const x = k / this.n;
      const wob = 0.5 + 0.5 * Math.sin(t / 180 + k * 1.3) * Math.cos(t / 330 + k * 0.7);
      out[k] = 0.25 + 0.35 * wob * (1 - x * 0.4) + 0.4 * hit * Math.max(0, 1 - x * 2.2);
    }
    this._binFlux = 0;
    return out;
  }
}

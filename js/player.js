// Floating music player.
//
// Audio comes from the 30-second Spotify previews Every Noise used for each genre
// (one example track per genre, with artist + title, so we can credit it).
// If a preview no longer loads, we look the same song up on Deezer (JSONP, no key)
// and play its 30s preview instead, still crediting the same artist and song.
import { $, clamp, fmtTime, toast, Emitter } from "./util.js";
import { model, trackOf } from "./data.js";
import { BeatAnalyser } from "./beat.js";
import { t } from "./i18n.js";

const SPOTIFY_PREVIEW = "https://p.scdn.co/mp3-preview/";

// 0.1s of silence, used to unlock audio playback on iOS
const SILENT_WAV = (() => {
  const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let bin = ""; new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return "data:audio/wav;base64," + btoa(bin);
})();

function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = "__dz" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const done = () => { delete window[cb]; s.remove(); clearTimeout(t); };
    window[cb] = (d) => { done(); resolve(d); };
    s.onerror = () => { done(); reject(new Error("jsonp failed")); };
    const t = setTimeout(() => { done(); reject(new Error("jsonp timeout")); }, timeout);
    s.src = url + (url.includes("?") ? "&" : "?") + "output=jsonp&callback=" + cb;
    document.head.append(s);
  });
}

async function deezerLookup(artist, song) {
  const clean = song.replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, "").replace(/\(.*?\)/g, "").trim();
  const q = `artist:"${artist}" track:"${clean}"`;
  const d = await jsonp("https://api.deezer.com/search?limit=3&q=" + encodeURIComponent(q));
  const hit = (d && d.data || []).find((t) => t.preview);
  return hit ? { preview: hit.preview, link: hit.link, explicit: !!hit.explicit_lyrics, title: hit.title, artist: hit.artist?.name } : null;
}

export class Player extends Emitter {
  constructor() {
    super();
    // Two elements: `fx` requests CORS so we can draw a real spectrum; `plain` is the
    // fallback when the CDN doesn't send CORS headers (a media element routed through
    // Web Audio without CORS would play silence).
    this.fx = new Audio(); this.fx.crossOrigin = "anonymous"; this.fx.preload = "auto";
    this.plain = new Audio(); this.plain.preload = "auto";
    this.audio = this.plain;
    this.fxa = new BeatAnalyser(48);   // bars + kick detection shared by every visualizer
    this.corsOk = undefined;
    this.current = -1;
    this.meta = null;
    this.history = [];
    this.loop = false;
    this.auto = "near";          // off | near | random   (tours override this)
    this.rate = 1;
    this.volume = 0.9;
    this.kids = false;
    this.nextProvider = null;    // (mode, current) => index
    this._token = 0;
    this._seeking = false;

    for (const a of [this.fx, this.plain]) {
      a.volume = this.volume;
      a.addEventListener("timeupdate", () => { if (a === this.audio) { this._time(); this._maybePrefetch(); } });
      a.addEventListener("durationchange", () => a === this.audio && this._time());
      a.addEventListener("play", () => a === this.audio && this.meta && this._state(true));
      a.addEventListener("pause", () => a === this.audio && this._state(false));
      a.addEventListener("waiting", () => a === this.audio && this._setBusy(true));
      a.addEventListener("playing", () => a === this.audio && this._setBusy(false));
      a.addEventListener("ended", () => a === this.audio && this.meta && this._ended());
    }
    this._bindUI();
    this._mediaSession();
    // iOS only lets media play from a user gesture: "unlock" both elements on the first tap
    const unlock = () => {
      this._ensureAudioCtx();
      for (const a of [this.fx, this.plain]) {
        if (a.src) continue;
        a.src = SILENT_WAV;
        a.play().then(() => a.pause()).catch(() => {});
      }
    };
    document.addEventListener("pointerdown", unlock, { once: true, capture: true });
    document.addEventListener("keydown", unlock, { once: true, capture: true });
  }

  get playing() { return !this.audio.paused && !this.audio.ended; }

  async play(i, { auto = false } = {}) {
    if (i == null || i < 0) return false;
    if (i === this.current && this.audio.src && !auto) { this.toggle(); return true; }
    await model.tracksReady;
    const tr = trackOf(i);
    const g = model.G[i];
    if (!tr) {
      toast(t("“{g}” chưa có bài mẫu 😢", { g: g.n }));
      if (auto) setTimeout(() => this.next(true), 400);
      return false;
    }
    if (this.current >= 0 && this.current !== i) this.history.push(this.current);
    if (this.history.length > 200) this.history.shift();
    this.current = i;
    this.meta = {
      i, genre: g.n, color: g.c, artist: tr[2], song: tr[3], trackId: tr[1],
      source: "spotify", link: `https://open.spotify.com/track/${tr[1]}`,
    };
    this._ensureAudioCtx();
    this._renderMeta();
    this._setBusy(true);
    this.emit("track", this.meta);

    const token = ++this._token;
    const ok = await this._load(tr, token);
    if (token !== this._token) return false;      // user picked something else meanwhile
    this._setBusy(false);
    if (!ok) {
      this._renderMeta();
      this.emit("track", this.meta);
      toast(t("Không phát được bản nghe thử này. Thử mở trên Spotify nhé!"));
      if (auto || this.auto !== "off") setTimeout(() => token === this._token && this.next(true), 1500);
      return false;
    }
    this.audio.loop = this.loop;
    this.audio.playbackRate = this.rate;
    try { await this.audio.play(); } catch (e) { console.warn(e); this._state(false); }
    this._renderMeta();
    this.emit("track", this.meta);
    return true;
  }

  async _load(tr, token) {
    const url = SPOTIFY_PREVIEW + tr[0];
    const other = (a) => (a === this.fx ? this.plain : this.fx);
    const use = (a) => { other(a).pause(); this.audio = a; };
    if (this.corsOk !== false) {
      if (await this._try(this.fx, url, token)) { this.corsOk = true; this._connectFx(); use(this.fx); return true; }
      if (token !== this._token) return false;
    }
    if (await this._try(this.plain, url, token)) {
      if (this.corsOk === undefined) this.corsOk = false;
      use(this.plain); return true;
    }
    if (token !== this._token) return false;
    // fallback: same song on Deezer
    try {
      const dz = await deezerLookup(tr[2], tr[3]);
      if (token !== this._token) return false;
      if (dz && !(this.kids && dz.explicit)) {
        if (await this._try(this.plain, dz.preview, token)) {
          use(this.plain);
          this.meta.source = "deezer";
          this.meta.deezer = dz.link;
          return true;
        }
      }
    } catch (e) { console.warn(e); }
    this.meta.source = "none";
    return false;
  }

  _try(a, url, token) {
    return new Promise((resolve) => {
      const done = (ok) => { a.removeEventListener("canplay", yes); a.removeEventListener("error", no); clearTimeout(t); resolve(ok && token === this._token); };
      const yes = () => done(true), no = () => done(false);
      const t = setTimeout(() => done(false), 10000);
      a.addEventListener("canplay", yes);
      a.addEventListener("error", no);
      a.src = url;
      a.load();
    });
  }

  _ensureAudioCtx() {
    if (this.actx) { if (this.actx.state === "suspended") this.actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.actx = new AC(); } catch { this.actx = null; }
  }
  _connectFx() {
    if (this.analyser || !this.actx) return;
    try {
      const src = this.actx.createMediaElementSource(this.fx);
      this.analyser = this.actx.createAnalyser();
      this.analyser.fftSize = 2048;              // ~21 Hz bins: enough to isolate the kick
      this.analyser.smoothingTimeConstant = 0.35;  // low: BeatAnalyser does its own attack/fall
      this.analyser.minDecibels = -95;
      this.analyser.maxDecibels = -20;
      src.connect(this.analyser);
      this.analyser.connect(this.actx.destination);
    } catch (e) { console.warn(e); }
  }
  get realViz() { return !!this.analyser && this.audio === this.fx; }

  toggle() {
    if (this.current < 0) { this.emit("needpick"); return; }
    this._ensureAudioCtx();
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }
  pause() { this.audio.pause(); }
  stop() { this._token++; this.fx.pause(); this.plain.pause(); }

  next(auto = false) {
    const mode = this.auto === "off" ? "near" : this.auto;
    const q = this._queued;
    this._queued = null;
    const i = q && q.from === this.current && q.mode === mode ? q.i
      : this.nextProvider ? this.nextProvider(mode, this.current) : -1;
    if (i >= 0) { this.emit("advance", i); this.play(i, { auto }); }
  }
  prev() {
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    const i = this.history.pop();
    if (i != null) { this.current = -1; this.emit("advance", i); this.play(i); }
  }

  seek(frac) {
    const d = this.audio.duration;
    if (isFinite(d)) this.audio.currentTime = clamp(frac, 0, 1) * d;
  }
  setLoop(on) {
    this.loop = on;
    this.fx.loop = this.plain.loop = on;
    $("#p-loop").setAttribute("aria-pressed", on);
    toast(on ? t("🔁 Lặp lại bài này") : t("Tắt lặp lại"));
  }
  setAuto(mode) {
    this.auto = mode;
    const b = $("#p-auto");
    b.dataset.mode = mode;
    b.setAttribute("aria-pressed", mode !== "off");
    b.title = t({ off: "Tự chuyển: tắt", near: "Tự chuyển sang thể loại gần giống", random: "Tự chuyển ngẫu nhiên" }[mode]);
    $("#p-auto-label").textContent = t({ off: "Tắt", near: "Gần", random: "Ngẫu nhiên" }[mode]);
  }
  setRate(r) {
    this.rate = r;
    this.fx.playbackRate = this.plain.playbackRate = r;
    this.emit("rate", r);
  }
  setVolume(v) {
    this.volume = v;
    this.fx.volume = this.plain.volume = v;
    this.fx.muted = this.plain.muted = v === 0;
    $("#p-vol").value = Math.round(v * 100);
    $("#p-mute").dataset.muted = v === 0;
  }

  _maybePrefetch() {
    const a = this.audio, left = a.duration - a.currentTime;
    // tours advance their step when asked for the next track, so they are not asked early
    if (this.loop || !(left < 8) || !this.nextProvider || this.auto === "off" || this.tourActive) return;
    if (this._queued && this._queued.from === this.current) return;
    const mode = this.auto === "off" ? "near" : this.auto;
    const i = this.nextProvider(mode, this.current);
    this._queued = { from: this.current, mode, i };
    const tr = i >= 0 ? trackOf(i) : null;
    if (tr) fetch(SPOTIFY_PREVIEW + tr[0], { priority: "low" }).then((r) => r.arrayBuffer()).catch(() => {});
  }

  _ended() {
    this._state(false);
    if (this.loop) return;
    if (this.auto !== "off" || this.tourActive) this.next(true);
  }

  // ───────────── UI ─────────────
  _bindUI() {
    $("#p-play").onclick = () => this.toggle();
    $("#p-next").onclick = () => this.next();
    $("#p-prev").onclick = () => this.prev();
    $("#p-loop").onclick = () => this.setLoop(!this.loop);
    $("#p-auto").onclick = () => {
      const order = ["near", "random", "off"];
      this.setAuto(order[(order.indexOf(this.auto) + 1) % order.length]);
      toast($("#p-auto").title);
    };
    const vol = $("#p-vol");
    vol.oninput = () => this.setVolume(vol.value / 100);
    let lastVol = 0.9;
    $("#p-mute").onclick = () => {
      if (this.volume > 0) { lastVol = this.volume; this.setVolume(0); } else this.setVolume(lastVol || 0.9);
    };

    const seek = $("#p-seek");
    seek.addEventListener("input", () => {
      this._seeking = true;
      const d = this.audio.duration || 30;
      $("#p-cur").textContent = fmtTime((seek.value / 1000) * d);
      this._fill(seek.value / 1000);
    });
    seek.addEventListener("change", () => { this.seek(seek.value / 1000); this._seeking = false; });
    this.setAuto(this.auto);
    this._drawViz(0);
  }

  _fill(f) { $("#player").style.setProperty("--p", (f * 100).toFixed(2) + "%"); }

  _time() {
    const a = this.audio;
    const d = isFinite(a.duration) ? a.duration : 30;
    if (!this._seeking) {
      $("#p-seek").value = Math.round((a.currentTime / d) * 1000) || 0;
      $("#p-cur").textContent = fmtTime(a.currentTime);
      this._fill(a.currentTime / d);
    }
    $("#p-dur").textContent = fmtTime(d);
    if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && isFinite(a.duration)) {
      try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate }); } catch { /* ignore */ }
    }
    this.emit("time", a.currentTime, d);
  }

  _state(playing) {
    $("#player").dataset.playing = playing;
    this._labelPlay(playing);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    this.emit("state", playing);
    if (playing) this._startViz();
  }
  _labelPlay(playing = this.playing) {
    $("#p-play").setAttribute("aria-label", t(playing ? "Tạm dừng" : "Phát"));
    $("#p-play").title = t(playing ? "Tạm dừng (Space)" : "Phát (Space)");
  }
  /** Re-apply translated labels after a language switch. */
  relabel() { this._labelPlay(); this.setAuto(this.auto); this._renderMeta(); }
  _setBusy(b) { $("#player").dataset.busy = b; }

  _renderMeta() {
    const m = this.meta;
    const p = $("#player");
    p.dataset.state = m ? "ready" : "empty";
    if (!m) return;
    p.style.setProperty("--g", m.color);
    $("#p-title").textContent = m.song;
    $("#p-title").title = m.song;
    $("#p-artist").textContent = m.artist;
    $("#p-genre").textContent = m.genre;
    $("#p-genre").style.color = m.color;
    if ("mediaSession" in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: m.song, artist: m.artist, album: t("Thể loại: {g} · Everynoise", { g: m.genre }) });
    }
  }

  _mediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    set("play", () => this.toggle());
    set("pause", () => this.pause());
    set("nexttrack", () => this.next());
    set("previoustrack", () => this.prev());
    set("seekto", (d) => { if (d.seekTime != null) this.audio.currentTime = d.seekTime; });
  }

  // ───────────── visualizer ─────────────
  _startViz() {
    if (this._vizOn) return;
    this._vizOn = true;
    const loop = (t) => {
      this.fxa.update(t, this.realViz ? this.analyser : null, this.playing);
      this._drawViz(t);
      // keep animating after pause until the bars have fallen
      if (this.playing || this.fxa.energy > 0.005 || this.fxa.beat > 0.01) requestAnimationFrame(loop);
      else this._vizOn = false;
    };
    requestAnimationFrame(loop);
  }

  /** Mini visualizer in the player artwork: pulsing disc + radial bars, NCS-style. */
  _drawViz(t) {
    const c = $("#p-viz");
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height, cx = W / 2, cy = H / 2;
    const color = this.meta?.color || "#7c8cff";
    const a = this.fxa, beat = a.beat;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.16 + beat * 0.22;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    const base = W * 0.17 * (1 + beat * 0.28 + a.bass * 0.12);
    const nb = 24;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t / 9000);
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineWidth = W * 0.035;
    for (let i = 0; i < nb; i++) {
      // mirror: bass on top and bottom, highs on the sides
      const k = Math.floor((i < nb / 2 ? i : nb - 1 - i) * (a.n * 0.55) / (nb / 2));
      const v = a.bands[k];
      const ang = (i / nb) * Math.PI * 2;
      const r0 = base + W * 0.04, r1 = r0 + W * 0.04 + v * W * 0.2;
      ctx.beginPath();
      ctx.moveTo(Math.sin(ang) * r0, -Math.cos(ang) * r0);
      ctx.lineTo(Math.sin(ang) * r1, -Math.cos(ang) * r1);
      ctx.stroke();
    }
    ctx.restore();

    // cheap halo instead of shadowBlur (shadowBlur is CPU-rendered on Safari)
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18 + beat * 0.3;
    ctx.beginPath(); ctx.arc(cx, cy, base * (1.25 + beat * 0.2), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(cx, cy, base, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.35 + beat * 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, base * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    this.emit("viz", t);
  }
}

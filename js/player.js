// Floating music player.
//
// Audio comes from the 30-second Spotify previews Every Noise used for each genre
// (one example track per genre, with artist + title, so we can credit it).
// If a preview no longer loads, we look the same song up on Deezer (JSONP, no key)
// and play its 30s preview instead, still crediting the same artist and song.
import { $, clamp, fmtTime, toast, Emitter, cover } from "./util.js";
import { model, trackOf, radioOf } from "./data.js";
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
    this.lastN = new Map();      // genre index -> index of the demo track played last
    this.heardN = new Map();     // genre index -> Set of demo track indexes heard this session
    this.repeat = "off";         // "off" | "track" (loop this song) | "genre" (keep playing this genre's songs)
    this.auto = "near";          // off | near | random   (tours override this)
    this.rate = 1;
    this.volume = 0.9;
    this.kids = false;
    this.nextProvider = null;    // (mode, current) => index
    this._token = 0;
    this._others = [];           // game audio (quiz, guess the country): see solo()
    this._seeking = false;

    for (const a of [this.fx, this.plain]) {
      a.volume = this.volume;
      a.addEventListener("timeupdate", () => { if (a === this.audio) { this._time(); this._maybePrefetch(); } });
      a.addEventListener("durationchange", () => a === this.audio && this._time());
      a.addEventListener("play", () => { this._others.forEach((o) => o.pause()); if (a === this.audio && this.meta) this._state(true); });
      a.addEventListener("pause", () => a === this.audio && this._state(false));
      a.addEventListener("waiting", () => a === this.audio && this._setBusy(true));
      a.addEventListener("playing", () => a === this.audio && this._setBusy(false));
      a.addEventListener("ended", () => a === this.audio && this.meta && this._ended());
    }
    this._bindUI();
    this._mediaSession();
    // Android Chrome drops the media notification for an <audio> routed through Web Audio (fx -> analyser) once
    // the app is in the background, then freezes/kills the "silent" tab a few minutes later. In the background
    // nobody sees the visualizer, so the song moves to the plain element (same spot) and the next songs load there.
    // hidden: plain element (keeps Android playing + its media notification); back: Web Audio again so the visualizers
    // have data mid-song (otherwise they stayed flat until the next track)
    document.addEventListener("visibilitychange", () => { if (document.hidden) this._toPlain(); else this._toFx(); });
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

  /** Play genre i. `n` = which demo track of the genre; left out = a random one not heard yet. */
  async play(i, { auto = false, n, tr: custom } = {}) {
    if (i == null || i < 0) return false;
    // `tr` = a track that is not one of the genre's demo tracks (artist page): [preview id, track id, artist, song]
    if (i === this.current && this.audio.src && !auto && (custom ? custom[1] === this.meta?.trackId : (n == null || n === (this.meta?.n ?? 0)))) { this.toggle(); return true; }
    const t0 = this._token;      // a newer play() or game audio (solo) while we await = this call is stale
    await model.tracksReady;
    if (custom) n = -1;
    else if (n == null) n = await this.pickN(i);
    // only n > 0 needs the lazily loaded shard; the first track is already in memory
    const tr = custom || (n > 0 ? (await radioOf(i))[n] || (n = 0, trackOf(i)) : trackOf(i));
    if (this._token !== t0) return false;
    const g = model.G[i];
    if (!tr) {
      toast(t("“{g}” chưa có bài mẫu 😢", { g: g.n }));
      if (auto) setTimeout(() => this.next(true), 400);
      return false;
    }
    if (!custom) {
      this.lastN.set(i, n);
      if (!this.heardN.has(i)) this.heardN.set(i, new Set());
      this.heardN.get(i).add(n);
    }
    if (this.current >= 0 && this.current !== i) this.history.push(this.current);
    if (this.history.length > 200) this.history.shift();
    this.current = i;
    this.meta = {
      i, n, genre: g.n, color: g.c, artist: tr[2], song: tr[3], trackId: tr[1],
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
    this.audio.loop = this.repeat === "track";
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
    if (this.corsOk !== false && !document.hidden) {
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

  /** Hand the playing song from fx (Web Audio) to the plain element without a gap; fx keeps playing if that fails. */
  _toPlain() {
    const a = this.fx, p = this.plain, tok = this._token;
    if (this.audio !== a || a.paused || a.ended || !a.currentSrc) return;
    p.src = a.currentSrc; p.loop = a.loop; p.playbackRate = a.playbackRate;
    p.addEventListener("loadedmetadata", () => {
      if (tok !== this._token || this.audio !== a || a.paused) return;
      p.currentTime = a.currentTime;
      p.play().then(() => {
        if (tok !== this._token || this.audio !== a) { p.pause(); return; }
        this.audio = p; a.pause(); this._state(true); this._time();
      }).catch(() => { /* not allowed in the background: fx keeps playing */ });
    }, { once: true });
    p.load();
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

  async _toFx() {
    const a = this.plain, f = this.fx, tok = this._token;
    if (this.audio !== a || a.paused || a.ended || !a.currentSrc || this.corsOk !== true || !this._fxSrc) return;
    // a suspended context would make fx play silent: only switch once it really runs
    try { await Promise.race([this.actx.resume(), new Promise((r) => setTimeout(r, 800))]); } catch {}
    if (this.actx.state !== "running" || document.hidden || tok !== this._token) return;
    f.src = a.currentSrc; f.loop = a.loop; f.playbackRate = a.playbackRate;
    f.addEventListener("loadedmetadata", () => {
      if (tok !== this._token || this.audio !== a || a.paused || document.hidden) return;
      f.currentTime = a.currentTime;
      f.play().then(() => {
        if (tok !== this._token || this.audio !== a || document.hidden) { f.pause(); return; }
        this.audio = f; a.pause(); this._state(true); this._time();
      }).catch(() => {});
    }, { once: true });
    f.load();
  }
  _ensureAudioCtx() {
    if (this.actx) { if (this.actx.state === "suspended") this.actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.actx = new AC(); } catch { this.actx = null; }
  }
  _ensureAnalyser() {
    if (this.analyser) return this.analyser;
    if (!this.actx) return null;
    try {
      const an = this.actx.createAnalyser();
      an.fftSize = 2048;              // ~21 Hz bins: enough to isolate the kick
      an.smoothingTimeConstant = 0.35;  // low: BeatAnalyser does its own attack/fall
      an.minDecibels = -95;
      an.maxDecibels = -20;
      an.connect(this.actx.destination);
      this.analyser = an;
    } catch (e) { console.warn(e); }
    return this.analyser || null;
  }
  _connectFx() {
    if (this._fxSrc || !this._ensureAnalyser()) return;
    try {
      this._fxSrc = this.actx.createMediaElementSource(this.fx);
      this._fxSrc.connect(this.analyser);
    } catch (e) { console.warn(e); }
  }
  get realViz() { return !!this.analyser && this.audio === this.fx; }

  /** A random demo track of genre i, preferring ones not heard this session. The track list loads
   *  lazily; if it is slow (first visit, bad network) the first track plays rather than waiting. */
  async pickN(i, other = false) {
    // repeating a genre waits for its list: the next song must be a different one
    const list = other ? await radioOf(i) : await Promise.race([radioOf(i), new Promise((r) => setTimeout(() => r(null), 400))]);
    if (!list || list.length < 2) return 0;
    // arriving at a genre keeps the old "few demo songs" feel (first 6); repeat-genre and "another" use the whole radio list
    const pool = [...Array(other ? list.length : Math.min(6, list.length)).keys()];
    const heard = this.heardN.get(i) || new Set(), last = this.lastN.get(i);
    let cand = pool.filter((n) => !heard.has(n));
    if (!cand.length) { for (const n of pool) heard.delete(n); cand = pool.filter((n) => n !== last); }
    if (!cand.length) return 0;
    return cand[Math.floor(Math.random() * cand.length)];
  }

  /** Play another song of genre i, random among the ones not heard yet (never a repeat until the whole radio list was played). */
  async another(i) {
    const list = await radioOf(i);
    if (list.length < 2) return this.play(i);
    const n = await this.pickN(i, true);
    await this.play(i, { n });
    return n;
  }

  /** Game audio and the main player never play at once: whichever starts last wins. Starting game audio
   *  also cancels a main-player song that is still loading (it would start under the game otherwise). */
  solo(el) {
    this._others.push(el);
    el.addEventListener("play", () => { this._token++; this.fx.pause(); this.plain.pause(); this._setBusy(false); this._ensureAudioCtx(); });
    // the CORS-tagged load failed (CDN without CORS headers, or a dead preview): reload the same URL untagged, no spectrum
    el.addEventListener("error", (ev) => {
      if (!el.crossOrigin || el._plain) return;
      ev.stopImmediatePropagation();
      el._plain = true; el.removeAttribute("crossorigin"); el.load();
      el.play().catch(() => {});
    });
    el.addEventListener("canplay", () => {
      if (el._plain) { if (this.corsOk === undefined) this.corsOk = false; return; }   // loaded only without CORS
      if (el.crossOrigin) { this.corsOk = true; this._tapGame(el); }
    });
  }

  /** Set a game element's source. Asks for CORS (when the CDN allows it) so the spectrum can be analysed. */
  gameSrc(el, url) {
    el._plain = this.corsOk === false || !(window.AudioContext || window.webkitAudioContext);
    if (el._plain) el.removeAttribute("crossorigin"); else el.crossOrigin = "anonymous";
    el.src = url;
  }
  _tapGame(el) {
    if (el._tap || !this._ensureAnalyser()) return;
    try { el._tap = this.actx.createMediaElementSource(el); el._tap.connect(this.analyser); } catch (e) { console.warn(e); }
  }

  /** One analysis step per animation frame for whoever draws: main player or game audio (callers share the frame's `t`). */
  vizTick(t) {
    if (this._vt === t) return;
    this._vt = t;
    const g = this.gamePlaying;
    this.fxa.update(t, g ? (g._tap ? this.analyser : null) : this.realViz ? this.analyser : null, this.playing || !!g);
  }
  get gamePlaying() { return this._others.find((o) => !o.paused && !o.ended) || null; }

  toggle() {
    if (this.current < 0) { this.emit("needpick"); return; }
    this._ensureAudioCtx();
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }
  pause() { this.audio.pause(); }
  stop() { this._token++; this.fx.pause(); this.plain.pause(); }

  next(auto = false) {
    const q = this._queued;
    this._queued = null;
    if (this.repeat === "genre" && this.current >= 0) {
      const i = this.current;
      const n = q && q.from === i && q.mode === "genre" ? Promise.resolve(q.n) : this.pickN(i, true);
      n.then((n) => this.play(i, { auto: true, n }));
      return;
    }
    const mode = this.auto === "off" ? "near" : this.auto;
    const hit = q && q.from === this.current && q.mode === mode;
    // the provider returns a genre index, or { i, n } to play one specific song of it (my routes)
    const r = hit ? q.i : this.nextProvider ? this.nextProvider(mode, this.current) : -1;
    const i = r != null && typeof r === "object" ? r.i : r;
    if (i >= 0) { this.emit("advance", i); this.play(i, { auto, n: hit ? q.n : r?.n }); }
  }
  prev() {
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    const i = this.history.pop();
    if (i != null) { this.current = -1; this.emit("advance", i); this.play(i, { n: this.lastN.get(i) }); }   // same song as before
  }

  seek(frac) {
    const d = this.audio.duration;
    if (isFinite(d)) this.audio.currentTime = clamp(frac, 0, 1) * d;
  }
  /** Repeat: off → this track → this genre → off. Without an argument, step to the next mode. */
  setRepeat(mode) {
    const order = ["off", "track", "genre"];
    this.repeat = mode || order[(order.indexOf(this.repeat) + 1) % order.length];
    this.fx.loop = this.plain.loop = this.repeat === "track";
    this._queued = null;          // a prefetched next pick may belong to the other mode
    const b = $("#p-loop");
    b.dataset.mode = this.repeat;
    b.setAttribute("aria-pressed", this.repeat !== "off");
    b.title = t({ off: "Lặp lại: tắt (L)", track: "Lặp lại bài này (L)", genre: "Lặp lại thể loại này (L)" }[this.repeat]);
    toast(t({ off: "Tắt lặp lại", track: "🔁 Lặp lại bài này", genre: "🔁 Lặp lại thể loại này" }[this.repeat]));
  }
  setAuto(mode) {
    this.auto = mode;
    const b = $("#p-auto");
    b.dataset.mode = mode;
    b.setAttribute("aria-pressed", mode !== "off");
    b.title = t({ off: "Tự chuyển: tắt", near: "Tự chuyển sang thể loại gần giống", random: "Tự chuyển ngẫu nhiên" }[mode]);
    b.setAttribute("aria-label", b.title);
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
    if (this.repeat === "track" || !(left < 8)) return;
    if (this._queued && this._queued.from === this.current) return;
    if (this.repeat === "genre") {      // warm the genre's next song
      const i = this.current, q = this._queued = { from: i, mode: "genre", i, n: 0 };
      this.pickN(i, true).then(async (n) => {
        if (this._queued !== q) return;
        q.n = n;
        const tr = (await radioOf(i))[n] || trackOf(i);
        fetch(SPOTIFY_PREVIEW + tr[0], { priority: "low" }).then((r) => r.arrayBuffer()).catch(() => {});
      });
      return;
    }
    if (!this.nextProvider || this.auto === "off" || this.tourActive) return;
    const mode = this.auto === "off" ? "near" : this.auto;
    const i = this.nextProvider(mode, this.current);
    const q = this._queued = { from: this.current, mode, i, n: 0 };
    if (i < 0) return;
    // pick the next genre's track now, so the URL warmed here is exactly the one next() plays
    this.pickN(i).then(async (n) => {
      if (this._queued !== q) return;
      q.n = n;
      const tr = n ? (await radioOf(i))[n] : trackOf(i);
      if (tr) fetch(SPOTIFY_PREVIEW + tr[0], { priority: "low" }).then((r) => r.arrayBuffer()).catch(() => {});
    });
  }

  _ended() {
    this._state(false);
    if (this.repeat === "track") return;
    if (this.repeat === "genre" || this.auto !== "off" || this.tourActive) this.next(true);
  }

  // ───────────── UI ─────────────
  _bindUI() {
    $("#p-play").onclick = () => this.toggle();
    $("#p-next").onclick = () => this.next();
    $("#p-prev").onclick = () => this.prev();
    $("#p-loop").onclick = () => this.setRepeat();
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
    if (this._vizOn || cover.on) return;   // a modal covers the player: nothing to animate (resumed on "modalchange")
    this._vizOn = true;
    const loop = (t) => {
      if (cover.on) { this._vizOn = false; return; }
      this.vizTick(t);
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

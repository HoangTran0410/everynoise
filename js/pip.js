// Mini player in an always-on-top window (Document Picture-in-Picture, Chrome/Edge 116+). Opens from the player's
// PiP button, and by itself when the user switches tab while music plays (media session "enterpictureinpicture",
// Chrome 134+; Chrome decides when it is allowed and closes that window when the tab is back in front).
// The top shows the album cover / artist photo or one of several live visualizers (cycled by the corner button,
// remembered); prev / play / next float over it on hover (like Spotify's), seek and ♥ + title sit below.
// Built once per window from the player's state; same Emitter events as the main bar.
import { $, store, fmtTime } from "./util.js";
import { t, addStrings } from "./i18n.js";
import { svg } from "./icons.js";
import { likes } from "./likes.js";
import { avatarOf, avatarUrl } from "./covers.js";
import { createViz, VIZ_MODES, VIZ_LABELS_EN } from "./vizdraw.js";

addStrings({
  "Trình phát nổi": "Mini player",
  "Ảnh / hiệu ứng": "Picture / visualizer",
  "Ảnh": "Picture", ...VIZ_LABELS_EN,
  "Trước": "Previous", "Tiếp": "Next", "Phát": "Play", "Tạm dừng": "Pause",
});

const MODE = "nm:pip-mode";
// what the top of the window shows; the corner button steps through them in this order
const MODES = [["art", "Ảnh"], ...VIZ_MODES];
const CSS = `
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:#121218;color:#f1f1f6;font:14px/1.3 Nunito,system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;
  overflow:hidden;user-select:none;-webkit-user-select:none}
.stage{position:relative;flex:1 1 auto;min-height:0;margin:10px 10px 0;border-radius:10px;overflow:hidden;background:var(--c,#333)}
.stage img,.stage canvas,.stage .fb{position:absolute;inset:0;width:100%;height:100%}
.stage img{object-fit:cover}
.stage .fb{display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;font-weight:800;font-size:22px;
  background:linear-gradient(140deg,var(--c,#555),#15151c)}
/* hover layer: dim + prev / play / next in the middle, the mode button in the corner (hidden until the pointer is over the picture) */
.ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:18px;background:rgba(0,0,0,.42);
  opacity:0;transition:opacity .18s}
.stage.hov .ov,.ov:has(:focus-visible){opacity:1}
.mode{position:absolute;top:8px;right:8px;height:30px;min-width:30px;padding:0 8px;gap:6px;border-radius:15px;background:rgba(0,0,0,.5);color:#fff;font-size:12px;font-weight:700}
.mode:hover{background:rgba(0,0,0,.7)}
.mode span:empty{display:none}
.tag{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:4px 10px;border-radius:12px;background:rgba(0,0,0,.6);color:#fff;
  font-size:12px;font-weight:700;opacity:0;transition:opacity .3s;pointer-events:none;white-space:nowrap}
.tag.on{opacity:1}
.seek{padding:10px 12px 0}
/* chunky progress: 6px rounded track, the played part in the genre colour, thumb grows on hover */
.seek input{-webkit-appearance:none;appearance:none;display:block;width:100%;height:16px;margin:0;background:none;cursor:pointer;--v:0%}
.seek input::-webkit-slider-runnable-track{height:6px;border-radius:3px;
  background:linear-gradient(to right,var(--c,#fff) var(--v),rgba(255,255,255,.18) var(--v))}
.seek input::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-4px;border-radius:50%;background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.5);transform:scale(.75);transition:transform .15s}
.seek:hover input::-webkit-slider-thumb,.seek input:active::-webkit-slider-thumb{transform:scale(1.1)}
.seek:hover input::-webkit-slider-runnable-track{height:8px;margin-top:-1px}
.times{display:flex;justify-content:space-between;font-size:11.5px;font-variant-numeric:tabular-nums;color:#a8a8b8;margin-top:4px}
.meta{display:flex;align-items:center;gap:8px;padding:4px 6px 12px 12px;min-width:0}
.meta .txt{flex:1;min-width:0}
.meta b{display:block;font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta small{display:block;color:#a8a8b8;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta small i{font-style:normal;color:var(--c,#a8a8b8)}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center}
button:disabled{opacity:.35;cursor:default}
.ib{width:40px;height:40px;border-radius:50%;flex:none}
.ov .ib{color:#fff}
.ib:hover:not(:disabled){background:rgba(255,255,255,.14)}
.play{width:54px;height:54px;border-radius:50%;background:#fff;color:#121218;flex:none}
.play:hover{transform:scale(1.05)}
.play svg{width:26px;height:26px}
svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.mode svg{width:16px;height:16px}
svg .fill{fill:currentColor;stroke:none}
.like[aria-pressed=true]{color:#ff4d6d}
.like[aria-pressed=true] svg path{fill:currentColor}
`;
const I = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5v14" /><path class="fill" d="M18 6l-9 6 9 6z" /></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M18 5v14" /><path class="fill" d="M6 6l9 6-9 6z" /></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" /></svg>',
  viz: '<svg viewBox="0 0 24 24"><path d="M4 14v-4M8 18V6M12 15V9M16 20V4M20 14v-4" /></svg>',
  pic: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m20.5 16-5-5-8.5 8.5" /></svg>',
};

/** player: Player; song(): the ♥ record of the current track (main.js songRec). Returns { open, supported } or null. */
export function initPip({ player, song }) {
  const supported = "documentPictureInPicture" in window;
  const btn = $("#p-pip");
  if (btn) btn.hidden = !supported;
  if (!supported) return { supported, open: () => {} };

  let win = null, ui = null, mode = store.get(MODE, "art");
  if (mode === "viz") mode = "ring";   // the first version had one visualizer
  if (!MODES.some((m) => m[0] === mode)) mode = "art";
  const img = new Image();   // the picture also drawn in the middle of the visualizer
  img.referrerPolicy = "no-referrer";
  img.crossOrigin = "anonymous";   // i.scdn.co sends ACAO *: the canvas stays readable

  /** Best picture for the current track: album cover (640) > artist photo > none. */
  function picture() {
    const c = $("#p-cover");
    if (c && !c.hidden && c.src) return c.dataset.zoom || c.src;
    const v = avatarOf(player.meta?.artist);
    return v ? avatarUrl(v, 320) : null;
  }

  function build(doc) {
    const st = doc.createElement("style"); st.textContent = CSS; doc.head.append(st);
    doc.title = t("Trình phát nổi");
    doc.body.innerHTML = `
      <div class="stage"><div class="fb"></div><img alt="" hidden><canvas hidden></canvas>
        <div class="ov">
          <button class="ib prev" title="${t("Trước")}" aria-label="${t("Trước")}">${I.prev}</button>
          <button class="play" aria-label="${t("Phát")}"></button>
          <button class="ib next" title="${t("Tiếp")}" aria-label="${t("Tiếp")}">${I.next}</button>
          <button class="mode" title="${t("Ảnh / hiệu ứng")}" aria-label="${t("Ảnh / hiệu ứng")}"></button>
        </div>
        <div class="tag"></div></div>
      <div class="seek"><input type="range" min="0" max="1000" value="0" aria-label="Seek"><div class="times"><span class="cur">0:00</span><span class="dur">0:30</span></div></div>
      <div class="meta"><div class="txt"><b></b><small></small></div>
        <button class="ib like" aria-pressed="false" title="${t("Lưu bài hát")}" aria-label="${t("Lưu bài hát")}">${I.heart}</button></div>`;
    const q = (s) => doc.querySelector(s);
    ui = { doc, stage: q(".stage"), fb: q(".fb"), img: q(".stage img"), cv: q("canvas"), mode: q(".mode"), tag: q(".tag"), seek: q(".seek input"),
      cur: q(".cur"), dur: q(".dur"), title: q(".meta b"), sub: q(".meta small"), play: q(".play"), like: q(".like") };
    // shown while the pointer is over the picture, gone the moment it leaves (or leaves the whole window); a click
    // doesn't keep them up through focus, only keyboard focus does
    const hov = (on) => ui?.stage.classList.toggle("hov", on);
    ui.stage.addEventListener("pointerenter", () => hov(true));
    ui.stage.addEventListener("pointerleave", () => hov(false));
    doc.addEventListener("mouseleave", () => hov(false));
    doc.defaultView.addEventListener("blur", () => hov(false));
    q(".prev").onclick = () => player.prev();
    q(".next").onclick = () => player.next();
    ui.play.onclick = () => player.toggle();
    ui.like.onclick = () => { const r = song(); if (r?.id) likes.toggle(r); };
    ui.mode.onclick = () => {
      mode = MODES[(MODES.findIndex((m) => m[0] === mode) + 1) % MODES.length][0];
      store.set(MODE, mode); paint();
      ui.tag.textContent = t(MODES.find((m) => m[0] === mode)[1]);
      ui.tag.classList.add("on"); clearTimeout(ui.tagT); ui.tagT = setTimeout(() => ui?.tag.classList.remove("on"), 1200);
    };
    let seeking = false;
    ui.seek.oninput = () => { seeking = true; ui.seek.style.setProperty("--v", ui.seek.value / 10 + "%"); };
    ui.seek.onchange = () => { const a = player.audio; if (isFinite(a.duration)) a.currentTime = (ui.seek.value / 1000) * a.duration; seeking = false; };
    ui.isSeeking = () => seeking;
    // keyboard inside the window: space = play/pause, arrows = prev/next
    doc.addEventListener("keydown", (ev) => {
      if (ev.key === " ") { ev.preventDefault(); player.toggle(); }
      else if (ev.key === "ArrowRight") player.next();
      else if (ev.key === "ArrowLeft") player.prev();
    });
  }

  function paint() {
    if (!ui) return;
    const m = player.meta;
    ui.stage.style.setProperty("--c", m?.color || "#555");
    ui.doc.body.style.setProperty("--c", m?.color || "#a8a8b8");
    ui.title.textContent = m ? m.song : t("Bấm vào một thể loại để nghe 🎧");
    ui.sub.innerHTML = "";
    if (m) { ui.sub.append(m.artist + " · "); const i = ui.doc.createElement("i"); i.textContent = m.genre; ui.sub.append(i); }
    const src = picture();
    if (src && img.src !== src) img.src = src;
    if (!src) img.removeAttribute("src");
    const viz = mode !== "art";
    const next = MODES[(MODES.findIndex((m) => m[0] === mode) + 1) % MODES.length];
    ui.mode.innerHTML = (next[0] === "art" ? I.pic : I.viz) + "<span></span>";
    ui.mode.title = ui.mode.ariaLabel = `${t("Ảnh / hiệu ứng")}: ${t(next[1])}`;
    ui.img.hidden = viz || !src;
    if (!viz && src && ui.img.src !== src) ui.img.src = src;
    ui.fb.hidden = viz || !!src;
    ui.fb.textContent = m ? m.genre : "Everynoise";
    ui.cv.hidden = !viz;
    state();
    if (viz) startViz();
  }

  function state() {
    if (!ui) return;
    const p = player.playing;
    ui.play.innerHTML = p ? svg("pause") : svg("play");
    ui.play.title = ui.play.ariaLabel = p ? t("Tạm dừng") : t("Phát");
    const r = song();
    ui.like.disabled = !r?.id;
    ui.like.setAttribute("aria-pressed", String(likes.has(r?.id)));
  }

  function time(cur, dur) {
    if (!ui) return;
    ui.cur.textContent = fmtTime(cur);
    ui.dur.textContent = fmtTime(dur || 30);
    if (!ui.isSeeking() && dur) ui.seek.value = Math.round((cur / dur) * 1000);
    ui.seek.style.setProperty("--v", ui.seek.value / 10 + "%");
  }

  // ── visualizers (all fed by the main player's BeatAnalyser, drawn in the genre colour) ──
  let vizOn = false;
  function startViz() {
    if (vizOn || !win || mode === "art") return;
    vizOn = true;
    const loop = () => {
      if (!win || mode === "art") { vizOn = false; return; }
      const now = performance.now();   // the main window's clock: the analyser's dt must not mix two time bases
      player.vizTick(now);
      draw(now);
      if (player.playing || player.fxa.energy > 0.005 || player.fxa.beat > 0.01 || vz.busy) win.requestAnimationFrame(loop);
      else vizOn = false;
    };
    win.requestAnimationFrame(loop);
  }

  const vz = createViz(img);
  function draw(now) {
    const cv = ui.cv, dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    vz.draw(cv.getContext("2d"), w, h, mode, { a: player.fxa, color: player.meta?.color || "#7c8cff", now, playing: player.playing, dpr });
  }

  async function open() {
    if (win) { win.focus?.(); return; }
    try {
      win = await documentPictureInPicture.requestWindow({ width: 320, height: 400 });
    } catch (e) { console.warn("pip", e); win = null; return; }
    build(win.document);
    paint();
    time(player.audio.currentTime || 0, player.audio.duration || 0);
    btn?.setAttribute("aria-pressed", "true");
    away = document.hidden;
    win.addEventListener("pagehide", () => { win = null; ui = null; vizOn = false; btn?.setAttribute("aria-pressed", "false"); });
  }

  // Like Spotify: the mini player is for while you are elsewhere. Once the user has left the page (other tab / app)
  // and comes back to it, close it. Focus moving into the mini player itself doesn't count as leaving.
  let away = false;
  const left = () => { if (win && !win.document.hasFocus()) away = true; };
  const back = () => { if (win && away && !document.hidden && document.hasFocus()) win.close(); away = false; };
  document.addEventListener("visibilitychange", () => (document.hidden ? (away = !!win) : back()));
  addEventListener("blur", () => setTimeout(left, 50));
  addEventListener("focus", back);

  player.on("track", () => paint());
  player.on("state", (p) => { state(); if (p) startViz(); });
  player.on("time", (c, d) => time(c, d));
  likes.on("change", state);
  $("#p-cover")?.addEventListener("load", () => paint());   // the cover arrives after "track"
  img.onload = () => { if (ui && mode !== "art" && !vizOn) draw(performance.now()); };
  if (btn) btn.onclick = () => (win ? win.close() : open());

  // automatic: Chrome 134+ calls this when the tab loses focus while our audio plays (no user gesture needed)
  try { navigator.mediaSession.setActionHandler("enterpictureinpicture", () => open()); } catch { /* not supported */ }
  return { supported, open, get isOpen() { return !!win; } };
}

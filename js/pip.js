// Mini player in an always-on-top window (Document Picture-in-Picture, Chrome/Edge 116+). Opens from the player's
// PiP button, and by itself when the user switches tab while music plays (media session "enterpictureinpicture",
// Chrome 134+; Chrome decides when it is allowed and closes that window when the tab is back in front).
// The top shows the album cover / artist photo, or a live visualizer (toggle, remembered); the controls are always
// there: prev, play/pause, next, seek, ♥. Built once per window from the player's state; same Emitter events as
// the main bar.
import { $, store, fmtTime } from "./util.js";
import { t, addStrings } from "./i18n.js";
import { svg } from "./icons.js";
import { likes } from "./likes.js";
import { avatarOf, avatarUrl } from "./covers.js";

addStrings({
  "Trình phát nổi": "Mini player",
  "Ảnh / hiệu ứng": "Picture / visualizer",
  "Trước": "Previous", "Tiếp": "Next", "Phát": "Play", "Tạm dừng": "Pause",
});

const MODE = "nm:pip-mode";   // "art" | "viz"
const TAU = Math.PI * 2;
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
.stage .mode{position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:50%;border:0;background:rgba(0,0,0,.45);color:#fff;
  display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.85}
.stage .mode:hover{opacity:1;background:rgba(0,0,0,.65)}
.seek{padding:8px 12px 0}
.seek input{width:100%;accent-color:#fff;height:4px;cursor:pointer}
.times{display:flex;justify-content:space-between;font-size:11px;color:#a8a8b8;margin-top:2px}
.meta{padding:4px 12px 0;min-width:0}
.meta b{display:block;font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta small{display:block;color:#a8a8b8;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta small i{font-style:normal;color:var(--c,#a8a8b8)}
.ctl{display:flex;align-items:center;justify-content:center;gap:10px;padding:6px 10px 10px}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center}
button:disabled{opacity:.35;cursor:default}
.ib{width:38px;height:38px;border-radius:50%}
.ib:hover:not(:disabled){background:rgba(255,255,255,.1)}
.play{width:46px;height:46px;border-radius:50%;background:#fff;color:#121218}
.play:hover{transform:scale(1.05)}
svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
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

  let win = null, ui = null, mode = store.get(MODE, "art") === "viz" ? "viz" : "art";
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
        <button class="mode" title="${t("Ảnh / hiệu ứng")}" aria-label="${t("Ảnh / hiệu ứng")}"></button></div>
      <div class="seek"><input type="range" min="0" max="1000" value="0" aria-label="Seek"><div class="times"><span class="cur">0:00</span><span class="dur">0:30</span></div></div>
      <div class="meta"><b></b><small></small></div>
      <div class="ctl">
        <button class="ib prev" title="${t("Trước")}" aria-label="${t("Trước")}">${I.prev}</button>
        <button class="play" aria-label="${t("Phát")}"></button>
        <button class="ib next" title="${t("Tiếp")}" aria-label="${t("Tiếp")}">${I.next}</button>
        <button class="ib like" aria-pressed="false" title="${t("Lưu bài hát")}" aria-label="${t("Lưu bài hát")}">${I.heart}</button>
      </div>`;
    const q = (s) => doc.querySelector(s);
    ui = { doc, stage: q(".stage"), fb: q(".fb"), img: q(".stage img"), cv: q("canvas"), mode: q(".mode"), seek: q(".seek input"),
      cur: q(".cur"), dur: q(".dur"), title: q(".meta b"), sub: q(".meta small"), play: q(".play"), like: q(".like") };
    q(".prev").onclick = () => player.prev();
    q(".next").onclick = () => player.next();
    ui.play.onclick = () => player.toggle();
    ui.like.onclick = () => { const r = song(); if (r?.id) likes.toggle(r); };
    ui.mode.onclick = () => { mode = mode === "viz" ? "art" : "viz"; store.set(MODE, mode); paint(); };
    let seeking = false;
    ui.seek.oninput = () => { seeking = true; };
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
    const viz = mode === "viz";
    ui.mode.innerHTML = viz ? I.pic : I.viz;
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
  }

  // ── visualizer: radial bars in the genre colour around the cover / artist photo as a pulsing disc ──
  let vizOn = false;
  function startViz() {
    if (vizOn || !win || mode !== "viz") return;
    vizOn = true;
    const loop = () => {
      if (!win || mode !== "viz") { vizOn = false; return; }
      const now = performance.now();   // the main window's clock: the analyser's dt must not mix two time bases
      player.vizTick(now);
      draw(now);
      if (player.playing || player.fxa.energy > 0.005 || player.fxa.beat > 0.01) win.requestAnimationFrame(loop);
      else vizOn = false;
    };
    win.requestAnimationFrame(loop);
  }
  function draw(now) {
    const cv = ui.cv, dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d"), a = player.fxa, beat = a.beat, color = player.meta?.color || "#7c8cff";
    const S = Math.min(w, h), cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#101016"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color; ctx.globalAlpha = 0.14 + beat * 0.2; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    const base = S * 0.2 * (1 + beat * 0.12 + a.bass * 0.06), nb = 48;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(now / 12000);
    ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.lineWidth = Math.max(2, S * 0.022);
    ctx.beginPath();
    for (let i = 0; i < nb; i++) {
      const k = Math.floor((i < nb / 2 ? i : nb - 1 - i) * (a.n * 0.6) / (nb / 2));   // bass top + bottom, highs on the sides
      const ang = (i / nb) * TAU, s = Math.sin(ang), c = -Math.cos(ang);
      const r0 = base + S * 0.03, r1 = r0 + S * 0.02 + (a.bands[k] || 0) * S * 0.24;
      ctx.moveTo(s * r0, c * r0); ctx.lineTo(s * r1, c * r1);
    }
    ctx.stroke(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, base, 0, TAU); ctx.clip();
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, cx - base, cy - base, base * 2, base * 2);
    } else {
      ctx.fillStyle = color; ctx.globalAlpha = 0.5 + beat * 0.3; ctx.fillRect(cx - base, cy - base, base * 2, base * 2); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  async function open() {
    if (win) { win.focus?.(); return; }
    try {
      win = await documentPictureInPicture.requestWindow({ width: 320, height: 420 });
    } catch (e) { console.warn("pip", e); win = null; return; }
    build(win.document);
    paint();
    time(player.audio.currentTime || 0, player.audio.duration || 0);
    btn?.setAttribute("aria-pressed", "true");
    win.addEventListener("pagehide", () => { win = null; ui = null; vizOn = false; btn?.setAttribute("aria-pressed", "false"); });
  }

  player.on("track", () => paint());
  player.on("state", (p) => { state(); if (p) startViz(); });
  player.on("time", (c, d) => time(c, d));
  likes.on("change", state);
  $("#p-cover")?.addEventListener("load", () => paint());   // the cover arrives after "track"
  img.onload = () => { if (ui && mode === "viz" && !vizOn) draw(performance.now()); };
  if (btn) btn.onclick = () => (win ? win.close() : open());

  // automatic: Chrome 134+ calls this when the tab loses focus while our audio plays (no user gesture needed)
  try { navigator.mediaSession.setActionHandler("enterpictureinpicture", () => open()); } catch { /* not supported */ }
  return { supported, open, get isOpen() { return !!win; } };
}

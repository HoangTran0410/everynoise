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

addStrings({
  "Trình phát nổi": "Mini player",
  "Ảnh / hiệu ứng": "Picture / visualizer",
  "Ảnh": "Picture", "Vòng sóng": "Ring", "Cột sóng": "Bars", "Dải sóng": "Wave", "Hạt": "Particles", "Đường hầm": "Tunnel",
  "Trước": "Previous", "Tiếp": "Next", "Phát": "Play", "Tạm dừng": "Pause",
});

const MODE = "nm:pip-mode";
// what the top of the window shows; the corner button steps through them in this order
const MODES = [["art", "Ảnh"], ["ring", "Vòng sóng"], ["bars", "Cột sóng"], ["wave", "Dải sóng"], ["orbs", "Hạt"], ["tunnel", "Đường hầm"]];
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
      if (player.playing || player.fxa.energy > 0.005 || player.fxa.beat > 0.01 || parts.length) win.requestAnimationFrame(loop);
      else vizOn = false;
    };
    win.requestAnimationFrame(loop);
  }

  // blurred, darkened picture behind the visualizers: rendered once per picture / size, not every frame
  let bg = null, bgKey = "";
  function backdrop(w, h, color) {
    const key = `${w}x${h}|${img.complete && img.naturalWidth ? img.src : ""}|${color}`;
    if (key === bgKey && bg) return bg;
    bgKey = key;
    bg = bg || document.createElement("canvas");
    bg.width = w; bg.height = h;
    const c = bg.getContext("2d");
    c.fillStyle = "#101016"; c.fillRect(0, 0, w, h);
    if (img.complete && img.naturalWidth) {
      const S = Math.max(w, h) * 1.25;
      c.filter = `blur(${Math.round(Math.min(w, h) / 14)}px) saturate(1.3)`;
      c.drawImage(img, (w - S) / 2, (h - S) / 2, S, S);
      c.filter = "none";
      c.fillStyle = "rgba(10,10,16,.62)"; c.fillRect(0, 0, w, h);
    } else {
      c.fillStyle = color; c.globalAlpha = 0.16; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
    }
    return bg;
  }
  /** The cover as a disc of radius r at (x, y), or a colour disc while it loads. */
  function disc(ctx, x, y, r, color, beat) {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    if (img.complete && img.naturalWidth) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    else { ctx.fillStyle = color; ctx.globalAlpha = 0.5 + beat * 0.3; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.restore();
  }
  /** Band level for position f (0 = lowest), using the musical part of the spectrum. */
  const band = (a, f) => a.bands[Math.min(a.n - 1, Math.floor(f * a.n * 0.7))] || 0;

  const parts = [];   // particles: {x, y, vx, vy, life, r}
  const rings = [];   // tunnel rings: {r, a}
  let lastKicks = -1;

  function draw(now) {
    const cv = ui.cv, dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d"), a = player.fxa, beat = a.beat, color = player.meta?.color || "#7c8cff";
    const S = Math.min(w, h), cx = w / 2, cy = h / 2;
    const kicked = lastKicks >= 0 && a.kicks !== lastKicks;
    lastKicks = a.kicks;
    ctx.drawImage(backdrop(w, h, color), 0, 0);
    ctx.fillStyle = color; ctx.globalAlpha = beat * 0.12; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    ctx.lineCap = "round";

    if (mode === "ring") {   // radial bars around the cover, slowly turning
      const base = S * 0.2 * (1 + beat * 0.12 + a.bass * 0.06), nb = 48;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(now / 12000);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, S * 0.022);
      ctx.beginPath();
      for (let i = 0; i < nb; i++) {
        const f = (i < nb / 2 ? i : nb - 1 - i) / (nb / 2);   // bass top + bottom, highs on the sides
        const ang = (i / nb) * TAU, sn = Math.sin(ang), cs = -Math.cos(ang);
        const r0 = base + S * 0.03, r1 = r0 + S * 0.02 + band(a, f) * S * 0.24;
        ctx.moveTo(sn * r0, cs * r0); ctx.lineTo(sn * r1, cs * r1);
      }
      ctx.stroke(); ctx.restore();
      disc(ctx, cx, cy, base, color, beat);
    } else if (mode === "bars") {   // spectrum from the floor, with falling peak caps and a faint reflection
      const nb = 28, gap = w * 0.012, bw = (w - gap * (nb + 1)) / nb, floor = h * 0.78;
      for (let i = 0; i < nb; i++) {
        const f = i / nb, v = band(a, f), pk = a.peaks[Math.min(a.n - 1, Math.floor(f * a.n * 0.7))] || 0;
        const x = gap + i * (bw + gap), bh = Math.max(S * 0.01, v * floor * 0.85);
        ctx.fillStyle = color; ctx.globalAlpha = 0.95;
        ctx.beginPath(); ctx.roundRect(x, floor - bh, bw, bh, Math.min(bw / 2, 6 * dpr)); ctx.fill();
        ctx.globalAlpha = 0.18; ctx.fillRect(x, floor + 2 * dpr, bw, bh * 0.3);
        ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.fillRect(x, floor - pk * floor * 0.85 - 4 * dpr, bw, 2 * dpr);
      }
      ctx.globalAlpha = 1;
    } else if (mode === "wave") {   // a mirrored ribbon: lows in the middle, highs at the edges, breathing with the bass
      const n = 24, amp = h * 0.36 * (0.7 + a.bass * 0.3);
      const ys = (sgn) => {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const x = (i / n) * w, f = Math.abs(i / n - 0.5) * 2;
          const wob = Math.sin(now / 420 + i * 0.7) * 0.06;
          pts.push([x, cy + sgn * (band(a, f) * 0.9 + 0.04 + wob * a.energy) * amp]);
        }
        return pts;
      };
      const curve = (pts, join) => {
        join ? ctx.lineTo(pts[0][0], pts[0][1]) : ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        ctx.lineTo(pts.at(-1)[0], pts.at(-1)[1]);
      };
      for (const [k, alpha] of [[1, 0.35], [0.6, 0.85]]) {
        const top = ys(-1).map(([x, y]) => [x, cy + (y - cy) * k]), bot = ys(1).map(([x, y]) => [x, cy + (y - cy) * k]);
        ctx.beginPath(); curve(top); curve(bot.reverse(), true); ctx.closePath();
        ctx.fillStyle = color; ctx.globalAlpha = alpha; ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#fff"; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (mode === "orbs") {   // sparks thrown out from the cover on every kick, a halo that follows the energy
      const base = S * 0.17 * (1 + beat * 0.15);
      if (kicked || (player.playing && Math.random() < a.energy * 0.25)) {
        const k = kicked ? 18 : 2;
        for (let i = 0; i < k; i++) {
          const ang = Math.random() * TAU, sp = S * (0.004 + Math.random() * 0.01) * (kicked ? 1 + beat : 0.6);
          parts.push({ x: cx + Math.cos(ang) * base, y: cy + Math.sin(ang) * base, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
            life: 1, r: S * (0.006 + Math.random() * 0.012) });
        }
      }
      ctx.fillStyle = color;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.vy *= 0.985; p.life -= 0.012;
        if (p.life <= 0 || parts.length > 400) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = p.life; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + p.life * 0.5), 0, TAU); ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, cy, base, cx, cy, base * (1.6 + a.energy));
      g.addColorStop(0, color); g.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.35 + beat * 0.4; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, base * (1.6 + a.energy), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      disc(ctx, cx, cy, base, color, beat);
    } else if (mode === "tunnel") {   // rings born on each kick fly outward; a band-shaped polygon spins in the middle
      if (kicked) rings.push({ r: S * 0.12, a: 0.9 });
      if (rings.length > 24) rings.shift();
      ctx.strokeStyle = color;
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg = rings[i];
        rg.r *= 1.022 + a.energy * 0.02; rg.a *= 0.975;
        if (rg.a < 0.02 || rg.r > S) { rings.splice(i, 1); continue; }
        ctx.globalAlpha = rg.a; ctx.lineWidth = Math.max(1.5, rg.r * 0.04);
        ctx.beginPath(); ctx.arc(cx, cy, rg.r, 0, TAU); ctx.stroke();
      }
      const n = 36, base = S * 0.16;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-now / 6000);
      ctx.globalAlpha = 0.9; ctx.lineWidth = Math.max(1.5, S * 0.008); ctx.beginPath();
      const pt = (i) => { const f = (i < n / 2 ? i : n - i) / (n / 2), r = base * (1.05 + band(a, f) * 0.7), ang = (i / n) * TAU; return [Math.cos(ang) * r, Math.sin(ang) * r]; };
      let [px, py] = pt(0), [qx, qy] = pt(1);
      ctx.moveTo((px + qx) / 2, (py + qy) / 2);
      for (let i = 1; i <= n; i++) {   // smooth closed curve through the mid-points
        [px, py] = pt(i % n); [qx, qy] = pt((i + 1) % n);
        ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
      }
      ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
      disc(ctx, cx, cy, base * (0.85 + beat * 0.1), color, beat);
    }
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

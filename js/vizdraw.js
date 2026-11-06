// Music visualizers shared by the mini player (pip.js) and the genre panel (main.js): one factory per canvas, so the
// particle / ring state and the blurred backdrop cache stay per surface. Every mode reads the player's BeatAnalyser
// (bands 0..1, peaks, bass, beat, energy, kicks) and draws in the genre colour; the picture (album cover / artist
// photo) sits in the middle of the round modes.
// The low-end shape (beat.js `spec`) and the Aura mode follow ifocus (github.com/HoangTran0410/ifocus), whose Trap
// Nation renderer comes from caseif/vis.js.
const TAU = Math.PI * 2;

/** [id, Vietnamese label] in the order the mode buttons step through them. */
export const VIZ_MODES = [["aura", "Hào quang"], ["mirror", "Gương"], ["ring", "Vòng sóng"], ["bars", "Cột sóng"], ["wave", "Dải sóng"], ["orbs", "Hạt"], ["tunnel", "Đường hầm"]];
export const VIZ_LABELS_EN = { "Hào quang": "Aura", "Gương": "Mirror", "Vòng sóng": "Ring", "Cột sóng": "Bars", "Dải sóng": "Wave", "Hạt": "Particles", "Đường hầm": "Tunnel" };
/** Modes drawn around a centre point: they want a squarer canvas. */
export const ROUND = new Set(["aura", "ring", "orbs", "tunnel"]);

/** "#rrggbb" → [h, s, l] (deg, %, %). */
function hsl(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "") || [0, "88", "88", "ff"];
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
// Trap Nation ghosts (after caseif/vis.js, as used in ifocus): each layer is the shape from `delay` frames ago,
// pushed out by `exp`, drawn back to front, so a kick leaves a coloured trail behind the white front layer.
// Colours are hue steps around the genre colour instead of a fixed rainbow.
const GHOSTS = [[1, 0, 0, null], [1.12, 1, 18, 62], [1.14, 2, -18, 52], [1.3, 3, 40, 60], [1.33, 4, -40, 40], [1.36, 5, 70, 50], [1.5, 6, -70, 58], [1.52, 7, 110, 46]];

/** img: an Image (may be unloaded / without src). */
export function createViz(img) {
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
  // The shape: a.spec (25 smooth low-end points, beat.js), read at f (0 = deepest), linearly interpolated.
  const band = (a, f) => {
    const sp = a.spec;
    if (!sp) return a.bands[Math.min(a.n - 1, Math.floor(f * a.n * 0.7))] || 0;
    const x = Math.max(0, Math.min(1, f)) * (sp.length - 1), i = Math.floor(x), j = Math.min(sp.length - 1, i + 1);
    return sp[i] + (sp[j] - sp[i]) * (x - i);
  };
  const caps = new Float32Array(64), capHold = new Float32Array(64);   // peak caps for the bar modes
  const cap = (i, v, dt) => {
    if (v >= caps[i]) { caps[i] = v; capHold[i] = 0.25; }
    else if ((capHold[i] -= dt) <= 0) caps[i] = Math.max(v, caps[i] - dt * 0.9);
    return caps[i];
  };
  const hist = [];   // aura: recent shapes, newest last
  let lastNow = 0;

  const parts = [];   // particles: {x, y, vx, vy, life, r}
  const rings = [];   // tunnel rings: {r, a}
  let lastKicks = -1;


  /** Draws one frame. o = { a: BeatAnalyser, color, now, playing, dpr, backdrop: blurred picture behind (else transparent) }. */
  function draw(ctx, w, h, mode, { a, color, now, playing, dpr = 1, backdrop: bgOn = true }) {
    const beat = a.beat, S = Math.min(w, h), cx = w / 2, cy = h / 2;
    const dt = Math.min(0.1, Math.max(0.001, (now - (lastNow || now - 16)) / 1000));
    lastNow = now;
    const kicked = lastKicks >= 0 && a.kicks !== lastKicks;
    lastKicks = a.kicks;
    if (bgOn) {
      ctx.drawImage(backdrop(w, h, color), 0, 0);
      ctx.fillStyle = color; ctx.globalAlpha = beat * 0.12; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    } else ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";

    if (mode === "aura") {   // Trap Nation: mirrored half-circle shape, smooth curve, ghost trail, the cover in the middle
      const N = 25, sp = new Float32Array(N);
      for (let i = 0; i < N; i++) sp[i] = band(a, i / (N - 1));
      hist.push(sp); if (hist.length > GHOSTS.length) hist.shift();
      const maxR = S * 0.26, minR = maxR / 5;
      let avg = 0; for (let i = 0; i < N; i++) avg += sp[i]; avg /= N;
      const tr = 1.2, mult = Math.min(1, Math.max(0.3, (1 / (tr - 1)) * (-Math.pow(avg, tr) + tr * avg)));
      const R = mult * (maxR - minR) * 0.8 + minR + a.bass * maxR * 0.06;
      const [hh, ss, ll] = hsl(color);
      for (let g = GHOSTS.length - 1; g >= 0; g--) {
        const [ex, delay, dh, lt] = GHOSTS[g], cur = hist[Math.max(0, hist.length - 1 - delay)];
        const pts = [];
        for (let i = 0; i < N; i++) {
          const t = Math.PI * (i / (N - 1)) - Math.PI / 2, r = R + cur[i] * maxR * 0.34 * (1 + (ex - 1) * 2.2);   // later ghosts reach further (size-independent)
          pts.push([r * Math.cos(t), r * Math.sin(t)]);
        }
        ctx.fillStyle = lt == null ? "#fff" : `hsl(${hh + dh} ${Math.max(55, ss)}% ${lt}%)`;
        ctx.globalAlpha = lt == null ? 1 : 0.85;
        ctx.beginPath();
        for (const sx of [1, -1]) {   // right half, then mirrored left half
          ctx.moveTo(cx, cy + pts[0][1]);
          for (let i = 1; i < N - 2; i++) ctx.quadraticCurveTo(cx + sx * pts[i][0], cy + pts[i][1], cx + sx * (pts[i][0] + pts[i + 1][0]) / 2, cy + (pts[i][1] + pts[i + 1][1]) / 2);
          ctx.quadraticCurveTo(cx + sx * pts[N - 2][0], cy + pts[N - 2][1], cx + sx * pts[N - 1][0], cy + pts[N - 1][1]);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      disc(ctx, cx, cy, R, color, beat);
    } else if (mode === "mirror") {   // NCS-style: bass in the middle, mirrored left/right and up/down, peak caps
      const N = 24, slots = N * 2, bw = w / slots, H = h * (bgOn ? 0.6 : 0.92);
      ctx.fillStyle = color;
      for (let s = 0; s < slots; s++) {
        const k = s < N ? N - 1 - s : s - N, v = band(a, k / (N - 1)), bh = Math.max(3, v * H);
        const x = s * bw + bw * 0.16, bwi = bw * 0.68;
        ctx.globalAlpha = 0.45 + v * 0.55;
        ctx.beginPath(); ctx.roundRect(x, cy - bh / 2, bwi, bh, bwi / 2); ctx.fill();
        const pk = s < N ? cap(k, v, dt) : caps[k];   // one cap per point, shared by both halves
        if (pk >= 0.05) {
          const off = Math.max(3, pk * H) / 2 + 3;
          ctx.globalAlpha = 0.85; ctx.fillRect(x, cy - off - 2, bwi, 2); ctx.fillRect(x, cy + off, bwi, 2);
        }
      }
      ctx.globalAlpha = 1;
    } else if (mode === "ring") {   // radial bars around the cover, slowly turning
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
        const f = Math.abs(i - (nb - 1) / 2) / ((nb - 1) / 2), v = band(a, f), pk = cap(i, v, dt);   // deepest in the middle, symmetric
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
      if (kicked || (playing && Math.random() < a.energy * 0.25)) {
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

  return { draw, get busy() { return parts.length > 0 || rings.length > 0; } };
}

// Music visualizers shared by the mini player (pip.js) and the genre panel (main.js): one factory per canvas, so the
// particle / ring state and the blurred backdrop cache stay per surface. Every mode reads the player's BeatAnalyser
// (bands 0..1, peaks, bass, beat, energy, kicks) and draws in the genre colour; the picture (album cover / artist
// photo) sits in the middle of the round modes.
const TAU = Math.PI * 2;

/** [id, Vietnamese label] in the order the mode buttons step through them. */
export const VIZ_MODES = [["mirror", "Gương"], ["ring", "Vòng sóng"], ["bars", "Cột sóng"], ["wave", "Dải sóng"], ["orbs", "Hạt"], ["tunnel", "Đường hầm"]];
export const VIZ_LABELS_EN = { "Gương": "Mirror", "Vòng sóng": "Ring", "Cột sóng": "Bars", "Dải sóng": "Wave", "Hạt": "Particles", "Đường hầm": "Tunnel" };
/** Modes drawn around a centre point: they want a squarer canvas. */
export const ROUND = new Set(["ring", "orbs", "tunnel"]);

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
  const band = (a, f) => a.bands[Math.min(a.n - 1, Math.floor(f * a.n * 0.7))] || 0;

  const parts = [];   // particles: {x, y, vx, vy, life, r}
  const rings = [];   // tunnel rings: {r, a}
  let lastKicks = -1;


  /** Draws one frame. o = { a: BeatAnalyser, color, now, playing, dpr, backdrop: blurred picture behind (else transparent) }. */
  function draw(ctx, w, h, mode, { a, color, now, playing, dpr = 1, backdrop: bgOn = true }) {
    const beat = a.beat, S = Math.min(w, h), cx = w / 2, cy = h / 2;
    const kicked = lastKicks >= 0 && a.kicks !== lastKicks;
    lastKicks = a.kicks;
    if (bgOn) {
      ctx.drawImage(backdrop(w, h, color), 0, 0);
      ctx.fillStyle = color; ctx.globalAlpha = beat * 0.12; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    } else ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";

    if (mode === "mirror") {   // NCS-style: bass in the middle, mirrored left/right and up/down, peak caps, swelling on kicks
      const n = a.n, slots = n * 2, bw = w / slots, boost = 1 + beat * 0.18, H = h * (bgOn ? 0.6 : 0.92);
      ctx.fillStyle = color;
      for (let s = 0; s < slots; s++) {
        const k = s < n ? n - 1 - s : s - n;
        const v = Math.min(1, a.bands[k] * boost), bh = Math.max(3, v * H);
        const x = s * bw + bw * 0.16, bwi = bw * 0.68;
        ctx.globalAlpha = 0.45 + v * 0.55;
        ctx.beginPath(); ctx.roundRect(x, cy - bh / 2, bwi, bh, bwi / 2); ctx.fill();
        const pk = Math.min(1, a.peaks[k] * boost);
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

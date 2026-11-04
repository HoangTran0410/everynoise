// "Hộ chiếu âm nhạc" / "Music passport": a shareable 1080×1350 card built from the genres heard.
import { $, el, toast } from "./util.js";
import { model, famLabel, famEmoji } from "./data.js";
import { t, fmtN } from "./i18n.js";
import { RANKS, rankOf, nextRank, stampsOf, flag, ready as worldReady } from "./ranks.js";
import { label } from "./world.js";

const W = 1080, H0 = 1350;
export const levelOf = rankOf;   // ranks live in ranks.js

/** Rarest = most isolated on the map: fewest other genres within R px of Every Noise space
 *  (same x/y as `nearest()`), ties → fewer sub-genres (`k`), then name. `s` is a local-scene
 *  place name (not popularity), so it is not used. Grid-bucketed: O(n) for the whole set. */
const R = 45;
let grid = null;
function buildGrid() {
  grid = new Map();
  for (const g of model.G) {
    const key = ((g.x / R) | 0) * 100000 + ((g.y / R) | 0);
    const a = grid.get(key); a ? a.push(g) : grid.set(key, [g]);
  }
}
function crowd(g) {
  const cx = (g.x / R) | 0, cy = (g.y / R) | 0;
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = grid.get((cx + dx) * 100000 + cy + dy);
    if (a) for (const h of a) if (h !== g && Math.hypot(h.x - g.x, h.y - g.y) <= R) n++;
  }
  return n;
}

/** Everything the card shows, from the list of heard genre objects (listening order). */
export function passportStats(heard, favCount) {
  if (!grid) buildGrid();
  const countries = new Set(), fam = new Map();
  let rare = null, rc = Infinity;
  for (const g of heard) {
    if (g.co) countries.add(g.co);
    const f = g.f[0]; if (f) fam.set(f, (fam.get(f) || 0) + 1);
    const c = crowd(g) * 1000 + g.k;
    if (c < rc || (c === rc && g.n < rare.n)) { rc = c; rare = g; }
  }
  const top = [...fam].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
    .map(([f, n]) => ({ f, n, pct: Math.round((n / heard.length) * 100) }));
  return { heard, n: heard.length, total: model.G.length, countries: countries.size, top, rare,
    first: heard[0], last: heard[heard.length - 1], favs: favCount, level: levelOf(heard.length), stamps: [] };
}

function fit(ctx, text, max) {   // shorten with … until it fits
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1);
  return text + "…";
}

export async function drawCard(canvas, s) {
  try { await document.fonts.ready; } catch { /* ignore */ }
  const earned = (s.stamps || []).filter((x) => x.earned), COLS = 3, ROWS = Math.min(5, Math.ceil(earned.length / COLS));
  const H = H0 + (earned.length ? 90 + ROWS * 68 : 0);   // stamps strip grows the card
  canvas.width = W; canvas.height = H; canvas.style.aspectRatio = `${W} / ${H}`;
  const ctx = canvas.getContext("2d");
  const FF = "Nunito, system-ui, sans-serif";
  const font = (w, px) => (ctx.font = `${w} ${px}px ${FF}`);
  // background
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, "#1a1440"); bg.addColorStop(0.55, "#0e0f24"); bg.addColorStop(1, "#1b0f2e");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  // header
  ctx.fillStyle = "#a99cff"; font(800, 30); ctx.textAlign = "left";
  ctx.fillText("🛂 " + t("HỘ CHIẾU ÂM NHẠC"), 60, 92);
  ctx.textAlign = "right"; ctx.fillStyle = "#ffcf5a"; font(900, 30);
  ctx.fillText(`${s.level[1]} ${t(s.level[2])}`, W - 60, 92);
  // scatter: all genres faint, heard ones bright, at their map x/y
  const sx = 60, sy = 130, sw = W - 120, sh = 500;
  ctx.fillStyle = "rgba(255,255,255,.04)"; ctx.beginPath(); ctx.roundRect(sx - 14, sy - 14, sw + 28, sh + 28, 28); ctx.fill();
  let ymin = Infinity, ymax = -Infinity;
  for (const g of model.G) { if (g.y < ymin) ymin = g.y; if (g.y > ymax) ymax = g.y; }
  const px = (g) => sx + (g.x / 1500) * sw, py = (g) => sy + ((g.y - ymin) / (ymax - ymin)) * sh;
  ctx.fillStyle = "rgba(160,170,210,.16)";
  for (const g of model.G) ctx.fillRect(px(g) - 1, py(g) - 1, 2, 2);
  const r = s.n > 800 ? 3.5 : s.n > 150 ? 5 : 7;
  for (const g of s.heard) {
    const x = px(g), y = py(g);
    ctx.globalAlpha = 0.28; ctx.fillStyle = g.c; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  // headline numbers
  ctx.textAlign = "left"; ctx.fillStyle = "#ffffff"; font(900, 120);
  ctx.fillText(fmtN(s.n), 60, 770);
  const nw = ctx.measureText(fmtN(s.n)).width;
  ctx.fillStyle = "#a3aabd"; font(700, 36);
  ctx.fillText(`/ ${fmtN(s.total)} ${t("thể loại")}`, 60 + nw + 18, 770);
  const chip = (x, y, text) => {
    font(800, 30); const w = ctx.measureText(text).width + 44;
    ctx.fillStyle = "rgba(139,123,255,.2)"; ctx.beginPath(); ctx.roundRect(x, y, w, 56, 28); ctx.fill();
    ctx.fillStyle = "#eef0f6"; ctx.fillText(text, x + 22, y + 38); return x + w + 14;
  };
  let cx = chip(60, 800, `🌍 ${s.countries === 1 ? t("1 quốc gia") : t("{n} quốc gia", { n: fmtN(s.countries) })}`);
  chip(cx, 800, `⭐ ${s.favs === 1 ? t("1 yêu thích") : t("{n} yêu thích", { n: fmtN(s.favs) })}`);
  { const nx = nextRank(s.n), r = s.level, bx = 60, bw = 640;   // rank progress
    ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.roundRect(bx, 878, bw, 14, 7); ctx.fill();
    const pct = nx ? (s.n - r[0]) / (nx[0] - r[0]) : 1;
    ctx.fillStyle = "#ffcf5a"; ctx.beginPath(); ctx.roundRect(bx, 878, Math.max(14, bw * pct), 14, 7); ctx.fill();
    ctx.fillStyle = "#a3aabd"; font(700, 22); ctx.textAlign = "left";
    ctx.fillText(fit(ctx, nx ? `→ ${nx[1]} ${t(nx[2])} · ${fmtN(s.n)}/${fmtN(nx[0])}` : "🏆 " + t("Hạng cao nhất rồi!"), W - 60 - (bx + bw + 20)), bx + bw + 20, 892); }
  // top families
  ctx.fillStyle = "#a99cff"; font(800, 28); ctx.fillText(t("TOP 5 HỌ NHẠC"), 60, 925);
  const colorOf = new Map();
  for (const g of s.heard) if (!colorOf.has(g.f[0])) colorOf.set(g.f[0], g.c);
  s.top.forEach((o, i) => {
    const y = 940 + i * 46;
    ctx.fillStyle = "#eef0f6"; font(800, 28); ctx.textAlign = "left";
    ctx.fillText(fit(ctx, `${famEmoji(o.f)} ${famLabel(o.f)}`, 330), 60, y + 30);
    const bx = 410, bw = 520;
    ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.roundRect(bx, y + 8, bw, 28, 14); ctx.fill();
    ctx.fillStyle = colorOf.get(o.f) || "#8b7bff";
    ctx.beginPath(); ctx.roundRect(bx, y + 8, Math.max(28, (bw * o.pct) / 100), 28, 14); ctx.fill();
    ctx.fillStyle = "#a3aabd"; ctx.textAlign = "right"; ctx.fillText(o.pct + "%", W - 60, y + 30);
  });
  // rarest / first / latest
  ctx.textAlign = "left";
  const row = (i, label, g) => {
    const x = 60 + i * 330;
    ctx.fillStyle = "#a99cff"; font(800, 22); ctx.fillText(label, x, 1206);
    ctx.fillStyle = g.c; ctx.beginPath(); ctx.arc(x + 8, 1238, 7, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#ffffff"; font(800, 28); ctx.fillText(fit(ctx, g.n, 280), x + 24, 1248);
  };
  row(0, "💎 " + t("HIẾM NHẤT"), s.rare);
  row(1, "🌱 " + t("ĐẦU TIÊN"), s.first);
  row(2, "🕒 " + t("GẦN ĐÂY"), s.last);
  if (earned.length) {   // country stamps
    ctx.textAlign = "left"; ctx.fillStyle = "#a99cff"; font(800, 22);
    ctx.fillText("🛂 " + t("DẤU QUỐC GIA") + ` · ${earned.length}`, 60, 1304);
    const cw = (W - 120 - 2 * 14) / COLS, shown = earned.slice(0, COLS * ROWS);
    shown.forEach((o, i) => {
      const x = 60 + (i % COLS) * (cw + 14), y = 1324 + ((i / COLS) | 0) * 68;
      const last = i === shown.length - 1 && earned.length > shown.length;
      ctx.fillStyle = "rgba(255,207,90,.16)"; ctx.beginPath(); ctx.roundRect(x, y, cw, 56, 28); ctx.fill();
      ctx.fillStyle = "#eef0f6"; font(800, 25);
      ctx.fillText(last ? `+${earned.length - shown.length + 1} …` : fit(ctx, `${flag(o.iso)} ${label(o.co, o.iso)}`, cw - 36), x + 18, y + 37);
    });
  }
  ctx.textAlign = "center"; ctx.fillStyle = "#a99cff"; font(800, 30);
  ctx.fillText("everynoise.pages.dev", W / 2, H - 40);
}

export function initPassport({ getVisited, getFavs, isOk, beforeOpen }) {
  const dlg = $("#passport"), cv = $("#pp-canvas"), empty = $("#pp-empty"), acts = $("#pp-actions");
  let stats = null, busy = null;
  const canShareFiles = () => {
    try { return !!navigator.canShare && navigator.canShare({ files: [new File([""], "a.png", { type: "image/png" })] }); } catch { return false; }
  };
  const heardList = () => [...getVisited()].map((n) => model.byName.get(n)).filter((i) => i != null && isOk(model.G[i])).map((i) => model.G[i]);

  async function render() {
    const heard = heardList();
    empty.hidden = heard.length > 0; cv.hidden = acts.hidden = heard.length === 0;
    $("#pp-share").textContent = canShareFiles() ? t("📤 Chia sẻ") : t("💾 Lưu ảnh");
    if (!heard.length) { stats = null; return; }
    stats = passportStats(heard, getFavs().size);
    await worldReady(); stats.stamps = stampsOf(new Set(heard.map((g) => g.n)));
    await drawCard(cv, stats);
  }
  const blob = () => new Promise((res) => cv.toBlob(res, "image/png"));
  const download = (b) => {
    const a = el("a", { href: URL.createObjectURL(b), download: "everynoise-passport.png" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $("#pp-share").onclick = async () => {
    if (!stats) return;
    const b = await blob(); if (!b) return;
    const file = new File([b], "everynoise-passport.png", { type: "image/png" });
    if (canShareFiles() && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: t("Hộ chiếu âm nhạc"), text: "everynoise.pages.dev" }); return; }
      catch (e) { if (e?.name === "AbortError") return; }
    }
    download(b); toast(t("Đã lưu ảnh"));
  };
  const open = () => { beforeOpen?.(); dlg.showModal(); busy = render(); };
  for (const id of ["#ex-passport", "#set-passport"]) $(id).onclick = open;
  addEventListener("langchange", () => { if (dlg.open) busy = render(); });
  return { open, render: () => busy };
}

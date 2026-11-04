// Ranks (by genres heard) and country stamps (>= STAMP_AT genres of one country heard) for the music passport.
// Announces new ranks / stamps once (nm:ranks, nm:stamps), shows rank + progress in the passport dialog and
// the header counter tooltip. Country mapping = g.co (same as world.js), flags from data/world.json iso codes.
import { $, el, store, toast } from "./util.js";
import { model } from "./data.js";
import { t, addStrings, fmtN } from "./i18n.js";
import { label } from "./world.js";

addStrings({
  "Người mới": "Newcomer", "Người nghe": "Listener", "Lữ khách": "Traveller", "Thám hiểm": "Explorer",
  "Nhà thám hiểm": "Adventurer", "Bậc thầy bản đồ": "Map master", "Huyền thoại": "Legend", "Tập nghe": "Beginner",
  "Hạng mới: {r}!": "New rank: {r}!",
  "🛂 Dấu mới: {c}": "🛂 New stamp: {c}",
  "Hạng tiếp theo: {r} ({a}/{b})": "Next rank: {r} ({a}/{b})",
  "Hạng cao nhất rồi!": "Top rank reached!",
  "Còn {n} thể loại nữa để lên {r}": "{n} more genres to reach {r}",
  "DẤU QUỐC GIA": "COUNTRY STAMPS",
  "Dấu quốc gia": "Country stamps",
  "Nghe {n} thể loại của một nước để nhận dấu.": "Hear {n} genres of a country to earn its stamp.",
  "Còn {n} quốc gia chưa nghe": "{n} more countries to discover",
  "Dấu: {n}": "Stamps: {n}",
  "Bạn đã nghe {a} / {b} thể loại": "You have heard {a} / {b} genres",
});

export const RANKS = [   // [min genres heard, emoji, title]
  [2500, "🏆", "Huyền thoại"],
  [1000, "🗺️", "Bậc thầy bản đồ"],
  [400, "🔭", "Nhà thám hiểm"],
  [150, "🧭", "Thám hiểm"],
  [50, "🧳", "Lữ khách"],
  [10, "🎵", "Người nghe"],
  [1, "🎧", "Người mới"],
  [0, "🐣", "Tập nghe"],
];
export const STAMP_AT = 3;
export const rankOf = (n) => RANKS.find((r) => n >= r[0]);
/** Next rank above n, or null at the top. */
export const nextRank = (n) => { let nx = null; for (const r of RANKS) { if (r[0] > n) nx = r; else break; } return nx; };
export const flag = (iso) => iso && iso.length === 2 ? String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌐";

let isoOf = null, loading = null;   // co -> ISO code (only countries/dots that world.json knows)
const loadWorld = () => loading || (loading = fetch("data/world.json").then((r) => r.json()).then((d) => {
  isoOf = new Map();
  for (const c of d.countries) isoOf.set(c.name, c.iso);
  for (const c of d.dots) isoOf.set(c.name, c.iso);
}).catch(() => { isoOf = new Map(); }));

let byCo = null;
const genresByCo = () => {
  if (byCo) return byCo;
  byCo = new Map();
  for (const g of model.G) if (g.co && isoOf.has(g.co)) { if (!byCo.has(g.co)) byCo.set(g.co, []); byCo.get(g.co).push(g.n); }
  return byCo;
};

/** [{co, iso, heard, total, earned}] for every country with >= 1 heard genre (earned first, then closest). Needs loadWorld(). */
export function stampsOf(seen) {
  const out = [];
  for (const [co, names] of genresByCo()) {
    let heard = 0;
    for (const n of names) if (seen.has(n)) heard++;
    if (heard) out.push({ co, iso: isoOf.get(co), heard, total: names.length, earned: heard >= STAMP_AT });
  }
  const need = (s) => (s.earned ? 0 : STAMP_AT - s.heard);
  return out.sort((a, b) => need(a) - need(b) || b.heard - a.heard || a.co.localeCompare(b.co));
}
export const countriesLeft = (seen) => genresByCo().size - stampsOf(seen).length;
export const ready = () => loadWorld();

function burst(emojis) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = el("div", { class: "rk-burst", "aria-hidden": "true" });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * 6.283 + Math.random() * 0.4, d = 90 + Math.random() * 90;
    box.append(el("span", { style: `--dx:${Math.cos(a) * d | 0}px;--dy:${Math.sin(a) * d - 40 | 0}px;animation-delay:${i * 12}ms` }, emojis[i % emojis.length]));
  }
  document.body.append(box); setTimeout(() => box.remove(), 1600);
}

export function initRanks({ player, getVisited }) {
  const visited = () => getVisited();
  let annRanks = store.get("nm:ranks", null), annStamps = store.get("nm:stamps", null);
  const rankIdx = (n) => RANKS.length - 1 - RANKS.indexOf(rankOf(n));   // 0 = lowest

  const tooltip = () => {
    const n = visited().size, r = rankOf(n), nx = nextRank(n);
    return `${r[1]} ${t(r[2])} · ` + t("Bạn đã nghe {a} / {b} thể loại", { a: fmtN(n), b: fmtN(model.G.length) }) +
      (nx ? " · " + t("Hạng tiếp theo: {r} ({a}/{b})", { r: t(nx[2]), a: fmtN(n), b: fmtN(nx[0]) }) : " · " + t("Hạng cao nhất rồi!"));
  };
  const exp = $("#explored");
  const setTip = () => { const s = tooltip(); if (exp.title !== s) exp.title = s; };
  new MutationObserver(setTip).observe(exp, { attributes: true, attributeFilter: ["title"] });

  async function check() {
    await loadWorld();
    const seen = visited(), n = seen.size;
    setTip();
    const rk = rankOf(n)[0];
    const earned = stampsOf(seen).filter((s) => s.earned).map((s) => s.co);
    if (annRanks == null || annStamps == null) {   // first run: whatever was already reached stays silent
      annRanks = annRanks ?? RANKS.filter((r) => n >= r[0]).map((r) => r[0]);
      annStamps = annStamps ?? earned;
      store.set("nm:ranks", annRanks); store.set("nm:stamps", annStamps);
      return;
    }
    const msgs = [], emo = [];
    const newStamps = earned.filter((c) => !annStamps.includes(c));
    for (const c of newStamps) { msgs.push(t("🛂 Dấu mới: {c}", { c: `${flag(isoOf.get(c))} ${label(c, isoOf.get(c))}` })); emo.push("🛂", flag(isoOf.get(c))); }
    if (!annRanks.includes(rk)) {
      annRanks = RANKS.filter((r) => n >= r[0]).map((r) => r[0]);
      if (rk > 0) { const r = rankOf(n); msgs.push(`${r[1]} ` + t("Hạng mới: {r}!", { r: t(r[2]) })); emo.push(r[1], "🎉", "✨"); }
      store.set("nm:ranks", annRanks);
    }
    if (newStamps.length) { annStamps = annStamps.concat(newStamps); store.set("nm:stamps", annStamps); }
    msgs.forEach((m, i) => setTimeout(() => toast(m), i * 2300));
    if (msgs.length) burst(emo.length ? emo : ["🎉"]);
  }
  player.on("track", () => { check(); });
  addEventListener("langchange", setTip);
  check();

  // ── passport dialog: rank + progress above the card, stamp grid below ──
  const dlg = $("#passport");
  if (!dlg) return { check };
  const top = el("div", { class: "rk-box", id: "rk-box" }), grid = el("div", { class: "st-box", id: "st-box" });
  $("#pp-canvas").before(top); $("#pp-actions").after(grid);
  async function paint() {
    await loadWorld();
    const seen = visited(), n = seen.size, r = rankOf(n), nx = nextRank(n);
    top.textContent = ""; grid.textContent = "";
    top.hidden = grid.hidden = n === 0;
    if (!n) return;
    const pct = nx ? Math.round(((n - r[0]) / (nx[0] - r[0])) * 100) : 100;
    top.append(
      el("div", { class: "rk-head" }, el("span", { class: "rk-emoji" }, r[1]), el("b", {}, t(r[2])), el("small", { class: "muted" }, nx ? t("Hạng tiếp theo: {r} ({a}/{b})", { r: `${nx[1]} ${t(nx[2])}`, a: fmtN(n), b: fmtN(nx[0]) }) : t("Hạng cao nhất rồi!"))),
      el("div", { class: "rk-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }, el("i", { style: `width:${pct}%` })));
    const all = stampsOf(seen), got = all.filter((s) => s.earned).length;
    grid.append(el("h3", {}, "🛂 " + t("Dấu quốc gia"), el("span", { class: "muted st-n" }, t("Dấu: {n}", { n: got }))),
      el("p", { class: "muted st-hint" }, t("Nghe {n} thể loại của một nước để nhận dấu.", { n: STAMP_AT })));
    const ul = el("ul", { class: "st-grid" });
    for (const s of all) ul.append(el("li", { class: s.earned ? "st on" : "st", "data-co": s.co },
      el("span", { class: "st-flag", "aria-hidden": "true" }, flag(s.iso)), el("b", {}, label(s.co, s.iso)),
      el("small", {}, s.earned ? `${s.heard}/${s.total}` : `${s.heard}/${STAMP_AT}`)));
    grid.append(ul, el("p", { class: "muted st-hint" }, t("Còn {n} quốc gia chưa nghe", { n: countriesLeft(seen) })));
  }
  new MutationObserver(() => { if (dlg.open) paint(); }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
  addEventListener("langchange", () => { if (dlg.open) paint(); });
  return { check, paint };
}

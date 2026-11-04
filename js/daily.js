// "Thể loại hôm nay": one genre per calendar day, the same for everyone (local date hashed into a pool), no server.
// Card at the top of the Explore dialog, a dot on the Explore button until it is heard, a streak of consecutive days.
import { $, el, store, toast, hash32 } from "./util.js";
import { model, trackOf, nearest, famLabel } from "./data.js";
import { t, addStrings } from "./i18n.js";

addStrings({
  "📅 Thể loại hôm nay": "📅 Genre of the day",
  "📅 Thể loại hôm nay: {g} — bấm để nghe": "📅 Genre of the day: {g} — tap to listen",
  "▶ Nghe": "▶ Listen",
  "Biết chưa?": "Did you know?",
  "🔥 {n} ngày": "🔥 {n} days",
  "Có {k} nhánh con, hàng xóm gần nhất trên bản đồ là {n1} và {n2}.": "{k} sub-genres; its nearest neighbours on the map are {n1} and {n2}.",
  "Hàng xóm gần nhất trên bản đồ là {n1} và {n2}.": "Its nearest neighbours on the map are {n1} and {n2}.",
  "Đến từ {co}, thuộc nhóm {f}.": "From {co}, part of the {f} family.",
  "Thuộc nhóm {f}.": "Part of the {f} family.",
  "Là nhánh con của «{p}».": "A sub-genre of “{p}”.",
  "Bài nghe thử: {s} — {a}.": "Sample track: {s} — {a}.",
});

const KEY = "nm:daily";   // { days: ["YYYY-MM-DD", ...] } days on which the daily genre was heard
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date(Date.now()));
const dayBefore = (s) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d - 1, 12)); };

let pool = null;
/** Kid-safe genres with a demo track and a branch count above the median (not tied to the user's kids mode: same for everyone). */
function getPool() {
  if (pool) return pool;
  const base = model.G.filter((g) => g.kid && trackOf(g.i));
  const ks = base.map((g) => g.k).sort((a, b) => a - b);
  const med = ks[ks.length >> 1] || 0;
  pool = base.filter((g) => g.k > med).map((g) => g.i);
  if (!pool.length) pool = base.map((g) => g.i);
  return pool;
}
/** Genre index for a YYYY-MM-DD date. */
export function dailyFor(dateStr) { const p = getPool(); return p.length ? p[hash32("everynoise-daily-" + dateStr) % p.length] : -1; }

const days = () => new Set(store.get(KEY, {}).days || []);
export const heardToday = () => days().has(today());
export function streak() {
  const s = days(); let d = today(), n = 0;
  if (!s.has(d)) d = dayBefore(d);   // today not heard yet: the streak so far is still alive until midnight
  while (s.has(d)) { n++; d = dayBefore(d); }
  return n;
}

/** Data-only one-liner; picks (by date) among the templates that have all their values. */
export function factFor(i, dateStr = today()) {
  const g = model.G[i], opts = [];
  const nb = nearest(i, 2, (h) => h.kid).map((x) => model.G[x[0]].n);
  if (nb.length === 2 && g.k > 0) opts.push(t("Có {k} nhánh con, hàng xóm gần nhất trên bản đồ là {n1} và {n2}.", { k: g.k, n1: nb[0], n2: nb[1] }));
  else if (nb.length === 2) opts.push(t("Hàng xóm gần nhất trên bản đồ là {n1} và {n2}.", { n1: nb[0], n2: nb[1] }));
  const f = g.f[0] ? famLabel(g.f[0]) : "";
  if (g.co && f) opts.push(t("Đến từ {co}, thuộc nhóm {f}.", { co: g.co, f }));
  else if (f) opts.push(t("Thuộc nhóm {f}.", { f }));
  const par = g.p.find((p) => model.byName.has(p));
  if (par) opts.push(t("Là nhánh con của «{p}».", { p: par }));
  const tr = trackOf(i);
  if (tr && tr[2] && tr[3]) opts.push(t("Bài nghe thử: {s} — {a}.", { s: tr[3], a: tr[2] }));
  return opts.length ? opts[hash32(dateStr + g.n) % opts.length] : "";
}

/** play(i): select the genre on the map, fly there and play it. */
export function initDaily({ player, play }) {
  const card = el("section", { class: "daily-card", id: "daily-card" });
  $("#explore .ex-h").before(card);
  const dot = el("span", { class: "daily-dot", hidden: true, "aria-hidden": "true" });
  $("#btn-explore").append(dot);
  let cur = -1;

  const listen = () => { $("#explore").close(); play(cur); };
  function mark() {
    const s = days(), d = today();
    if (s.has(d)) return;
    s.add(d); store.set(KEY, { days: [...s].sort().slice(-400) });
    render();
  }
  function render() {
    cur = dailyFor(today());
    if (cur < 0) { card.hidden = true; return; }
    const g = model.G[cur], heard = heardToday(), n = streak();
    dot.hidden = heard; card.hidden = false;
    card.replaceChildren(
      el("div", { class: "daily-top" },
        el("span", { class: "daily-lbl" }, t("📅 Thể loại hôm nay")),
        n >= 2 ? el("span", { class: "daily-streak" }, t("🔥 {n} ngày", { n })) : null),
      el("div", { class: "daily-main" },
        el("span", { class: "daily-c", style: `background:${g.c}` }),
        el("div", { class: "daily-txt" },
          el("b", { class: "daily-name" }, g.n),
          el("small", {}, [g.co, g.f[0] ? famLabel(g.f[0]) : ""].filter(Boolean).join(" · "))),
        el("button", { class: "btn primary daily-play", id: "daily-play", onclick: listen }, (heard ? "✓ " : "") + t("▶ Nghe"))),
      el("p", { class: "daily-fact" }, el("b", {}, t("Biết chưa?") + " "), factFor(cur)));
  }

  player.on("track", (m) => { if (m && cur >= 0 && m.i === cur) mark(); });
  $("#btn-explore").addEventListener("click", render);
  const midnight = () => {
    const n = new Date(Date.now()), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
    setTimeout(() => { render(); midnight(); }, Math.max(1000, next - n));
  };
  midnight();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && dailyFor(today()) !== cur) render(); });
  window.__dailyFor = dailyFor;
  card.hidden = true;
  // the pool needs the demo tracks, which load in the background
  model.tracksReady.then(() => {
    render();
    // returning users, first visit of the day: a toast that plays it on tap
    if (store.get("nm:welcomed", false) && cur >= 0 && store.get("nm:daily-toast", "") !== today() && !heardToday()) {
      store.set("nm:daily-toast", today());
      toast(t("📅 Thể loại hôm nay: {g} — bấm để nghe", { g: model.G[cur].n }));
      const tt = $("#toast");
      tt.style.cursor = "pointer";
      tt.onclick = () => { tt.hidden = true; tt.onclick = null; play(cur); };
      setTimeout(() => { tt.onclick = null; tt.style.cursor = ""; }, 2100);
    }
  });
  return { render, get index() { return cur; } };
}

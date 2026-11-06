// One-line, kid-friendly explanation of the selected genre (#d-explain in the detail panel).
// data/explain.json is fetched lazily once; the sentence is composed by js/explain-core.js.
import { model } from "./data.js";
import { lang, t } from "./i18n.js";
import { el } from "./util.js";
import { parseExplain, compose } from "./explain-core.js";

let X = null, loading = null, current = -1;

function load() {
  if (!loading) {
    loading = fetch("data/explain.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("explain.json " + r.status))))
      .then((j) => { X = parseExplain(j); return X; })
      .catch((e) => { console.warn(e); loading = null; return null; });
  }
  return loading;
}

export function sentence(i, l = lang) {
  const g = model.G[i];
  if (!X || !g) return "";
  return compose(X, g, i, l);
}

// ── facts carousel: the composed sentence is fact 1, then "born … · from …" (Wikidata), then facts written from
// the genre's Wikipedia intro (data/facts/<i % 32>.json, scripts/build_facts.mjs); ‹ › step through them ──
const SH = 32, shardP = new Map();
let pos = 0;
function factsOf(i) {
  const k = i % SH;
  if (!shardP.has(k)) shardP.set(k, fetch(`data/facts/${k}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => { shardP.delete(k); return {}; }));
  return shardP.get(k).then((s) => s[i] || null);
}
const known = new Map();   // genre index -> its facts record (null = none), once loaded
function list(i) {
  const out = [];
  const s = sentence(i);
  if (s) out.push(s);
  const r = known.get(i);
  if (!r) return out;
  const vi = lang !== "en";
  // a round year (1960, 1500) is usually a decade/century estimate: say "around"
  const when = r.y ? t(r.y % 10 ? "📅 Ra đời năm {y}" : "📅 Ra đời khoảng năm {y}", { y: r.y }) : "";
  const where = r.o ? t("📍 khởi nguồn: {p}", { p: r.o.map((x) => x[vi ? 0 : 1]).join(", ") }) : "";
  if (when || where) out.push([when, where].filter(Boolean).join(" · "));
  for (const f of r.f || []) out.push("💡 " + f[vi ? 0 : 1]);
  return out;
}
function paint() {
  const p = document.getElementById("d-explain"), nav = document.getElementById("fact-nav");
  if (!p) return;
  if (current < 0) { p.textContent = ""; if (nav) nav.hidden = true; return; }
  const l = list(current);
  if (pos >= l.length) pos = 0;
  p.textContent = l[pos] || "";
  p.hidden = !p.textContent;
  if (nav) {
    nav.hidden = l.length < 2;
    document.getElementById("fact-n").textContent = `${pos + 1}/${l.length}`;
  }
}
function step(d) {
  if (current < 0) return;
  const n = list(current).length;
  if (n < 2) return;
  pos = (pos + d + n) % n;
  paint();
}
document.getElementById("fact-prev")?.addEventListener("click", () => step(-1));
document.getElementById("fact-next")?.addEventListener("click", () => step(1));

// Call from the detail panel every time a genre is selected.
export function showExplain(i) {
  if (i !== current) pos = 0;
  current = i;
  paint();
  if (!X) load().then(() => { if (current === i) paint(); });
  if (i >= 0 && !known.has(i)) factsOf(i).then((r) => { known.set(i, r); if (current === i) paint(); });
}

addEventListener("langchange", paint);
/** The genre's written facts (no 💡 prefix) in the current language; [] when it has none. */
export function factsFor(i) {
  return (known.has(i) ? Promise.resolve(known.get(i)) : factsOf(i).then((r) => (known.set(i, r), r)))
    .then((r) => (r?.f || []).map((f) => f[lang !== "en" ? 0 : 1]));
}
const ARROW = { prev: "M15 5l-7 7 7 7", next: "M9 5l7 7-7 7" };
/** Self-contained fact box for game answer screens: opens on the first 💡 fact (else the description), ‹ › browse all. */
export function factCard(i) {
  const p = el("p", { class: "g-fact", "aria-live": "polite" });
  const n = el("span", { class: "fact-n" });
  const btn = (k, d) => {
    const b = el("button", { class: "icon-btn fact-btn", "aria-label": t(k === "prev" ? "Điều thú vị trước" : "Điều thú vị tiếp"), onclick: () => { touched = true; const c = list(i).length; if (c > 1) { pos = (pos + d + c) % c; paint(); } } });
    b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ARROW[k]}" /></svg>`;
    return b;
  };
  const nav = el("div", { class: "fact-nav" }, btn("prev", -1), n, btn("next", 1));
  const box = el("div", { class: "g-facts", hidden: true }, p, nav);
  let pos = -1, touched = false;
  function paint() {
    const l = list(i);
    if (!touched) pos = Math.max(0, l.findIndex((s) => s.startsWith("💡")));
    if (pos >= l.length) pos = 0;
    p.textContent = l[pos] || "";
    box.hidden = !l.length;
    nav.hidden = l.length < 2;
    n.textContent = `${pos + 1}/${l.length}`;
  }
  Promise.all([load(), known.has(i) ? null : factsOf(i).then((r) => known.set(i, r))]).then(paint);
  paint();
  return box;
}

window.__explain = { sentence: (i, l) => sentence(i, l || lang), ready: () => load().then(() => true), facts: (i) => list(i), step };

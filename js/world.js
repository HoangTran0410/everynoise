// "Nhạc khắp thế giới": a world map where each country is coloured by how many genres it has.
// Tap a country -> its genres (play one, or play them all as a tour). Shapes come from
// data/world.json (built once by scripts/build_world.py), fetched lazily on first open.
import { $, el, toast } from "./util.js";
import { model, famEmoji } from "./data.js";
import { t, lang, fmtN } from "./i18n.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
// `co` values that are regions, not countries (no shape): chips under the map. Vietnamese names; English = the data name.
const REGION_VI = { "Africa": "Châu Phi", "Arab world": "Thế giới Ả Rập", "Balkans": "Balkan", "Kurdistan": "Kurdistan",
  "Latin America": "Mỹ Latin", "Nordics": "Bắc Âu", "Tibet": "Tây Tạng" };
const LEVELS = [1, 2, 5, 15, 40];   // genre-count thresholds for colour levels 1..5
const level = (n) => (n ? 1 + LEVELS.filter((x) => n >= x).length - 1 : 0);

let dn = null, dnLang = "";
/** Country name in the UI language: Intl.DisplayNames from the ISO code (vi + en), regions from REGION_VI. */
export function label(co, iso) {
  if (lang === "vi" && REGION_VI[co]) return REGION_VI[co];
  if (!iso) return co;
  try {
    if (dnLang !== lang) { dn = new Intl.DisplayNames([lang], { type: "region" }); dnLang = lang; }
    return dn.of(iso) || co;
  } catch { return co; }
}

export function initWorld({ isOk, visited, play, playOne, openPicker }) {
  const dlg = $("#world"), box = $("#world-map"), sheet = $("#world-sheet");
  let data = null, loading = null, svg = null, gMap = null, sel = "";
  const nodes = new Map();      // co -> [svg nodes]
  const isos = new Map();       // co -> ISO code
  let byCo = null;              // co -> genre indices (all), built once
  let rows = [];                // [{ co, list }] under the current kids filter
  const view = { x: 0, y: 0, w: 1000, h: 400 };
  let full = view, raf = 0;

  const load = () => loading || (loading = fetch("data/world.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("world.json " + r.status)))).then((d) => (data = d)));

  function build() {
    const [vx, vy, vw, vh] = data.viewBox.split(" ").map(Number);
    full = { x: vx, y: vy, w: vw, h: vh }; Object.assign(view, full);
    box.style.aspectRatio = `${vw} / ${vh}`;
    svg = svgEl("svg", { viewBox: data.viewBox, role: "group", "aria-label": t("🌍 Nhạc khắp thế giới") });
    gMap = svgEl("g", {});
    for (const c of data.countries) {
      const p = svgEl("path", { d: c.d, "data-co": c.name, class: "wc" });
      gMap.append(p); nodes.set(c.name, [p]); isos.set(c.name, c.iso);
    }
    for (const d of data.dots) {
      const g = svgEl("g", { "data-co": d.name, class: "wc wd" });
      g.append(svgEl("circle", { cx: d.x, cy: d.y, r: 10 }));
      gMap.append(g); nodes.set(d.name, [g]); isos.set(d.name, d.iso);
    }
    svg.append(gMap);
    box.append(svg);
    wire();
  }

  function genresOf() {
    if (byCo) return;
    byCo = new Map();
    for (const g of model.G) if (g.co) { if (!byCo.has(g.co)) byCo.set(g.co, []); byCo.get(g.co).push(g.i); }
    for (const l of byCo.values()) l.sort((a, b) => (model.G[b].k || 0) - (model.G[a].k || 0) || model.G[a].n.localeCompare(model.G[b].n));
  }
  const listOf = (co) => (byCo.get(co) || []).filter((i) => isOk(model.G[i]));

  /** Recolour (kids mode / heard status can change between opens) and rebuild the chips. */
  function paint() {
    const seen = visited();
    rows = [];
    for (const co of byCo.keys()) rows.push({ co, list: listOf(co) });
    const cnt = new Map(rows.map((r) => [r.co, r.list]));
    for (const [co, ns] of nodes) {
      const l = cnt.get(co) || [];
      const heard = l.some((i) => seen.has(model.G[i].n));
      const cls = `wc${ns[0].classList.contains("wd") ? " wd" : ""} w${level(l.length)}${heard ? " heard" : ""}${co === sel ? " sel" : ""}`;
      for (const n of ns) { n.setAttribute("class", cls); n.setAttribute("aria-label", `${label(co, isos.get(co))}: ${l.length}`); if (l.length) { n.setAttribute("role", "button"); n.setAttribute("tabindex", "0"); } else { n.removeAttribute("role"); n.removeAttribute("tabindex"); } }
    }
    const chips = $("#world-regions"); chips.textContent = "";
    const extra = rows.filter((r) => r.list.length && (!nodes.has(r.co) || nodes.get(r.co)[0].classList.contains("wd")))
      .sort((a, b) => label(a.co, isos.get(a.co)).localeCompare(label(b.co, isos.get(b.co)), lang));
    for (const r of extra)
      chips.append(el("button", { class: "chip", "data-co": r.co, onclick: () => show(r.co) }, label(r.co, isos.get(r.co)), el("span", { class: "n" }, String(r.list.length))));
    $("#world-extra").hidden = !extra.length;
  }

  function show(co) {
    sel = co;
    const prev = svg.querySelector(".sel"); if (prev) prev.classList.remove("sel");
    const ns = nodes.get(co);
    if (ns) { ns[0].classList.add("sel"); gMap.append(ns[0]); }
    renderSheet();
  }

  function renderSheet() {
    sheet.textContent = "";
    if (!sel) { sheet.append(el("p", { class: "muted world-hint" }, t("Bấm một quốc gia để xem thể loại nhạc ở đó."))); return; }
    const list = listOf(sel), seen = visited();
    const name = label(sel, isos.get(sel));
    const heard = list.filter((i) => seen.has(model.G[i].n)).length;
    sheet.append(el("div", { class: "ws-head" },
      el("div", {}, el("b", { class: "ws-name" }, name),
        el("small", { class: "muted" }, t("{n} thể loại", { n: fmtN(list.length) }) + (heard ? " · ✓ " + t("{a}/{b} đã nghe", { a: heard, b: list.length }) : ""))),
      el("button", { class: "btn primary sm", disabled: !list.length, onclick: () => { dlg.close(); play(list, name); } }, t("▶ Nghe tất cả"))));
    if (!list.length) { sheet.append(el("p", { class: "muted world-hint" }, t("Chưa có thể loại nào ở đây."))); return; }
    const ul = el("ul", { class: "ws-list" });
    for (const i of list) {
      const g = model.G[i];
      ul.append(el("li", { tabindex: "0", "data-i": i, onclick: () => pick(i) },
        el("span", { class: "dot", style: `background:${g.c}` }), el("span", { class: "name" }, g.n),
        el("span", { class: "emo", "aria-hidden": "true" }, g.f[0] ? famEmoji(g.f[0]) : "🎵"),
        el("span", { class: "play-mini" }, seen.has(g.n) ? "✓" : "▶")));
    }
    sheet.append(ul);
  }
  function pick(i) {
    playOne(i);
    const li = sheet.querySelector(`li[data-i="${i}"] .play-mini`);
    if (li) li.textContent = "🔊";
  }
  sheet.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { const li = ev.target.closest?.("li"); if (li) { ev.preventDefault(); li.click(); } } };

  // ── zoom / pan: just the viewBox, one attribute write per frame ──
  function apply() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); });
  }
  function zoomAt(fx, fy, f) {   // fx, fy: 0..1 inside the box
    const w = Math.min(full.w, Math.max(full.w / 10, view.w * f)), h = w * full.h / full.w;
    view.x = view.x + fx * view.w - fx * w; view.y = view.y + fy * view.h - fy * h; view.w = w; view.h = h;
    clampView(); apply();
  }
  function clampView() {
    view.x = Math.min(full.x + full.w - view.w, Math.max(full.x, view.x));
    view.y = Math.min(full.y + full.h - view.h, Math.max(full.y, view.y));
  }
  function wire() {
    const ptrs = new Map(); let rect = null, moved = false, startX = 0, startY = 0, pd = 0;
    svg.style.touchAction = "none";
    svg.addEventListener("pointerdown", (ev) => {
      rect = svg.getBoundingClientRect(); ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (ptrs.size === 1) { moved = false; startX = ev.clientX; startY = ev.clientY; }
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pd = Math.hypot(a[0] - b[0], a[1] - b[1]); moved = true; }
    });
    svg.addEventListener("pointermove", (ev) => {
      const prev = ptrs.get(ev.pointerId); if (!prev) return;
      if (ptrs.size === 1) {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 7) return;
        if (!moved) { moved = true; try { svg.setPointerCapture(ev.pointerId); } catch {} }
        view.x -= (ev.clientX - prev[0]) / rect.width * view.w; view.y -= (ev.clientY - prev[1]) / rect.height * view.h;
        clampView(); apply();
      } else if (ptrs.size === 2) {
        ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pd && d) zoomAt(((a[0] + b[0]) / 2 - rect.left) / rect.width, ((a[1] + b[1]) / 2 - rect.top) / rect.height, pd / d);
        pd = d;
      }
      ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    });
    const up = (ev) => { ptrs.delete(ev.pointerId); pd = 0; if (!ptrs.size) setTimeout(() => (moved = false), 0); };
    svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault(); const r = svg.getBoundingClientRect();
      zoomAt((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, Math.exp(ev.deltaY * 0.0015));
    }, { passive: false });
    svg.addEventListener("click", (ev) => {
      if (moved) return;
      const n = ev.target.closest("[data-co]"); if (n && n.hasAttribute("role")) show(n.dataset.co);
    });
    svg.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { const n = ev.target.closest("[data-co]"); if (n && n.hasAttribute("role")) { ev.preventDefault(); show(n.dataset.co); } } });
  }
  const zoomBtn = (id, f) => { $(id).onclick = () => svg && zoomAt(0.5, 0.5, f); };
  zoomBtn("#world-in", 0.6); zoomBtn("#world-out", 1 / 0.6);
  $("#world-reset").onclick = () => { if (!svg) return; Object.assign(view, full); apply(); };

  $("#world-search").onclick = () => openPicker({
    title: t("Quốc gia / khu vực"), search: true, placeholder: t("Tìm quốc gia…"), value: sel,
    items: () => rows.filter((r) => r.list.length).map((r) => ({ value: r.co, label: label(r.co, isos.get(r.co)), n: r.list.length }))
      .sort((a, b) => a.label.localeCompare(b.label, lang)),
    onPick: (co) => {
      show(co);
      const n = nodes.get(co)?.[0];   // bring it into view if we are zoomed in
      if (n && n.getBBox && view.w < full.w) { const b = n.getBBox(); view.x = b.x + b.width / 2 - view.w / 2; view.y = b.y + b.height / 2 - view.h / 2; clampView(); apply(); }
    },
  });

  async function open() {
    dlg.showModal();
    try { await load(); } catch (err) { console.error(err); toast(t("Không tải được bản đồ 😢")); dlg.close(); return; }
    if (!svg) build();
    genresOf(); paint();
    if (sel && !listOf(sel).length) sel = "";
    show(sel);
  }
  $("#ex-world").onclick = () => { $("#games").close(); open(); };
  addEventListener("langchange", () => { if (svg && dlg.open) { paint(); renderSheet(); svg.setAttribute("aria-label", t("🌍 Nhạc khắp thế giới")); } });
  return { open };
}

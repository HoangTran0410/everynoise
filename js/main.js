// Everynoise: wires the map, the player, search/filters, detail panel, tours and quiz.
import { $, $$, el, clamp, norm, store, escapeHtml, titleCase, toast, isMobile, fmtTime } from "./util.js";
import { initDaily } from "./daily.js";
import { model, loadData, trackOf, radioOf, nearOf, loadNear, nearest, famLabel, famEmoji, FAMILY_INFO } from "./data.js";
import { MapView } from "./map.js";
import { Player } from "./player.js";
import { TOURS, buildTour } from "./tours.js";
import { t, t as tl, fmtN, lang, setLang, applyStatic } from "./i18n.js";
import { Quiz } from "./quiz.js";
import { initPassport } from "./passport.js";
import { initPath } from "./path.js";
import { initRoute } from "./route.js";
import { initDJ } from "./dj.js";
import { initWorld } from "./world.js";
import { initGeoGuess } from "./geoguess.js";
import { initArtistGuess } from "./artistguess.js";
import { Instruments } from "./instruments.js";
import { initArtists } from "./artists.js";
import { likes, likeBtn, songRec } from "./likes.js";
import { initArtistPage } from "./artistpage.js";
import { initBridge } from "./bridge.js";
import { initPerfHud } from "./perfhud.js";

// ───────────────────────── state ─────────────────────────
const state = {
  q: "", fams: new Set(), country: "", scene: false, fav: false, fresh: false,
  e: [0, 100], b: [0, 100], sort: "relevance",
  selected: -1,
  kids: store.get("nm:kids", false),
  tour: null,             // { t, list, idx }
};
let favs = new Set(store.get("nm:favs", []));
let visited = new Set(store.get("nm:visited", []));
let match, scores, resultList = [], filterActive = false;
const RESULT_LIMIT = 20;   // the panel shows the top 20; the rest is a searchable picker (a 6000-row list is unusable)

applyStatic();
const map = new MapView($("#stage"));
const player = new Player();
map.fx = player.fxa;   // map pulse follows the beat
const isOk = (g) => !state.kids || g.kid;

// ───────────────────────── search ─────────────────────────
// artist index (data/artists.json) loads on first focus of the search box; results get a "Nghệ sĩ" group
const artists = initArtists({
  model, isOk, state,
  pick: (i) => { select(i, { play: true }); closePanelMobile(); },
  onLoaded: () => { if (match && state.q.trim()) { applyFilters(); renderSuggest(); } },
  open: (name) => artistPage.open(name),
});
let bridge = null;   // set once the data is in (initBridge)
const artistPage = initArtistPage({ artists, player, map, state, pick: (i) => { select(i, { play: true }); closePanelMobile(); } });
let artistHits = [];
function scoreOf(g, q, tokens) {
  const n = g.nn;
  if (n === q) return 1000;
  let s = 0;
  if (n.startsWith(q)) s = 600;
  else if (n.includes(" " + q)) s = 450;
  else if (n.includes(q)) s = 300;
  else {
    const hay = n + " " + (g.co ? norm(g.co) : "") + " " + norm(g.f.join(" ") + " " + g.f.map((f) => f + " " + (FAMILY_INFO[f]?.vi || "")).join(" "));
    let ok = true, ts = 0;
    for (const t of tokens) {
      const idx = hay.indexOf(t);
      if (idx < 0) { ok = false; break; }
      ts += idx < n.length ? (idx === 0 || hay[idx - 1] === " " ? 60 : 30) : 15;
    }
    if (ok) s = 100 + ts;
    else if (q.length >= 4) {
      // forgiving subsequence match: "shogaze" → "shoegaze". Must start a word and skip at most 1 letter (2 from
      // 6 letters), otherwise "viet" also matched "sla[vi]c m[et]al"
      let qi = 0, gaps = 0, last = -1, start = -1;
      for (let i = 0; i < n.length && qi < q.length; i++) if (n[i] === q[qi]) { if (qi === 0) start = i; if (last >= 0) gaps += i - last - 1; last = i; qi++; }
      if (qi === q.length && (start === 0 || n[start - 1] === " ") && gaps <= 1 + Math.floor(q.length / 6)) s = 40 - gaps;
    }
  }
  if (s > 0) s += Math.min(40, g.k * 2) - n.length * 0.3;
  return s;
}

function applyFilters() {
  const G = model.G;
  const q = norm(state.q.trim());
  const tokens = q.split(/\s+/).filter(Boolean);
  const [e0, e1] = state.e, [b0, b1] = state.b;
  filterActive = !!(q || state.fams.size || state.country || state.scene || state.fav || state.fresh || state.kids ||
    e0 > 0 || e1 < 100 || b0 > 0 || b1 < 100);
  resultList = [];
  for (const g of G) {
    let ok = isOk(g);
    if (ok && state.fams.size && !g.f.some((f) => state.fams.has(f))) ok = false;
    if (ok && state.country && g.co !== state.country) ok = false;
    if (ok && state.scene && !g.s) ok = false;
    if (ok && state.fav && !favs.has(g.n)) ok = false;
    if (ok && state.fresh && visited.has(g.n)) ok = false;
    if (ok && (g.e * 100 < e0 || g.e * 100 > e1 || g.b * 100 < b0 || g.b * 100 > b1)) ok = false;
    let sc = 0;
    if (ok && q) { sc = scoreOf(g, q, tokens); if (sc <= 0) ok = false; }
    match[g.i] = ok ? 1 : 0;
    scores[g.i] = sc;
    if (ok) resultList.push(g.i);
  }
  // artist search: "taylor swift" matches no genre name, so fall back to the genres of the matching artists
  artistHits = q ? artists.find(q) : [];
  if (!resultList.length && artistHits.length && !state.fams.size && !state.country && !state.scene && !state.fav && !state.fresh &&
      e0 === 0 && e1 === 100 && b0 === 0 && b1 === 100) {
    for (const h of artistHits) for (const i of h.genres) if (!match[i]) { match[i] = 1; scores[i] = 100; resultList.push(i); }
  }
  sortResults();
  const order = q ? resultList.slice().sort((a, b) => scores[b] - scores[a]).concat(model.staticOrder) : model.staticOrder;
  map.setMatch(match, filterActive, order);
  player._queued = null;   // a next track picked before this filter change may not match it
  renderResults();
  syncClearButtons();
}

function sortResults() {
  const G = model.G;
  const by = {
    relevance: (a, b) => (scores[b] - scores[a]) || (G[b].k - G[a].k) || G[a].n.localeCompare(G[b].n),
    az: (a, b) => G[a].n.localeCompare(G[b].n),
    kids: (a, b) => G[b].k - G[a].k || G[a].n.localeCompare(G[b].n),
    electric: (a, b) => G[b].e - G[a].e,
    organic: (a, b) => G[a].e - G[b].e,
    bouncy: (a, b) => G[b].b - G[a].b,
  }[state.sort];
  resultList.sort(by);
}

function renderResults() {
  const ul = $("#results");
  ul.textContent = "";
  $("#count").textContent = fmtN(resultList.length);
  const artGroup = artists.resultsGroup(artistHits);
  if (artGroup) ul.append(artGroup);
  if (!resultList.length) {
    if (!artGroup) ul.append(el("li", { class: "empty" }, t("Không có thể loại nào khớp 🙈 Thử nới bộ lọc nhé.")));
    $("#more").hidden = true;
    return;
  }
  const frag = document.createDocumentFragment();
  if (artGroup && resultList.length) frag.append(el("li", { class: "art-h" }, t("Thể loại")));
  for (const i of resultList.slice(0, RESULT_LIMIT)) {
    const g = model.G[i];
    const meta = g.k ? t("{n} nhánh", { n: g.k }) : (g.co || (g.f[0] ? famLabel(g.f[0]) : ""));
    frag.append(el("li", { class: i === state.selected ? "active" : "", "data-i": i, title: g.n },
      el("span", { class: "dot", style: `background:${g.c}` }),
      el("span", { class: "name" }, g.n),
      visited.has(g.n) ? el("span", { class: "heard", title: t("Đã nghe") }, "✓") : null,
      el("span", { class: "meta" }, meta)));
  }
  ul.append(frag);
  $("#more").hidden = resultList.length <= RESULT_LIMIT;
  $("#more").textContent = t("Xem tất cả ({n})", { n: fmtN(resultList.length) });
}

// autocomplete
const qInput = $("#q"), sug = $("#suggest");
let sugIdx = -1, sugItems = [];
function highlight(name, q) {
  const i = q ? norm(name).indexOf(q) : -1;
  if (i < 0) return escapeHtml(name);
  return escapeHtml(name.slice(0, i)) + "<mark>" + escapeHtml(name.slice(i, i + q.length)) + "</mark>" + escapeHtml(name.slice(i + q.length));
}
function renderSuggest() {
  const q = norm(state.q.trim());
  if (!q || document.activeElement !== qInput) { sug.hidden = true; return; }
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = model.G.filter(isOk).map((g) => [g.i, scoreOf(g, q, tokens)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const hits = artists.find(q, 3), art = artists.suggestRows(hits, q);
  const artFirst = art.items.length && (!scored.length || hits[0].sc > scored[0][1]);   // strong artist match goes on top
  const genreIds = scored.slice(0, art.items.length ? 5 : 8).map((x) => x[0]);
  sug.textContent = ""; sugIdx = -1;
  sugItems = artFirst ? art.items.concat(genreIds) : genreIds.concat(art.items);
  if (!sugItems.length) { sug.hidden = true; return; }
  const genreRows = genreIds.map((i) => {
    const g = model.G[i];
    return el("li", { role: "option", "data-i": i, html:
      `<span class="dot" style="width:11px;height:11px;border-radius:50%;background:${g.c};flex:none"></span><span>${highlight(g.n, q)}</span><span class="sub">${escapeHtml(g.co || (g.f[0] ? famEmoji(g.f[0]) + " " + famLabel(g.f[0]) : ""))}</span>` });
  });
  sug.append(...(artFirst ? art.nodes.concat(genreRows) : genreRows.concat(art.nodes)));
  sug.hidden = false;
}
function moveSuggest(d) {
  if (sug.hidden || !sugItems.length) return;
  sugIdx += d;
  if (sugIdx >= sugItems.length) sugIdx = -1;
  if (sugIdx < -1) sugIdx = sugItems.length - 1;
  const rows = sug.querySelectorAll("li[data-i]");
  rows.forEach((li, k) => li.setAttribute("aria-selected", k === sugIdx));
  if (sugIdx >= 0) rows[sugIdx].scrollIntoView({ block: "nearest" });
}
let qTimer;
qInput.addEventListener("input", () => {
  state.q = qInput.value;
  artistPage.clear();
  renderSuggest();
  clearTimeout(qTimer); qTimer = setTimeout(applyFilters, 140);
});
qInput.addEventListener("focus", () => { artists.load(); renderSuggest(); });
qInput.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 150));
qInput.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") { ev.preventDefault(); moveSuggest(1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); moveSuggest(-1); }
  else if (ev.key === "Enter") {
    const pick = sugIdx >= 0 ? sugItems[sugIdx] : sugItems[0];
    clearTimeout(qTimer); applyFilters();
    if (pick != null) { select(pick, { play: true }); sug.hidden = true; qInput.blur(); }
    else if (resultList.length) map.fit(true, resultList);
  } else if (ev.key === "Escape") { sug.hidden = true; qInput.blur(); }
});
sug.addEventListener("mousedown", (ev) => {
  const art = ev.target.closest("li[data-a]");
  if (art) { ev.preventDefault(); sug.hidden = true; qInput.blur(); artistPage.open(art.dataset.a); return; }
  const li = ev.target.closest("li[data-i]");
  if (!li) return;
  ev.preventDefault();
  clearTimeout(qTimer); applyFilters();
  select(+li.dataset.i, { play: true }); sug.hidden = true; qInput.blur();
});

// ───────────────────────── filters UI ─────────────────────────
const famBtns = new Map();
function buildFilters() {
  const G = model.G;
  const box = $("#families");
  const counts = new Map();
  for (const g of G) for (const f of g.f) counts.set(f, (counts.get(f) || 0) + 1);
  for (const f of model.families) {
    let best = null;
    for (const g of G) if (g.f.includes(f) && (!best || g.k > best.k)) best = g;
    const c = best ? best.c : "#888";
    const b = el("button", { class: "chip", "aria-pressed": "false", style: `--chip-c:${c}`, title: f, "data-f": f },
      el("span", { class: "emo", "aria-hidden": "true" }, famEmoji(f)), famLabel(f), el("span", { class: "n" }, String(counts.get(f) || 0)));
    b.onclick = () => toggleFamily(f);
    famBtns.set(f, b);
    box.append(b);
  }
  const cc = new Map();
  for (const g of G) if (g.co) cc.set(g.co, (cc.get(g.co) || 0) + 1);
  const countries = [...cc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  $("#country-btn").onclick = () => openPicker({
    title: t("Quốc gia / khu vực"), search: true, placeholder: t("Tìm quốc gia…"), value: state.country,
    items: () => [{ value: "", label: t("🌐 Tất cả") }, ...countries.map(([c, n]) => ({ value: c, label: c, n }))],
    onPick: (v) => setCountry(v, false),
  });

  $("#only-scene").onchange = (ev) => { state.scene = ev.target.checked; applyFilters(); };
  $("#only-fav").onchange = (ev) => { state.fav = ev.target.checked; applyFilters(); };
  $("#only-new").onchange = (ev) => { state.fresh = ev.target.checked; applyFilters(); };
  $("#fam-clear").onclick = () => { state.fams.clear(); famBtns.forEach((b) => b.setAttribute("aria-pressed", "false")); applyFilters(); };
  $("#country-clear").onclick = () => setCountry("", false);

  $$(".range").forEach((r) => {
    const axis = r.dataset.axis;
    const [lo, hi] = r.querySelectorAll("input");
    const fill = r.querySelector(".dual-fill");
    const sync = () => {
      let a = +lo.value, b = +hi.value;
      if (a > b) [a, b] = [b, a];
      state[axis] = [a, b];
      fill.style.left = a + "%"; fill.style.width = b - a + "%";
    };
    let t;
    const onIn = () => { sync(); clearTimeout(t); t = setTimeout(applyFilters, 80); };
    lo.oninput = onIn; hi.oninput = onIn;
    r._reset = () => { lo.value = 0; hi.value = 100; sync(); };
    sync();
  });
  $("#axes-clear").onclick = () => { $$(".range").forEach((r) => r._reset()); applyFilters(); };
  $("#reset-all").onclick = resetAll;
  $("#sort-btn").onclick = () => openPicker({
    title: t("Sắp xếp"), value: state.sort,
    items: () => SORTS.map(([value, label]) => ({ value, label: t(label) })),
    onPick: (v) => { state.sort = v; syncPickLabels(); sortResults(); renderResults(); },
  });
  $("#more").onclick = () => openPicker({
    title: t("{n} thể loại", { n: fmtN(resultList.length) }), search: true, placeholder: t("Tìm thể loại…"), value: state.selected, max: 200,
    items: () => resultList.map((i) => { const g = model.G[i]; return { value: i, label: g.n, color: g.c, n: g.k || null }; }),
    onPick: (v) => { select(+v, { play: true }); closePanelMobile(); },
  });
  $("#results").addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (li) { select(+li.dataset.i, { play: true }); closePanelMobile(); }
  });
  $("#results").addEventListener("mouseover", (ev) => {
    const li = ev.target.closest("li[data-i]");
    map.setHover(li ? +li.dataset.i : -1);
  });
  $("#results").addEventListener("mouseleave", () => map.setHover(-1));
  updateCounters();
}
function toggleFamily(f, fit = true) {
  state.fams.has(f) ? state.fams.delete(f) : state.fams.add(f);
  famBtns.get(f)?.setAttribute("aria-pressed", state.fams.has(f));
  applyFilters();
  if (fit && filterActive) map.fit(true, resultList);
}
// ── picker: a searchable list in a dialog, used instead of <select> ──
const SORTS = [["relevance", "Liên quan"], ["az", "A → Z"], ["kids", "Nhiều nhánh con"], ["electric", "Điện tử nhất"], ["organic", "Mộc nhất"], ["bouncy", "Nhún nhảy nhất"]];
const picker = $("#picker"), pickQ = $("#pick-q"), pickList = $("#pick-list");
let pickCfg = null;
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function openPicker(cfg) {
  pickCfg = cfg;
  $("#pick-title").textContent = cfg.title;
  pickQ.value = ""; pickQ.hidden = !cfg.search; pickQ.placeholder = cfg.placeholder || "";
  renderPicker();
  picker.showModal();
  // no autofocus on touch: it would pop the keyboard over the list
  if (cfg.search && !matchMedia("(pointer: coarse)").matches) pickQ.focus();
  pickList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
}
function renderPicker() {
  const q = fold(pickQ.value.trim());
  const all = pickCfg.items().filter((it) => !q || fold(it.label).includes(q));
  const items = pickCfg.max ? all.slice(0, pickCfg.max) : all;   // long lists: the first rows + "type to narrow"
  pickList.textContent = "";
  for (const it of items)
    pickList.append(el("li", { role: "option", "aria-selected": String(it.value === pickCfg.value), "data-v": it.value, tabindex: "0" },
      it.color ? el("span", { class: "dot", style: `background:${it.color}` }) : null,
      el("span", { class: "name" }, it.label), it.n != null ? el("span", { class: "n" }, fmtN(it.n)) : null));
  const cut = all.length - items.length;
  $("#pick-empty").textContent = cut ? t("Còn {n} nữa · gõ để tìm", { n: fmtN(cut) }) : t("Không có kết quả");
  $("#pick-empty").hidden = !cut && items.length > 0;
}
pickQ.oninput = renderPicker;
pickQ.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); pickList.querySelector("li")?.click(); } };
pickList.onclick = (ev) => { const li = ev.target.closest("li"); if (!li) return; picker.close(); pickCfg.onPick(li.dataset.v); };
pickList.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.target.closest("li")?.click(); } };
function syncPickLabels() {
  $("#country-label").textContent = state.country || t("🌐 Tất cả");
  $("#sort-label").textContent = t(SORTS.find((s) => s[0] === state.sort)?.[1] || "Liên quan");
}

function setCountry(c, withToast = true) {
  state.country = c; syncPickLabels();
  applyFilters();
  if (c) map.fit(true, resultList);
  if (withToast && c) toast(t("📍 Đang lọc: {c}", { c }));
}
function syncClearButtons() {
  $("#fam-clear").hidden = !state.fams.size;
  $("#country-clear").hidden = !state.country;
  $("#axes-clear").hidden = state.e[0] === 0 && state.e[1] === 100 && state.b[0] === 0 && state.b[1] === 100;
  $("#reset-all").disabled = !(state.q || state.fams.size || state.country || state.scene || state.fav || state.fresh ||
    state.e[0] > 0 || state.e[1] < 100 || state.b[0] > 0 || state.b[1] < 100);
}
function resetAll() {
  state.q = ""; qInput.value = "";
  state.fams.clear(); famBtns.forEach((b) => b.setAttribute("aria-pressed", "false"));
  state.country = ""; syncPickLabels();
  state.scene = state.fav = state.fresh = false;
  $("#only-scene").checked = $("#only-fav").checked = $("#only-new").checked = false;
  $$(".range").forEach((r) => r._reset());
  applyFilters();
}
function syncKidChips() {
  // hide families that have (almost) nothing left in kids mode
  for (const [f, b] of famBtns) {
    const n = model.G.filter((g) => g.f.includes(f) && (!state.kids || g.kid)).length;
    b.classList.toggle("kid-hidden", state.kids && n < 5);
    b.querySelector(".n").textContent = n;
  }
}
function updateCounters() {
  $("#fav-count").textContent = favs.size;
  $("#explored b").textContent = fmtN(visited.size);
  $("#explored").title = t("Bạn đã nghe {a} / {b} thể loại", { a: fmtN(visited.size), b: fmtN(model.G.length) });
}

// ───────────────────────── selection + detail ─────────────────────────
let neighbors = [];
function select(i, { play = false, fly = true, open } = {}) {
  state.selected = i;
  if (!artistPage.isOpen) artistPage.clear();
  const detail = $("#detail");
  if (i < 0) {
    detail.hidden = true;
    $(".layout").classList.remove("detail-open");
    map.setSelected(-1);
    setHash("");
    relayout();
    return;
  }
  const g = model.G[i];
  const near = nearest(i, 10, isOk);
  neighbors = near.map((x) => x[0]);
  map.setSelected(i, neighbors.slice(0, 6));
  setHash(g.n);

  const shouldOpen = open ?? !isMobile();
  if (shouldOpen) openDetail();
  renderDetail(i, near);
  $$("#results li.active").forEach((li) => li.classList.remove("active"));
  $(`#results li[data-i="${i}"]`)?.classList.add("active");

  if (fly) map.focus(i);
  if (play) player.play(i);
}

function openDetail() {
  const d = $("#detail");
  const was = d.hidden;
  d.hidden = false;
  $(".layout").classList.add("detail-open");
  if (was) relayout();
}
function closeDetail() {
  $("#detail").hidden = true;
  $(".layout").classList.remove("detail-open");
  relayout();
}

function renderDetail(i, near) {
  const g = model.G[i];
  const d = $("#detail");
  d.style.setProperty("--g", g.c);
  $("#d-swatch").style.background = g.c;
  $("#d-name").textContent = g.n;
  $("#d-name").style.color = g.c;

  const tags = $("#d-tags"); tags.textContent = "";
  for (const f of g.f) tags.append(el("button", { class: "tag", title: t("Lọc theo nhóm này"), onclick: () => { if (!state.fams.has(f)) toggleFamily(f); toast(t("{e} Đang lọc: {f}", { e: famEmoji(f), f: famLabel(f) })); } }, `${famEmoji(f)} ${famLabel(f)}`));
  if (g.co) tags.append(el("button", { class: "tag", title: t("Lọc theo quốc gia này"), onclick: () => setCountry(g.co) }, "📍 " + g.co));
  if (g.s) tags.append(el("span", { class: "tag" }, "🏙 " + titleCase(g.s)));
  if (visited.has(g.n)) tags.append(el("span", { class: "tag" }, t("✓ Đã nghe")));

  $("#d-e").style.left = (g.e * 100).toFixed(1) + "%";
  $("#d-b").style.left = (g.b * 100).toFixed(1) + "%";
  $("#d-approx").hidden = !g.ap;
  $("#d-fav").setAttribute("aria-pressed", favs.has(g.n));

  const q = encodeURIComponent;
  $("#d-everynoise").href = `https://everynoise.com/engenremap-${g.n.replace(/[^a-z0-9]/gi, "").toLowerCase()}.html`;
  $("#d-wiki").href = `https://en.wikipedia.org/w/index.php?search=${q(g.n + " music genre")}`;
  renderNow();

  const parents = g.p.map((p) => model.byName.get(p)).filter((x) => x != null && isOk(model.G[x]));
  $("#d-parents-sec").hidden = !parents.length;
  const pb = $("#d-parents"); pb.textContent = ""; parents.forEach((p) => pb.append(chip(p)));

  const kids = (model.kidsOf.get(g.n) || []).filter((k) => isOk(model.G[k])).sort((a, b) => model.G[b].k - model.G[a].k || model.G[a].n.localeCompare(model.G[b].n));
  $("#d-kids-sec").hidden = !kids.length;
  $("#d-kids-count").textContent = kids.length ? `(${kids.length})` : "";
  const kb = $("#d-kids"); kb.textContent = "";
  kids.slice(0, 40).forEach((k) => kb.append(chip(k)));
  if (kids.length > 40) kb.append(el("button", { class: "chip", onclick: () => { qInput.value = state.q = g.n; applyFilters(); map.fit(true, resultList); } }, t("+{n} nữa…", { n: kids.length - 40 })));

  const nl = $("#d-near"); nl.textContent = "";
  for (const [j] of near) {
    const h = model.G[j];
    const tr = trackOf(j);
    nl.append(el("li", {
      onclick: () => select(j, { play: true, open: true }),
      onmouseenter: () => map.setHover(j), onmouseleave: () => map.setHover(-1),
      title: tr ? `🎵 ${tr[3]} — ${tr[2]}` : h.n,
    }, el("span", { class: "dot", style: `background:${h.c}` }), el("span", { class: "name" }, h.n),
    el("span", { class: "play-mini" }, visited.has(h.n) ? "✓" : "▶")));
  }
  $(".detail-scroll").scrollTop = 0;
}

function chip(i) {
  const g = model.G[i];
  return el("button", { class: "chip", title: g.n, onclick: () => select(i, { play: true, open: true }) },
    el("span", { class: "dot", style: `background:${g.c}` }), g.n);
}

/** The "sample track" card for the selected genre (credits + audio details). */
function renderNow() {
  const i = state.selected;
  if (i < 0) return;
  const g = model.G[i];
  const isCur = player.current === i;
  // while this genre is playing, show the track that is actually playing (it may not be the first one)
  const tr = isCur && player.meta ? [null, player.meta.trackId, player.meta.artist, player.meta.song] : trackOf(i);
  const now = $("#d-now");
  now.classList.toggle("no-track", !tr && !!model.tracks);
  now.dataset.playing = isCur && player.playing;
  $("#d-more").hidden = !tr || !model.tracks;
  if (!model.tracks) { $("#d-song").textContent = t("Đang tải danh sách bài mẫu…"); $("#d-artist").textContent = ""; return; }
  if (!tr) { $("#d-song").textContent = t("Chưa có bài mẫu cho thể loại này"); $("#d-artist").textContent = t("Thử các thể loại gần giống bên dưới nhé"); return; }
  const [, id, artist, song] = tr;
  $("#d-song").textContent = song;
  $("#d-artist").textContent = artist;
  const q = encodeURIComponent;
  const meta = isCur ? player.meta : null;
  $("#d-l-spotify").href = `https://open.spotify.com/track/${id}`;
  $("#d-l-youtube").href = `https://www.youtube.com/results?search_query=${q(artist + " " + song)}`;
  $("#d-l-apple").href = `https://music.apple.com/search?term=${q(artist + " " + song)}`;
  $("#d-l-deezer").href = meta?.deezer || `https://www.deezer.com/search/${q(artist + " " + song)}`;
  $("#d-a-src").textContent = !meta ? t("Bản nghe thử Spotify (chưa phát)")
    : meta.source === "spotify" ? t("Bản nghe thử 30s của Spotify (bài mẫu Every Noise chọn)")
    : meta.source === "deezer" ? t("Bản nghe thử 30s của Deezer (cùng bài hát, vì bản Spotify không tải được)")
    : t("Không tải được bản nghe thử");
  $("#d-a-id").textContent = id;
  renderTrackList(i);
  artists.renderDetail(i, artist);
  const d = isCur && isFinite(player.audio.duration) ? player.audio.duration : null;
  $("#d-a-dur").textContent = d ? t("{d} (bản nghe thử)", { d: fmtTime(d) }) : t("bản nghe thử ~30 giây");
  $("#d-a-viz").textContent = !isCur ? "—" : player.realViz ? t("Phổ tần số thật (Web Audio)") : t("Mô phỏng (máy chủ không cho đọc dữ liệu âm thanh)");
  $$("#d-rate button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.rate === player.rate));
}

/** Track list of the selected genre (artist — song, tap to play, current one highlighted). Shards load lazily. */
let listKey = "";
async function renderTrackList(i) {
  const box = $("#d-more"), ul = $("#d-tracks");
  const list = await radioOf(i);
  if (state.selected !== i) return;                    // selection moved on while the shard loaded
  box.hidden = list.length < 2;
  if (list.length < 2) { listKey = ""; return; }
  const key = i + ":" + list.length + ":" + lang;
  if (key !== listKey) {
    listKey = key;
    ul.textContent = "";
    list.forEach((tr, n) => ul.append(el("li", {
      "data-n": n, tabindex: 0, role: "button",
      title: tl("Phát bài {s} — {a}", { s: tr[3], a: tr[2] }),
      onclick: () => player.play(i, { n }),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); player.play(i, { n }); } },
    }, el("span", { class: "tn" }, String(n + 1)), el("span", { class: "tt" }, el("b", {}, tr[3]), el("small", {}, tr[2])))));
  }
  const cur = player.current === i ? player.meta?.n ?? 0 : -1;
  for (const li of ul.children) {
    const on = +li.dataset.n === cur;
    li.classList.toggle("cur", on);
    li.querySelector(".tn").textContent = on ? (player.playing ? "🔊" : "▶") : String(+li.dataset.n + 1);
    if (on && ul.scrollHeight > ul.clientHeight) ul.scrollTop = li.offsetTop - ul.clientHeight / 2 + li.offsetHeight / 2;   // only the list scrolls, not the page
  }
  $("#d-pos").textContent = list.length > 6 ? `${(player.heardN.get(i) || new Set()).size}/${list.length}` : "";
}
$("#d-another").onclick = () => { if (state.selected >= 0) player.another(state.selected); };

function drawDetailViz(t) {
  const c = $("#d-viz");
  if ($("#detail").hidden || state.selected !== player.current) return;
  // NCS-style: bass in the middle, mirrored left/right and up/down, peak caps, bars swell on kicks (no shadowBlur: too slow on phones)
  const ctx = c.getContext("2d");
  const W = c.width, H = c.height, mid = H / 2;
  const a = player.fxa, beat = a.beat;
  const color = model.G[state.selected].c;
  ctx.clearRect(0, 0, W, H);
  const n = a.n, slots = n * 2, bw = W / slots;
  const boost = 1 + beat * 0.18;
  ctx.fillStyle = color;
  for (let s = 0; s < slots; s++) {
    const k = s < n ? n - 1 - s : s - n;            // center = band 0 (bass)
    const v = Math.min(1, a.bands[k] * boost);
    const h = Math.max(3, v * (H * 0.92));
    const x = s * bw + bw * 0.16, w = bw * 0.68;
    ctx.globalAlpha = 0.45 + v * 0.55;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, mid - h / 2, w, h, w / 2) : ctx.rect(x, mid - h / 2, w, h);
    ctx.fill();
  }
  // peak caps
  ctx.fillStyle = color;
  for (let s = 0; s < slots; s++) {
    const k = s < n ? n - 1 - s : s - n;
    const p = Math.min(1, a.peaks[k] * boost);
    if (p < 0.05) continue;
    const off = Math.max(3, p * H * 0.92) / 2 + 3;
    const x = s * bw + bw * 0.16, w = bw * 0.68;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, mid - off - 2, w, 2);
    ctx.fillRect(x, mid + off, w, 2);
  }
  ctx.globalAlpha = 1;
}

$("#d-close").onclick = () => (isMobile() ? closeDetail() : select(-1));
$("#d-play").onclick = () => {
  const i = state.selected;
  if (i < 0) return;
  if (player.current === i) player.toggle(); else player.play(i);
};
$("#d-fav").onclick = () => {
  const g = model.G[state.selected]; if (!g) return;
  setFav(g.n, !favs.has(g.n));
  toast(favs.has(g.n) ? t("⭐ Đã thêm vào yêu thích") : t("Đã bỏ khỏi yêu thích"));
};
function setFav(name, on) {
  if (on) favs.add(name); else favs.delete(name);
  store.set("nm:favs", [...favs]);
  const g = model.G[state.selected];
  if (g) $("#d-fav").setAttribute("aria-pressed", favs.has(g.n));
  updateCounters();
  if (state.fav) applyFilters();
}
$("#d-share").onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); toast(t("🔗 Đã sao chép liên kết")); } catch { toast(location.href); }
};
$$("#d-rate button").forEach((b) => (b.onclick = () => { player.setRate(+b.dataset.rate); renderNow(); }));

// ───────────────────────── player wiring ─────────────────────────
player.nextProvider = (mode, cur) => {
  if (state.tour) {
    const t = state.tour;
    t.idx++;
    // the left-panel filter wins: skip tour steps it hides (not for a route the user built: every step was chosen)
    while (filterActive && !t.t.raw && t.idx < t.list.length && !match[t.list[t.idx]]) t.idx++;
    if (t.idx >= t.list.length) { stopTour(true); return -1; }
    renderTourBar();
    const n = t.t.ns?.[t.idx];
    return n != null ? { i: t.list[t.idx], n } : t.list[t.idx];
  }
  const hasTr = (h) => !model.tracks || !!trackOf(h.i);
  const pool = filterActive ? resultList : null;
  if (mode === "random" || cur < 0) {
    const cand = (pool || model.G.map((g) => g.i)).filter((i) => i !== cur && hasTr(model.G[i]) && isOk(model.G[i]));
    const fresh = cand.filter((i) => !visited.has(model.G[i].n));
    const from = fresh.length ? fresh : cand;
    return from.length ? from[Math.floor(Math.random() * from.length)] : -1;
  }
  // "near": radio walk. Drift to an unheard neighbour while keeping a rough heading, so the radio
  // travels across the map (jazz → funk → disco) instead of circling one spot.
  const okNear = (h) => isOk(h) && hasTr(h) && (!filterActive || match[h.i]);
  // by shared artists (data/near, loaded with the genre that is playing); map distance when a genre has no data
  const sim = (nearOf(cur) || []).filter(([j]) => okNear(model.G[j]));
  if (sim.length) {
    const fresh = sim.filter(([j]) => !visited.has(model.G[j].n)), from = fresh.length ? fresh : sim;
    let r = Math.random() * from.reduce((a, [, s]) => a + s, 0);
    for (const [j, s] of from) if ((r -= s) < 0) return j;
    return from[0][0];
  }
  let nb = nearest(cur, 12, (h) => okNear(h) && !visited.has(h.n));
  if (!nb.length) nb = nearest(cur, 6, okNear);
  if (!nb.length) return -1;
  return walkStep(cur, nb);
};
let walkHeading = null;   // unit vector [dx, dy] on the map
function walkStep(cur, nb) {
  const g = model.G[cur], far = nb[nb.length - 1][1] || 1;
  if (!walkHeading) { const a = Math.random() * 2 * Math.PI; walkHeading = [Math.cos(a), Math.sin(a)]; }
  const [hx, hy] = walkHeading;
  const scored = nb.map(([j, d]) => {
    const o = model.G[j], dx = (o.x - g.x) / (d || 1), dy = (o.y - g.y) / (d || 1);
    return { j, dx, dy, s: dx * hx + dy * hy - 0.4 * (d / far) };   // ahead and close wins
  }).sort((a, b) => b.s - a.s);
  const pick = scored[Math.random() < 0.7 || scored.length < 2 ? 0 : 1];
  // nothing ahead (edge of the map): turn towards where we actually went
  const w = pick.s < -0.2 ? 1 : 0.35;
  const nx = hx * (1 - w) + pick.dx * w, ny = hy * (1 - w) + pick.dy * w, len = Math.hypot(nx, ny) || 1;
  walkHeading = [nx / len, ny / len];
  return pick.j;
}
// auto-next keeps the detail panel as the user left it (closed stays closed)
player.on("advance", (i) => select(i, { fly: true, open: !$("#detail").hidden && !isMobile() }));
player.on("track", (m) => {
  loadNear(m.i);
  map.setPlaying(m.i, player.playing);
  const g = model.G[m.i];
  const isNew = !visited.has(g.n);
  visited.delete(g.n); visited.add(g.n); store.set("nm:visited", [...visited]);   // last = most recent
  if (isNew) updateCounters();
  if (setDlg.open) renderSettings();
  if (state.selected === m.i) renderNow();
  if (state.selected !== m.i && !state.tour) { /* player can be ahead of selection (prev/next) */ }
});
player.on("state", (playing) => {
  map.setPlaying(player.current, playing);
  $("#d-now").dataset.playing = state.selected === player.current && playing;
  if (state.selected === player.current) renderNow();
});
player.on("viz", drawDetailViz);
// a modal covers the page: the player/detail/map-pulse loops stopped themselves; restart them when it closes
addEventListener("modalchange", (ev) => { if (!ev.detail && player.playing) { player._startViz(); map.resumePulse(); } });
player.on("needpick", () => {
  const i = player.nextProvider("random", -1);
  if (i >= 0) select(i, { play: true });
});
const showPlaying = () => { if (player.current >= 0) select(player.current, { fly: true, open: true }); };
$("#p-genre").onclick = showPlaying;
$("#p-art").onclick = showPlaying;
$("#p-more").onclick = () => {
  if (!$("#detail").hidden && state.selected === player.current) closeDetail(); else showPlaying();
};

// ───────────────────────── tours ─────────────────────────
function buildExplore() {
  const grid = $("#tour-grid");
  grid.textContent = "";
  for (const t of TOURS) {
    grid.append(el("button", { class: "tour-card", onclick: () => { $("#explore").close(); startTour(t); } },
      el("span", { class: "t-emoji" }, t.emoji),
      el("span", {}, el("b", {}, tl(t.title)), el("small", {}, tl(t.desc)))));
  }
  $("#ex-quiz").onclick = () => { $("#games").close(); quiz.open(); };
  $("#ex-free").onclick = () => $("#explore").close();
  $("#ex-kids").onchange = (ev) => setKids(ev.target.checked);
}
async function startTour(t) {
  await model.tracksReady;
  // t.list: prebuilt list (world map); a single country genre is still worth playing
  startList(t, (t.list || buildTour(t, isOk)).filter((i) => trackOf(i)), t.list ? 1 : 2);
}
/** Play a prebuilt list of genre indices as a tour (meta: { emoji, title, desc, trail? }). */
function startList(t, list, min = 2) {
  if (list.length < min) { toast(tl("Hành trình này chưa có đủ bài 😢")); return; }
  map.setTrail(t.trail ? list : null);
  state.tour = { t, list, idx: 0 };
  player.tourActive = true;
  renderTourBar();
  $("#tour-bar").hidden = false;
  // t.ns: per step, the radio index of a specific song (my routes); otherwise the player picks one
  const n0 = t.ns?.[0];
  select(list[0], { play: n0 == null, fly: true });
  if (n0 != null) player.play(list[0], { n: n0 });
  toast(tl("{e} Bắt đầu: {t}", { e: t.emoji, t: tl(t.title) }));
}
function stopTour(finished = false) {
  if (!state.tour) return;
  if (finished) toast(t("🎉 Xong hành trình “{t}”!", { t: t(state.tour.t.title) }));
  state.tour = null;
  map.setTrail(null);
  player.tourActive = false;
  $("#tour-bar").hidden = true;
}
function renderTourBar() {
  const { t, list, idx } = state.tour;
  $("#tour-emoji").textContent = t.emoji;
  $("#tour-title").textContent = tl(t.title);
  $("#tour-step").textContent = `${idx + 1} / ${list.length} · ${model.G[list[idx]].n}`;
  const dots = $("#tour-dots"); dots.textContent = "";
  list.forEach((_, k) => dots.append(el("i", { class: k < idx ? "done" : k === idx ? "cur" : "" })));
}
$("#tour-stop").onclick = () => { stopTour(); toast(t("Đã dừng hành trình")); };

// ───────────────────────── kids mode ─────────────────────────
function setKids(on) {
  state.kids = on;
  store.set("nm:kids", on);
  document.body.classList.toggle("kids", on);
  $("#ex-kids").checked = on;
  renderSettings();
  player.kids = on;
  map.setLabelScale(on ? 1.18 : 1);
  syncKidChips();
  if (on) {
    for (const f of [...state.fams]) if (famBtns.get(f)?.classList.contains("kid-hidden")) { state.fams.delete(f); famBtns.get(f).setAttribute("aria-pressed", "false"); }
    // advanced filters are hidden in kids mode: clear them so nothing is filtered invisibly
    state.scene = state.fav = state.fresh = false; state.country = "";
    $("#only-scene").checked = $("#only-fav").checked = $("#only-new").checked = false; syncPickLabels();
    $$(".range").forEach((r) => r._reset());
  }
  applyFilters();
  if (state.selected >= 0 && !isOk(model.G[state.selected])) select(-1);
  else if (state.selected >= 0) renderDetail(state.selected, nearest(state.selected, 10, isOk));
  syncPlaceholder();
  if (bridge?.isOpen) bridge.start();
}

// ───────────────────────── quiz ─────────────────────────
// "Show on the map": select it AND keep playing the very song heard in the quiz (the main player still held the old genre)
const quiz = new Quiz({ player, isOk, onShow: (i, n) => { select(i, { fly: true, open: true }); player.play(i, { n }); } });
initArtistGuess({ player, isOk, onShow: (i, n) => { select(i, { fly: true, open: true }); player.play(i, { n }); } });
initPassport({ getVisited: () => visited, getFavs: () => favs, isOk, beforeOpen: () => $("#games").close() });
initWorld({ isOk, visited: () => visited, openPicker,
  play: (list, title) => startTour({ emoji: "🌍", title, desc: "", list }),
  playOne: (i) => { stopTour(); select(i, { play: true, fly: false, open: false }); } });
initGeoGuess({ player, isOk, kids: () => state.kids,
  listen: (i) => { stopTour(); select(i, { play: true, fly: true, open: false }); } });
const instr = new Instruments({ player, isOk, onShow: (i, n) => { select(i, { fly: true, open: true }); player.play(i, { n }); } });
$("#ex-instr").onclick = () => { $("#games").close(); instr.open(); };
$("#btn-explore").onclick = () => { $("#explore").classList.remove("first"); $("#explore").showModal(); };
$("#btn-games").onclick = () => $("#games").showModal();
// iOS Safari ignores user-scalable=no: block its page pinch-zoom so two fingers always zoom the map, 1:1
for (const ty of ["gesturestart", "gesturechange"]) document.addEventListener(ty, (ev) => ev.preventDefault(), { passive: false });

// ───────────────────────── map wiring ─────────────────────────
const tip = $("#tooltip");
map.on("pick", (i) => {
  if (state.tour) stopTour();
  if (i === player.current) { player.toggle(); if (!isMobile()) openDetail(); return; }
  select(i, { play: true, fly: false });
});
map.on("background", () => { if (isMobile() && !$("#detail").hidden) closeDetail(); });
map.on("hover", (i, x, y) => {
  if (i < 0) { tip.hidden = true; return; }
  const g = model.G[i];
  const tr = trackOf(i);
  const bits = [...g.f.slice(0, 2).map((f) => famEmoji(f) + " " + famLabel(f)), g.co && "📍 " + g.co].filter(Boolean).join(" · ");
  tip.innerHTML = `<b style="color:${g.c}">${escapeHtml(g.n)}</b>${bits ? `<span>${escapeHtml(bits)}</span>` : ""}` +
    (tr ? `<span>🎵 ${escapeHtml(tr[3])} — ${escapeHtml(tr[2])}</span>` : "");
  tip.hidden = false;
  if (x == null) return;
  const W = map.W, H = map.H;
  tip.style.left = clamp(x + 16, 6, W - tip.offsetWidth - 6) + "px";
  tip.style.top = clamp(y + 16, 6, H - tip.offsetHeight - 6) + "px";
});
let lastLandscape = null;
const onOrientation = (landscape) => {
  const set = (id, t) => ($(id).textContent = t);
  lastLandscape = landscape;
  if (landscape) { set("#ax-l", t("🌿 Mộc")); set("#ax-r", t("Điện tử ⚡")); set("#ax-t", t("🌫 Âm đặc, vang")); set("#ax-b", t("🎈 Nhịp nhún nhảy")); }
  else { set("#ax-l", t("🌫 Âm đặc, vang")); set("#ax-r", t("Nhún nhảy 🎈")); set("#ax-t", t("⚡ Điện tử")); set("#ax-b", t("🌿 Mộc")); }
};
map.on("orientation", onOrientation);
$("#zoom-in").onclick = () => map.zoomSmooth(1.7, undefined, undefined, 80);
$("#zoom-out").onclick = () => map.zoomSmooth(1 / 1.7, undefined, undefined, 80);
$("#zoom-fit").onclick = () => map.fit(true, filterActive && !state.kids ? resultList : null);
$("#btn-random").onclick = () => random();
function random() {
  if (state.tour) stopTour();
  const i = player.nextProvider("random", -1);
  if (i >= 0) select(i, { play: true });
}

// ───────────────────────── layout ─────────────────────────
function relayout() {
  const tablet = matchMedia("(max-width: 1279px) and (min-width: 761px)").matches;
  map.rightInset = tablet && !$("#detail").hidden ? $("#detail").offsetWidth + 24 : 0;
  map.resize(true);
}
let rT;
new ResizeObserver(() => {
  const h = $("#player").offsetHeight;
  document.documentElement.style.setProperty("--player-h", h + "px");
  if (map.padBottom !== h + 20) { map.padBottom = h + 20; clearTimeout(rT); rT = setTimeout(relayout, 60); }
}).observe($("#player"));
new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(relayout, 60); }).observe($("#stage"));

const panel = $("#panel"), scrim = $("#scrim");
$("#btn-filters").onclick = () => {
  if (isMobile()) {
    panel.classList.toggle("open");
    scrim.hidden = !panel.classList.contains("open");
  } else {
    panel.classList.toggle("collapsed");
    store.set("nm:panel", !panel.classList.contains("collapsed"));
    relayout();   // same task as the DOM change: the map is never painted stretched to the new stage width
  }
  $("#btn-filters").setAttribute("aria-expanded", isMobile() ? panel.classList.contains("open") : !panel.classList.contains("collapsed"));
};
scrim.onclick = closePanelMobile;
function closePanelMobile() { panel.classList.remove("open"); scrim.hidden = true; }
if (store.get("nm:panel", true) === false || matchMedia("(max-width: 1023px) and (min-width: 761px)").matches) panel.classList.add("collapsed");

const mqSmall = matchMedia("(max-width: 760px)");
function syncPlaceholder() {
  qInput.placeholder = t(mqSmall.matches ? "Tìm…" : state.kids ? "Tìm thể loại… (vd: lullaby, piano, samba)" : "Tìm thể loại… (vd: shoegaze, vietnamese, lullaby)");
}
mqSmall.addEventListener?.("change", syncPlaceholder);

// ───────────────────────── theme ─────────────────────────
const root = document.documentElement;
const savedTheme = store.get("nm:theme", null);
if (savedTheme) root.dataset.theme = savedTheme;
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => map.readColors());
$("#brand").onclick = (ev) => { ev.preventDefault(); stopTour(); resetAll(); select(-1); map.fit(); };

// ───────────────────────── URL hash ─────────────────────────
let hashLock = false;
function setHash(name) {
  hashLock = true;
  history.replaceState(null, "", name ? "#g=" + encodeURIComponent(name) : location.pathname + location.search);
  setTimeout(() => (hashLock = false));
}
function readHash() {
  const m = location.hash.match(/g=([^&]+)/);
  if (!m) return false;
  const i = model.byName.get(decodeURIComponent(m[1]));
  if (i == null) return false;
  select(i, { open: true });
  return true;
}
window.addEventListener("hashchange", () => { if (!hashLock) readHash(); });

// ───────────────────────── keyboard ─────────────────────────
document.addEventListener("keydown", (ev) => {
  const a = document.activeElement;
  const typing = a && (/TEXTAREA/.test(a.tagName) || (a.tagName === "INPUT" && !["checkbox", "range"].includes(a.type)) || a.tagName === "SELECT");
  if (document.querySelector("dialog[open]")) return;
  if (ev.key === "/" && !typing) { ev.preventDefault(); qInput.focus(); qInput.select(); return; }
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (ev.key === " " && a?.tagName !== "BUTTON") { ev.preventDefault(); player.toggle(); }
  else if (ev.key === "Escape") { if (!$("#detail").hidden) select(-1); closePanelMobile(); }
  else if (k === "n") player.next();
  else if (k === "p") player.prev();
  else if (k === "l") player.setRepeat();
  else if (k === "r") random();
  else if (k === "f") map.fit(true, filterActive && !state.kids ? resultList : null);
  else if (ev.key === "ArrowRight" && player.current >= 0) player.audio.currentTime += 5;
  else if (ev.key === "ArrowLeft" && player.current >= 0) player.audio.currentTime = Math.max(0, player.audio.currentTime - 5);
  else if (ev.key === "+" || ev.key === "=") map.zoomSmooth(1.5, undefined, undefined, 80);
  else if (ev.key === "-" || ev.key === "_") map.zoomSmooth(1 / 1.5, undefined, undefined, 80);
});

// ───────────────────────── settings ─────────────────────────
const setDlg = $("#settings");
function applyTheme(mode) {   // "auto" | "light" | "dark"
  if (mode === "auto") root.removeAttribute("data-theme"); else root.dataset.theme = mode;
  store.set("nm:theme", mode === "auto" ? null : mode);
  map.readColors();
  renderSettings();
}
let clearArmed = false;
function renderSettings() {
  if (!setDlg.open) return;
  $$("#set-lang button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === lang));
  const th = root.dataset.theme || "auto";
  $$("#set-theme button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.theme === th));
  $("#set-kids").checked = state.kids;
  const list = [...favs].map((n) => model.byName.get(n)).filter((i) => i != null);
  $("#set-fav-n").textContent = list.length ? `(${list.length})` : "";
  $("#set-fav-empty").hidden = list.length > 0;
  const box = $("#set-favs"); box.textContent = "";
  for (const i of list) {
    const g = model.G[i];
    const x = el("span", { class: "x", role: "button", title: t("Bỏ khỏi yêu thích"), "aria-label": t("Bỏ khỏi yêu thích") }, "✕");
    x.onclick = (ev) => { ev.stopPropagation(); setFav(g.n, false); renderSettings(); };
    box.append(el("button", { class: "chip", title: g.n, onclick: () => { setDlg.close(); select(i, { play: true, open: true }); } },
      el("span", { class: "dot", style: `background:${g.c}` }), g.n, x));
  }
  renderSongs();
  $("#set-heard").textContent = t("Đã nghe {a} / {b} thể loại", { a: fmtN(visited.size), b: fmtN(model.G.length) });
  $("#set-clear-heard").textContent = t(clearArmed ? "Bấm lần nữa để xoá" : "Xoá lịch sử");
  // listening history: newest first, tap to play again
  const hist = [...visited].reverse().map((n) => model.byName.get(n)).filter((i) => i != null && isOk(model.G[i]));
  const shown = histAll ? hist : hist.slice(0, 20);
  const hl = $("#set-hist"); hl.textContent = "";
  for (const i of shown) {
    const g = model.G[i], tr = trackOf(i);
    hl.append(el("li", { onclick: () => { setDlg.close(); select(i, { play: true, open: true }); } },
      el("span", { class: "dot", style: `background:${g.c}` }),
      el("span", { class: "name" }, g.n, tr ? el("small", {}, `${tr[3]} — ${tr[2]}`) : null),
      el("span", { class: "play-mini" }, player.current === i && player.playing ? "🔊" : "▶")));
  }
  $("#set-hist-empty").hidden = hist.length > 0;
  const more = $("#set-hist-more");
  more.hidden = histAll || hist.length <= shown.length;
  more.textContent = t("Xem tất cả ({n})", { n: fmtN(hist.length) });
}
let histAll = false;
$("#set-hist-more").onclick = () => { histAll = true; renderSettings(); };
setDlg.addEventListener("close", () => { histAll = false; });
// settings tabs: general · your stuff (favourites, history) · about
function setTab(tab) {
  $$("#settings .set-tabs button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tab === tab));
  $$("#settings .set-pane").forEach((p) => (p.hidden = p.dataset.pane !== tab));
}
$$("#settings .set-tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
const openHistory = () => { setTab("mine"); setDlg.showModal(); renderSettings(); showVersion(); $("#set-heard").scrollIntoView({ block: "start" }); };
$("#explored").onclick = openHistory;
$("#explored").onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openHistory(); } };
$("#set-clear-heard").onclick = () => {
  if (!clearArmed) { clearArmed = true; renderSettings(); setTimeout(() => { clearArmed = false; renderSettings(); }, 3000); return; }
  clearArmed = false;
  visited.clear(); store.set("nm:visited", []);
  updateCounters(); applyFilters();
  if (state.selected >= 0) renderDetail(state.selected, nearest(state.selected, 10, isOk));
  renderSettings();
  toast(t("Đã xoá lịch sử nghe"));
};
$$("#set-lang button").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
$$("#set-theme button").forEach((b) => (b.onclick = () => applyTheme(b.dataset.theme)));
$("#set-kids").onchange = (ev) => setKids(ev.target.checked);
$("#set-about").onclick = () => { setDlg.close(); $("#about").showModal(); };
$("#btn-settings").onclick = () => { setTab("general"); setDlg.showModal(); renderSettings(); showVersion(); };

// update check. The SW skips waiting and claims the page, so a new build usually installs and
// activates in the background right after launch; reg.update() then finds nothing newer, yet this
// page still runs the old code. So compare the build this page loaded with the active SW's build.
const askVer = (sw) => new Promise((res) => {
  if (!sw) return res(null);
  const ch = new MessageChannel();
  ch.port1.onmessage = (e) => res(e.data);
  sw.postMessage("version", [ch.port2]);
  setTimeout(() => res(null), 1500);
});
const pageVer = askVer(navigator.serviceWorker?.controller);   // build that served this page
async function showVersion() {
  const v = await pageVer;
  $("#set-ver").textContent = v || "dev";
}
const updMsg = (k) => { const m = $("#set-update-msg"); m.hidden = !k; m.textContent = k ? t(k) : ""; };
$("#set-update").onclick = async () => {
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
  if (!reg) { updMsg("Bản chạy local, không có service worker."); return; }
  updMsg("Đang kiểm tra…");
  try { await reg.update(); } catch { updMsg("Không kiểm tra được (đang offline?)"); return; }
  const nw = reg.installing || reg.waiting;
  if (nw) {
    updMsg("⬇️ Đang tải bản mới…");
    await new Promise((res) => {
      if (nw.state === "activated") return res();
      nw.addEventListener("statechange", () => (nw.state === "activated" || nw.state === "redundant") && res());
    });
  }
  const [mine, active] = await Promise.all([pageVer, askVer(reg.active)]);
  if (!nw && (!mine || !active || mine === active)) { updMsg("✅ Bạn đang dùng bản mới nhất."); return; }
  updMsg("🎉 Đã có bản mới!");
  $("#set-reload").hidden = false;
};
$("#set-reload").onclick = () => location.reload();

// language switch: re-render everything built from JS (music keeps playing)
addEventListener("langchange", () => {
  for (const [f, b] of famBtns) b.childNodes[1].nodeValue = famLabel(f);
  renderResults(); updateCounters(); syncPlaceholder(); buildExplore();
  if (lastLandscape != null) onOrientation(lastLandscape);
  if (state.selected >= 0) renderDetail(state.selected, nearest(state.selected, 10, isOk));
  if (state.tour) renderTourBar();
  player.relabel(); quiz._scoreUI();
  renderSettings(); syncPickLabels();
  if (picker.open) picker.close();
});

// ───────────────────────── boot ─────────────────────────
(async () => {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    $("#loading").innerHTML = t("Không tải được dữ liệu 😢") + "<br><small>" + t("Hãy mở qua một web server (vd: <code>python3 -m http.server</code>).") + "</small>";
    return;
  }
  match = new Uint8Array(model.G.length).fill(1);
  scores = new Float32Array(model.G.length);
  map.init();
  buildFilters();
  buildExplore();
  document.body.classList.toggle("kids", state.kids);
  $("#ex-kids").checked = state.kids;
  player.kids = state.kids;
  if (state.kids) map.setLabelScale(1.18);
  syncKidChips();
  syncPlaceholder();
  applyFilters();
  $("#loading").remove();
  const pathUI = initPath({ openPicker, isOk, select, startList, map, state });
  const routeUI = initRoute({ openPicker, startList, isOk });
  $("#d-route").onclick = () => {
    const i = state.selected; if (i < 0) return;
    const g = model.G[i], m = player.meta && player.current === i ? player.meta : null;
    openPicker({
      title: t("Thêm vào lộ trình"),
      items: () => [{ value: "g", label: t("📍 Thể loại: {g}", { g: g.n }) },
        ...(m ? [{ value: "s", label: t("🎵 Bài: {s} — {a}", { s: m.song, a: m.artist }) }] : []),
        { value: "o", label: t("🗺️ Mở lộ trình của tôi") }],
      onPick: (v) => { if (v === "o") routeUI.open(); else routeUI.add(v === "s" ? { g: g.n, id: m.trackId, a: m.artist, s: m.song } : { g: g.n }); },
    });
  };
  initDJ({ player, isOk, state });
  initDaily({ player, play: (i) => select(i, { play: true, fly: true }) });
  bridge = initBridge({ artists, player, isOk, state });
  const fromHash = readHash() || pathUI.readHash() || routeUI.readHash();
  if (!fromHash && !store.get("nm:welcomed", false)) {
    $("#explore").classList.add("first");
    $("#explore").showModal();
    store.set("nm:welcomed", true);
  }
  // re-measure label widths once the web font is in
  document.fonts?.ready.then(() => map.measureLabels());
  model.tracksReady.then(() => { if (state.selected >= 0) renderNow(); });
})();
// handle for debugging from the console
window.__everynoise = { map, player, model, state, artistPage, quiz };

// ---- saved songs (♥): heart in the player bar + list in Settings › Your stuff ----
const pLike = likeBtn(() => (player.meta ? songRec(player.meta.genre, [0, player.meta.trackId, player.meta.artist, player.meta.song], player.meta.n) : null), { id: "p-like" });
$("#p-more").before(pLike);
player.on("track", pLike.refresh);
likes.on("change", () => renderSettings());
/** Play a saved song: its genre, at the radio index whose track id matches (lists can be rebuilt). */
async function playSong(rec) {
  const i = model.byName.get(rec.g);
  if (i == null) { toast(t("Không tìm thấy bài này nữa 😢")); return; }
  let n = 0;
  try { const list = await radioOf(i); const k = list.findIndex((tr) => tr && tr[1] === rec.id); n = k >= 0 ? k : 0; if (k < 0) toast(t("Bài này không còn, phát bài khác cùng thể loại")); } catch { /* offline: first track */ }
  select(i, { fly: true });
  player.play(i, { n });
}
function renderSongs() {
  const all = likes.all(), box = $("#set-songs");
  if (!box) return;
  $("#set-song-n").textContent = all.length ? `(${all.length})` : "";
  $("#set-song-empty").hidden = all.length > 0;
  box.textContent = "";
  for (const r of all) {
    const i = model.byName.get(r.g), g = i != null ? model.G[i] : null;
    const x = el("button", { class: "icon-btn sm x", title: t("Bỏ lưu"), "aria-label": t("Bỏ lưu") }, "✕");
    x.onclick = (ev) => { ev.stopPropagation(); likes.set(r, false); };
    const playingNow = player.meta?.trackId === r.id && player.playing;
    box.append(el("li", { onclick: () => { setDlg.close(); playSong(r); } },
      el("span", { class: "dot", style: `background:${g?.c || "#888"}` }),
      el("span", { class: "name" }, r.s, el("small", {}, `${r.a} · ${r.g}`)),
      el("span", { class: "play-mini" }, playingNow ? "🔊" : "▶"), x));
  }
}

// ---- a game opened from the Games menu goes back to it when dismissed (✕, Esc, "Close") ----
// Leaving on purpose ("show on map", "play", a genre chip) closes it from code and stays on the map.
let gamesClick = 0, backClick = 0;
// any other click (Settings, Explore, the map…) ends the window: only the dialog a game card opens belongs to Games
document.addEventListener("click", (ev) => {
  if (ev.target.closest("#games .game-card")) gamesClick = performance.now();
  else if (ev.target.closest("#quiz-back, #instr-back, #bridge-back")) backClick = performance.now();
  else gamesClick = backClick = 0;
}, true);
new MutationObserver((recs) => {
  for (const r of recs) {
    const d = r.target;
    if (d.tagName !== "DIALOG" || d.id === "games" || !d.open || r.oldValue !== null) continue;
    const now = performance.now();
    if (now - gamesClick < 4000) { d.dataset.parent = "games"; gamesClick = 0; }
    // "back to the quiz" reopens a game that came from Games: keep its parent; any other opening clears it
    else if (!(now - backClick < 4000)) delete d.dataset.parent;
    backClick = 0;
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"], attributeOldValue: true });
// a dismissal only counts for the close it causes (a cancelled Esc or a click that closes nothing must not linger)
const dismissed = new WeakSet();
const dismiss = (d) => { dismissed.add(d); setTimeout(() => dismissed.delete(d), 1000); };
document.addEventListener("cancel", (ev) => { if (ev.target.tagName === "DIALOG") dismiss(ev.target); }, true);
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("dialog form[method=dialog] button, dialog [data-back]");
  if (b) dismiss(b.closest("dialog"));
}, true);
document.addEventListener("close", (ev) => {
  const d = ev.target;
  if (d.tagName !== "DIALOG" || !dismissed.has(d)) return;
  dismissed.delete(d);
  if (d.dataset.parent === "games" && !document.querySelector("dialog[open]")) $("#games").showModal();
}, true);

initPerfHud(map, $("#set-ver"));

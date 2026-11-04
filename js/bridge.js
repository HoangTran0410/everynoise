// "Nối thể loại": get from genre A to genre B by hopping through artists. Pick an artist of the current genre,
// then one of that artist's other genres, until you reach the target. Pairs are precomputed (data/bridge.json:
// [[a, b, steps], ...], built from the kid-safe core graph); the shortest solution is found here with a BFS over the
// genre–artist graph of the *current* kids mode (usable genre = isOk + has a track; usable artist = core artist in >= 2 usable genres).
import { $, el, shuffle, toast } from "./util.js";
import { model, trackOf, famEmoji } from "./data.js";
import { t, fmtN } from "./i18n.js";

const N_ARTISTS = 6, N_GENRES = 12;
const graphs = new Map();     // kids(bool) -> { by: Map genre -> [artist k], dist(target) }
let api = null, pairs = null, level = 2, last = -1;
let g = null;                 // current game: { graph, from, to, cur, trail: [genre], via: [artist k], pick: k|null, best, dist, over }

const usable = (i) => i >= 0 && model.G[i] && api.isOk(model.G[i]) && !!trackOf(i);
const gname = (i) => model.G[i].n;

function buildGraph() {
  const A = api.artists, by = new Map(), ag = new Map();
  for (let k = 0; k < A.coreN; k++) {
    if (api.state.kids && A.isBad(k)) continue;
    const gs = A.genresOf(k).filter(usable);
    if (gs.length < 2) continue;
    ag.set(k, gs);
    for (const i of gs) { if (!by.has(i)) by.set(i, []); by.get(i).push(k); }
  }
  return { by, ag };
}
function graph() {
  const key = !!api.state.kids;
  if (!graphs.has(key)) graphs.set(key, buildGraph());
  return graphs.get(key);
}
/** Hops (genre -> artist -> genre) from every genre to `to`: Int16Array, -1 = unreachable. */
function distFrom(gr, to) {
  const d = new Int16Array(model.G.length).fill(-1);
  d[to] = 0;
  const q = [to];
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const k of gr.by.get(u) || []) for (const v of gr.ag.get(k)) if (d[v] < 0) { d[v] = d[u] + 1; q.push(v); }
  }
  return d;
}
/** One shortest solution: [genre, artist k, genre, artist k, ..., genre]. */
function solution(gr, dist, from) {
  const out = [from];
  let u = from;
  while (dist[u] > 0) {
    let hit = null;
    for (const k of gr.by.get(u) || []) {
      const v = gr.ag.get(k).find((x) => dist[x] === dist[u] - 1);
      if (v != null && (!hit || k < hit[0])) hit = [k, v];
    }
    if (!hit) break;
    out.push(hit[0], hit[1]); u = hit[1];
  }
  return out;
}

async function start() {
  const A = api.artists;
  $("#bridge-step").textContent = t("Đang tải…");
  const ok = await A.load();
  await model.tracksReady;
  if (!pairs) pairs = await fetch("data/bridge.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const gr = graph();
  const pool = pairs.filter((p) => p[2] === level && usable(p[0]) && usable(p[1]));
  if (!ok || !pool.length) { $("#bridge-step").textContent = t("Chưa đủ dữ liệu để chơi 😢"); return; }
  let ix = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && ix === last) ix = (ix + 1) % pool.length;
  last = ix;
  const [from, to] = pool[ix];
  const dist = distFrom(gr, to);
  g = { gr, from, to, dist, cur: from, trail: [from], via: [], pick: null, best: dist[from], over: false, hint: false };
  render();
  api.player.play(from);
}

function genreChip(i, extra = "", onclick = null) {
  const gg = model.G[i];
  return el("button", { class: "chip path-chip " + extra, style: `--chip-c:${gg.c}`, title: gg.n, onclick: onclick || (() => api.player.play(i)) },
    el("span", { class: "dot", style: `background:${gg.c}` }), gg.f[0] ? el("span", { class: "emo", "aria-hidden": "true" }, famEmoji(gg.f[0])) : null, gg.n);
}

/** Artist options at the current genre: always includes artists that lead closer to the target. */
function artistOptions() {
  const { gr, dist, cur, via } = g;
  const cands = (gr.by.get(cur) || []).filter((k) => !via.includes(k));
  const good = [], rest = [];
  for (const k of cands) (gr.ag.get(k).some((v) => dist[v] >= 0 && dist[v] < dist[cur]) ? good : rest).push(k);
  shuffle(good); shuffle(rest);
  // better-known bridges first (more genres), then a random pick of those so every game differs
  rest.sort((a, b) => gr.ag.get(b).length - gr.ag.get(a).length);
  const pool = shuffle(rest.slice(0, 24));
  return shuffle(good.slice(0, 2).concat(pool).slice(0, N_ARTISTS));
}
/** Genres to hop to from artist k: the target (if there), progress hops and some others. */
function genreOptions(k) {
  const { gr, dist, cur } = g;
  const all = gr.ag.get(k).filter((x) => x !== cur && !g.trail.includes(x));
  const tgt = all.filter((x) => x === g.to), prog = all.filter((x) => x !== g.to && dist[x] >= 0 && dist[x] < dist[cur]);
  const other = shuffle(all.filter((x) => x !== g.to && !prog.includes(x)));
  return shuffle(tgt.concat(prog.slice(0, 3), other).slice(0, N_GENRES));
}

function choose(k) { g.pick = k; render(); }
function hop(i) {
  g.trail.push(i); g.via.push(g.pick); g.cur = i; g.pick = null; g.hint = false;
  if (i === g.to) g.over = true;
  render();
  api.player.play(i);
}
function back() {
  if (!g) return;
  if (g.pick != null) g.pick = null;
  else if (g.trail.length > 1) { g.trail.pop(); g.via.pop(); g.cur = g.trail[g.trail.length - 1]; g.over = false; }
  g.hint = false;
  render();
}

function render() {
  if (!g) return;
  const A = api.artists;
  $("#bridge-from").replaceChildren(genreChip(g.from));
  $("#bridge-to").replaceChildren(genreChip(g.to));
  $("#bridge-level").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.l === level)));
  const trail = $("#bridge-trail");
  trail.textContent = "";
  g.trail.forEach((i, n) => {
    if (n) trail.append(el("span", { class: "path-arrow", "aria-hidden": "true" }, "→"), el("span", { class: "bridge-via" }, "🎤 " + A.nameOf(g.via[n - 1])), el("span", { class: "path-arrow", "aria-hidden": "true" }, "→"));
    trail.append(genreChip(i, i === g.cur ? "now" : ""));
  });
  $("#bridge-count").textContent = t("Bước {n}", { n: fmtN(g.via.length + (g.over ? 0 : 1)) }) + " · " + t("Ngắn nhất: {n} bước", { n: fmtN(g.best) });
  const step = $("#bridge-step"), final = $("#bridge-final");
  step.textContent = ""; final.textContent = ""; final.hidden = !g.over;
  $("#bridge-back").disabled = g.trail.length < 2 && g.pick == null;
  $("#bridge-hint").disabled = g.over;
  if (g.over) { renderFinal(final); return; }
  if (g.pick == null) {
    step.append(el("p", { class: "bridge-q" }, t("Chọn một nghệ sĩ của “{g}”", { g: gname(g.cur) })));
    const box = el("div", { class: "bridge-opts" });
    for (const k of artistOptions()) {
      const good = g.hint && g.gr.ag.get(k).some((v) => g.dist[v] >= 0 && g.dist[v] < g.dist[g.cur]);
      box.append(el("button", { class: "bridge-a" + (good ? " hint" : ""), onclick: () => choose(k) },
        el("b", {}, A.nameOf(k)), el("small", {}, t("{n} thể loại", { n: fmtN(g.gr.ag.get(k).length) }))));
    }
    step.append(box);
  } else {
    step.append(el("p", { class: "bridge-q" }, t("{a} còn thuộc những thể loại nào? Chọn một để nhảy sang.", { a: A.nameOf(g.pick) })));
    const box = el("div", { class: "bridge-genres" });
    for (const i of genreOptions(g.pick)) {
      const prog = g.hint && g.dist[i] >= 0 && g.dist[i] < g.dist[g.cur];
      box.append(genreChip(i, prog ? "hint" : "", () => hop(i)));
    }
    step.append(box);
  }
}

function renderFinal(box) {
  const A = api.artists, hops = g.via.length;
  box.append(el("p", { class: "bridge-win" }, t("Bạn đã tới đích trong {n} bước! 🎉", { n: fmtN(hops) })));
  box.append(el("p", { class: "muted small" }, hops <= g.best ? t("Đó là đường ngắn nhất!") : t("Đường ngắn nhất chỉ có {n} bước:", { n: fmtN(g.best) })));
  const sol = solution(g.gr, g.dist, g.from);
  const row = el("div", { class: "path-chain" });
  sol.forEach((x, n) => {
    if (n % 2) row.append(el("span", { class: "path-arrow", "aria-hidden": "true" }, "→"), el("span", { class: "bridge-via" }, "🎤 " + A.nameOf(x)), el("span", { class: "path-arrow", "aria-hidden": "true" }, "→"));
    else row.append(genreChip(x));
  });
  box.append(row);
  if (sol.length >= 3) box.append(el("p", { class: "muted small" }, t("{a} nối “{x}” với “{y}”.", { a: A.nameOf(sol[1]), x: gname(sol[0]), y: gname(sol[2]) })));
}

export function initBridge(opts) {
  api = opts;   // { artists, player, isOk, state }
  const dlg = $("#bridge");
  $("#ex-bridge").onclick = () => { $("#games").close(); dlg.showModal(); start(); };
  $("#bridge-new").onclick = () => start();
  $("#bridge-back").onclick = back;
  $("#bridge-hint").onclick = () => { if (g && !g.over) { g.hint = true; render(); toast(t("💡 Những lựa chọn sáng lên sẽ đưa bạn lại gần đích")); } };
  $("#bridge-level").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-l]");
    if (b) { level = +b.dataset.l; start(); }
  });
  addEventListener("langchange", () => { if (dlg.open) render(); });
  // kids mode flips the graph: the caller restarts an open game with a pair that is playable in the new mode
  return { start, get isOpen() { return dlg.open; } };
}

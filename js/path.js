// "Đường đi âm nhạc": shortest chain of genres between two genres.
// Graph = `p` (parent/related) edges (weight 1) + map-neighbour edges (weight 1.5), built lazily
// once per kids-mode setting. Search = Dijkstra with a binary heap.
import { $, el, toast } from "./util.js";
import { model, trackOf, famEmoji } from "./data.js";
import { t, fmtN } from "./i18n.js";

const K_NEAR = 6, W_P = 1, W_NEAR = 1.5, W_BRIDGE = 3, MAX_NODES = 60;
const graphs = new Map();   // kids(bool) → { adj: Array<[to, w]>, ok: Uint8Array }
let api = null, from = -1, to = -1, path = null;

/** Grid-based k-nearest search over the usable genres (same space as data.js nearest()). */
function knnAll(ok, k) {
  const { G } = model;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (const g of G) if (ok[g.i]) { n++; x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x); y0 = Math.min(y0, g.y); y1 = Math.max(y1, g.y); }
  const cell = Math.max(1, Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / Math.max(1, n)) * 1.5);
  const cols = Math.floor((x1 - x0) / cell) + 1, rows = Math.floor((y1 - y0) / cell) + 1;
  const buckets = new Array(cols * rows);
  const cx = (g) => Math.floor((g.x - x0) / cell), cy = (g) => Math.floor((g.y - y0) / cell);
  for (const g of G) if (ok[g.i]) (buckets[cy(g) * cols + cx(g)] ||= []).push(g.i);
  const out = new Array(G.length);
  for (const g of G) {
    if (!ok[g.i]) continue;
    const gx = cx(g), gy = cy(g), best = [];
    for (let r = 0; r < Math.max(cols, rows); r++) {
      // once k found and the ring is farther than the k-th best, stop
      if (best.length >= k && (r - 1) * cell > best[k - 1][1]) break;
      for (let yy = gy - r; yy <= gy + r; yy++) {
        if (yy < 0 || yy >= rows) continue;
        const edge = yy === gy - r || yy === gy + r;
        for (let xx = gx - r; xx <= gx + r; edge ? xx++ : (xx += 2 * r || 1)) {
          if (xx < 0 || xx >= cols) continue;
          const b = buckets[yy * cols + xx];
          if (!b) continue;
          for (const j of b) {
            if (j === g.i) continue;
            const h = G[j], d = Math.hypot(h.x - g.x, h.y - g.y);
            if (best.length < k) { best.push([j, d]); best.sort((a, c) => a[1] - c[1]); }
            else if (d < best[k - 1][1]) { best[k - 1] = [j, d]; best.sort((a, c) => a[1] - c[1]); }
          }
        }
      }
    }
    out[g.i] = best;
  }
  return out;
}

function buildGraph(isOk) {
  const { G, byName } = model;
  const ok = new Uint8Array(G.length);
  for (const g of G) ok[g.i] = isOk(g) && trackOf(g.i) ? 1 : 0;
  const adj = G.map(() => []);
  const seen = new Set();
  const link = (a, b, w) => {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    if (seen.has(key)) { // keep the cheaper weight
      const e = adj[a].find((x) => x[0] === b); if (e && w < e[1]) { e[1] = w; adj[b].find((x) => x[0] === a)[1] = w; }
      return;
    }
    seen.add(key); adj[a].push([b, w]); adj[b].push([a, w]);
  };
  for (const g of G) {
    if (!ok[g.i]) continue;
    for (const p of g.p) { const j = byName.get(p); if (j != null && j !== g.i && ok[j]) link(g.i, j, W_P); }
  }
  const near = knnAll(ok, K_NEAR);
  for (const g of G) if (ok[g.i]) for (const [j] of near[g.i]) link(g.i, j, W_NEAR);
  // join islands so every pair is reachable
  const comp = new Int32Array(G.length).fill(-1);
  const sizes = [];
  for (const g of G) {
    if (!ok[g.i] || comp[g.i] >= 0) continue;
    const id = sizes.length; let size = 0; const st = [g.i]; comp[g.i] = id;
    while (st.length) { const a = st.pop(); size++; for (const [b] of adj[a]) if (comp[b] < 0) { comp[b] = id; st.push(b); } }
    sizes.push(size);
  }
  if (sizes.length > 1) {
    const main = sizes.indexOf(Math.max(...sizes));
    const mainNodes = G.filter((g) => ok[g.i] && comp[g.i] === main);
    for (let c = 0; c < sizes.length; c++) {
      if (c === main) continue;
      const members = G.filter((g) => ok[g.i] && comp[g.i] === c);
      let bi = -1, bj = -1, bd = Infinity;
      for (const a of members) for (const b of mainNodes) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < bd) { bd = d; bi = a.i; bj = b.i; } }
      if (bi >= 0) link(bi, bj, W_BRIDGE);
    }
  }
  return { adj, ok };
}

function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}

/** Cheapest chain of genre indices from a to b, or null. */
export function findPath(graph, a, b) {
  if (a === b) return [a];
  const { adj } = graph, n = adj.length;
  const dist = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  dist[a] = 0;
  const h = [[0, a]];
  while (h.length) {
    const [d, u] = heapPop(h);
    if (d > dist[u]) continue;
    if (u === b) break;
    for (const [v, w] of adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heapPush(h, [nd, v]); }
    }
  }
  if (prev[b] < 0) return null;
  const out = [];
  for (let u = b; u >= 0; u = prev[u]) out.push(u);
  return out.reverse();
}

const kidsKey = () => !!api.state.kids;
async function ensureGraph() {
  await model.tracksReady;
  const key = kidsKey();
  if (!graphs.has(key)) {
    const t0 = performance.now();
    graphs.set(key, buildGraph(api.isOk));
    window.__pathBuildMs = Math.round(performance.now() - t0);
  }
  return graphs.get(key);
}

const usable = (i) => i >= 0 && model.G[i] && api.isOk(model.G[i]) && !!trackOf(i);
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function pickGenre(which) {
  const cur = which === "from" ? from : to;
  api.openPicker({
    title: which === "from" ? t("Bắt đầu từ…") : t("Đi tới…"),
    search: true, placeholder: t("Tìm thể loại…"), value: String(cur),
    // 6000 rows are slow to render: show the 300 most popular, narrow down by typing
    items: () => {
      const q = fold($("#pick-q").value.trim());
      const out = [];
      const order = q ? model.G : model.staticOrder.map((i) => model.G[i]);
      for (const g of order) {
        if (!usable(g.i) || (q && !fold(g.n).includes(q))) continue;
        out.push({ label: g.n, value: String(g.i) });
        if (out.length >= 300) break;
      }
      return out;
    },
    onPick: (v) => { if (which === "from") from = +v; else to = +v; compute(); },
  });
}

function randomPair() {
  const pool = model.G.filter((g) => usable(g.i) && !g.ap && g.k >= 3);
  if (pool.length < 2) return;
  const pickOne = () => pool[Math.floor(Math.random() * pool.length)];
  const a = pickOne();
  let b = pickOne(), bd = -1;
  for (let k = 0; k < 40; k++) { const c = pickOne(), d = Math.hypot(c.x - a.x, c.y - a.y); if (d > bd) { bd = d; b = c; } }
  from = a.i; to = b.i;
  compute();
}

async function compute() {
  path = null;
  render();
  if (!usable(from) || !usable(to)) return;
  const graph = await ensureGraph();
  const t0 = performance.now();
  let p = findPath(graph, from, to);
  window.__pathSearchMs = +(performance.now() - t0).toFixed(2);
  if (p && p.length > MAX_NODES) p = null;
  path = p || [];
  render();
}

function chipOf(i) {
  const g = model.G[i];
  return el("button", { class: "chip path-chip", style: `--chip-c:${g.c}`, title: g.n, onclick: () => { $("#path").close(); api.select(i, { play: true, open: true }); } },
    el("span", { class: "dot", style: `background:${g.c}` }), g.f[0] ? el("span", { class: "emo", "aria-hidden": "true" }, famEmoji(g.f[0])) : null, g.n);
}

function render() {
  const nm = (i) => (i >= 0 ? model.G[i].n : t("Chọn thể loại…"));
  $("#path-from-v").textContent = nm(from);
  $("#path-to-v").textContent = nm(to);
  $("#path-from-v").classList.toggle("empty", from < 0);
  $("#path-to-v").classList.toggle("empty", to < 0);
  const chain = $("#path-chain"), cnt = $("#path-count");
  chain.textContent = "";
  const has = path && path.length > 1;
  $("#path-play").disabled = !has;
  $("#path-share").disabled = !(usable(from) && usable(to));
  if (path == null) {
    cnt.textContent = from >= 0 && to >= 0 ? t("Đang tìm đường…") : t("Chọn hai thể loại, hoặc bấm 🎲 để thử ngẫu nhiên.");
    return;
  }
  if (!path.length) { cnt.textContent = t("Không tìm thấy đường đi giữa hai thể loại này 😢"); return; }
  cnt.textContent = path.length === 1 ? t("Hai thể loại này là một!") : t("{n} bước", { n: fmtN(path.length - 1) });
  path.forEach((i, k) => {
    if (k) chain.append(el("span", { class: "path-arrow", "aria-hidden": "true" }, "→"));
    chain.append(chipOf(i));
  });
}

async function open(a, b) {
  if (a != null) from = a;
  if (b != null) to = b;
  if (!$("#path").open) $("#path").showModal();
  await model.tracksReady;   // usable() needs the tracks (hash links open before they load)
  if (!usable(from)) from = -1;
  if (!usable(to)) to = -1;
  compute();
}

const linkFor = () => location.origin + location.pathname + "#path=" + encodeURIComponent(model.G[from].n) + "~" + encodeURIComponent(model.G[to].n);

function readHash() {
  const m = location.hash.match(/path=([^&]+)/);
  if (!m) return false;
  const [a, b] = m[1].split("~").map((s) => { try { return model.byName.get(decodeURIComponent(s)); } catch { return null; } });
  if (a == null || b == null) return false;
  from = a; to = b;
  open().then(() => { if (from < 0 || to < 0) toast(t("Thể loại này không có trong chế độ hiện tại")); });
  return true;
}

export function initPath(opts) {
  api = opts;   // { openPicker, isOk, select, startList, map, state }
  $("#ex-path").onclick = () => { $("#games").close(); open(); };
  $("#d-path").onclick = () => { const s = api.state.selected; open(usable(s) ? s : -1, -1); };
  $("#path-from").onclick = () => pickGenre("from");
  $("#path-to").onclick = () => pickGenre("to");
  $("#path-rand").onclick = randomPair;
  $("#path-swap").onclick = () => { [from, to] = [to, from]; compute(); };
  $("#path-play").onclick = () => {
    if (!path || path.length < 2) return;
    $("#path").close();
    api.startList({ emoji: "🧭", title: "Đường đi âm nhạc", desc: "", trail: true }, path.slice());
  };
  $("#path-share").onclick = async () => {
    const url = linkFor();
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ title: "Everynoise", url }); return; }
      await navigator.clipboard.writeText(url); toast(t("🔗 Đã sao chép liên kết"));
    } catch (e) { if (e?.name !== "AbortError") toast(url); }
  };
  addEventListener("langchange", () => { if ($("#path").open) render(); });
  addEventListener("hashchange", () => { if (/path=/.test(location.hash)) readHash(); });
  return { readHash };
}

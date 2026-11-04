// "Bàn DJ": a square pad on the map's own axes. x = g.e (organic → electric), y = g.b (dense → spiky),
// i.e. the landscape layout of js/map.js. Drag to preview the nearest genre; the music switches after the
// finger rests DWELL ms on a new genre, or on release. Nearest lookup = uniform grid (CSR arrays, no allocation).
import { $, clamp } from "./util.js";
import { model, trackOf, famLabel, famEmoji } from "./data.js";
import { t } from "./i18n.js";
import { initVizBtn } from "./vizbtn.js";

const DWELL = 350, N = 40;            // dwell ms; grid cells per axis
const PUCK = 18;                      // half puck size (css px)
let api = null, built = null;         // built = kids flag the index was made for
let start, items, px, py;             // CSR grid: start[N*N+1], genre ids, their pad coords
let pad, cv, puck, target, nowEl, size = 0, vb = null;
let x = 0.5, y = 0.5, cand = -1, timer = 0, drag = false, rect = null;
let downCur = -1, switched = false;   // playing genre at pointerdown; did the gesture move to another genre

const usable = (g) => api.isOk(g) && !!trackOf(g.i);

function buildIndex() {
  const kids = !!api.state.kids;
  if (built === kids) return;
  built = kids;
  const G = model.G, cell = new Int32Array(G.length).fill(-1);
  const cnt = new Int32Array(N * N + 1);
  let n = 0;
  for (const g of G) {
    if (!usable(g)) continue;
    const c = Math.min(N - 1, (clamp(g.b, 0, 1) * N) | 0) * N + Math.min(N - 1, (clamp(g.e, 0, 1) * N) | 0);
    cell[g.i] = c; cnt[c + 1]++; n++;
  }
  for (let c = 0; c < N * N; c++) cnt[c + 1] += cnt[c];
  start = cnt; items = new Int32Array(n); px = new Float32Array(n); py = new Float32Array(n);
  const fill = start.slice(0, N * N);
  for (const g of G) {
    const c = cell[g.i];
    if (c < 0) continue;
    const k = fill[c]++;
    items[k] = g.i; px[k] = clamp(g.e, 0, 1); py[k] = clamp(g.b, 0, 1);
  }
}

/** Nearest usable genre to (qx, qy) in pad space; expands square rings and stops when no closer one can exist. */
function nearestAt(qx, qy) {
  const cx = Math.min(N - 1, (qx * N) | 0), cy = Math.min(N - 1, (qy * N) | 0);
  let best = -1, bd = Infinity;
  for (let r = 0; r < N; r++) {
    const lim = r / N;
    if (best >= 0 && bd <= lim * lim) break;
    const y0 = cy - r, y1 = cy + r;
    for (let yy = Math.max(0, y0); yy <= Math.min(N - 1, y1); yy++) {
      const edge = yy === y0 || yy === y1, step = edge ? 1 : 2 * r || 1;
      for (let xx = cx - r; xx <= cx + r; xx += step) {
        if (xx < 0 || xx >= N) continue;
        const c = yy * N + xx;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const dx = px[k] - qx, dy = py[k] - qy, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = k; }
        }
      }
    }
  }
  return best;   // index into items/px/py, or -1
}

function draw() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  size = pad.clientWidth;
  cv.width = cv.height = Math.round(size * dpr);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.globalAlpha = 0.6;
  const G = model.G, d = size >= 300 ? 3 : 2.4;
  const span = size;
  for (let k = 0; k < items.length; k++) {
    ctx.fillStyle = G[items[k]].c;
    ctx.fillRect(px[k] * span - d / 2, py[k] * span - d / 2, d, d);
  }
}

function showCand(k) {
  const i = k < 0 ? -1 : items[k];
  cand = i;
  const g = i >= 0 ? model.G[i] : null;
  pad.style.setProperty("--dj-c", g ? g.c : "var(--accent)");
  nowEl.style.setProperty("--dj-c", g ? g.c : "var(--accent)");
  renderNow();
  if (g) target.style.transform = `translate3d(${px[k] * size - PUCK}px,${py[k] * size - PUCK}px,0)`;
  target.hidden = !g;
}

function renderNow() {
  const g = cand >= 0 ? model.G[cand] : null;
  $(".dj-emo", nowEl).textContent = g ? famEmoji(g.f[0]) : "🎛️";
  $(".dj-name", nowEl).textContent = g ? g.n : t("Chạm vào bàn để chọn");
  $(".dj-fam", nowEl).textContent = g && g.f[0] ? famLabel(g.f[0]) : "";
}

function commit(tap = false) {
  clearTimeout(timer); timer = 0;
  if (cand < 0) return;
  // tapping the genre that is already playing = another song of it
  if (tap && cand === api.player.current && api.player.playing) api.player.another(cand);
  else if (cand !== api.player.current || !api.player.playing) api.player.play(cand);
}

function move(nx, ny, instant) {
  x = clamp(nx, 0, 1); y = clamp(ny, 0, 1);
  puck.style.transform = `translate3d(${x * size - PUCK}px,${y * size - PUCK}px,0)`;
  const k = nearestAt(x, y);
  if (k >= 0 && items[k] !== cand) {
    switched = true;
    showCand(k);
    clearTimeout(timer);
    if (!instant) timer = setTimeout(commit, DWELL);
  }
}

function posOf(i) {
  const g = model.G[i];
  return [clamp(g.e, 0, 1), clamp(g.b, 0, 1)];
}

function randomSpot() {
  const k = (Math.random() * items.length) | 0;
  x = px[k]; y = py[k];
  puck.style.transform = `translate3d(${x * size - PUCK}px,${y * size - PUCK}px,0)`;
  showCand(k);
  commit();
}

async function open() {
  if (!$("#dj").open) $("#dj").showModal();
  $("#dj").dataset.playing = api.player.playing;
  vb?.start();
  await model.tracksReady;
  buildIndex();
  if (!items.length) return;
  draw();
  const cur = api.player.current;
  const [sx, sy] = cur >= 0 && model.G[cur] ? posOf(cur) : [0.5, 0.5];
  cand = -1;
  move(sx, sy, true);
  pad.focus({ preventScroll: true });
}

export function initDJ(opts) {
  api = opts;   // { player, isOk, state }
  pad = $("#dj-pad"); cv = $("#dj-cv"); puck = $("#dj-puck"); target = $("#dj-target"); nowEl = $("#dj-now");
  $("#ex-dj").onclick = () => { $("#games").close(); open(); };
  $("#dj-rand").onclick = () => { if (items?.length) randomSpot(); };
  const dlg = $("#dj");
  vb = initVizBtn($("#dj-play"), { player: api.player, dlg });
  const sync = () => { dlg.dataset.playing = api.player.playing; };
  api.player.on("state", sync);
  $("#dj-play").onclick = () => {
    if (api.player.current >= 0) api.player.toggle();
    else if (items?.length) (cand >= 0 ? commit() : randomSpot());
  };
  $("#dj").addEventListener("close", () => { clearTimeout(timer); timer = 0; drag = false; });

  const at = (ev) => move((ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height);
  pad.addEventListener("pointerdown", (ev) => {
    if (!items?.length || ev.button > 0) return;
    ev.preventDefault();
    rect = pad.getBoundingClientRect();   // once per gesture (the dialog animates in, so not cached earlier)
    downCur = api.player.playing ? api.player.current : -1; switched = false;
    drag = true; pad.setPointerCapture(ev.pointerId); pad.classList.add("drag");
    at(ev);
  });
  pad.addEventListener("pointermove", (ev) => { if (drag) at(ev); });
  // a gesture that never left the playing genre is a tap on it
  const end = () => { if (!drag) return; drag = false; pad.classList.remove("drag"); commit(!switched && downCur >= 0 && cand === downCur); };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  pad.addEventListener("keydown", (ev) => {
    if (!items?.length) return;
    const s = ev.shiftKey ? 0.08 : 0.025;
    if (ev.key === "ArrowLeft") move(x - s, y);
    else if (ev.key === "ArrowRight") move(x + s, y);
    else if (ev.key === "ArrowUp") move(x, y - s);
    else if (ev.key === "ArrowDown") move(x, y + s);
    else if (ev.key === "Enter" || ev.key === " ") commit();
    else return;
    ev.preventDefault();
  });
  addEventListener("resize", () => {
    if (!$("#dj").open || !items?.length) return;
    draw();
    puck.style.transform = `translate3d(${x * size - PUCK}px,${y * size - PUCK}px,0)`;
    const k = nearestAt(x, y);
    if (k >= 0) { cand = -1; showCand(k); }
  });
  addEventListener("langchange", () => { if ($("#dj").open) renderNow(); });
}

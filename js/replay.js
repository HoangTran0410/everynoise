// Replay: animates a list of genres on the map — the trail grows step by step while the camera follows —
// with no music. Used for the listening history (Settings), a genre path and a saved route.
import { $, clamp, toast } from "./util.js";
import { model } from "./data.js";
import { t } from "./i18n.js";

let api = null, run = null;   // run: { list, title, k, t0, step, paused, prevTrail, raf }

const bar = () => $("#replay-bar");
function ui() {
  if (!run) return;
  $("#replay-title").textContent = run.title.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "");   // the bar has its own 🎞
  $("#replay-step").textContent = run.done ? t("Xong! {n} thể loại", { n: run.list.length }) : `${Math.min(run.k + 1, run.list.length)} / ${run.list.length} · ${model.G[run.list[Math.min(run.k, run.list.length - 1)]].n}`;
  $("#replay-pause").textContent = run.paused ? "▶" : "⏸";
  $("#replay-pause").title = $("#replay-pause").ariaLabel = t(run.paused ? "Tiếp tục" : "Tạm dừng");
  $("#replay-pause").hidden = !!run.done;
}
function fly(i, ms) {
  const g = model.G[i], m = api.map;
  const z = clamp(m.view.z, m.zFit * 3, m.zFit * 9);
  m.flyTo({ cx: g.wx + (60 + m.rightInset / 2) / z, cy: g.wy + m.padBottom / 2 / z, z }, ms);
}
function frame(now) {
  if (!run || run.paused) return;
  const { list, step } = run;
  const p = (now - run.t0) / step;   // progress inside the current segment
  if (p >= 1) {
    run.k++;
    if (run.k >= list.length - 1) { api.map.setTrailProgress(list.length - 1); run.done = true; ui(); return; }
    run.t0 = now;
    api.map.setSelected(list[run.k + 1]);
    fly(list[run.k + 1], step);
    ui();
  } else {
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    api.map.setTrailProgress(run.k + e);
  }
  run.raf = requestAnimationFrame(frame);
}

/** Animate `list` (genre indices, in order). Returns false when there is nothing to show. */
export function start(list, title = t("🎞 Đường đi")) {
  list = list.filter((i, k) => i != null && i >= 0 && (k === 0 || i !== list[k - 1]));
  if (list.length < 2) { toast(t("Cần ít nhất 2 thể loại để xem đường đi")); return false; }
  stop(true);
  const m = api.map;
  run = { list, title, k: 0, t0: performance.now(), step: clamp(14000 / list.length, 450, 1200), paused: false, done: false, prevTrail: m.trail, prevSel: m.sel, raf: 0 };
  $("#tour-bar").classList.add("under-replay");
  bar().hidden = false;
  m.setTrail(list); m.setTrailProgress(0);
  m.setSelected(list[0]);
  fly(list[0], 500);
  ui();
  // the first segment starts after the camera arrived
  run.t0 = performance.now() + 500;
  run.raf = requestAnimationFrame(frame);
  return true;
}
export function stop(silent = false) {
  if (!run) return;
  cancelAnimationFrame(run.raf);
  const m = api.map, prev = run.prevTrail, sel = run.prevSel;
  run = null;
  bar().hidden = true;
  $("#tour-bar").classList.remove("under-replay");
  m.setTrail(live ? live.list : prev);   // the live trail / a journey's trail comes back
  m.setSelected(sel >= 0 ? sel : -1, sel >= 0 ? m.neighbors : []);
  if (!silent) api.onStop?.();
}
export const active = () => !!run;

// ── live trail: from "start" on, every genre change adds a point; the map draws it as it grows ──
let live = null;   // { list }
const liveBar = () => $("#live-bar");
function liveUI() {
  if (!live) return;
  $("#live-step").textContent = live.list.length ? t("{n} bước · {g}", { n: live.list.length, g: model.G[live.list[live.list.length - 1]].n }) : t("Đổi thể loại để vẽ");
  $("#live-replay").disabled = live.list.length < 2;
}
export function liveStart(first = -1) {
  stop(true);
  live = { list: [] };
  if (first >= 0) live.list.push(first);
  api.map.setTrail(live.list);
  liveBar().hidden = false;
  liveUI();
  toast(t("⏺ Đang vẽ trail: mỗi lần đổi thể loại là thêm một bước"));
}
/** Called on every track change (main.js). */
export function liveAdd(i) {
  if (!live || i == null || i < 0 || live.list[live.list.length - 1] === i) return;
  live.list.push(i);
  if (live.list.length > 300) live.list.shift();
  if (!run) api.map.setTrail(live.list);
  liveUI();
}
export function liveStop() {
  if (!live) return;
  const list = live.list; live = null;
  liveBar().hidden = true;
  if (!run) api.map.setTrail(null);
  return list;
}
export const liveActive = () => !!live;
export const liveList = () => (live ? live.list.slice() : []);

export function initReplay(opts) {
  api = opts;   // { map, onStop? }
  $("#replay-pause").onclick = () => {
    if (!run) return;
    run.paused = !run.paused;
    if (run.paused) { run.elapsed = performance.now() - run.t0; cancelAnimationFrame(run.raf); }
    else { run.t0 = performance.now() - run.elapsed; run.raf = requestAnimationFrame(frame); }
    ui();
  };
  $("#replay-stop").onclick = () => stop();
  $("#live-replay").onclick = () => { if (live && live.list.length > 1) start(live.list.slice(), t("⏺ Trail của bạn")); };
  $("#live-stop").onclick = () => { liveStop(); toast(t("Đã dừng vẽ trail")); };
  addEventListener("langchange", () => { ui(); liveUI(); });
  return { start, stop, active, liveStart, liveAdd, liveStop, liveActive, liveList };
}

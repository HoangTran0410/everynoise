// "Lộ trình của tôi": routes the user builds from genres and/or specific songs, kept in localStorage,
// played as a tour (trail on the map) and shared as a link. No server: the link carries the whole route
// (#route=<name>:<genre index base36>[~<track id>].<...>), so a shared route opens anywhere.
import { $, el, store, toast } from "./util.js";
import { model, trackOf, radioOf } from "./data.js";
import { t, fmtN } from "./i18n.js";

const KEY = "nm:routes", CUR = "nm:route-cur", MAX_ITEMS = 60, MAX_ROUTES = 30;
let routes = store.get(KEY, []);   // newest first: [{ id, name, items: [{ g, id?, a?, s? }], shared? }]
let curId = store.get(CUR, null);
let api = null, delArmed = 0;

const save = () => { store.set(KEY, routes); store.set(CUR, curId); };
const uid = () => Math.random().toString(36).slice(2, 8);
const cur = () => routes.find((r) => r.id === curId) || routes[0] || null;
const same = (a, b) => a.g === b.g && (a.id || "") === (b.id || "");

function create(name, items = [], extra = {}) {
  const r = { id: uid(), name: name || t("Lộ trình {n}", { n: routes.length + 1 }), items, ...extra };
  routes.unshift(r); routes = routes.slice(0, MAX_ROUTES); curId = r.id; save();
  return r;
}

/** Add a genre ({ g }) or a song ({ g, id, a, s }) to the current route (created on first use). */
export function add(rec) {
  const r = cur() || create();
  if (r.items.some((x) => same(x, rec))) { toast(t("Đã có trong lộ trình «{r}»", { r: r.name })); return false; }
  if (r.items.length >= MAX_ITEMS) { toast(t("Lộ trình đầy rồi ({n} mục)", { n: MAX_ITEMS })); return false; }
  r.items.push({ g: rec.g, ...(rec.id ? { id: rec.id, a: rec.a, s: rec.s } : {}) }); save();
  toast(t("🧭 Đã thêm vào «{r}» ({n})", { r: r.name, n: r.items.length }));
  if ($("#route").open) render();
  return true;
}

// ── link ──
// item: <genre base36>, a song by id <genre>~<track id>, or a compact song <genre>-<index in the genre's radio, base36>
// (≈6 chars instead of 27: what a shared journey of 100+ songs uses; the index is resolved to the song on arrival)
const MAX_SHARED = 200;
const itemCode = (it) => { const i = model.byName.get(it.g); return i == null ? null : i.toString(36) + (it.id ? "~" + it.id : it.n != null ? "-" + it.n.toString(36) : ""); };
const encode = (r) => "#route=" + encodeURIComponent(r.name) + ":" + r.items.map(itemCode).filter(Boolean).join(".");
const isSong = (it) => !!it.id || it.n != null;
/**
 * A link hash ("route=…", no "#") for any journey: genre indices, and per step the song's radio index (ns) when
 * the journey plays specific songs. Long journeys are cut to the first MAX_SHARED steps.
 */
export function journeyHash(name, list, ns) {
  const items = list.slice(0, MAX_SHARED).map((i, k) => i.toString(36) + (ns?.[k] != null ? "-" + ns[k].toString(36) : ""));
  return { hash: "route=" + encodeURIComponent(String(name).slice(0, 40)) + ":" + items.join("."), n: items.length, total: list.length };
}
const linkFor = (r) => location.origin + location.pathname + encode(r);
function parse(hash) {
  // the /s card page re-encodes the value (":" → %3A): read it through URLSearchParams, split at the last ":"
  const v = new URLSearchParams(hash.replace(/^#/, "")).get("route");
  if (!v) return null;
  const k = v.lastIndexOf(":");
  if (k < 0) return null;
  let name = v.slice(0, k); try { name = decodeURIComponent(name); } catch { /* already plain */ }
  name = name.slice(0, 40);
  const items = [];
  for (const s of v.slice(k + 1).split(".")) {
    if (!s || items.length >= MAX_SHARED) continue;
    const [ix, id] = s.split("~"), [gx, nx] = ix.split("-");
    const g = model.G[parseInt(gx, 36)];
    if (!g) continue;
    const n = nx != null ? parseInt(nx, 36) : NaN;
    items.push(id ? { g: g.n, id } : n >= 0 ? { g: g.n, n } : { g: g.n });
  }
  return items.length ? { name, items } : null;
}
/** Song names are not in the link: look them up in the genre's track list (async, best effort). */
async function resolveNames(r) {
  let changed = false;
  for (const it of r.items) {
    if (!isSong(it) || it.s) continue;
    const i = model.byName.get(it.g);
    try {
      const list = await radioOf(i), tr = it.id ? list.find((x) => x && x[1] === it.id) : list[it.n];
      if (tr) { it.id = tr[1]; it.a = tr[2]; it.s = tr[3]; delete it.n; changed = true; }
    } catch { /* offline */ }
  }
  if (changed) { save(); if ($("#route").open && cur() === r) render(); }
}

// ── play ──
async function play(r) {
  const steps = r.items.map((it) => ({ i: model.byName.get(it.g), id: it.id, n: it.n })).filter((s) => s.i != null && api.isOk(model.G[s.i]) && trackOf(s.i));
  // a song plays at its index in the genre's radio list (the lists can be rebuilt: fall back to the first track)
  const ns = await Promise.all(steps.map(async (s) => {
    if (!s.id) return s.n;   // a shared compact song not resolved yet: its index as sent
    try { const k = (await radioOf(s.i)).findIndex((tr) => tr && tr[1] === s.id); return k >= 0 ? k : 0; } catch { return 0; }
  }));
  $("#route").close();
  api.startList({ emoji: "🧭", title: r.name, desc: "", trail: true, ns, raw: true }, steps.map((s) => s.i), 1);
}

// ── modal ──
function label(it) {
  const g = model.G[model.byName.get(it.g)];
  if (!isSong(it)) return [it.g, g?.co || "", g?.c || "#888"];
  return [it.s || t("Bài hát trong {g}", { g: it.g }), it.s ? `${it.a} · ${it.g}` : "", g?.c || "#888"];
}
function render() {
  const r = cur();
  const ol = $("#route-list"); ol.textContent = "";
  $("#route-name").value = r?.name || "";
  $("#route-name").disabled = !r;
  $("#route-switch-label").textContent = routes.length > 1 ? t("{n} lộ trình", { n: routes.length }) : t("Lộ trình");
  $("#route-shared").hidden = !r?.shared;
  $("#route-empty").hidden = !!r?.items.length;
  $("#route-empty").textContent = r ? t("Chưa có gì. Mở một thể loại rồi bấm «🧭 + Lộ trình» để thêm thể loại hoặc bài đang phát.") : t("Chưa có lộ trình nào. Bấm «＋ Lộ trình mới», hoặc mở một thể loại rồi bấm «🧭 + Lộ trình».");
  $("#route-play").disabled = !r?.items.length;
  $("#route-share").disabled = !r?.items.length;
  $("#route-view").disabled = (r?.items.length || 0) < 2;
  $("#route-del").disabled = !r;
  $("#route-del").textContent = delArmed ? t("🗑 Chắc chứ?") : t("🗑 Xoá");
  $("#route-del").classList.toggle("danger", !!delArmed);
  if (!r) return;
  r.items.forEach((it, k) => {
    const [main, sub, color] = label(it);
    const move = (d) => { const j = k + d; if (j < 0 || j >= r.items.length) return; [r.items[k], r.items[j]] = [r.items[j], r.items[k]]; save(); render(); };
    ol.append(el("li", { "data-k": k },
      el("span", { class: "dot", style: `background:${color}` }),
      el("span", { class: "route-t" }, el("b", {}, (isSong(it) ? "🎵 " : "") + main), sub ? el("small", {}, sub) : null),
      el("button", { class: "icon-btn", title: t("Lên"), "aria-label": t("Lên"), disabled: k === 0 ? "" : null, onclick: () => move(-1) }, "↑"),
      el("button", { class: "icon-btn", title: t("Xuống"), "aria-label": t("Xuống"), disabled: k === r.items.length - 1 ? "" : null, onclick: () => move(1) }, "↓"),
      el("button", { class: "icon-btn", title: t("Bỏ"), "aria-label": t("Bỏ"), onclick: () => { r.items.splice(k, 1); save(); render(); } }, "✕")));
  });
}
function open() {
  delArmed = 0;
  render();
  $("#route").showModal();
}
function switchRoute() {
  api.openPicker({
    title: t("Chọn lộ trình"), value: curId,
    items: () => [...routes.map((r) => ({ value: r.id, label: r.name, n: r.items.length })), { value: "+", label: t("＋ Lộ trình mới") }],
    onPick: (v) => { if (v === "+") create(); else curId = v; save(); render(); if (!$("#route").open) $("#route").showModal(); },
  });
}

/** Opens a route from the link (#route=…); imported as a new saved route, once per distinct link. */
function readHash() {
  const p = parse(location.hash);
  if (!p) return false;
  const enc = encode(p);
  let r = routes.find((x) => x.src === enc || encode(x) === enc);
  if (!r) { r = create(p.name, p.items, { shared: true, src: enc }); toast(t("🧭 Đã nhận lộ trình «{r}» ({n} mục)", { r: r.name, n: r.items.length })); }
  else curId = r.id;
  save();
  history.replaceState(null, "", location.pathname + location.search);
  model.tracksReady.then(() => resolveNames(r));
  open();
  return true;
}

export function initRoute(opts) {
  api = opts;   // { openPicker, startList, isOk }
  $("#ex-route").onclick = () => { $("#games").close(); open(); };
  $("#route-switch").onclick = switchRoute;
  $("#route-name").oninput = (ev) => { const r = cur(); if (!r) return; r.name = ev.target.value.trim().slice(0, 40) || r.name; save(); };
  $("#route-name").onchange = render;
  $("#route-new").onclick = () => { create(); render(); $("#route-name").focus(); };
  $("#route-del").onclick = () => {
    const r = cur(); if (!r) return;
    // two taps: the first one arms the button (red) for 4 s
    if (!delArmed) { delArmed = 1; render(); setTimeout(() => { if (delArmed) { delArmed = 0; if ($("#route").open) render(); } }, 4000); return; }
    delArmed = 0;
    routes = routes.filter((x) => x !== r); curId = routes[0]?.id || null; save();
    toast(t("Đã xoá lộ trình «{r}»", { r: r.name }));
    render();
  };
  $("#route-play").onclick = () => { const r = cur(); if (r?.items.length) play(r); };
  $("#route-view").onclick = () => { const r = cur(); if (!r?.items.length) return; $("#route").close(); api.replay(r.items.map((it) => model.byName.get(it.g)), r.name); };
  $("#route-share").onclick = async () => {
    const r = cur(); if (!r?.items.length) return;
    const url = linkFor(r);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ title: r.name, url }); return; }
      await navigator.clipboard.writeText(url); toast(t("🔗 Đã sao chép liên kết"));
    } catch (e) { if (e?.name !== "AbortError") toast(url); }
  };
  addEventListener("langchange", () => { if ($("#route").open) render(); });
  addEventListener("hashchange", () => { if (/route=/.test(location.hash)) readHash(); });
  return { add, open, readHash, linkFor: () => { const r = cur(); return r ? linkFor(r) : ""; }, all: () => routes, current: cur };
}

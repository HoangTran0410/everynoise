// One link for whatever is on screen. The hash is rewritten (replaceState, no history entries) on every
// change — genre, song, filters, tour step, open game — so the address bar, or any 🔗 button, always
// links to "here". Keys: g=<genre> s=<track id> | tour=<id> k=<step> | game=<id> a=<genre> b=<genre>,
// plus the left-panel filters q fam co scene fav new e b sort. #route= and #path= stay with their modules.
import { toast, isTouch } from "./util.js";
import { model } from "./data.js";
import { t } from "./i18n.js";
import { cover } from "./covers.js";

let api = null, timer = 0, last = "";
// dialog id → game id in the link
const GAMES = { quiz: "quiz", passport: "passport", path: "path", route: "route", bridge: "bridge", geo: "geo", artistq: "artist",
  instr: "instr", world: "world", ab: "ab", dj: "dj", heardle: "heardle" };

/** The hash for the current screen (without "#"). */
export function current() {
  if (!api) return "";
  const s = api.state, p = new URLSearchParams();
  const game = [...document.querySelectorAll("dialog[open]")].map((d) => GAMES[d.id]).find(Boolean);
  if (game) {
    p.set("game", game);
    if (game === "ab") { const st = window.__ab?.state; if (st?.A >= 0) p.set("a", model.G[st.A].n); if (st?.B >= 0) p.set("b", model.G[st.B].n); }
  } else if (s.tour?.t.id) {
    p.set("tour", s.tour.t.id);
    if (s.tour.idx > 0) p.set("k", s.tour.idx + 1);
  } else if (s.selected >= 0) {
    p.set("g", model.G[s.selected].n);
    const m = api.player.meta;
    if (m && m.i === s.selected && m.n >= 0 && m.trackId) p.set("s", m.trackId);
  }
  if (s.q.trim()) p.set("q", s.q.trim());
  if (s.fams.size) p.set("fam", [...s.fams].join(","));
  if (s.country) p.set("co", s.country);
  if (s.scene) p.set("scene", "1");
  if (s.fav) p.set("fav", "1");
  if (s.fresh) p.set("new", "1");
  if (s.e[0] > 0 || s.e[1] < 100) p.set("e", s.e.join("-"));
  if (s.b[0] > 0 || s.b[1] < 100) p.set("b", s.b.join("-"));
  if (s.sort && s.sort !== "relevance") p.set("sort", s.sort);
  return p.toString();
}
export const link = () => location.origin + location.pathname + (current() ? "#" + current() : "");
/** The hash for a trail (genre indices, base36) that opens straight in replay: trail=a.b.c&n=<title> */
export const trailHash = (list, title = "") => "trail=" + list.map((i) => i.toString(36)).join(".") + (title ? "&n=" + encodeURIComponent(title) : "");
/**
 * The link handed to a share sheet: /s?<hash>&t=<title>&d=<text>&c=<cover> — a tiny page (functions/s.js)
 * with the preview card (title, text, album cover) that sends the browser on to /#<hash>. The address bar
 * keeps the plain #hash; only shared links take this form.
 */
export function cardLink(hash, { title = "", desc = "", cover: c = "" } = {}) {
  if (!hash) return location.origin + location.pathname;
  const p = new URLSearchParams(hash);
  if (title) p.set("t", title);
  if (desc) p.set("d", desc);
  if (c) p.set("c", c);
  return location.origin + "/s?" + p.toString();
}

/** Rewrite the hash soon (changes come in bursts: select + play + render). */
export function sync() { clearTimeout(timer); timer = setTimeout(write, 60); }
function write() {
  if (!api) return;
  const h = current();
  if (h === last) return;
  last = h;
  history.replaceState(null, "", location.pathname + location.search + (h ? "#" + h : ""));
}

const range = (v) => { const [a, b] = String(v).split("-").map((x) => Math.max(0, Math.min(100, +x))); return a >= 0 && b >= 0 && a <= b ? [a, b] : null; };
/** Open what a hash describes. Returns true when it pointed at something. */
export function apply(hash = location.hash) {
  const h = hash.replace(/^#/, "");
  if (!h || !api || /(^|&)(route|path)=/.test(h)) return false;
  const p = new URLSearchParams(h);
  let did = false;
  const f = {};
  if (p.has("q")) f.q = p.get("q").slice(0, 80);
  if (p.has("fam")) f.fams = p.get("fam").split(",").filter((x) => model.families.includes(x));
  if (p.has("co")) f.country = p.get("co");
  if (p.has("scene")) f.scene = p.get("scene") === "1";
  if (p.has("fav")) f.fav = p.get("fav") === "1";
  if (p.has("new")) f.fresh = p.get("new") === "1";
  if (p.has("e") && range(p.get("e"))) f.e = range(p.get("e"));
  if (p.has("b") && range(p.get("b"))) f.b = range(p.get("b"));
  if (p.has("sort")) f.sort = p.get("sort");
  if (Object.keys(f).length) { api.setFilters(f); did = true; }
  if (p.has("g")) {
    const i = model.byName.get(p.get("g"));
    if (i != null) { did = true; if (p.get("s")) api.playSong(i, p.get("s")); else api.select(i, { open: true }); }
  }
  if (p.has("tour")) { const k = parseInt(p.get("k"), 10); did = api.startTour(p.get("tour"), k > 1 ? k - 1 : 0) || did; }
  if (p.has("game")) did = api.openGame(p.get("game"), p) || did;
  if (p.has("trail")) {
    const list = p.get("trail").split(".").map((s) => parseInt(s, 36)).filter((i) => i >= 0 && i < model.G.length).slice(0, 300);
    did = api.replayTrail(list, (p.get("n") || "").slice(0, 40)) || did;
  }
  return did;
}

/** Share a link (the current screen unless `hash` is given): the OS sheet on touch screens, the clipboard elsewhere. */
export async function share(title = "Everynoise", hash = null, { desc = "", trackId = "" } = {}) {
  write();
  const url = cardLink(hash ?? current(), { title, desc, cover: trackId ? await cover(trackId) : "" });
  if (navigator.share && isTouch()) {
    try { await navigator.share({ title, url }); return; } catch (e) { if (e?.name === "AbortError") return; }   // no sheet: copy instead
  }
  try { await navigator.clipboard.writeText(url); toast(t("🔗 Đã sao chép liên kết")); } catch { toast(url); }
}

export function initShare(opts) {
  api = opts;   // { state, player, select, playSong, setFilters, startTour, openGame }
  // a game opening or closing (any <dialog> toggling) changes the link
  new MutationObserver(sync).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
  addEventListener("urlsync", sync);
  addEventListener("hashchange", () => { const h = location.hash.replace(/^#/, ""); if (h !== last) { last = h; apply(h); } });
  return { apply, sync, share, link, trailHash, cardLink };
}

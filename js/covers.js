// Album covers for the demo tracks. data/covers.json (scripts/build_covers.mjs) maps a Spotify track id to
// the cover's image hash; a track that is not in it (the extra songs in data/more, a shared song) is looked
// up once through Spotify's public oEmbed (CORS, no token) and remembered in localStorage.
// Image URLs: https://i.scdn.co/image/ab67616d0000<size><hash>, size 4851 = 64 px, 1e02 = 300 px, b273 = 640 px
// (the image id is 40 hex chars: 16 of prefix + size, 24 of hash).
import { el, store } from "./util.js";

const SIZE = { 64: "4851", 300: "1e02", 640: "b273" };
const LS = "nm:covers", LS_MAX = 400;
let map = null, ready = null, extra = null;
const pending = new Map();

export const coverUrl = (hash, size = 300) => (hash ? `https://i.scdn.co/image/ab67616d0000${SIZE[size] || SIZE[300]}${hash}` : null);
const hashOf = (u) => (String(u || "").match(/\/image\/ab67616d0000(?:4851|1e02|b273)([0-9a-f]{24})/) || [])[1] || null;

/** Loads the prebuilt table once (boot calls it; everything else waits on it). */
export function load() {
  if (!ready) {
    ready = fetch("data/covers.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((j) => { map = j; });
    extra = store.get(LS, {});
  }
  return ready;
}
/** The hash when it is already known: a string, null (no cover), or undefined (not looked up yet). */
export function known(id) {
  if (!id) return null;
  if (map && id in map) return map[id];
  if (extra && id in extra) return extra[id];
  return undefined;
}
/** The hash for a track id (null when the track has no cover), fetching it when needed. */
export function cover(id) {
  if (!id) return Promise.resolve(null);
  const k = known(id);
  if (k !== undefined) return Promise.resolve(k);
  if (pending.has(id)) return pending.get(id);
  const p = load()
    .then(() => { const k2 = known(id); if (k2 !== undefined) return k2; return fetch("https://open.spotify.com/oembed?url=https://open.spotify.com/track/" + id).then((r) => (r.ok ? r.json() : r.status === 404 ? {} : Promise.reject(r.status))).then((j) => hashOf(j?.thumbnail_url)); })
    .catch(() => undefined)
    .then((h) => {
      pending.delete(id);
      if (h === undefined) return null;   // could not ask (offline, rate-limited): try again next time
      if (!extra) extra = {};
      extra[id] = h;
      const keys = Object.keys(extra);
      if (keys.length > LS_MAX) for (const k3 of keys.slice(0, keys.length - LS_MAX)) delete extra[k3];
      store.set(LS, extra);
      return h;
    });
  pending.set(id, p);
  return p;
}

/**
 * A square tile for a track's cover: coloured placeholder (`color`) that gets the image when it is known.
 * Used inline in lists, feedback cards and headers; `size` picks the CDN variant (64 | 300 | 640).
 */
export function coverEl(id, { size = 64, color = "", cls = "", alt = "" } = {}) {
  const box = el("span", { class: "cover " + cls, style: color ? `--c:${color}` : "" });
  if (!id) return box;
  const put = (h) => { if (h) box.append(el("img", { src: coverUrl(h, size), alt, loading: "lazy", decoding: "async" })); box.dataset.state = h ? "img" : "none"; };
  const k = known(id);
  if (k !== undefined) put(k); else cover(id).then((h) => box.isConnected !== false && put(h));
  return box;
}
/** 2×2 mosaic of up to four tracks' covers (first = the genre's own, then neighbours). */
export function mosaicEl(ids, { color = "", cls = "" } = {}) {
  const box = el("span", { class: "mosaic " + cls, style: color ? `--c:${color}` : "" });
  for (const id of ids.slice(0, 4)) box.append(coverEl(id, { size: 64, color }));
  box.dataset.n = Math.min(4, ids.filter(Boolean).length);
  return box;
}

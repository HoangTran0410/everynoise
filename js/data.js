// Loads data/genres.json (+ data/tracks.json in the background) into a shared model.
import { norm, hash32 } from "./util.js";
import { lang } from "./i18n.js";

export const FAMILY_INFO = {
  "Pop": { vi: "Pop", emoji: "🎤" },
  "Rock": { vi: "Rock", emoji: "🎸" },
  "Metal": { vi: "Metal", emoji: "🤘" },
  "Hip hop & Rap": { vi: "Hip hop & Rap", emoji: "🎧" },
  "Electronic": { vi: "Điện tử", emoji: "🎛️" },
  "Jazz": { vi: "Jazz", emoji: "🎷" },
  "Classical": { vi: "Cổ điển", emoji: "🎻" },
  "Folk & Traditional": { vi: "Dân gian", emoji: "🪕" },
  "Country": { vi: "Đồng quê", emoji: "🤠" },
  "R&B, Soul & Funk": { vi: "R&B · Soul · Funk", emoji: "🕺" },
  "Blues": { vi: "Blues", emoji: "🎺" },
  "Latin": { vi: "Latin", emoji: "💃" },
  "Reggae & Caribbean": { vi: "Reggae · Caribe", emoji: "🌴" },
  "African": { vi: "Châu Phi", emoji: "🥁" },
  "Religious": { vi: "Tôn giáo", emoji: "🙏" },
  "Soundtrack & Media": { vi: "Nhạc phim · Thiếu nhi", emoji: "🎬" },
  "Experimental": { vi: "Thử nghiệm", emoji: "🧪" },
  "Indie & Alternative": { vi: "Indie", emoji: "🌙" },
  "Wellness & Spoken": { vi: "Thư giãn", emoji: "🧘" },
};
export const famLabel = (f) => (lang === "vi" && FAMILY_INFO[f]?.vi) || f;
export const famEmoji = (f) => FAMILY_INFO[f]?.emoji || "🎵";

export const model = {
  G: [],
  byName: new Map(),
  kidsOf: new Map(),
  staticOrder: [],
  families: [],
  tracks: null,          // aligned with G; [previewId, spotifyTrackId, artist, song] | null
  tracksReady: null,     // Promise
};

export async function loadData() {
  const res = await fetch("data/genres.json");
  if (!res.ok) throw new Error("genres.json " + res.status);
  const data = await res.json();
  model.families = data.meta.families;
  let ymin = Infinity, ymax = -Infinity;
  for (const g of data.genres) { ymin = Math.min(ymin, g.y); ymax = Math.max(ymax, g.y); }
  model.G = data.genres.map((g, i) => ({
    i,
    n: g.n, x: g.x, y: g.y, c: g.c,
    f: g.f, co: g.co, s: g.s, p: g.p, k: g.k,
    kid: !!g.kid,
    ap: !!g.ap,
    e: (g.y - ymin) / (ymax - ymin),   // 0 organic → 1 mechanical / electric
    b: g.x / 1500,                     // 0 dense / atmospheric → 1 spiky / bouncy
    nn: norm(g.n),
    h: hash32(g.n),
    wx: 0, wy: 0,                      // world position (set by the map layout)
    tw: 0,                             // label width per 1px of font size
  }));
  const { G, byName, kidsOf } = model;
  for (const g of G) byName.set(g.n, g.i);
  for (const g of G) for (const p of g.p) {
    if (!byName.has(p)) continue;
    if (!kidsOf.has(p)) kidsOf.set(p, []);
    kidsOf.get(p).push(g.i);
  }
  model.staticOrder = G.map((g) => g.i).sort((a, b) => (G[b].k - G[a].k) || (G[a].h - G[b].h));

  model.tracksReady = fetch("data/tracks.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("tracks.json " + r.status))))
    .then((t) => { model.tracks = t; return t; })
    .catch((e) => { console.warn(e); model.tracks = []; return []; });
  return model;
}

export const trackOf = (i) => (model.tracks ? model.tracks[i] : null);

// ── more demo tracks per genre ──────────────────────────────────────────────
// data/tracks.json only holds track #1 of each genre (small, loaded at startup). The other tracks
// live in data/more/<shard>.json ({ "<genre index>": [track, ...] }, tracks #2..), fetched lazily
// the first time a genre's list is needed and kept in memory.
const SHARD = 80;               // genres per shard file; keep in sync with scripts/build_data.py
const shardCache = new Map();   // shard number -> Promise<object>
function loadShard(k) {
  if (!shardCache.has(k)) {
    shardCache.set(k, fetch(`data/more/${k}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("more " + r.status))))
      .catch((e) => { shardCache.delete(k); console.warn(e); return {}; }));
  }
  return shardCache.get(k);
}
/** All demo tracks of genre i (track #1 first). Resolves to [] when the genre has none. */
export async function tracksOf(i) {
  await model.tracksReady;
  const first = trackOf(i);
  if (!first) return [];
  const more = (await loadShard(Math.floor(i / SHARD)))[i] || [];
  return [first, ...more];
}

// ── endless radio ───────────────────────────────────────────────────────────
// data/radio/<genre index>.json: up to 59 more tracks (distinct artists, same ranking as data/more, built by
// scripts/build_radio.py from every artist Every Noise lists). ~4 KB gzip, fetched when a genre is played/opened.
const radioCache = new Map();   // genre index -> Promise<[track, ...] | null>
function loadRadio(i) {
  if (!radioCache.has(i)) {
    radioCache.set(i, fetch(`data/radio/${i}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => { radioCache.delete(i); return null; }));
  }
  return radioCache.get(i);
}
/** Radio list of genre i: track #1 first, then up to 59 more. Falls back to tracksOf() when the genre has no radio file. */
export async function radioOf(i) {
  await model.tracksReady;
  const first = trackOf(i);
  if (!first) return [];
  const r = await loadRadio(i);
  return r && r.length ? [first, ...r] : tracksOf(i);
}

// ── similar genres by shared artists ────────────────────────────────────────
// data/near/<shard>.json: { "<genre index>": [[neighbour index, score 1..100], ...] } (scripts/build_near.py).
// nearOf() is synchronous (the auto-next provider is): it returns null until the shard is in memory.
const nearCache = new Map();    // shard -> object (loaded) | Promise (loading)
export function loadNear(i) {
  const k = Math.floor(i / SHARD);
  if (!nearCache.has(k)) {
    nearCache.set(k, fetch(`data/near/${k}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => { nearCache.delete(k); return {}; })
      .then((d) => { nearCache.set(k, d); return d; }));
  }
  const v = nearCache.get(k);
  return v instanceof Promise ? v : Promise.resolve(v);
}
export function nearOf(i) {
  const v = nearCache.get(Math.floor(i / SHARD));
  return v && !(v instanceof Promise) ? v[i] || null : null;
}
export const hasTrack = (i) => !model.tracks || !!model.tracks[i];

/** Nearest genres in the original Every Noise pixel space. */
export function nearest(i, k = 10, filter = null) {
  const { G } = model;
  const g = G[i];
  const best = [];
  for (const h of G) {
    if (h.i === i || (filter && !filter(h))) continue;
    const d = Math.hypot(h.x - g.x, h.y - g.y);
    if (best.length < k) { best.push([h.i, d]); best.sort((a, b) => a[1] - b[1]); }
    else if (d < best[k - 1][1]) { best[k - 1] = [h.i, d]; best.sort((a, b) => a[1] - b[1]); }
  }
  return best;
}

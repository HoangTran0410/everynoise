// Search by artist. Data (built by scripts/build_artists.py from the full genre pages, ~425k artists):
//   data/artists.json     "core", the most popular artists: fetched lazily on first focus of the search box
//   data/ar/<leaf>.json   every other artist, sharded by the prefix of each word of the name: fetched when a query needs it
//   data/ar/index.json    the leaf lists (small, fetched together with the core)
//   data/ap/<leaf>.json   per-artist track profiles, sharded by the prefix of the whole name (artist page)
// Also renders the "Nghệ sĩ" result groups and the artist lines of the genre detail panel.
import { $, el, norm, escapeHtml } from "./util.js";
import { tracksOf } from "./data.js";
import { t, lang } from "./i18n.js";
import { avatarEl, loadAvatars } from "./covers.js";

const B36 = (s) => parseInt(s, 36);
const EXTRA = { "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "ð": "d", "þ": "th", "ı": "i" };
/** util.norm (lower case, no diacritics, đ→d) + a few letters NFD does not split. Mirrors fold() in build_artists.py. */
export const fold = (s) => norm(s).replace(/[øæœßłðþı]/g, (c) => EXTRA[c]);
const STOP = new Set(["the", "and", "of", "de", "la", "le", "les", "los", "las", "el", "da", "di", "von", "van", "der", "den", "die", "das", "feat", "ft", "with", "for", "dj", "mc"]);
const TOKEN_SPLIT = /[^a-z0-9\u0080-\u{10ffff}]+/u;
/** Shard key of a folded word / name: its leading a-z0-9 run (>= 2 chars), else the bucket _<code point % 97>. */
const keyBase = (s) => { const m = /^[a-z0-9]+/.exec(s); return m && m[0].length >= 2 ? m[0] : "_" + (s.codePointAt(0) % 97); };
/** Leaves that can hold words starting with prefix p: leaves under p + the longest leaf that is a prefix of p. */
function leavesFor(leaves, p) {
  if (p[0] === "_") return leaves.has(p) ? [p] : [];
  const out = [];
  for (const l of leaves) if (l.startsWith(p)) out.push(l);
  for (let L = p.length; L >= 2; L--) if (leaves.has(p.slice(0, L))) { if (!out.includes(p.slice(0, L))) out.push(p.slice(0, L)); break; }
  return out;
}
/** The one leaf holding the whole name (longest leaf prefix of its key). */
function leafOf(leaves, name) {
  const f = fold(name).replace(/[^a-z0-9\u0080-\u{10ffff}]/gu, "");
  const k = keyBase(f || "_");
  if (k[0] === "_") return leaves.has(k) ? k : null;
  for (let L = Math.min(k.length, 8); L >= 2; L--) if (leaves.has(k.slice(0, L))) return k.slice(0, L);
  return null;
}

let names = [], nn = [], refs = [], bad = new Set(), exact = new Map();
let coreN = 0, nl = null, pl = null;       // nl / pl = Sets of name-shard / profile-shard leaf keys
let loading = null, ready = false;
const shardP = new Map();                  // "ar/xx" | "ap/xx" -> Promise<object|null>

const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(url + " " + r.status))));
function shard(dir, key) {
  const id = dir + "/" + key;
  if (!shardP.has(id)) shardP.set(id, getJSON(`data/${id}.json`).catch((e) => { console.warn(e); shardP.delete(id); return null; }));
  return shardP.get(id);
}

/** Append a {a, g, b} block to the in-memory index (artists already known are skipped). */
function addBlock(d) {
  const ns = d.a ? d.a.split("|") : [], rs = d.g ? d.g.split("|") : [];
  const bs = new Set(d.b ? d.b.split(",").map(B36) : []);
  let added = 0;
  for (let j = 0; j < ns.length; j++) {
    const low = ns[j].toLowerCase();
    if (exact.has(low)) continue;
    const k = names.length;
    exact.set(low, k); names.push(ns[j]); refs.push(rs[j]); nn.push(fold(ns[j]));
    if (bs.has(j)) bad.add(k);
    added++;
  }
  return added;
}

/** Fetch + index the core (and the shard manifest) once. Resolves to true when usable. */
export function loadArtists() {
  if (!loading) {
    loading = Promise.all([getJSON("data/artists.json"), getJSON("data/ar/index.json").catch(() => null)])
      .then(([d, idx]) => {
        addBlock(d);
        coreN = names.length;
        if (idx) { nl = new Set(idx.n.split(",")); pl = new Set(idx.p.split(",")); }
        ready = true;
        return true;
      })
      .catch((e) => { console.warn(e); loading = null; return false; });
  }
  return loading;
}

/** Genre indices of artist k, most central first (the order of the file). */
const genresOf = (k) => refs[k].split(",").map(B36);

let tailT = 0;
const TAIL_DELAY = 120;   // short pause: long enough to skip keystrokes in a burst, short enough to feel instant
const tailP = new Map();                   // name-shard leaf -> Promise<number of artists added>
function loadLeaf(l) {
  if (!tailP.has(l)) tailP.set(l, shard("ar", l).then((d) => { if (!d) tailP.delete(l); return d ? addBlock(d) : 0; }));
  return tailP.get(l);
}
/** Load the name shards a (folded) query needs. Resolves to the number of artists added by this call's new loads. */
function ensureTail(q) {
  if (!nl) return Promise.resolve(0);
  const toks = q.split(TOKEN_SPLIT).filter((w) => w.length >= 2 && !STOP.has(w));
  if (!toks.length) return Promise.resolve(0);
  const need = leavesFor(nl, keyBase(toks[0])).filter((l) => !tailP.has(l));
  return Promise.all(need.map(loadLeaf)).then((a) => a.reduce((x, y) => x + y, 0));
}

/** Resolve an artist name to its index (loads the name shard when the artist is not in the core). -1 when unknown. */
export async function lookupArtist(name) {
  await loadArtists();
  const low = name.toLowerCase();
  if (exact.has(low)) return exact.get(low);
  const toks = fold(name).split(TOKEN_SPLIT).filter(Boolean);
  const cand = toks.filter((w) => !STOP.has(w));
  const first = (cand.length ? cand : toks)[0];
  if (!first || !nl) return -1;
  await Promise.all(leavesFor(nl, keyBase(first)).map(loadLeaf));
  return exact.has(low) ? exact.get(low) : -1;
}

/** Tracks of an artist: [{ tr: [preview id, track id, artist, song], gs: [genre idx] }], best genre first. [] when unknown. */
export async function artistProfile(name) {
  await loadArtists();
  const leaf = pl && leafOf(pl, name);
  if (!leaf) return [];
  const d = await shard("ap", leaf);
  const rows = d && d[name];
  if (!rows) return [];
  return rows.map(([pv, tid, song, gs]) => ({ tr: [pvHex(pv), tid, name, song], gs: gs.split(",").map(B36) }));
}
function pvHex(s) {
  if (s[0] === "=") return s.slice(1);
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  let h = "";
  for (let i = 0; i < b.length; i++) h += b.charCodeAt(i).toString(16).padStart(2, "0");
  return h;
}

export function initArtists({ model, isOk, state, pick, onLoaded, open }) {
  // model.G is replaced when genres.json arrives (this runs at module load), so never cache it
  const okGenres = (k) => { const G = model.G; return genresOf(k).filter((i) => isOk(G[i])).sort((a, b) => (G[b].k - G[a].k) || (a - b)); };
  /** Genres of artist k that pass kids mode, most central first (artist page). */
  const centralGenres = (k) => genresOf(k).filter((i) => isOk(model.G[i]));
  const load = () => (loadAvatars(), loadArtists()).then((ok) => { if (ok && onLoaded) onLoaded(); return ok; });

  /** Best matching artists for a normalised query: [{ k, name, genres, sc }] (top `limit`, kids mode respected). */
  function find(q, limit = 4) {
    if (!ready) return [];
    q = fold(q);
    if (q.length < 2) return [];
    // sharded tail: loaded once the user pauses typing (so "so" on the way to "son tung" costs nothing); results refresh when it arrives
    clearTimeout(tailT);
    tailT = setTimeout(() => ensureTail(q).then((n) => { if (n && onLoaded) onLoaded(); }), TAIL_DELAY);
    const toks = q.split(/\s+/).filter(Boolean);
    const sp = " " + q;
    const top = [];                                   // sorted by score desc
    for (let k = 0; k < nn.length; k++) {
      const n = nn[k];
      let s = 0;
      if (n === q) s = 1000;
      else if (n.startsWith(q)) s = 600;
      else if (n.includes(sp)) s = 450;
      else if (n.includes(q)) s = 300;
      else if (toks.length > 1 && toks.every((w) => n.startsWith(w) || n.includes(" " + w))) s = 200;
      if (!s) continue;
      s += Math.min(refs[k].length, 60) / 100 - n.length / 1000;   // more genres, shorter name first
      if (top.length >= limit && s <= top[top.length - 1].sc) continue;
      if (state.kids && bad.has(k)) continue;
      const genres = okGenres(k);
      if (!genres.length) continue;
      let p = top.length;
      while (p > 0 && top[p - 1].sc < s) p--;
      top.splice(p, 0, { k, name: names[k], genres, sc: s });
      if (top.length > limit) top.pop();
    }
    return top;
  }

  function highlight(name, q) {
    const f = fold(name);
    const i = q && f.length === name.length ? f.indexOf(q) : -1;
    if (i < 0) return escapeHtml(name);
    return escapeHtml(name.slice(0, i)) + "<mark>" + escapeHtml(name.slice(i, i + q.length)) + "</mark>" + escapeHtml(name.slice(i + q.length));
  }

  /** Rows for the autocomplete dropdown: { nodes, items } where items = genre indices in DOM order. */
  function suggestRows(hits, q, perArtist = 3, maxArtists = 3) {
    const nodes = [], items = [];
    q = fold(q);
    if (!hits.length) return { nodes, items };
    nodes.push(el("li", { class: "sug-h", role: "presentation" }, "🎤 " + t("Nghệ sĩ")));
    for (const h of hits.slice(0, maxArtists)) {
      const row = el("li", { class: "sug-a", role: "presentation", "data-a": h.name, html: `<span>${highlight(h.name, q)}</span><span class="sub">${escapeHtml(t("{n} thể loại", { n: h.genres.length }))}</span>` });
      row.prepend(avatarEl(h.name, { size: 24 }));
      nodes.push(row);
      for (const i of h.genres.slice(0, perArtist)) {
        const g = model.G[i];
        items.push(i);
        nodes.push(el("li", { class: "sug-g", role: "option", "data-i": i, html:
          `<span class="dot" style="width:11px;height:11px;border-radius:50%;background:${g.c};flex:none"></span><span>${escapeHtml(g.n)}</span>` }));
      }
    }
    return { nodes, items };
  }

  /** Group shown on top of the sidebar results: artist -> genre chips. */
  function resultsGroup(hits) {
    if (!hits.length) return null;
    const frag = document.createDocumentFragment();
    frag.append(el("li", { class: "art-h" }, "🎤 " + t("Nghệ sĩ")));
    for (const h of hits) {
      const chips = el("span", { class: "art-chips" });
      for (const i of h.genres.slice(0, 6)) {
        const g = model.G[i];
        chips.append(el("button", { class: "chip", title: g.n, onclick: () => pick(i) },
          el("span", { class: "dot", style: `background:${g.c}` }), g.n));
      }
      if (h.genres.length > 6) chips.append(el("span", { class: "art-more" }, "+" + (h.genres.length - 6)));
      frag.append(el("li", { class: "art-row" }, el("button", { class: "art-link art-name", title: t("Mở trang nghệ sĩ"), onclick: () => open?.(h.name) }, avatarEl(h.name, { size: 28 }), h.name), chips));
    }
    return frag;
  }

  // ── genre detail panel: "Nghệ sĩ tiêu biểu: A, B, C" + "{artist} còn thuộc: chips" ──
  let key = "";
  async function renderDetail(i, artist) {
    const sec = $("#d-artists");
    if (!sec) return;
    const k0 = [i, artist, lang, state.kids].join("|");
    if (k0 === key) return;
    key = k0;
    const list = await tracksOf(i);
    if (key !== k0) return;
    const seen = new Set(), top = [];
    for (const tr of list) if (!seen.has(tr[2].toLowerCase())) { seen.add(tr[2].toLowerCase()); top.push(tr[2]); }
    sec.hidden = !top.length;
    const line = $("#d-art-list");
    line.textContent = "";
    if (top.length) {
      line.append(t("Nghệ sĩ tiêu biểu:") + " ");
      top.forEach((a, j) => { if (j) line.append(", "); line.append(el("button", { class: "art-link", onclick: () => open?.(a) }, a)); });
    }
    const also = $("#d-art-also"), chips = $("#d-art-chips");
    also.hidden = true; chips.textContent = "";
    if (!artist) return;
    const k = await lookupArtist(artist);
    if (key !== k0) return;
    if (k < 0 || (state.kids && bad.has(k))) return;
    const gs = okGenres(k);
    const others = gs.filter((x) => x !== i);
    if (gs.length < 2 || !others.length) return;
    const [pre, post] = t("{a} còn thuộc:", { a: "\u0000" }).split("\u0000");
    const lab = $("#d-art-also-l");
    lab.textContent = "";
    lab.append(pre, el("button", { class: "art-link", title: t("Mở trang nghệ sĩ"), onclick: () => open?.(artist) }, artist), post);
    for (const j of others.slice(0, 10)) {
      chips.append(el("button", { class: "chip", title: model.G[j].n, onclick: () => pick(j) },
        el("span", { class: "dot", style: `background:${model.G[j].c}` }), model.G[j].n));
    }
    also.hidden = false;
  }

  return {
    load, find, suggestRows, resultsGroup, renderDetail, lookup: lookupArtist, profile: artistProfile, centralGenres,
    isBad: (k) => bad.has(k), nameOf: (k) => names[k], genresOf, get coreN() { return coreN; }, get ready() { return ready; },
  };
}

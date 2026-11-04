// Search by artist: data/artists.json (built by scripts/build_artists.py) maps an artist to the genres
// they appear in. It is fetched lazily (first focus of the search box, or once a track is shown), never at startup.
// Also renders the "Nghệ sĩ" result groups and the artist lines of the genre detail panel.
import { $, el, norm, escapeHtml } from "./util.js";
import { tracksOf } from "./data.js";
import { t, lang } from "./i18n.js";

const B36 = (s) => parseInt(s, 36);
let names = [], nn = [], refs = [], bad = new Set(), exact = null;
let loading = null, ready = false;

/** Fetch + index data/artists.json once. Resolves to true when usable. */
export function loadArtists() {
  if (!loading) {
    loading = fetch("data/artists.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("artists " + r.status))))
      .then((d) => {
        names = d.a.split("|");
        refs = d.g.split("|");
        bad = new Set(d.b ? d.b.split(",").map(B36) : []);
        nn = new Array(names.length);
        for (let k = 0; k < names.length; k++) nn[k] = norm(names[k]);
        ready = true;
        return true;
      })
      .catch((e) => { console.warn(e); loading = null; return false; });
  }
  return loading;
}

/** Genre indices of artist k (ascending, delta-coded base36 in the file). */
function genresOf(k) {
  const out = []; let acc = 0;
  for (const p of refs[k].split(",")) { acc += B36(p); out.push(acc); }
  return out;
}

export function initArtists({ model, isOk, state, pick, onLoaded }) {
  // model.G is replaced when genres.json arrives (this runs at module load), so never cache it
  const okGenres = (k) => { const G = model.G; return genresOf(k).filter((i) => isOk(G[i])).sort((a, b) => (G[b].k - G[a].k) || (a - b)); };
  const load = () => loadArtists().then((ok) => { if (ok && onLoaded) onLoaded(); return ok; });

  /** Best matching artists for a normalised query: [{ k, name, genres, sc }] (top `limit`, kids mode respected). */
  function find(q, limit = 4) {
    if (!ready || q.length < 2) return [];
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
    const i = q ? norm(name).indexOf(q) : -1;
    if (i < 0) return escapeHtml(name);
    return escapeHtml(name.slice(0, i)) + "<mark>" + escapeHtml(name.slice(i, i + q.length)) + "</mark>" + escapeHtml(name.slice(i + q.length));
  }

  /** Rows for the autocomplete dropdown: { nodes, items } where items = genre indices in DOM order. */
  function suggestRows(hits, q, perArtist = 3, maxArtists = 3) {
    const nodes = [], items = [];
    if (!hits.length) return { nodes, items };
    nodes.push(el("li", { class: "sug-h", role: "presentation" }, "🎤 " + t("Nghệ sĩ")));
    for (const h of hits.slice(0, maxArtists)) {
      nodes.push(el("li", { class: "sug-a", role: "presentation", html: `<span>${highlight(h.name, q)}</span><span class="sub">${escapeHtml(t("{n} thể loại", { n: h.genres.length }))}</span>` }));
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
      frag.append(el("li", { class: "art-row" }, el("b", {}, h.name), chips));
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
    $("#d-art-list").textContent = top.length ? t("Nghệ sĩ tiêu biểu:") + " " + top.join(", ") : "";
    const also = $("#d-art-also"), chips = $("#d-art-chips");
    also.hidden = true; chips.textContent = "";
    if (!artist) return;
    if (!ready) { load().then((ok) => { if (ok && key === k0) { key = ""; renderDetail(i, artist); } }); return; }
    if (!exact) { exact = new Map(); for (let k = 0; k < names.length; k++) exact.set(names[k].toLowerCase(), k); }
    const k = exact.get(artist.toLowerCase());
    if (k == null || (state.kids && bad.has(k))) return;
    const gs = okGenres(k);
    const others = gs.filter((x) => x !== i);
    if (gs.length < 2 || !others.length) return;
    $("#d-art-also-l").textContent = t("{a} còn thuộc:", { a: artist });
    for (const j of others.slice(0, 10)) {
      chips.append(el("button", { class: "chip", title: model.G[j].n, onclick: () => pick(j) },
        el("span", { class: "dot", style: `background:${model.G[j].c}` }), model.G[j].n));
    }
    also.hidden = false;
  }

  return { load, find, suggestRows, resultsGroup, renderDetail, get ready() { return ready; } };
}

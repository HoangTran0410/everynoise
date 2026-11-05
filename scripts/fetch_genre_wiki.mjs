#!/usr/bin/env node
// Sources for genre facts. Wikidata P9881 ("Every Noise at Once ID") maps a genre slug to an item; from it we take
// the inception year (P571), country of origin (P495) and the en/vi Wikipedia articles, then the articles' intros.
// Input : data/raw/wikidata_genres.json (SPARQL result, see DECISIONS / the query in this file's git history)
// Output: data/raw/genre_wiki.json  { "<genre index>": { n, item, year, origin[], en: {title, text}, vi: {title, text} } }
// Usage : node scripts/fetch_genre_wiki.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const G = JSON.parse(fs.readFileSync(path.join(root, "data/genres.json"), "utf8"));
const genres = Array.isArray(G) ? G : G.genres;
const rows = JSON.parse(fs.readFileSync(path.join(root, "data/raw/wikidata_genres.json"), "utf8")).results.bindings;
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
const bySlug = new Map(genres.map((g, i) => [slug(g.n), i]));
const UA = { "user-agent": "everynoise-build/1.0 (static genre map; build script)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = {};
for (const b of rows) {
  const i = bySlug.get(b.en.value);
  if (i == null) continue;
  const o = (out[i] ||= { n: genres[i].n, item: b.item.value.split("/").pop(), year: null, origin: [], en: null, vi: null });
  if (b.inception) { const y = +b.inception.value.slice(0, b.inception.value.startsWith("-") ? 5 : 4); if (y && (!o.year || y < o.year)) o.year = y; }
  if (b.originLabel && !/^Q\d+$/.test(b.originLabel.value) && !o.origin.includes(b.originLabel.value)) o.origin.push(b.originLabel.value);
  const t = (u) => decodeURIComponent(u.split("/wiki/")[1]).replace(/_/g, " ");
  if (b.enwiki && !o.en) o.en = { title: t(b.enwiki.value), text: "" };
  if (b.viwiki && !o.vi) o.vi = { title: t(b.viwiki.value), text: "" };
}

async function intros(host, titles) {
  const res = {};
  for (let k = 0; k < titles.length; k += 20) {
    const batch = titles.slice(k, k + 20);
    const u = `https://${host}/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exlimit=20&redirects=1&titles=` + encodeURIComponent(batch.join("|"));
    for (let a = 0; a < 5; a++) {
      try {
        const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) });
        if (r.status === 429) { await sleep(5000 * (a + 1)); continue; }
        const j = await r.json();
        const redir = new Map([...(j.query.normalized || []), ...(j.query.redirects || [])].map((x) => [x.from, x.to]));
        const byTitle = new Map(Object.values(j.query.pages).map((p) => [p.title, p.extract || ""]));
        for (const t of batch) { let x = t; for (let h = 0; h < 3 && redir.has(x); h++) x = redir.get(x); res[t] = byTitle.get(x) || ""; }
        break;
      } catch (e) { if (a === 4) console.warn(host, e.message); await sleep(1500 * (a + 1)); }
    }
    process.stdout.write(`\r${host} ${Math.min(k + 20, titles.length)}/${titles.length}`);
    await sleep(150);
  }
  console.log();
  return res;
}
for (const lang of ["en", "vi"]) {
  const titles = [...new Set(Object.values(out).filter((o) => o[lang]).map((o) => o[lang].title))];
  const tx = await intros(lang + ".wikipedia.org", titles);
  for (const o of Object.values(out)) if (o[lang]) o[lang].text = (tx[o[lang].title] || "").slice(0, 1800);
}
fs.writeFileSync(path.join(root, "data/raw/genre_wiki.json"), JSON.stringify(out));
const v = Object.values(out);
console.log("genres", v.length, "en text", v.filter((o) => o.en?.text).length, "vi text", v.filter((o) => o.vi?.text).length, "year", v.filter((o) => o.year).length, "origin", v.filter((o) => o.origin.length).length);

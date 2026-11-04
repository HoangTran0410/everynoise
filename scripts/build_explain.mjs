// Builds data/explain.json: a vocabulary of hand-written kid-friendly fragments (scripts/explain_terms_*.mjs)
// plus one compact tag record per genre (the ids of the vocabulary terms found in its name).
// js/explain-core.js composes the sentence at runtime from: record + the genre's country / family / axes.
//
// Usage: node scripts/build_explain.mjs        (writes data/explain.json, prints coverage + unmatched tokens)
import fs from "node:fs";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { A } from "./explain_terms_a.mjs";
import { B } from "./explain_terms_b.mjs";
import { C as TC } from "./explain_terms_c.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const genres = JSON.parse(fs.readFileSync(path.join(ROOT, "data/genres.json"), "utf8")).genres;
const world = JSON.parse(fs.readFileSync(path.join(ROOT, "data/world.json"), "utf8"));

// ── vocabulary ──
const entries = [...A, ...B, ...TC];
const dict = new Map();          // key -> entry index
const ignored = new Set();
entries.forEach((e, i) => {
  for (const k of e[0].split("|")) {
    if (e[1] === "x") { ignored.add(k); continue; }
    if (dict.has(k) && dict.get(k) !== i) console.warn("duplicate key:", k, "->", entries[dict.get(k)][1], "and", e[1]);
    dict.set(k, i);
  }
});
for (const [i, e] of entries.entries()) {
  if (e[1] === "x") continue;
  if (!e[2] || !e[3]) throw new Error("empty fragment: " + e[0]);
  if (!["n", "m", "i", "l"].includes(e[1])) throw new Error("bad type " + e[0]);
}

const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
function lookup(key) {
  if (dict.has(key)) return dict.get(key);
  const s = strip(key);
  return dict.has(s) ? dict.get(s) : undefined;
}

const SUFFIXES = ["punk", "pop", "rock", "metal", "wave", "house", "trap", "jazz", "folk", "soul", "funk", "blues", "techno", "trance", "hop", "beats", "reggae", "disco"];

// Greedy longest match (up to 4 words); hyphenated words that are not in the vocabulary are split.
function match(name) {
  const toks = name.toLowerCase().split(/\s+/).filter(Boolean);
  const found = [], unmatched = [];
  for (let p = 0; p < toks.length;) {
    let hit;
    for (let len = Math.min(4, toks.length - p); len >= 1 && hit === undefined; len--) {
      const idx = lookup(toks.slice(p, p + len).join(" "));
      if (idx !== undefined) { hit = idx; p += len; }
    }
    if (hit !== undefined) { found.push(hit); continue; }
    const tok = toks[p++];
    if (ignored.has(tok) || ignored.has(strip(tok))) continue;
    // glued compounds such as "cowpunk" or "afrohouse": use the genre word at the end
    const suf = SUFFIXES.find((x) => tok.length >= x.length + 3 && tok.endsWith(x) && !tok.includes("-"));
    if (suf) { found.push(lookup(suf)); continue; }
    const parts = tok.includes("-") ? tok.split("-").filter(Boolean) : [];
    let any = false;
    for (const part of parts) {
      const idx = lookup(part);
      if (idx !== undefined) { found.push(idx); any = true; } else if (!ignored.has(part)) unmatched.push(part);
    }
    if (!parts.length) unmatched.push(tok);
  }
  return { found, unmatched };
}

// ── countries (English name as in genres.json -> Vietnamese) ──
const iso = new Map();
for (const c of [...world.countries, ...world.dots]) iso.set(c.name, c.iso);
const dn = new Intl.DisplayNames(["vi"], { type: "region" });
const COUNTRY_OVERRIDE = {
  "USA": "Mỹ", "UK": "Anh", "Nordics": "các nước Bắc Âu", "Latin America": "châu Mỹ Latin", "Africa": "châu Phi",
  "Arab world": "thế giới Ả Rập", "Balkans": "vùng Balkan", "Kurdistan": "xứ người Kurd", "Tibet": "Tây Tạng",
  "Czechia": "Séc", "South Korea": "Hàn Quốc", "North Macedonia": "Bắc Macedonia", "Hong Kong": "Hồng Kông",
  "Cape Verde": "Cape Verde", "DR Congo": "Cộng hòa Dân chủ Congo", "Faroe Islands": "quần đảo Faroe", "Greenland": "Greenland",
  "Trinidad & Tobago": "Trinidad và Tobago", "Puerto Rico": "Puerto Rico", "Palestine": "Palestine",
};
const countryNames = [...new Set(genres.map((g) => g.co).filter(Boolean))].sort();
const C = {};
for (const n of countryNames) {
  let vi = COUNTRY_OVERRIDE[n];
  if (!vi) { const code = iso.get(n); if (code) { try { vi = dn.of(code); } catch { /* */ } } }
  if (!vi || vi === n && /^[A-Z]{2}$/.test(vi)) { console.warn("no vi name for country:", n); vi = n; }
  C[n] = vi;
}

// ── families ──
// [Vietnamese label, English label, Vietnamese description (after "một nhánh của"), English description]
const F = {
  "Pop": ["Pop", "Pop", "nhạc pop dễ nghe, dễ hát theo", "easy-to-sing pop music"],
  "Rock": ["Rock", "Rock", "nhạc rock với guitar điện và trống mạnh", "rock music with electric guitars and strong drums"],
  "Metal": ["Metal", "Metal", "nhạc metal nặng và mạnh", "heavy, powerful metal music"],
  "Hip hop & Rap": ["Hip hop & Rap", "Hip hop & Rap", "hip hop, đọc lời theo nhịp trống", "hip hop, with spoken lyrics over drum beats"],
  "Electronic": ["Điện tử", "Electronic", "nhạc điện tử làm bằng máy tính và máy tổng hợp", "electronic music made with computers and synthesizers"],
  "Jazz": ["Jazz", "Jazz", "nhạc jazz ngẫu hứng", "improvised jazz music"],
  "Classical": ["Cổ điển", "Classical", "nhạc cổ điển tinh tế", "refined classical music"],
  "Folk & Traditional": ["Dân gian", "Folk & Traditional", "nhạc dân gian truyền thống", "traditional folk music"],
  "Country": ["Đồng quê", "Country", "nhạc đồng quê với guitar và fiddle", "country music with guitar and fiddle"],
  "R&B, Soul & Funk": ["R&B · Soul · Funk", "R&B, Soul & Funk", "nhạc R&B, soul và funk giàu cảm xúc, nhún nhảy", "emotional, groovy R&B, soul and funk"],
  "Blues": ["Blues", "Blues", "nhạc blues đầy cảm xúc", "soulful blues music"],
  "Latin": ["Latin", "Latin", "nhạc Latin nhiều nhịp điệu", "rhythmic Latin music"],
  "Reggae & Caribbean": ["Reggae · Caribe", "Reggae & Caribbean", "nhạc reggae và vùng Caribe thư thái", "relaxed reggae and Caribbean music"],
  "African": ["Châu Phi", "African", "nhạc châu Phi nhiều trống và nhịp điệu", "African music rich in drums and rhythm"],
  "Religious": ["Tôn giáo", "Religious", "nhạc tôn giáo để cầu nguyện và ca ngợi", "religious music for prayer and praise"],
  "Soundtrack & Media": ["Nhạc phim · Thiếu nhi", "Soundtrack & Media", "nhạc phim và nhạc cho trẻ em", "music from movies, shows and for children"],
  "Experimental": ["Thử nghiệm", "Experimental", "nhạc thử nghiệm với âm thanh mới lạ", "experimental music with new, unusual sounds"],
  "Indie & Alternative": ["Indie", "Indie & Alternative", "nhạc indie của các nghệ sĩ độc lập", "indie music by independent artists"],
  "Wellness & Spoken": ["Thư giãn", "Wellness & Spoken", "nhạc thư giãn và lời kể nhẹ nhàng", "relaxing music and gentle spoken word"],
};
const famNames = JSON.parse(fs.readFileSync(path.join(ROOT, "data/genres.json"), "utf8")).meta.families;
for (const f of famNames) if (!F[f]) throw new Error("family without text: " + f);

// ── per-genre records ──
const used = [];            // vocabulary entries actually used, in id order
const usedId = new Map();
const idOf = (ei) => { if (!usedId.has(ei)) { usedId.set(ei, used.length); used.push(entries[ei]); } return usedId.get(ei); };
const records = [];
const unmatchedCount = new Map();
let withTerm = 0;
const coRatio = new Map();
for (const g of genres) for (const w of new Set(g.n.toLowerCase().split(/\s+/))) {
  const r = coRatio.get(w) || [0, 0]; r[0]++; if (g.co) r[1]++; coRatio.set(w, r);
}
for (const g of genres) {
  const { found, unmatched } = match(g.n);
  const ids = [...new Set(found)].map(idOf);
  if (ids.length) withTerm++;
  records.push(ids.map((x) => x.toString(36)).join(","));
  for (const u of unmatched) unmatchedCount.set(u, (unmatchedCount.get(u) || 0) + 1);
}

// axis bands: terciles of the normalised axes (same normalisation as js/data.js)
let ymin = Infinity, ymax = -Infinity;
for (const g of genres) { ymin = Math.min(ymin, g.y); ymax = Math.max(ymax, g.y); }
const q = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * p)];
const es = genres.map((g) => (g.y - ymin) / (ymax - ymin)), bs = genres.map((g) => g.x / 1500);
const r4 = (x) => Math.round(x * 1e4) / 1e4;

const out = {
  v: 1,
  // terms: [type, vi, en, shortVi?, shortEn?]; type n head genre, m modifier clause, i instrument, l language
  T: used.map((e) => (e[1] === "n" ? [e[1], e[2], e[3], e[4] || "", e[5] || ""] : [e[1], e[2], e[3]])),
  F, C,
  ax: { e: [r4(q(es, 0.33)), r4(q(es, 0.66))], b: [r4(q(bs, 0.33)), r4(q(bs, 0.66))] },
  R: records.join("|"),    // one comma-separated base-36 id list per genre, genres in genres.json order
};
const file = path.join(ROOT, "data/explain.json");
const json = JSON.stringify(out);
fs.writeFileSync(file, json);

const gz = zlib.gzipSync(json, { level: 9 }).length;
console.log(`terms in dictionary: ${entries.filter((e) => e[1] !== "x").length}, used: ${used.length}`);
console.log(`genres: ${genres.length}, with at least one term: ${withTerm} (${((100 * withTerm) / genres.length).toFixed(1)}%)`);
console.log(`explain.json: ${(json.length / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`);
const place = (w) => { const r = coRatio.get(w); return r && r[0] >= 2 && r[1] / r[0] >= 0.5; };
const top = [...unmatchedCount].filter(([w]) => !place(w)).sort((a, b) => b[1] - a[1]);
console.log("top unmatched non-place tokens:", top.slice(0, +(process.env.TOP || 60)).map((e) => e.join(":")).join(" "));

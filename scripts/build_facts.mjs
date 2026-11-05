#!/usr/bin/env node
// Genre facts for the detail panel's fact carousel (js/explain.js).
// Input : data/raw/genre_wiki.json (scripts/fetch_genre_wiki.mjs: Wikidata year/origin + Wikipedia intros)
//         data/raw/genre_facts.json { "<genre index>": [[vi, en], ...] } (written from the Wikipedia intros only)
// Output: data/facts/<i % 32>.json  { "<i>": { y: year, o: [[vi, en] origin], f: [[vi, en], ...] } }
//         a genre is fetched with one small shard (~40 KB), only when its panel opens.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SH = 32;
const wiki = JSON.parse(fs.readFileSync(path.join(root, "data/raw/genre_wiki.json"), "utf8"));
const facts = JSON.parse(fs.readFileSync(path.join(root, "data/raw/genre_facts.json"), "utf8"));
const C = JSON.parse(fs.readFileSync(path.join(root, "data/explain.json"), "utf8")).C;   // English country → Vietnamese
const VI = {
  "United States": "Mỹ", "United Kingdom": "Anh", "England": "Anh", "Wales": "xứ Wales", "Europe": "châu Âu", "Scandinavia": "Bắc Âu",
  "Nordic countries": "Bắc Âu", "People's Republic of China": "Trung Quốc", "Soviet Union": "Liên Xô", "Russian Empire": "Đế quốc Nga",
  "Yugoslavia": "Nam Tư", "East Germany": "Đông Đức", "Czech Republic": "Séc", "Kingdom of Portugal": "Bồ Đào Nha", "The Gambia": "Gambia",
  "Belize": "Belize", "Honduras": "Honduras", "Angola": "Angola", "British Raj": "Ấn Độ thuộc Anh", "French West Indies": "Antilles thuộc Pháp",
  "Cook Islands": "quần đảo Cook", "Polynesia": "Polynesia", "Ibero-America": "Mỹ Latinh và bán đảo Iberia", "Brixton": "Brixton (London)",
  "Samorian state": "đế quốc Wassoulou (Tây Phi)", "Mauritania": "Mauritania", "Curaçao": "Curaçao", "Catalan countries": "xứ Catalan",
  "Principality of Catalonia": "Catalonia", "Zimbabwe": "Zimbabwe", "Trinidad and Tobago": "Trinidad và Tobago", "Mauritius": "Mauritius",
  "El Salvador": "El Salvador", "Ivory Coast": "Bờ Biển Ngà", "Karnataka": "Karnataka (Ấn Độ)", "Saudi Arabia": "Ả Rập Xê Út",
  "Viceroyalty of Peru": "Peru (thời thuộc địa)", "Republic of the Congo": "Cộng hòa Congo", "Democratic Republic of the Congo": "CHDC Congo",
  "Sinophone": "cộng đồng nói tiếng Hoa", "Zacatecas": "Zacatecas (Mexico)", "Detroit": "Detroit (Mỹ)", "Guinea-Bissau": "Guinea-Bissau",
  "Naples": "Napoli (Ý)", "Emirate of Córdoba": "Córdoba (Al-Andalus)", "Sápmi": "Sápmi (vùng người Sami)", "Celtic nations": "các xứ Celt",
  "Louisiana": "Louisiana (Mỹ)", "Frankfurt": "Frankfurt (Đức)",
};
const EN = { "People's Republic of China": "China", "Kingdom of Portugal": "Portugal", "Principality of Catalonia": "Catalonia" };
const THE = new Set(["United States", "United Kingdom", "Soviet Union", "Czech Republic", "Netherlands", "Philippines", "Caribbean", "Dominican Republic"]);

const shards = Array.from({ length: SH }, () => ({}));
let nf = 0, ng = 0;
for (const [i, o] of Object.entries(wiki)) {
  const f = (facts[i] || []).filter((x) => Array.isArray(x) && x[0] && x[1]).map(([v, e]) => [String(v).trim(), String(e).trim()]);
  const origin = o.origin.slice(0, 2).map((x) => [VI[x] || C[x] || x, (THE.has(EN[x] || x) ? "the " : "") + (EN[x] || x)]);
  const y = o.year && o.year > 0 && o.year <= 2025 ? o.year : null;
  if (!f.length && !y && !origin.length) continue;
  const rec = {};
  if (y) rec.y = y;
  if (origin.length) rec.o = origin;
  if (f.length) rec.f = f;
  shards[i % SH][i] = rec;
  nf += f.length; ng++;
}
const dir = path.join(root, "data/facts");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir);
let tot = 0;
shards.forEach((s, k) => { const p = path.join(dir, k + ".json"); fs.writeFileSync(p, JSON.stringify(s)); tot += fs.statSync(p).size; });
console.log(`genres ${ng}, facts ${nf}, ${SH} shards, ${(tot / 1024).toFixed(0)} KB total`);

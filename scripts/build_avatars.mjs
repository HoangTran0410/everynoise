#!/usr/bin/env node
// Artist photos for the demo tracks' artists: data/avatars.json = { "<artist name, lower case>": "<24-hex hash> | <40-hex image id>" | null }.
// No token needed: the track's embed page (open.spotify.com/embed/track/<id>) names its artists with their ids,
// then the artist's oEmbed gives the photo URL. The client builds
// https://i.scdn.co/image/ab6761610000<size><hash> with size f178 (160px) / 5174 (320px) / e5eb (640px).
// Rerunnable: names already in avatars.json are skipped. Usage: node scripts/build_avatars.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data/avatars.json");
const PAR = 4, RETRY = 8;
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const key = (n) => String(n).trim().toLowerCase();

// first track per artist name (the demo track's artist is the one the UI shows)
const byName = new Map();
for (const tr of JSON.parse(fs.readFileSync(path.join(root, "data/tracks.json"), "utf8"))) {
  if (tr && tr[2] && !byName.has(key(tr[2]))) byName.set(key(tr[2]), tr);
}
const todo = [...byName.keys()].filter((k) => !(k in out));
console.log(`${byName.size} artists, ${todo.length} to fetch, ${Object.keys(out).length} known`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "Mozilla/5.0 (Macintosh) everynoise-build" };
async function get(url, asJson) {
  for (let k = 0; k < RETRY; k++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });   // a hung socket must not stall the run
      if (r.status === 429) { await sleep(1000 * Math.max(+r.headers.get("retry-after") || 0, 5 * (k + 1))); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return asJson ? await r.json() : await r.text();
    } catch (e) { if (k === RETRY - 1) throw e; await sleep(800 * (k + 1)); }
  }
  throw new Error("rate-limited");
}
const norm = (s) => key(s).normalize("NFKD").replace(/[̀-ͯ]/g, "");
let done = 0, fail = 0, t0 = Date.now();
async function one(k) {
  const tr = byName.get(k);
  try {
    const html = await get("https://open.spotify.com/embed/track/" + tr[1]);
    const arts = html ? [...html.matchAll(/\{"name":"((?:[^"\\]|\\.)*)","uri":"spotify:artist:([A-Za-z0-9]{22})"\}/g)].map((m) => [JSON.parse('"' + m[1] + '"'), m[2]]) : [];
    // the artist whose name matches the demo track's artist field, else the first one
    const a = arts.find(([n]) => norm(n) === norm(tr[2])) || arts[0];
    if (!a) { out[k] = null; return; }
    const j = await get("https://open.spotify.com/oembed?url=https://open.spotify.com/artist/" + a[1], true);
    // usual artist photo: ab6761610000<size><24-hex hash> → store the hash; any other image kind → store the whole 40-hex id
    const m = String(j?.thumbnail_url || "").match(/\/image\/([0-9a-f]{40})/);
    out[k] = !m ? null : /^ab6761610000(?:f178|5174|e5eb)/.test(m[1]) ? m[1].slice(16) : m[1];
  } catch (e) { fail++; console.warn(k, e.message); }
}
const save = () => fs.writeFileSync(OUT, JSON.stringify(out));
for (let i = 0; i < todo.length; i += PAR) {
  await Promise.all(todo.slice(i, i + PAR).map(one));
  done = Math.min(i + PAR, todo.length);
  if (done % 400 < PAR || done === todo.length) { save(); console.log(`${done}/${todo.length} · ${fail} failed · ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
}
save();
const n = Object.values(out).filter(Boolean).length;
console.log(`done: ${n} photos, ${Object.keys(out).length - n} without, ${fail} failed, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);

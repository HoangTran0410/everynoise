#!/usr/bin/env node
// Album covers for the demo tracks: data/covers.json = { "<spotify track id>": "<image hash>" }.
// Source: Spotify's public oEmbed (no token). The hash is the tail of thumbnail_url; the client builds
// https://i.scdn.co/image/ab67616d0000<size><hash> with size 4851 (64px) / 1e02 (300px) / b273 (640px).
// Rerunnable: ids already in covers.json are skipped. Usage: node scripts/build_covers.mjs [more ids file…]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data/covers.json");
const PAR = 8, RETRY = 3;
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

const ids = new Set();
for (const tr of JSON.parse(fs.readFileSync(path.join(root, "data/tracks.json"), "utf8"))) if (tr) ids.add(tr[1]);
for (const f of process.argv.slice(2)) for (const id of fs.readFileSync(f, "utf8").split(/\s+/)) if (/^[A-Za-z0-9]{22}$/.test(id)) ids.add(id);
const todo = [...ids].filter((id) => !(id in out));
console.log(`${ids.size} tracks, ${todo.length} to fetch, ${Object.keys(out).length} known`);

const hashOf = (u) => (u.match(/\/image\/ab67616d0000(?:4851|1e02|b273)([0-9a-f]{24})/) || [])[1] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = 0, fail = 0, t0 = Date.now();
async function one(id) {
  for (let k = 0; k < RETRY; k++) {
    try {
      const r = await fetch("https://open.spotify.com/oembed?url=https://open.spotify.com/track/" + id);
      if (r.status === 429) { await sleep(1000 * (+r.headers.get("retry-after") || 5)); continue; }
      if (r.status === 404) { out[id] = null; return; }   // track gone: remembered, not retried
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      out[id] = hashOf(j.thumbnail_url || "");
      return;
    } catch (e) { if (k === RETRY - 1) { fail++; console.warn(id, e.message); } else await sleep(800 * (k + 1)); }
  }
}
const save = () => fs.writeFileSync(OUT, JSON.stringify(out));
for (let i = 0; i < todo.length; i += PAR) {
  await Promise.all(todo.slice(i, i + PAR).map(one));
  done = Math.min(i + PAR, todo.length);
  if (done % 400 < PAR || done === todo.length) { save(); console.log(`${done}/${todo.length} · ${fail} failed · ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
}
save();
const n = Object.values(out).filter(Boolean).length;
console.log(`done: ${n} covers, ${Object.keys(out).length - n} without, ${fail} failed, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);

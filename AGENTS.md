# AGENTS.md

Notes for coding agents working on Everynoise. Read `README.md` for what the app does.

## Basics

- Static site, vanilla ES modules, **no build step and no runtime dependencies**. Don't add a bundler, framework or npm package to the app.
- Run: `python3 -m http.server 8000` and open `http://localhost:8000`. The service worker is skipped on `localhost`/`127.*`, so edits show up on reload.
- Debug handle in the console: `window.__everynoise` → `{ map, player, model, state }`.
- Syntax check: `for f in js/*.js; do node --check "$f"; done`. There is no test suite; verify in a real browser (see Testing).

## Deploy

- `./scripts/deploy.sh` copies `index.html manifest.webmanifest robots.txt sitemap.xml css js fonts icons data/{genres,tracks,world}.json data/more` into `dist/`, stamps `__VERSION__` in `sw.js`, and deploys to Cloudflare Pages project `everynoise` (https://everynoise.pages.dev).
- Pages is **not** connected to GitHub: pushing does not deploy, deploying does not push.
- Production is used daily by a child on an installed iPad PWA. Deploy only tested changes.

## Rules that are easy to break

**Service worker (`sw.js`)**
- Every file the page loads must be in `FILES`. A new `js/*.js` file that is missing there breaks the installed app offline.
- Never cache or intercept audio or other cross-origin requests (Spotify `p.scdn.co`, Deezer JSONP). Music must stay lazy-loaded.
- The SW calls `skipWaiting` + `clients.claim`; Settings → "Check for updates" relies on that and on the `"version"` message handler.

**Storage**
- `localStorage` keys use the `nm:` prefix (`nm:favs`, `nm:visited`, `nm:kids`, `nm:lang`, `nm:theme`, `nm:welcomed`, …). **Never rename them**: the installed PWA would lose the user's favourites, history and kids mode. Always go through `store` in `js/util.js` (it handles blocked storage).

**Translations (`js/i18n.js`)**
- Every user-visible string goes through `t("Vietnamese text", { vars })`. The Vietnamese text is the key; add the English to the `EN` table. Missing keys fall back to Vietnamese silently, so check coverage (below).
- Static text in `index.html` (text nodes, `title`, `aria-label`, `placeholder`) is translated automatically when the exact trimmed text is a key. Blocks with inline markup use `data-i18n-html="name"` and an `"html:name"` entry.
- Text set from JS must be re-rendered on the `langchange` event (see the handler near the Settings section in `js/main.js`). Switching language must not stop playback.
- Inside functions where `t` is a local variable (tours use `t` for the tour object) use the alias `tl`.
- Family names: `famLabel(f)` returns the Vietnamese label in `vi` and the original English family name in `en`.

**Performance (weak iPads/phones)**
- No `backdrop-filter`, no canvas `shadowBlur`, no `createRadialGradient`/`createLinearGradient` per frame. Static CSS `box-shadow` is fine (measured: no cost while dragging).
- The map overlay is drawn at most once per animation frame (`_overlayT` dedupe on the rAF timestamp). Keep rAF loops stopping when idle and paused.
- Don't call `getBoundingClientRect` in `pointermove`; the map caches its rect.
- Canvas DPR is capped at 2.
- No native `<select>`: use `openPicker()` in `js/main.js` (searchable list in a dialog). The first `<select>` costs 1–3 s of layout in Chrome/macOS on a 4× slower CPU.
- No third-party fonts/CSS: Nunito is self-hosted in `fonts/` (3 subsets, preloaded). Keep `<link rel="preload">`/`modulepreload` in `index.html` in sync when adding a module or renaming data files.
- Auto-advance picks the next genre ~8 s early (`_maybePrefetch`) and pulls its preview into the HTTP cache (`p.scdn.co` sends `max-age=604800`). Tours are not prefetched: their `nextProvider` advances the tour step.
- Wheel and +/- zoom go through `map.zoomSmooth()` (exponential easing, notches add up). Pinch (`ctrlKey` wheel, touch) stays 1:1. No animation libraries: the map is canvas, so a motion library adds weight without helping.

**Music passport** (`js/passport.js`)
- The card is drawn once per open/`langchange` (no animation) and does `await document.fonts.ready` first. "Rarest" = fewest map neighbours within 45 px of Every Noise space (`s` is a scene place name, `k` the number of sub-genres, not popularity). Add new `t()` strings to the `// passport` block of `EN`; also check `passport` in the coverage script.
**Genre path (`js/path.js`)**
- The graph is built lazily per kids-mode value (usable node = `isOk` + has a track); never put a non-usable genre in a path. The picker list is capped at 300 rows because 6000 `<li>` are slow.

**Kids mode**
- Anything that lists or plays genres must respect `isOk(g)` (`!state.kids || g.kid`).

**CSS**
- A global `[hidden] { display: none !important; }` exists, so toggling `.hidden` works on elements whose class sets `display`.
- Breakpoints: `≤1279px` (iPad), `≤1023px`, `≤760px` (phone), `≤380px`.

## SEO

- Title, description, canonical, Open Graph/Twitter tags and JSON-LD are in `index.html` `<head>`; the share image is `icons/og.jpg` (1200×630). `robots.txt`, `sitemap.xml` and `_headers` (long cache for `fonts/`, `icons/`) sit in the repo root and are copied by `deploy.sh`.
- Preview deploys (`BRANCH=name ./scripts/deploy.sh` → `https://name.everynoise.pages.dev`) get `x-robots-tag: noindex` from Cloudflare, so Lighthouse SEO is lower there; that is expected.

## Testing

Use headless Chrome through `puppeteer-core` (installed outside the repo, pointing at `/Applications/Google Chrome.app`). Check at least:

- phone `390×844` DPR 3 with touch, and iPad landscape `1180×820`;
- both languages: set `localStorage["nm:lang"]` to `"en"`/`"vi"`, open every dialog (`#settings`, `#explore`, `#quiz`, `#about`) and look for leftover Vietnamese text in English mode;
- no `pageerror` events;
- for map/visualizer changes: drag latency and frame times with CPU throttling (`Emulation.setCPUThrottlingRate` 4–6×) while music plays.

Translation key coverage (every literal passed to `t()`/`tl()` must exist in `EN`):

```bash
node -e '
const fs=require("fs"),src=fs.readFileSync("js/i18n.js","utf8");
const keys=new Set([...src.matchAll(/^\s+("(?:[^"\\]|\\.)*"):/gm)].map(m=>JSON.parse(m[1])));
for(const f of ["main","player","quiz"]) for(const m of fs.readFileSync("js/"+f+".js","utf8").matchAll(/\b(?:t|tl)\(\s*"((?:[^"\\]|\\.)*)"/g)) if(!keys.has(m[1])) console.log(f, m[1]);
for(const m of fs.readFileSync("js/tours.js","utf8").matchAll(/(?:title|desc): "([^"]+)"/g)) if(!keys.has(m[1])) console.log("tours", m[1]);'
```

Things headless Chrome can't tell you: Safari/iOS rendering and GPU cost, real audio output, home-screen PWA behaviour. Say so when reporting.

## Data

- `data/world.json` (country shapes, ~98 KB, lazy-loaded by `js/world.js`) is generated once by `scripts/build_world.py` from world-atlas 110m (steps in its docstring). When `co` values in the genre data change, update `ALIAS`/`DOTS` there (no-shape countries are dots; regions such as "Nordics" show as chips) and keep it in `sw.js` `FILES` and `deploy.sh`.

- `data/genres.json` and `data/tracks.json` are generated by `python3 scripts/build_data.py` from `data/raw/`. Don't hand-edit them; fix the dictionaries in the script and rebuild.
- `tracks.json` is aligned by index with `genres.json` and holds only track #1 of each genre (loaded at startup: do not grow it).
- Extra demo tracks live in `data/more/<genre index // 80>.json` (`{"<index>": [[preview, track id, artist, song], ...]}`, tracks #2..; ~28 KB each, 2.1 MB in total). They are generated by `build_data.py` from `data/raw/genre_artists.json` (made by `scripts/scrape_artists.py`: the artists Every Noise itself lists on `everynoise.com/engenremap-<slug>.html`, slug = lower-case name without anything but a-z0-9, biggest font = most central first) minus `data/raw/dead_previews.txt` (optional). Picks: distinct artists, not the artist of track #1, 5 extra per genre, 3 for genres flagged `kid` (also drops tracks with bad words, `KID_BAD`). `SHARD` in `build_data.py` and `js/data.js` must match.
- `tracksOf(i)` (js/data.js) fetches the shard lazily and caches it; `player.play(i, { n })` plays track `n`, `player.another(i)` the next one. Auto-advance, quiz, passport, path and tours always use track #1 (`trackOf`), so `_maybePrefetch` warms exactly the URL that plays.
- Service worker: shards are **not** in `FILES` (2 MB would be downloaded by every install although most genres are never opened). `sw.js` caches `/data/more/*` at runtime, cache-first, in the versioned cache, so a played genre works offline afterwards and a deploy drops stale shards. `deploy.sh` copies `data/more`.
- `build_data.py` currently rewrites 4 genres' position/country slightly differently on each run (set-order ties, pre-existing); check `git diff data/genres.json` before committing it.

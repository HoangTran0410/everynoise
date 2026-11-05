// Service worker: app shell + genre data are cached so the installed app opens instantly
// (and the map works offline). Audio is NOT cached: previews still stream on demand.
// scripts/deploy.sh replaces __VERSION__ on every deploy, so each deploy gets a fresh,
// consistent cache (no mix of old and new files). The new version takes over on the next launch.
const VERSION = "__VERSION__";
const SHELL = `shell-${VERSION}`;

const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css", "css/ranks.css", "css/daily.css", "css/heardle.css", "css/ab.css",
  "js/main.js", "js/map.js", "js/player.js", "js/beat.js", "js/tours.js", "js/quiz.js", "js/passport.js", "js/ranks.js", "js/path.js", "js/route.js", "js/dj.js", "js/world.js", "js/geoguess.js", "js/artistguess.js", "js/vizbtn.js", "js/instruments.js", "js/artists.js", "js/likes.js", "js/perfhud.js", "js/data.js", "js/util.js", "js/i18n.js", "js/artistpage.js", "js/bridge.js", "js/daily.js", "js/heardle.js", "js/ab.js", "js/timeradio.js", "js/explain.js", "js/explain-core.js",
  "data/genres.json",
  "data/tracks.json",
  "data/world.json",
  "data/explain.json",
  "fonts/nunito-latin.woff2", "fonts/nunito-latin-ext.woff2", "fonts/nunito-vietnamese.woff2",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The settings screen asks which version is running.
self.addEventListener("message", (e) => {
  if (e.data === "version") e.ports[0]?.postMessage(VERSION);
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Everything else off-origin (Spotify/Deezer audio, JSONP, links) goes straight to the network.
  if (url.origin !== self.location.origin) return;

  // Static SEO pages (/g/...) are real documents: never serve the app shell for them, load from the network.
  if (url.pathname.startsWith(new URL("g/", self.registration.scope).pathname)) return;
  // Share cards (/s?…, a Pages Function with the preview tags) must reach the server too: it sends the browser on to /#….
  if (url.pathname === new URL("s", self.registration.scope).pathname) return;

  // Same origin: serve from this version's cache, fall back to network.
  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true }) ||
        (req.mode === "navigate" ? await c.match("./") : undefined);
      if (hit) return hit;
      const res = await fetch(req);
      // data/more, data/radio (endless radio), data/near (similar genres), the artist shards (data/ar, data/ap),
      // data/artists.json and data/bridge.json are cached on first use, not precached in FILES
      if (res.ok && /\/data\/(more\/|radio\/|near\/|ar\/|ap\/|artists\.json$|bridge\.json$|covers\.json$)/.test(url.pathname)) c.put(req, res.clone());
      return res;
    }),
  );
});

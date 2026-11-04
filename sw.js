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
  "css/style.css",
  "js/main.js", "js/map.js", "js/player.js", "js/beat.js", "js/tours.js", "js/quiz.js", "js/data.js", "js/util.js", "js/i18n.js",
  "data/genres.json",
  "data/tracks.json",
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

  // Same origin: serve from this version's cache, fall back to network.
  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true }) ||
        (req.mode === "navigate" ? await c.match("./") : undefined);
      return hit || fetch(req);
    }),
  );
});

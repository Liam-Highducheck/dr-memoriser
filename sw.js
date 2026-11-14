// Offline cache. Everything the app needs is cached on install, so it opens with no connection. After that each file
// is served from the cache at once and quietly re-checked with the server (a cheap conditional request), so a deploy
// reaches the phone on its next launch without bumping a version. Bump VERSION only to drop files that were removed.
const VERSION = "v2";
const CACHE = "dr-memoriser-" + VERSION;
const ASSETS = [
  "./", "index.html", "style.css", "app.js", "store.js", "manifest.webmanifest",
  "lib/cubing-twisty.js", "lib/eo_core.js", "lib/dr_core.js", "lib/db-worker.js",
  "lib/sqlite/index.mjs", "lib/sqlite/sqlite3.wasm", "data/cases.json",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req, { cache: "no-cache" }).then((res) => { if (res.status === 200) cache.put(req, res.clone()); return res; });
    if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
    try { return await refresh; }
    catch { return req.mode === "navigate" ? (await cache.match("index.html")) || Response.error() : Response.error(); }
  })());
});

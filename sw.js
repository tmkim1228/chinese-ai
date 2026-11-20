const CACHE = "chinese-ai-en-v1.1-20261120";
const FILES = [
  "./",
  "./index.html",
  "./srs.js",
  "./app.js",
  "./dictionary.js",
  "./ask.js",
  "./styles.css",
  "./pwa.js",
  "./manifest.webmanifest",
  "./data/meta.json",
  "./data/dictionary.json",
  "./data/ko-readings.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];
// words.json / words.json.gz are runtime-cached on first fetch (Dictionary tab, character popup, or idle prefetch).

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k.startsWith("chinese-ai-en-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (/api\.x\.ai$|api\.openai\.com$|generativelanguage\.googleapis\.com$/.test(url.hostname)) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res && res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    } catch (err) {
      if (e.request.mode === "navigate") {
        const page = await caches.match("./index.html") || await caches.match("./");
        if (page) return page;
      }
      return Response.error();
    }
  })());
});

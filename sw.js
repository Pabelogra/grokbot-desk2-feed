/* Cache the app shell only. Never cache /d/ feed files. */
const SHELL = "desk-shell-v4";
const ASSETS = ["./","index.html","app.css","app.js","chart.js","manifest.json","apple-touch-icon.png","icons/icon-180.png","icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.includes("/d/")) return; // always go to the network for feed files
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});

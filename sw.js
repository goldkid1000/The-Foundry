// The Foundry service worker — v2.17.0
// Purpose: PWA install + offline fallback ONLY. It must never strand a
// phone on stale code, so:
//  - install: skipWaiting (activate immediately, don't wait for tabs to close)
//  - activate: delete EVERY existing cache (all names, all versions), then
//    clients.claim() so open pages use this worker right away
//  - fetch: network-first for everything. HTML/navigation and assets alike
//    always try the network first; Cache Storage is only the offline
//    fallback. The cache is named per-release (foundry-v<version>) so every
//    release inherently invalidates the previous cache.
var CACHE_NAME = 'foundry-v2.17.0';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) { return caches.delete(n); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      // keep an offline copy of successful same-origin responses
      if (res && res.ok && new URL(e.request.url).origin === self.location.origin) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});

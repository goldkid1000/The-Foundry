// The Foundry service worker — v2.23.2
// Purpose: PWA install + offline fallback ONLY. It must never strand a
// phone on stale code, so:
//  - install: skipWaiting (activate immediately, don't wait for tabs to close)
//  - activate: delete the site's OWN outdated caches (names starting with
//    'foundry-' other than the current one), then clients.claim() so open
//    pages use this worker right away.
//    CACHE OWNERSHIP RULE (v2.19.2): Cache Storage is shared with other
//    libraries on this origin. The on-device AI (WebLLM) keeps its ~2GB
//    model in caches named 'webllm/model', 'webllm/config' and
//    'webllm/wasm'. Deleting caches we don't own wiped the downloaded AI
//    on every release and forced users to download it again and again.
//    ONLY 'foundry-' caches may ever be deleted here — no exceptions.
//  - fetch: network-first for everything. HTML/navigation and assets alike
//    always try the network first; Cache Storage is only the offline
//    fallback. The cache is named per-release (foundry-v<version>) so every
//    release inherently invalidates the previous app cache.
var CACHE_NAME = 'foundry-v2.23.2';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) {
        return n.indexOf('foundry-') === 0 && n !== CACHE_NAME;
      }).map(function (n) { return caches.delete(n); }));
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

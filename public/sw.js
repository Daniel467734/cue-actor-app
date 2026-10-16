const CACHE = 'cue-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const files = await (await fetch('./precache.json', { cache: 'no-store' })).json();
        await cache.addAll(['./', ...files, 'manifest.webmanifest', 'icon.svg']);
      } catch {
        /* offline caching is best effort */
      }
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && !k.startsWith('transformers')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const CDN = ['cdn.jsdelivr.net'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || (url.origin !== location.origin && !CDN.includes(url.hostname))) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./'))),
  );
});

/**
 * Sentinel Service Worker — offline-first app shell.
 *
 * Strategy:
 *  - `install`  → precache the Next.js app shell ("/" HTML route),
 *                 manifest, and the siren audio, then skipWaiting.
 *                 Every asset goes through Promise.allSettled so one
 *                 missing non-critical file (e.g. a missing favicon)
 *                 never aborts the installation.
 *  - `fetch`    → cache-first, network fallback; any successful same-origin
 *                 GET is stored in the runtime cache. Failed navigations
 *                 fall back to the cached "/" shell.
 *  - `activate` → purge stale caches so old builds never linger.
 *
 * Next.js notes: the /index.html file does NOT exist in a Next.js build —
 * "/" is the real shell URL. The siren ships as /sounds/siren.wav, not
 * /siren.mp3.
 */

const CACHE_NAME = 'sentinel-v3';
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/sounds/siren.wav'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use allSettled so one missing non-critical asset won't crash the entire SW installation
      await Promise.allSettled(
        PRECACHE_ASSETS.map((asset) => cache.add(asset).catch((err) => console.warn(`Failed to cache ${asset}:`, err)))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
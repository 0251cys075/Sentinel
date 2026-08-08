/**
 * Sentinel Service Worker — offline-first app shell.
 *
 * Strategy:
 *  - `install`  → precache the static app shell ("/" HTML route, icons,
 *                 manifest, siren audio), then DISCOVER the Next.js app
 *                 bundle inside that HTML and precache every `/_next/static/`
 *                 JS/CSS asset (plus the self-hosted fonts inside the CSS)
 *                 — so the very first offline open works, not just
 *                 follow-up visits. Everything is best-effort: a single
 *                 missing file (e.g. /favicon.ico) must never abort install.
 *  - `fetch`    → navigations are network-first (fall back to the cached
 *                 shell when offline); hashed Next.js build assets and
 *                 static icons/audio are cache-first (immutable URLs, zero
 *                 risk of staleness); everything else same-origin degrades
 *                 to the cached shell.
 *  - `activate` → purge stale caches so old builds never linger.
 */

const VERSION = "v4";
const CORE_CACHE = `sentinel-core-${VERSION}`;
const RUNTIME_CACHE = `sentinel-runtime-${VERSION}`;

/** Essential offline-first assets — index shell, icons, CSS bundles,
 *  manifest, siren/alarm sounds and the branded offline fallback page.
 *  /_next/static/ is discovered from the shell and filled during install. */
const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icon.svg",
  "/sounds/siren.wav",
];

/** Every /_next/static/ URL referenced in an HTML/CSS document. */
function collectStaticUrls(...docs) {
  const urls = new Set();
  for (const doc of docs) {
    for (const m of doc.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
      urls.add(m[1]);
    }
    for (const m of doc.matchAll(/url\((['"]?)(\/_next\/static\/[^)"']+)\1\)/g)) {
      urls.add(m[2]);
    }
  }
  return [...urls];
}

/**
 * Precache the entire app bundle during install:
 *  1. the shell URLs above,
 *  2. every JS/CSS chunk referenced by the cached "/" HTML,
 *  3. every font file referenced by those CSS chunks.
 * allSettled everywhere: a missing favicon or font must never abort the
 * whole cache build.
 */
async function precacheAppBundle(cache) {
  await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));

  const shell = await cache.match("/");
  if (!shell) return;
  const html = await shell.text();
  const bundleUrls = collectStaticUrls(html);
  await Promise.allSettled(bundleUrls.map((url) => cache.add(url)));

  const fonts = new Set();
  for (const cssUrl of bundleUrls.filter((u) => u.endsWith(".css"))) {
    const cssResponse = await cache.match(cssUrl).catch(() => null);
    if (!cssResponse) continue;
    const css = await cssResponse.text();
    for (const fontUrl of collectStaticUrls(css)) fonts.add(fontUrl);
  }
  await Promise.allSettled([...fonts].map((url) => cache.add(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CORE_CACHE)
      .then(precacheAppBundle)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CORE_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never touch cross-origin traffic (Supabase API, maps tiles, fonts…).
  if (url.origin !== self.location.origin) return;

  /* ── Page navigations: network-first, cached shell as the offline
     fallback so the installed app opens without connectivity. Any failed
     or non-ok response (DNS failure, 5xx, deploy window…) degrades to the
     cached app shell, then to the branded offline page. ── */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
          // Keep the freshest shell in the core cache for next offline open.
          const copy = response.clone();
          void caches.open(CORE_CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(async () => {
          const shell = await caches.match("/");
          if (shell) return shell;
          const offline = await caches.match("/offline.html");
          return offline || Response.error();
        })
    );
    return;
  }

  /* ── Immutable / hashed static assets: cache-first, populate on miss. ── */
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/manifest.json" ||
    url.pathname.startsWith("/sounds/");

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  /* ── Same-origin fallback: try the network, else any cached copy of the
     exact URL, else the app shell / branded offline page. ── */
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const shell = await caches.match("/");
      if (shell) return shell;
      const offline = await caches.match("/offline.html");
      return offline || Response.error();
    })
  );
});
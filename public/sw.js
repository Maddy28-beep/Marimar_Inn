// Runtime cache-and-fallback service worker — no precache list, since the
// static export's JS/CSS filenames are content-hashed per build and would
// need a generated manifest to precache by name. Instead: every successful
// same-origin GET is cached as a side effect of being fetched, and a
// failed fetch (offline) is served from whatever's already cached. This is
// what lets a page that was already open — and everything it needed —
// survive a reload with no network, whether that reload was the tablet's
// WebView recovering from a killed render process or a plain browser
// refresh.

const CACHE_NAME = "marimar-runtime-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only same-origin GETs — Firestore/Firebase Auth traffic (a different
  // origin) is left alone entirely; that's the Firestore SDK's own offline
  // cache to manage, not this service worker's job.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Navigating to a page that was never visited while online — no
        // cached shell to fall back to, so let the browser show its own
        // offline error rather than something misleading.
        throw new Error("Offline and not cached.");
      })
  );
});

// StoryClub service worker — installable PWA + offline app shell.
// --------------------------------------------------------------------------
// Only same-origin GETs are touched here; Firebase / gstatic / Open Library
// requests pass straight through to the network (never cached or intercepted),
// so the realtime sync is unaffected. Bump CACHE to force clients off old assets.
// --------------------------------------------------------------------------
const CACHE = "storyclub-v3";
const SHELL = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest",
  "./js/app.js", "./js/firebase.js", "./js/session.js", "./js/groups.js",
  "./js/movies.js", "./js/ratings.js", "./js/wheel.js", "./js/stats.js",
  "./js/openlib.js", "./js/theme.js", "./js/push.js",
  "./assets/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Don't let one missing/optional file abort the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // HTML navigations: network-first so updates always land; cache is the
  // offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Other same-origin assets: stale-while-revalidate (fast, self-updating).
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Offline cache.
//
// Split by type on purpose. The earlier version was cache-first for
// everything, which meant an installed phone kept serving the old build
// forever — new code and new artwork never arrived. Now:
//
//   code + markup  -> network first, cache as fallback  (updates land at once)
//   fonts, images  -> cache first                        (they never change)
//
// Bump VERSION whenever you change a file.

const VERSION = "v4";
const CODE = `receipts-code-${VERSION}`;
const ASSETS = `receipts-assets-${VERSION}`;

const CODE_FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./amex.js",
  "./images.js", "./store.js", "./export.js", "./manifest.json",
];

const ASSET_FILES = [
  "./lib/xlsx.full.min.js",
  "./brand/intralox-red.png", "./brand/intralox-white.png",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png",
  "./fonts/roboto-latin-300-normal.woff2", "./fonts/roboto-latin-400-normal.woff2",
  "./fonts/roboto-latin-500-normal.woff2", "./fonts/roboto-latin-700-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    // addAll fails the whole install if any one file 404s, which would leave
    // the app with no cache at all. Add them individually instead.
    const code = await caches.open(CODE);
    const assets = await caches.open(ASSETS);
    await Promise.all([
      ...CODE_FILES.map((f) => code.add(f).catch(() => {})),
      ...ASSET_FILES.map((f) => assets.add(f).catch(() => {})),
    ]);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = [CODE, ASSETS];
    for (const k of await caches.keys())
      if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isAsset = (url) =>
  /\.(woff2|png|jpg|jpeg|svg|ico)$/i.test(url.pathname) ||
  url.pathname.includes("/lib/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (isAsset(url)) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res.ok) caches.open(ASSETS).then((c) => c.put(req, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // Code and markup: network first, cache only as the offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CODE).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});

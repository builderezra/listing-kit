/* Listing Kit — service worker. Network-first with cache fallback: you always
 * get the newest version when online, and the app still works offline / as an
 * installed home-screen app for in-the-field or interview demos. */
const CACHE = 'listing-kit-v51';
const ASSETS = [
  './', './index.html', './styles.css',
  './app.js', './generator.js', './fairhousing.js',
  './parser.js', './importer.js', './visuals.js', './flyer.js', './ai.js', './studio.js', './tour.js', './qr.js',
  './icon.svg', './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // never intercept cross-origin (import proxies, remote images)
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: revalidate with the server so deploys show up immediately
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});

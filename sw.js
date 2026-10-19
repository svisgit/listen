/* Service worker: keeps the page itself on the phone so it opens even on a
   weak connection. Audio is NOT intercepted: phones stream audio in chunks,
   and GitHub Pages serves those chunks directly and reliably.
   Change VERSION after editing index.html so phones pick up the new page promptly. */
const VERSION = 'v2';
const SHELL_CACHE = 'listen-shell-' + VERSION;

const SHELL = [
  './', './index.html', './manifest.json',
  './icon-180.png', './icon-192.png', './icon-512.png',
  './fonts/mukta-malar-tamil-400-normal.woff2', './fonts/mukta-malar-tamil-600-normal.woff2',
  './fonts/mukta-malar-latin-400-normal.woff2', './fonts/mukta-malar-latin-600-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k !== SHELL_CACHE)          // also removes the audio cache from version 1
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // Apps Script etc.: untouched
  if (/\.(mp3|m4a|aac|ogg|opus|wav)$/i.test(url.pathname)) return; // audio: straight to the network

  if (req.mode === 'navigate') {
    // Newest page when online, saved page when not. ignoreSearch keeps ?k=... working.
    e.respondWith(fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});

/* Service worker: keeps the page and the audio on the phone so a weak
   connection doesn't interrupt listening. Change VERSION after editing
   index.html so phones pick up the new page promptly. */
const VERSION = 'v1';
const SHELL_CACHE = 'listen-shell-' + VERSION;
const AUDIO_CACHE = 'listen-audio';
const CACHE_AUDIO = true;   // set to false to stop storing MP3s on the phone

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
        .filter(k => k.startsWith('listen-shell-') && k !== SHELL_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* The page sends the current playlist's MP3s; store each one whole,
   and drop files that are no longer in the playlist. */
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'cache-audio' || !CACHE_AUDIO) return;
  const wanted = (e.data.urls || []).filter(u => new URL(u).origin === self.location.origin);
  e.waitUntil((async () => {
    const cache = await caches.open(AUDIO_CACHE);
    for (const req of await cache.keys()) {
      if (!wanted.includes(req.url)) { await cache.delete(req); buffers.delete(req.url); }
    }
    for (const url of wanted) {
      if (await cache.match(url)) continue;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.status === 200) await cache.put(url, res);
      } catch (err) { /* offline: try again next time */ }
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Apps Script and other sites: untouched

  if (/\.(mp3|m4a|aac|ogg|opus|wav)$/i.test(url.pathname)) {
    e.respondWith(serveAudio(req));
    return;
  }
  if (req.mode === 'navigate') {
    // Newest page when online, saved page when not. ignoreSearch keeps ?k=... working.
    e.respondWith(fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});

/* Phones request audio in byte ranges; answer those from the stored whole file. */
const buffers = new Map();
async function serveAudio(req) {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const hit = await cache.match(req.url, { ignoreSearch: true });
    if (!hit) return fetch(req);
    const range = req.headers.get('range');
    const type = hit.headers.get('Content-Type') || 'audio/mpeg';
    if (!buffers.has(req.url)) buffers.set(req.url, await hit.clone().arrayBuffer());
    const buf = buffers.get(req.url);
    const size = buf.byteLength;
    if (!range) {
      return new Response(buf, { status: 200, headers: {
        'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return fetch(req);
    let start, end;
    if (m[1] === '') {                       // "bytes=-500": the last 500 bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new Response(buf.slice(start, end + 1), { status: 206, headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    } });
  } catch (err) {
    return fetch(req);
  }
}

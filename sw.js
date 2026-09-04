/* Caches the app so it opens with no signal.
   Only index.html exists — everything else is inlined as data URIs.
   Bump VERSION every time you edit index.html, or the phone keeps the old copy. */
const VERSION = 'kopi-run-v1';
const SHELL = ['./', './index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // put each one separately: one bad URL must not fail the whole install
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

/* Caches the app so it opens with no signal.
   Only index.html exists — everything else is inlined as data URIs.
   Bump VERSION every time you edit index.html, or the phone keeps the old copy. */
const VERSION = 'kopi-run-v10';
const SHELL = ['./', './index.html', './team.js', './people.js'];

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
    .then(ks => Promise.all(ks.filter(k => k.startsWith('kopi-run-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Never intercept API calls, credentials, or third-party resources. Offline
  // navigation may show the shell, but the cloud app still requires a live load.
  if (url.origin !== self.location.origin || url.pathname.includes('/api/') || e.request.headers.has('Authorization')) return;
  const shellPaths = SHELL.map(path => new URL(path, self.registration.scope).pathname);
  if (!shellPaths.includes(url.pathname) || url.search) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const cp = r.clone(); e.waitUntil(caches.open(VERSION).then(c => c.put(e.request, cp))); } return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

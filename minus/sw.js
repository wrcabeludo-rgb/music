// Service worker: оболочка приложения работает офлайн.
// Тяжелые файлы (vendor/) кэшируются при первом использовании.
const VERSION = 'v3';
const SHELL = `minus-shell-${VERSION}`;
const VENDOR = `minus-vendor-${VERSION}`;
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'separate.worker.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('minus-') && k !== SHELL && k !== VENDOR).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // модель с Hugging Face кэшируется воркером отдельно

  if (url.pathname.includes('/vendor/')) {
    // cache-first
    e.respondWith(caches.open(VENDOR).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // network-first для остального, с откатом на кэш
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))));
});

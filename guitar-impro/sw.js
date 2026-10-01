// Офлайн-кэш «Гитара: аккорды и импровизация».
// При изменении файлов приложения увеличивайте CACHE — старый кэш удалится автоматически.
const CACHE = 'guitar-impro-v1';
const FILES = ['./', 'index.html', 'style.css', 'music.js', 'licks.js', 'theory.js', 'audio.js', 'app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('guitar-impro-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// кэш сначала, сеть — для обновления в фоне
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

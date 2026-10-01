// Офлайн-кэш «Гитара: аккорды и импровизация».
// При изменении файлов приложения увеличивайте CACHE — старый кэш удалится автоматически.
const CACHE = 'guitar-impro-v4';
const FILES = ['./', 'index.html', 'style.css', 'music.js', 'licks.js', 'theory.js', 'audio.js', 'app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  // записи гитары
  'samples/nylon/35.mp3', 'samples/nylon/38.mp3', 'samples/nylon/40.mp3', 'samples/nylon/42.mp3', 'samples/nylon/44.mp3', 'samples/nylon/45.mp3', 'samples/nylon/47.mp3', 'samples/nylon/49.mp3', 'samples/nylon/50.mp3', 'samples/nylon/52.mp3', 'samples/nylon/54.mp3', 'samples/nylon/55.mp3', 'samples/nylon/57.mp3', 'samples/nylon/59.mp3', 'samples/nylon/61.mp3', 'samples/nylon/63.mp3', 'samples/nylon/64.mp3', 'samples/nylon/66.mp3', 'samples/nylon/68.mp3', 'samples/nylon/69.mp3', 'samples/nylon/71.mp3', 'samples/nylon/73.mp3', 'samples/nylon/75.mp3', 'samples/nylon/76.mp3', 'samples/nylon/78.mp3', 'samples/nylon/79.mp3', 'samples/nylon/80.mp3', 'samples/nylon/81.mp3', 'samples/nylon/82.mp3', 'samples/drive/36.mp3', 'samples/drive/39.mp3', 'samples/drive/42.mp3', 'samples/drive/45.mp3', 'samples/drive/48.mp3', 'samples/drive/51.mp3', 'samples/drive/54.mp3', 'samples/drive/57.mp3', 'samples/drive/60.mp3', 'samples/drive/63.mp3', 'samples/drive/66.mp3', 'samples/drive/69.mp3', 'samples/drive/72.mp3', 'samples/drive/75.mp3', 'samples/drive/78.mp3', 'samples/drive/81.mp3', 'samples/drive/84.mp3', 'samples/drive/87.mp3', 'samples/drive/90.mp3', 'samples/drive/93.mp3',
  'samples/piano/36.mp3', 'samples/piano/39.mp3', 'samples/piano/42.mp3', 'samples/piano/45.mp3', 'samples/piano/48.mp3', 'samples/piano/51.mp3', 'samples/piano/54.mp3', 'samples/piano/57.mp3', 'samples/piano/60.mp3', 'samples/piano/63.mp3', 'samples/piano/66.mp3', 'samples/piano/69.mp3', 'samples/piano/72.mp3', 'samples/piano/75.mp3', 'samples/piano/78.mp3', 'samples/piano/81.mp3', 'samples/piano/84.mp3', 'samples/piano/87.mp3'];

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

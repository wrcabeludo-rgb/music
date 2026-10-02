// Service worker: оболочка приложения работает офлайн.
// Тяжелые файлы (vendor/) кэшируются при первом использовании.
const VERSION = 'v12';
const SHELL = `minus-shell-${VERSION}`;
const VENDOR = `minus-vendor-${VERSION}`;
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'separate.worker.js', 'pitch.worklet.js', 'export.worker.js', 'manifest.webmanifest',
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

// GitHub Pages не ставит заголовки COOP/COEP, без которых браузер не дает
// SharedArrayBuffer, а значит и многопоточный WASM. Добавляем их сами.
function isolated(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // модель с Hugging Face кэшируется воркером отдельно

  if (url.pathname.includes('/vendor/')) {
    // cache-first
    e.respondWith(caches.open(VENDOR).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return isolated(hit);
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return isolated(res);
    }));
    return;
  }

  // network-first для остального, с откатом на кэш. cache: 'no-cache' — сверяемся
  // с сервером (GitHub Pages разрешает держать файлы 10 минут), чтобы новая
  // версия подхватывалась сразу; без изменений ответ короткий (304).
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  e.respondWith(fetch(fresh).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
    return isolated(res);
  }).catch(() => caches.match(req).then((hit) => isolated(hit) || caches.match('index.html').then(isolated))));
});

// Воркер: скачивает модель HTDemucs (один раз, кэш), разделяет трек на 4 стема.
import * as ort from './vendor/ort/ort.webgpu.min.mjs';
import { DemucsProcessor } from './vendor/demucs/processor.js?v=5';

ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;

const MODEL_CACHE = 'stem-model-v1';
const DB_NAME = 'minus-rehearsal'; // та же база, что в app.js
const STEM_KEYS = ['vocals', 'drums', 'bass', 'other'];

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('songs', { keyPath: 'id' });
      r.result.createObjectStore('pcm');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function putChunk(db, songId, n, chunk) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pcm', 'readwrite');
    for (const key of STEM_KEYS) tx.objectStore('pcm').put(chunk[key], songId + ':' + key + ':' + n);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Не удалось сохранить дорожки'));
  });
}
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

// Тело ответа с отчетом о скачанных байтах.
function withProgress(res) {
  const total = Number(res.headers.get('Content-Length')) || 0;
  let loaded = 0;
  return res.body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      loaded += chunk.length;
      post({ type: 'download', loaded, total });
      ctrl.enqueue(chunk);
    },
  }));
}

// Модель держим в памяти в одном экземпляре: на телефоне каждая лишняя копия
// (172 МБ) может стоить закрытия вкладки системой.
async function getModel(url) {
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(url);
  if (hit) {
    post({ type: 'status', text: 'Загружаю модель из памяти устройства…' });
    return hit.arrayBuffer();
  }

  post({ type: 'status', text: 'Скачиваю модель (один раз)…' });
  let res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось скачать модель (HTTP ' + res.status + ')');

  // Сначала потоком на диск (в кэш), потом читаем оттуда один раз.
  try {
    await cache.put(url, new Response(withProgress(res), { headers: { 'Content-Type': 'application/octet-stream' } }));
    const saved = await cache.match(url);
    if (saved) {
      post({ type: 'status', text: 'Загружаю модель из памяти устройства…' });
      return saved.arrayBuffer();
    }
  } catch (e) {
    // Нет места или браузер не умеет сохранять поток: скачаем прямо в память.
    await cache.delete(url).catch(() => {});
  }
  post({ type: 'status', text: 'Скачиваю модель…' });
  res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось скачать модель (HTTP ' + res.status + ')');
  return new Response(withProgress(res)).arrayBuffer();
}

// null, если видеокарта доступна, иначе причина (покажем ее пользователю).
async function webgpuProblem() {
  try {
    if (!self.navigator.gpu) return 'браузер не дает WebGPU';
    if (!(await self.navigator.gpu.requestAdapter())) return 'нет доступа к видеокарте';
    return null;
  } catch (e) { return 'WebGPU: ' + ((e && e.message) || e); }
}

// Модель уже внутри ONNX Runtime: отдаем память копии в JS сразу, не дожидаясь
// сборщика мусора (передача в закрытый порт отсоединяет буфер).
function release(buf) {
  try { const { port1 } = new MessageChannel(); port1.postMessage(null, [buf]); port1.close(); } catch {}
}

async function run({ left, right, modelUrl, singleThread, songId }) {
  // Потоки WASM работают только при cross-origin isolation (заголовки ставит sw.js).
  const threads = self.crossOriginIsolated && !singleThread
    ? Math.max(1, Math.min(4, self.navigator.hardwareConcurrency || 4))
    : 1;
  ort.env.wasm.numThreads = threads;

  let buffer = await getModel(modelUrl);

  let gpuProblem = await webgpuProblem();
  let backend = gpuProblem ? 'wasm' : 'webgpu';
  let started = 0;

  const makeProcessor = () => new DemucsProcessor({
    ort,
    sessionOptions: {
      executionProviders: [backend],
      enableCpuMemArena: false,
      enableMemPattern: false,
      // Предупаковка ускоряет CPU, но держит вторую копию части весов.
      extra: { session: { disable_prepacking: '1', use_device_allocator_for_initializers: '1' } },
    },
    onProgress: ({ progress, currentSegment, totalSegments }) => {
      const elapsed = (performance.now() - started) / 1000;
      const eta = currentSegment ? (elapsed / currentSegment) * (totalSegments - currentSegment) : 0;
      post({ type: 'progress', progress, currentSegment, totalSegments, eta, backend, threads, gpuProblem });
    },
  });

  post({ type: 'status', text: 'Запускаю нейросеть…' });
  let processor = makeProcessor();
  try {
    await processor.loadModel(buffer);
  } catch (e) {
    if (backend === 'webgpu') {
      gpuProblem = 'ошибка видеокарты: ' + ((e && e.message) || e);
      backend = 'wasm';
      processor = makeProcessor();
      await processor.loadModel(buffer);
    } else {
      throw e;
    }
  }
  release(buffer);
  buffer = null;

  post({ type: 'status', text: 'Разделяю на вокал, ударные, бас и музыку…' });
  post({ type: 'progress', progress: 0, currentSegment: 0, totalSegments: 0, eta: 0, backend, threads, gpuProblem });
  started = performance.now();
  // Готовые куски сразу пишем в IndexedDB: в памяти не копятся все дорожки.
  const peak = (a, step) => { let m = 0; for (let i = 0; i < a.length; i += step) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };
  const inPeak = Math.max(peak(left, 97), peak(right, 97));
  const db = await openDb();
  let chunks = 0, outPeak = 0;
  try {
    await processor.separateInt16(left, right, async (start, chunk) => {
      for (const key of STEM_KEYS) outPeak = Math.max(outPeak, peak(chunk[key], 97));
      await putChunk(db, songId, chunks++, chunk);
    });
  } finally { db.close(); }

  // Сбой вычислений (например, WebGPU на телефоне) дает нули вместо звука:
  // лучше сказать об этом, чем сохранить пустые дорожки.
  if (inPeak > 0.01 && outPeak < 2) {
    throw new Error('нейросеть вернула тишину (режим ' + (backend === 'webgpu' ? 'WebGPU' : 'WASM') + ')');
  }
  post({ type: 'done', chunks, backend });
}

self.onmessage = async (e) => {
  try {
    await run(e.data);
  } catch (err) {
    // Возвращаем звук, чтобы можно было повторить попытку без перечитывания файла.
    const { left, right } = e.data;
    const back = left && left.buffer.byteLength ? [left.buffer, right.buffer] : [];
    post({
      type: 'error',
      message: (err && err.message) || String(err),
      threaded: self.crossOriginIsolated && !e.data.singleThread,
      left: back.length ? left : null, right: back.length ? right : null,
    }, back);
  }
};

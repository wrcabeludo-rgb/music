// Воркер: скачивает модель HTDemucs (один раз, кэш), разделяет трек на 4 стема.
import * as ort from './vendor/ort/ort.webgpu.min.mjs';
import { DemucsProcessor } from './vendor/demucs/index.js';

ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
// Без cross-origin isolation (GitHub Pages) потоки WASM недоступны.
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, self.navigator.hardwareConcurrency || 2)
  : 1;

const MODEL_CACHE = 'stem-model-v1';
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function getModel(url) {
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(url);
  if (hit) {
    post({ type: 'status', text: 'Загружаю модель из памяти устройства…' });
    return { buffer: await hit.arrayBuffer(), cached: true };
  }

  post({ type: 'status', text: 'Скачиваю модель (один раз)…' });
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось скачать модель (HTTP ' + res.status + ')');

  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  let buffer;
  if (total) {
    const bytes = new Uint8Array(total);
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value, loaded);
      loaded += value.length;
      post({ type: 'download', loaded, total });
    }
    buffer = bytes.buffer;
  } else {
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      post({ type: 'download', loaded, total: 0 });
    }
    const bytes = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length; }
    buffer = bytes.buffer;
  }

  try {
    await cache.put(url, new Response(buffer.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
  } catch (e) {
    // Не хватило места для кэша: работаем без него.
  }
  return { buffer, cached: false };
}

async function hasWebGPU() {
  try {
    if (!self.navigator.gpu) return false;
    return !!(await self.navigator.gpu.requestAdapter());
  } catch { return false; }
}

function toInt16Planar(stem) {
  const n = stem.left.length;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = stem.left[i], r = stem.right[i];
    out[i] = (l < -1 ? -1 : l > 1 ? 1 : l) * 32767;
    out[n + i] = (r < -1 ? -1 : r > 1 ? 1 : r) * 32767;
  }
  return out;
}

async function run({ left, right, modelUrl }) {
  const { buffer } = await getModel(modelUrl);

  let backend = (await hasWebGPU()) ? 'webgpu' : 'wasm';
  let started = 0;

  const makeProcessor = () => new DemucsProcessor({
    ort,
    sessionOptions: {
      executionProviders: [backend],
      enableCpuMemArena: false,
      enableMemPattern: false,
    },
    onProgress: ({ progress, currentSegment, totalSegments }) => {
      const elapsed = (performance.now() - started) / 1000;
      const eta = currentSegment ? (elapsed / currentSegment) * (totalSegments - currentSegment) : 0;
      post({ type: 'progress', progress, currentSegment, totalSegments, eta, backend });
    },
  });

  post({ type: 'status', text: 'Запускаю нейросеть…' });
  let processor = makeProcessor();
  try {
    await processor.loadModel(buffer);
  } catch (e) {
    if (backend === 'webgpu') {
      backend = 'wasm';
      processor = makeProcessor();
      await processor.loadModel(buffer);
    } else {
      throw e;
    }
  }

  post({ type: 'status', text: 'Разделяю на вокал, ударные, бас и музыку…' });
  post({ type: 'progress', progress: 0, currentSegment: 0, totalSegments: 0, eta: 0, backend });
  started = performance.now();
  const result = await processor.separate(left, right);

  const stems = {};
  const transfer = [];
  for (const key of ['vocals', 'drums', 'bass', 'other']) {
    stems[key] = toInt16Planar(result[key]);
    transfer.push(stems[key].buffer);
    delete result[key];
  }
  post({ type: 'done', stems, backend }, transfer);
}

self.onmessage = async (e) => {
  try {
    await run(e.data);
  } catch (err) {
    post({ type: 'error', message: (err && err.message) || String(err) });
  }
};

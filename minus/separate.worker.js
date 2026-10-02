// Воркер: скачивает модель HTDemucs (один раз, кэш), разделяет трек на 4 стема.
import * as ort from './vendor/ort/ort.webgpu.min.mjs';
import { DemucsProcessor } from './vendor/demucs/processor.js?v=4';

ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;

const MODEL_CACHE = 'stem-model-v1';
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

async function run({ left, right, modelUrl, singleThread }) {
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
  buffer = null; // модель уже внутри ONNX Runtime, копию в JS отпускаем

  post({ type: 'status', text: 'Разделяю на вокал, ударные, бас и музыку…' });
  post({ type: 'progress', progress: 0, currentSegment: 0, totalSegments: 0, eta: 0, backend, threads, gpuProblem });
  started = performance.now();
  const stems = await processor.separateInt16(left, right);

  // Сбой вычислений (например, WebGPU на телефоне) дает нули вместо звука:
  // лучше сказать об этом, чем сохранить пустые дорожки.
  const peak = (a, step) => { let m = 0; for (let i = 0; i < a.length; i += step) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };
  const inPeak = Math.max(peak(left, 97), peak(right, 97));
  const outPeak = Math.max(...Object.values(stems).map((a) => peak(a, 97)));
  if (inPeak > 0.01 && outPeak < 2) {
    throw new Error('нейросеть вернула тишину (режим ' + (backend === 'webgpu' ? 'WebGPU' : 'WASM') + ')');
  }
  post({ type: 'done', stems, backend }, Object.values(stems).map((a) => a.buffer));
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

// Воркер: кодирует готовый микс в MP3 (lamejs) или WAV и отдает Blob.
import { Mp3Encoder } from './vendor/lamejs/lamejs.js?v=1';

const BLOCK = 1152 * 20;

function toI16(src, from, to, out) {
  for (let i = from, j = 0; i < to; i++, j++) {
    const v = src[i];
    out[j] = (v < -1 ? -1 : v > 1 ? 1 : v) * 32767;
  }
}

function wav(left, right, sampleRate) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 4, true);
  const pcm = new Int16Array(buf, 44);
  for (let i = 0; i < n; i++) {
    const l = left[i], r = right[i];
    pcm[2 * i] = (l < -1 ? -1 : l > 1 ? 1 : l) * 32767;
    pcm[2 * i + 1] = (r < -1 ? -1 : r > 1 ? 1 : r) * 32767;
    if (i % 1000000 === 0) self.postMessage({ type: 'progress', progress: i / n });
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function mp3(left, right, sampleRate, kbps) {
  const enc = new Mp3Encoder(2, sampleRate, kbps);
  const n = left.length;
  const l16 = new Int16Array(BLOCK), r16 = new Int16Array(BLOCK);
  const parts = [];
  let last = 0;
  for (let i = 0; i < n; i += BLOCK) {
    const end = Math.min(i + BLOCK, n), len = end - i;
    toI16(left, i, end, l16); toI16(right, i, end, r16);
    const out = enc.encodeBuffer(l16.subarray(0, len), r16.subarray(0, len));
    if (out.length) parts.push(new Uint8Array(out));
    const now = performance.now();
    if (now - last > 200) { last = now; self.postMessage({ type: 'progress', progress: end / n }); }
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: 'audio/mpeg' });
}

self.onmessage = (e) => {
  const { left, right, sampleRate, format, kbps } = e.data;
  try {
    const blob = format === 'wav' ? wav(left, right, sampleRate) : mp3(left, right, sampleRate, kbps || 192);
    self.postMessage({ type: 'done', blob });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};

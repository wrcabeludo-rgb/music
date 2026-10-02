// Большая проверка распознавания: node notes/tools/bench.js
//
// 1. Живое пение: запись vocadito_1 (набор vocadito, CC BY 4.0, Bittner и др., 2021) с разметкой нот
//    от двух людей. Файлы скачиваются из тестовых данных mirdata в tools/data/cache/.
//    Сравнение как в mir_eval: начало ноты ±50 мс, высота ±50 центов.
// 2. Народные мелодии: 124 песни из Essen Folksong Collection (корпус music21, tools/data/essen.json)
//    «поются» синтезатором (tools/synth.js) в случайном темпе 60–140, с неточным строем, вибрато,
//    неровным ритмом, мужским или женским голосом. Проверяются ноты, ритм, темп, затакт, тональность.
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const T = require('../transcribe.js');

const DATA = path.join(__dirname, 'data');
const CACHE = path.join(DATA, 'cache');
const MIRDATA = 'https://raw.githubusercontent.com/mir-dataset-loaders/mirdata/11e11d50d66d25d1afb520b8d13dd371af44d67a/tests/resources/mir_datasets/vocadito/';
const tunes = JSON.parse(fs.readFileSync(path.join(DATA, 'essen.json'), 'utf8'));
const PC = { C: 0, 'C#': 1, 'D-': 1, D: 2, 'D#': 3, 'E-': 3, E: 4, F: 5, 'F#': 6, 'G-': 6, G: 7, 'G#': 8, 'A-': 8, A: 9, 'A#': 10, 'B-': 10, B: 11 };

// ---------- Народные мелодии (в потоках) ----------
function folkTune(ti) {
  const S = require('./synth.js');
  const tu = tunes[ti];
  S.setSeed(12345 + ti * 7919);
  const bpm = 60 + Math.floor(S.rnd() * 80);
  const male = S.rnd() < 0.4;
  const o = { bpm, detune: (S.rnd() - 0.5) * 70, vibrato: 0.15 + S.rnd() * 0.35, jitter: 0.012 + S.rnd() * 0.015, drift: (S.rnd() - 0.5) * 0.06, low: male, legato: S.rnd() < 0.3 };
  const mel = tu.notes.map(([m, q]) => [m == null ? null : m + (male ? -12 : 0), q]);
  const { x, notes: truth } = S.sing(mel, o);
  const notes = T.segmentNotes(T.pitchTrack(T.analyzePitch(x, S.SR)));

  let hit = 0;
  const used = new Set();
  for (const n of truth) {
    const k = notes.findIndex((d, i) => !used.has(i) && Math.abs(d.start - n.start) < 0.08 && d.midi === n.midi);
    if (k >= 0) { hit++; used.add(k); }
  }
  const sc = T.quantize(notes, { meter: tu.meter.split('/').map(Number) });
  const ratio = sc.bpm / bpm, k = [0.5, 1, 2].find((r) => Math.abs(ratio / r - 1) < 0.06);
  // Ритм: совпадение пар (высота, длительность) по выравниванию.
  const want = mel.filter(([m]) => m != null);
  const got = sc.events.filter((e) => e.midi != null).map((e) => [e.midi, e.len / T.UPQ / (k || 1)]);
  const eq = (a, b) => a[0] === b[0] && Math.abs(a[1] - b[1]) < 1e-6;
  const L = Array.from({ length: want.length + 1 }, () => new Int16Array(got.length + 1));
  for (let i = 1; i <= want.length; i++) for (let j = 1; j <= got.length; j++) L[i][j] = eq(want[i - 1], got[j - 1]) ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
  const rhythm = L[want.length][got.length];
  const [kn, mode] = tu.key.split(' ');
  const fifths = T.majorFifths(mode === 'minor' ? PC[kn] + 3 : PC[kn]);
  return {
    noteF: 2 * hit / (notes.length + truth.length), rhythm, total: want.length,
    tempo: k === 1, tempoOct: !!k,
    pickup: k === 1 ? (sc.mi.barUnits - sc.pickup) % sc.mi.barUnits === tu.pickupQ * T.UPQ : null,
    key: sc.key.fifths === fifths,
  };
}

if (!isMainThread) {
  const out = [];
  for (let ti = workerData.w; ti < tunes.length; ti += workerData.W) out.push(folkTune(ti));
  parentPort.postMessage(out);
  return;
}

// ---------- Живое пение ----------
async function fetchCached(name) {
  const f = path.join(CACHE, name);
  if (!fs.existsSync(f)) {
    const sub = name.endsWith('.wav') ? 'Audio/' : 'Annotations/Notes/';
    const res = await fetch(MIRDATA + sub + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(f);
}
function readWav(buf) {
  let p = 12, sr = 0, ch = 1, bits = 16, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = buf.readUInt16LE(p + 10); sr = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    if (id === 'data') data = buf.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (bits !== 16) throw new Error('нужен 16-битный WAV');
  const n = data.length / 2 / ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += data.readInt16LE((i * ch + c) * 2); x[i] = s / ch / 32768; }
  return { x, sr };
}
const readNotes = (buf) => buf.toString('utf8').trim().split('\n').map((l) => {
  const [s, hz, d] = l.split(',').map(Number);
  return { start: s, end: s + d, pitch: 69 + 12 * Math.log2(hz / 440) };
});
function noteF(ref, est) {
  const used = new Set();
  let hit = 0;
  for (const r of ref) {
    let best = -1, bd = Infinity;
    est.forEach((e, i) => {
      const d = Math.abs(e.start - r.start);
      if (!used.has(i) && d <= 0.05 && Math.abs(e.pitch - r.pitch) <= 0.5 && d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { used.add(best); hit++; }
  }
  return 2 * hit / (ref.length + est.length);
}

(async () => {
  const pct = (v) => (100 * v).toFixed(0) + '%';
  try {
    const { x, sr } = readWav(await fetchCached('vocadito_1.wav'));
    const A1 = readNotes(await fetchCached('vocadito_1_notesA1.csv')), A2 = readNotes(await fetchCached('vocadito_1_notesA2.csv'));
    const est = T.segmentNotes(T.pitchTrack(T.analyzePitch(T.resample(x, sr, 16000), 16000))).map((n) => ({ ...n, pitch: n.midi + n.tuning }));
    console.log(`Живое пение (vocadito_1, ${est.length} нот): совпадение с разметкой ${pct(noteF(A1, est))} и ${pct(noteF(A2, est))}; два человека между собой — ${pct(noteF(A1, A2))}`);
  } catch (e) {
    console.log('Живое пение: не удалось скачать запись (' + e.message + ')');
  }

  const t0 = Date.now();
  const W = Math.max(1, Math.min(8, require('os').cpus().length));
  const parts = await Promise.all(Array.from({ length: W }, (_, w) => new Promise((resolve, reject) => {
    new Worker(__filename, { workerData: { w, W } }).on('message', resolve).on('error', reject);
  })));
  const r = parts.flat(), n = r.length;
  const sum = (f) => r.reduce((s, x) => s + f(x), 0);
  const pk = r.filter((x) => x.pickup != null);
  console.log(`Народные мелодии (${n}, ${((Date.now() - t0) / 1000).toFixed(0)} с): ноты ${pct(sum((x) => x.noteF) / n)}, `
    + `ритм ${pct(sum((x) => x.rhythm) / sum((x) => x.total))} нот (целиком верно ${pct(sum((x) => x.rhythm === x.total) / n)} мелодий), `
    + `темп ${pct(sum((x) => x.tempo) / n)} (с точностью до ×2 — ${pct(sum((x) => x.tempoOct) / n)}), `
    + `затакт ${pct(pk.filter((x) => x.pickup).length / pk.length)}, тональность ${pct(sum((x) => x.key) / n)}`);
})();

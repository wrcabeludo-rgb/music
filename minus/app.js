// ---------- Настройки ----------
// Модель HTDemucs (ONNX, ~172 МБ). Позже можно заменить на свой хостинг.
const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const SAMPLE_RATE = 44100;
const STEMS = [
  { key: 'vocals', label: 'Вокал' },
  { key: 'drums', label: 'Ударные' },
  { key: 'bass', label: 'Бас' },
  { key: 'other', label: 'Музыка' },
];
const DEFAULT_FADER = 0.75; // 0 дБ

// ---------- Утилиты ----------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const faderToDb = (p) => (p < 0.02 ? -Infinity : p <= DEFAULT_FADER ? -50 * (DEFAULT_FADER - p) / DEFAULT_FADER : 6 * (p - DEFAULT_FADER) / (1 - DEFAULT_FADER));
const faderToGain = (p) => { const db = faderToDb(p); return db === -Infinity ? 0 : Math.pow(10, db / 20); };
const dbLabel = (p) => { const db = faderToDb(p); return db === -Infinity ? '−∞' : (db > 0.05 ? '+' : db < -0.05 ? '−' : '') + Math.abs(db).toFixed(0) + ' дБ'; };

let toastTimer;
function toast(text, ms = 3200) {
  const el = $('toast');
  el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// ---------- Хранилище (IndexedDB) ----------
const DB_NAME = 'minus-rehearsal';
let dbp;
function openDb() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('songs', { keyPath: 'id' });
      r.result.createObjectStore('pcm');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function withStores(names, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let out;
    Promise.resolve(fn(...names.map((n) => tx.objectStore(n)))).then((v) => (out = v));
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Ошибка хранилища'));
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const listSongs = () => withStores(['songs'], 'readonly', (s) => reqP(s.getAll())).then((a) => a.sort((x, y) => y.created - x.created));
// Дорожки хранятся кусками ("id:key:n", их пишет воркер по ходу разделения)
// или, у песен из ранних версий, целиком ("id:key"). Внутри каждого Int16Array
// сначала левый канал, потом правый.
const saveSong = (meta) => withStores(['songs'], 'readwrite', (songs) => { songs.put(meta); });
function loadStemChunks(meta, key) {
  return withStores(['pcm'], 'readonly', async (pcm) => {
    if (!meta.chunks) return [await reqP(pcm.get(meta.id + ':' + key))];
    const out = [];
    for (let n = 0; n < meta.chunks; n++) out.push(await reqP(pcm.get(meta.id + ':' + key + ':' + n)));
    return out;
  });
}
const pcmRange = (id) => IDBKeyRange.bound(id + ':', id + ':\uffff');
const deletePcm = (id) => withStores(['pcm'], 'readwrite', (pcm) => { pcm.delete(pcmRange(id)); });
async function deleteSong(id) {
  await withStores(['songs', 'pcm'], 'readwrite', (songs, pcm) => {
    songs.delete(id);
    pcm.delete(pcmRange(id));
  });
  localStorage.removeItem('mix:' + id);
}

// ---------- Аудиодвижок ----------
// iOS: без этого Web Audio молчит в беззвучном режиме (переключатель сбоку).
function audioAsPlayback() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
}

class Engine {
  constructor() {
    audioAsPlayback();
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ sampleRate: SAMPLE_RATE });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.shifter = null; // AudioWorklet сдвига тона, подключается только когда нужен
    this.semitones = 0;
    this.tempo = 1;
    this.stems = {};
    this.duration = 0;
    this.offset = 0;
    this.anchorTime = 0; // время ctx, с которого считается позиция
    this.anchorOff = 0;  // позиция в песне в этот момент
    this.playing = false;
    this.loop = { a: null, b: null, on: false };
  }

  // chunks: Int16Array-куски дорожки по порядку, в каждом левый канал, потом правый.
  addStem(key, chunks) {
    const n = chunks.reduce((sum, c) => sum + c.length / 2, 0);
    const buffer = this.ctx.createBuffer(2, n, SAMPLE_RATE);
    const l = buffer.getChannelData(0), r = buffer.getChannelData(1);
    let off = 0;
    for (const c of chunks) {
      const m = c.length / 2;
      for (let i = 0; i < m; i++) { l[off + i] = c[i] / 32768; r[off + i] = c[m + i] / 32768; }
      off += m;
    }
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    this.stems[key] = { buffer, gain, fader: DEFAULT_FADER, mute: false, solo: false, src: null };
    this.duration = Math.max(this.duration, n / SAMPLE_RATE);
  }

  applyGains(instant = false) {
    const anySolo = Object.values(this.stems).some((s) => s.solo);
    for (const s of Object.values(this.stems)) {
      const audible = !s.mute && (!anySolo || s.solo);
      const g = audible ? faderToGain(s.fader) : 0;
      if (instant) s.gain.gain.value = g;
      else s.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.015);
    }
  }
  isAudible(key) {
    const anySolo = Object.values(this.stems).some((s) => s.solo);
    const s = this.stems[key];
    return !s.mute && (!anySolo || s.solo);
  }

  position() {
    if (!this.playing) return this.offset;
    let t = this.anchorOff + (this.ctx.currentTime - this.anchorTime) * this.tempo;
    if (t < this.anchorOff) t = this.anchorOff;
    const { a, b, on } = this.loop;
    if (on && b > a && t >= b) t = a + ((t - a) % (b - a));
    return Math.min(t, this.duration);
  }

  _stopSources() {
    for (const s of Object.values(this.stems)) {
      if (s.src) { s.src.onended = null; try { s.src.stop(); } catch {} s.src.disconnect(); s.src = null; }
    }
  }
  _startSources(off) {
    this._stopSources();
    const { a, b, on } = this.loop;
    const looping = on && b > a;
    if (looping && off >= b) off = a;
    const t0 = this.ctx.currentTime + 0.05;
    for (const s of Object.values(this.stems)) {
      const src = this.ctx.createBufferSource();
      src.buffer = s.buffer;
      src.playbackRate.value = this.tempo;
      if (looping) { src.loop = true; src.loopStart = a; src.loopEnd = b; }
      src.connect(s.gain);
      src.start(t0, off);
      s.src = src;
    }
    this.anchorTime = t0;
    this.anchorOff = off;
    this.offset = off;
    this.playing = true;
    this.shifter?.port.postMessage({ clear: true });
  }

  // Тон и темп. Темп = скорость дорожек; тон, который при этом сдвигается,
  // выравнивает SoundTouch в AudioWorklet.
  async initShifter() {
    if (!this.ctx.audioWorklet) return false;
    try {
      await this.ctx.audioWorklet.addModule(new URL('./pitch.worklet.js?v=1', import.meta.url));
      this.shifter = new AudioWorkletNode(this.ctx, 'pitch-shift', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.shifter.connect(this.ctx.destination);
      return true;
    } catch { this.shifter = null; return false; }
  }
  setTone({ semitones = this.semitones, tempo = this.tempo }) {
    if (tempo !== this.tempo) {
      if (this.playing) {
        const pos = this.position();
        for (const s of Object.values(this.stems)) s.src?.playbackRate.setValueAtTime(tempo, this.ctx.currentTime);
        this.anchorTime = this.ctx.currentTime;
        this.anchorOff = pos;
      }
      this.tempo = tempo;
    }
    this.semitones = semitones;
    const pitch = Math.pow(2, semitones / 12) / tempo;
    const shift = !!this.shifter && Math.abs(pitch - 1) > 1e-4;
    this.master.disconnect();
    if (shift) {
      this.shifter.port.postMessage({ pitch, clear: !this.shifting });
      this.master.connect(this.shifter);
    } else {
      this.master.connect(this.ctx.destination);
    }
    this.shifting = shift;
  }

  async play() {
    if (this.playing) return;
    audioAsPlayback();
    await this.ctx.resume();
    if (this.offset >= this.duration - 0.05) this.offset = 0;
    this._startSources(this.offset);
  }
  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this._stopSources();
    this.playing = false;
  }
  seek(t) {
    t = clamp(t, 0, this.duration);
    if (this.playing) this._startSources(t); else this.offset = t;
  }
  setLoop(patch) {
    Object.assign(this.loop, patch);
    if (this.playing) this._startSources(this.position());
  }
  close() { this._stopSources(); this.ctx.close(); }
}

// ---------- Состояние ----------
let engine = null;
let currentSong = null;
let peaks = [];
let raf = 0;
let wakeLock = null;

// ---------- Экраны ----------
function show(view) {
  for (const id of ['library', 'player']) $(id).hidden = id !== view;
  window.scrollTo(0, 0);
}

async function renderLibrary() {
  const songs = await listSongs();
  const ul = $('songs');
  ul.textContent = '';
  $('empty').hidden = songs.length > 0;
  for (const s of songs) {
    const li = document.createElement('li');
    li.className = 'song';
    const open = document.createElement('button');
    open.className = 'open';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = s.name;
    const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = fmtTime(s.duration);
    open.append(name, sub);
    open.onclick = () => openSong(s);
    const del = document.createElement('button');
    del.className = 'del'; del.setAttribute('aria-label', 'Удалить «' + s.name + '»');
    del.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    del.onclick = async () => {
      if (confirm('Удалить «' + s.name + '» с этого устройства?')) { await deleteSong(s.id); renderLibrary(); }
    };
    li.append(open, del);
    ul.append(li);
  }
}

// ---------- Добавление песни и разделение ----------
let worker = null;

const JOB_KEY = 'minus:job';
// Обработка на видеокарте уже роняла страницу: дальше считаем на процессоре.
const NO_GPU_KEY = 'minus:noGpu';
let jobTimer = 0;
function setProc({ status, pct, meta }) {
  if (status != null) $('procStatus').textContent = status;
  if (pct != null) {
    $('procFill').style.width = pct + '%';
    $('procBar').setAttribute('aria-valuenow', Math.round(pct));
  }
  if (meta != null) $('procMeta').textContent = meta;
  // Если система закроет страницу (обычно от нехватки памяти), при следующем
  // запуске покажем, на каком этапе это случилось. Частые обновления (скачивание)
  // пишем не чаще раза в полсекунды, но последнее состояние не теряем.
  if (status != null) saveJob();
  else if (!jobTimer) jobTimer = setTimeout(saveJob, 500);
}
function saveJob() {
  clearTimeout(jobTimer); jobTimer = 0;
  if ($('processing').hidden) return;
  try {
    localStorage.setItem(JOB_KEY, $('procStatus').textContent + ($('procMeta').textContent ? ' (' + $('procMeta').textContent + ')' : ''));
  } catch {}
}
// id песни, которую сейчас пишет воркер: при отмене или ошибке удаляем ее куски.
let jobSongId = null;
function closeProc() {
  if (jobSongId) { deletePcm(jobSongId).catch(() => {}); jobSongId = null; }
  try { localStorage.removeItem(JOB_KEY + ':id'); } catch {}
  clearTimeout(jobTimer); jobTimer = 0;
  try { for (const k of ['', ':backend', ':threads']) localStorage.removeItem(JOB_KEY + k); } catch {}
  $('processing').hidden = true;
  if (worker) { worker.terminate(); worker = null; }
  releaseWake();
}

async function decodeFile(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ sampleRate: SAMPLE_RATE });
  try {
    const data = await file.arrayBuffer();
    const audio = await new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));
    const left = audio.getChannelData(0).slice();
    const right = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice();
    return { left, right, duration: audio.duration };
  } finally { ctx.close(); }
}

async function addSong(file) {
  $('processing').hidden = false;
  setProc({ status: 'Читаю файл…', pct: 0, meta: '' });
  requestWake();

  let decoded;
  try {
    decoded = await decodeFile(file);
  } catch {
    closeProc();
    toast('Не удалось прочитать файл. Попробуйте mp3, wav, m4a или flac.');
    return;
  }
  if (decoded.duration > 12 * 60) {
    if (!confirm('Трек длиннее 12 минут, обработка займет много времени и памяти. Продолжить?')) { closeProc(); return; }
  }

  startSeparation(file, decoded, false, crypto.randomUUID());
}

function startSeparation(file, decoded, singleThread, songId) {
  jobSongId = songId;
  try { localStorage.setItem(JOB_KEY + ':id', songId); } catch {}
  worker = new Worker(new URL('./separate.worker.js', import.meta.url), { type: 'module' });
  let phase = 'download';
  worker.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'status') setProc({ status: m.text });
    else if (m.type === 'download') {
      const total = m.total || 172e6;
      setProc({ pct: clamp((m.loaded / total) * 100, 0, 100), meta: (m.loaded / 1048576).toFixed(0) + ' МБ из ' + (total / 1048576).toFixed(0) + ' МБ' });
    } else if (m.type === 'progress') {
      phase = 'separate';
      try { localStorage.setItem(JOB_KEY + ':backend', m.backend); localStorage.setItem(JOB_KEY + ':threads', m.threads); } catch {}
      const eta = m.eta > 1 ? ' · осталось примерно ' + fmtTime(m.eta) : '';
      setProc({
        pct: m.progress * 100,
        meta: (m.totalSegments ? 'Фрагмент ' + m.currentSegment + ' из ' + m.totalSegments : 'Подготовка') + eta +
          (m.backend === 'wasm'
            ? ' · без видеокарты (' + (m.gpuProblem || 'причина неизвестна') + '), потоков: ' + m.threads
            : ' · на видеокарте'),
      });
    } else if (m.type === 'done') {
      setProc({ status: 'Сохраняю дорожки…', pct: 100, meta: '' });
      const meta = {
        id: songId,
        name: file.name.replace(/\.[^.]+$/, ''),
        duration: decoded.duration,
        created: Date.now(),
        chunks: m.chunks,
      };
      try {
        await saveSong(meta);
        jobSongId = null; // песня сохранена, недописанных кусков нет
        try { localStorage.removeItem(JOB_KEY + ':id'); } catch {}
        navigator.storage?.persist?.();
      } catch {
        closeProc();
        toast('Не хватило места на устройстве для сохранения.');
        return;
      }
      closeProc();
      await renderLibrary();
      try { localStorage.setItem(JOB_KEY, 'Открываю дорожки в плеере'); } catch {}
      await openSong(meta);
      try { localStorage.removeItem(JOB_KEY); } catch {}
    } else if (m.type === 'error') {
      // Многопоточный режим не завелся: пробуем еще раз в один поток.
      if (m.threaded && m.left && !singleThread && phase !== 'separate') {
        worker.terminate();
        setProc({ status: 'Пробую в обычном режиме…', meta: '' });
        startSeparation(file, { ...decoded, left: m.left, right: m.right }, true, songId);
        return;
      }
      closeProc();
      toast(phase === 'download' ? 'Ошибка: ' + m.message : 'Не удалось разделить трек: ' + m.message, 6000);
    }
  };
  worker.onerror = (e) => {
    const why = (e && e.message) || '';
    closeProc();
    toast('Ошибка воркера' + (why ? ': ' + why : '') + '. Попробуйте еще раз; если повторится, пришлите этот текст.', 10000);
  };

  setProc({ status: 'Готовлю модель…' });
  let noGpu = false;
  try { noGpu = localStorage.getItem(NO_GPU_KEY) === '1'; } catch {}
  worker.postMessage({ left: decoded.left, right: decoded.right, modelUrl: MODEL_URL, singleThread, songId, noGpu }, [decoded.left.buffer, decoded.right.buffer]);
}

$('procCancel').onclick = closeProc;
$('file').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) addSong(f);
};

// ---------- Wake Lock ----------
async function requestWake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }

// ---------- Плеер ----------
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

function makeFader(label, onChange) {
  const el = document.createElement('div');
  el.className = 'fader';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', 'Громкость: ' + label);
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.innerHTML = '<div class="track"><div class="fill"></div><div class="tick"></div><div class="cap"></div></div>';
  const track = el.firstChild;
  let value = DEFAULT_FADER;
  const set = (p, notify = true) => {
    value = clamp(p, 0, 1);
    el.style.setProperty('--p', value);
    el.setAttribute('aria-valuenow', Math.round(value * 100));
    el.setAttribute('aria-valuetext', dbLabel(value));
    if (notify) onChange(value);
  };
  const fromEvent = (e) => {
    const r = track.getBoundingClientRect();
    set(1 - (e.clientY - r.top) / r.height);
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); fromEvent(e); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) fromEvent(e); });
  el.addEventListener('dblclick', () => set(DEFAULT_FADER));
  el.addEventListener('keydown', (e) => {
    const step = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 }[e.key];
    if (step) { e.preventDefault(); set(value + step); }
    else if (e.key === 'Home') { e.preventDefault(); set(0); }
    else if (e.key === 'End') { e.preventDefault(); set(1); }
  });
  set(DEFAULT_FADER, false);
  return { el, set };
}

function mixKey() { return 'mix:' + currentSong.id; }
function saveMix() {
  const o = {};
  for (const { key } of STEMS) { const s = engine.stems[key]; o[key] = { f: s.fader, m: s.mute, s: s.solo }; }
  o.tone = { st: engine.semitones, tempo: engine.tempo };
  localStorage.setItem(mixKey(), JSON.stringify(o));
}

function buildMixer() {
  const root = $('mixer');
  root.textContent = '';
  const saved = JSON.parse(localStorage.getItem(mixKey()) || 'null');
  const refs = {};

  const refresh = () => {
    for (const { key } of STEMS) {
      const r = refs[key], s = engine.stems[key];
      r.ch.classList.toggle('off', !engine.isAudible(key));
      r.m.setAttribute('aria-pressed', s.mute);
      r.s.setAttribute('aria-pressed', s.solo);
      r.db.textContent = dbLabel(s.fader);
    }
  };

  for (const { key, label } of STEMS) {
    const s = engine.stems[key];
    if (saved?.[key]) { s.fader = saved[key].f ?? DEFAULT_FADER; s.mute = !!saved[key].m; s.solo = !!saved[key].s; }

    const ch = document.createElement('section');
    ch.className = 'ch'; ch.dataset.key = key;
    const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = label;
    const db = document.createElement('div'); db.className = 'db';
    const fader = makeFader(label, (p) => { s.fader = p; engine.applyGains(); refresh(); saveMix(); });
    fader.set(s.fader, false);

    const ms = document.createElement('div'); ms.className = 'ms';
    const m = document.createElement('button'); m.className = 'm'; m.textContent = 'M';
    m.setAttribute('aria-label', 'Выключить звук: ' + label);
    const so = document.createElement('button'); so.className = 's'; so.textContent = 'S';
    so.setAttribute('aria-label', 'Играть только: ' + label);
    m.onclick = () => { s.mute = !s.mute; engine.applyGains(); refresh(); saveMix(); };
    so.onclick = () => { s.solo = !s.solo; engine.applyGains(); refresh(); saveMix(); };
    ms.append(m, so);

    ch.append(lbl, fader.el, db, ms);
    root.append(ch);
    refs[key] = { ch, m, s: so, db };
  }
  engine.applyGains(true);
  refresh();

  const tone = saved?.tone;
  engine.setTone({ semitones: clamp(tone?.st ?? 0, TONE_MIN, TONE_MAX), tempo: clamp(tone?.tempo ?? 1, TEMPO_MIN, TEMPO_MAX) });
  updateToneUi();
}

// ---------- Тон и темп ----------
const TONE_MIN = -6, TONE_MAX = 6;
const TEMPO_MIN = 0.5, TEMPO_MAX = 1.5, TEMPO_STEP = 0.05;
const semisLabel = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + -n : '0');

function updateToneUi() {
  const ok = !!engine.shifter;
  const st = engine.semitones, pct = Math.round(engine.tempo * 100);
  $('toneVal').textContent = semisLabel(st);
  $('toneVal').setAttribute('aria-label', (st ? 'Тон ' + semisLabel(st) + ' полутона' : 'Тон без изменений') + '. Нажмите, чтобы сбросить');
  $('tempoVal').textContent = pct + '%';
  $('tempoVal').setAttribute('aria-label', 'Темп ' + pct + '%. Нажмите, чтобы сбросить');
  $('toneDown').disabled = !ok || st <= TONE_MIN;
  $('toneUp').disabled = !ok || st >= TONE_MAX;
  $('tempoDown').disabled = !ok || engine.tempo <= TEMPO_MIN + 1e-6;
  $('tempoUp').disabled = !ok || engine.tempo >= TEMPO_MAX - 1e-6;
  $('toneVal').closest('.stepper').classList.toggle('changed', st !== 0);
  $('tempoVal').closest('.stepper').classList.toggle('changed', pct !== 100);
}
function changeTone(patch) {
  if (!engine?.shifter) return;
  if (patch.tempo != null) patch.tempo = Math.round(clamp(patch.tempo, TEMPO_MIN, TEMPO_MAX) * 100) / 100;
  if (patch.semitones != null) patch.semitones = clamp(patch.semitones, TONE_MIN, TONE_MAX);
  engine.setTone(patch);
  updateToneUi();
  saveMix();
}
$('toneDown').onclick = () => changeTone({ semitones: engine.semitones - 1 });
$('toneUp').onclick = () => changeTone({ semitones: engine.semitones + 1 });
$('toneVal').onclick = () => changeTone({ semitones: 0 });
$('tempoDown').onclick = () => changeTone({ tempo: engine.tempo - TEMPO_STEP });
$('tempoUp').onclick = () => changeTone({ tempo: engine.tempo + TEMPO_STEP });
$('tempoVal').onclick = () => changeTone({ tempo: 1 });

// Волна по сумме всех дорожек
function computePeaks(buckets = 400) {
  const out = new Float32Array(buckets);
  const bufs = Object.values(engine.stems).map((s) => s.buffer.getChannelData(0));
  const n = bufs[0].length, size = Math.floor(n / buckets) || 1, step = Math.max(1, Math.floor(size / 64));
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    for (let i = b * size; i < (b + 1) * size && i < n; i += step) {
      let sum = 0;
      for (const d of bufs) sum += d[i];
      max = Math.max(max, Math.abs(sum));
    }
    out[b] = max;
  }
  const top = Math.max(...out) || 1;
  return out.map((v) => v / top);
}

const wave = $('wave');
function drawWave() {
  const dpr = window.devicePixelRatio || 1;
  const w = wave.clientWidth, h = wave.clientHeight;
  if (wave.width !== Math.round(w * dpr)) { wave.width = Math.round(w * dpr); wave.height = Math.round(h * dpr); }
  const g = wave.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pos = engine.position() / engine.duration;
  const { a, b, on } = engine.loop;

  if (a != null && b != null && b > a) {
    g.fillStyle = on ? 'rgba(243,241,236,.22)' : 'rgba(243,241,236,.10)';
    g.fillRect((a / engine.duration) * w, 0, ((b - a) / engine.duration) * w, h);
  }
  const n = peaks.length, bw = w / n;
  for (let i = 0; i < n; i++) {
    const x = i * bw, bh = Math.max(3, peaks[i] * (h - 14));
    g.fillStyle = i / n <= pos ? '#F3F1EC' : '#52608F';
    g.fillRect(x + 0.5, (h - bh) / 2, Math.max(1, bw - 1.5), bh);
  }
  for (const t of [a, b]) {
    if (t == null) continue;
    g.fillStyle = '#F3F1EC';
    g.fillRect((t / engine.duration) * w - 1, 0, 2, h);
  }
  g.fillStyle = '#FF6B8B';
  g.fillRect(pos * w - 1.5, 0, 3, h);
}

function updateLoopUi() {
  const { a, b, on } = engine.loop;
  const ready = a != null && b != null && b > a;
  $('loopA').classList.toggle('set', a != null);
  $('loopB').classList.toggle('set', b != null);
  $('loopOn').disabled = !ready;
  $('loopOn').setAttribute('aria-pressed', ready && on);
  $('loopClear').disabled = a == null && b == null;
  $('loopInfo').textContent = ready ? fmtTime(a) + ' – ' + fmtTime(b) : '';
}

function updatePlayBtn() {
  $('play').innerHTML = engine.playing ? PAUSE_SVG : PLAY_SVG;
  $('play').setAttribute('aria-label', engine.playing ? 'Пауза' : 'Играть');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = engine.playing ? 'playing' : 'paused';
}

function tick() {
  if (!engine) return;
  if (engine.playing && !engine.loop.on && engine.position() >= engine.duration - 0.02) {
    engine.pause(); engine.offset = 0; updatePlayBtn(); releaseWake();
  }
  $('cur').textContent = fmtTime(engine.position());
  drawWave();
  raf = requestAnimationFrame(tick);
}

async function togglePlay() {
  if (engine.playing) { engine.pause(); releaseWake(); }
  else { await engine.play(); requestWake(); }
  updatePlayBtn();
}

function seekFromEvent(e) {
  const r = wave.getBoundingClientRect();
  engine.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * engine.duration);
}
wave.addEventListener('pointerdown', (e) => { wave.setPointerCapture(e.pointerId); seekFromEvent(e); });
wave.addEventListener('pointermove', (e) => { if (wave.hasPointerCapture(e.pointerId)) seekFromEvent(e); });
wave.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); engine.seek(engine.position() - 5); }
  if (e.key === 'ArrowRight') { e.preventDefault(); engine.seek(engine.position() + 5); }
});

$('rew').onclick = () => engine.seek(engine.position() - 10);
$('fwd').onclick = () => engine.seek(engine.position() + 10);
$('play').onclick = togglePlay;

$('loopA').onclick = () => {
  const t = engine.position();
  const patch = { a: t };
  if (engine.loop.b != null && engine.loop.b <= t) patch.b = null;
  engine.setLoop(patch); updateLoopUi();
};
$('loopB').onclick = () => {
  const t = engine.position();
  if (engine.loop.a == null || t <= engine.loop.a + 0.3) { toast('Сначала поставьте точку A, потом B позже по времени.'); return; }
  engine.setLoop({ b: t, on: true }); updateLoopUi();
};
$('loopOn').onclick = () => { engine.setLoop({ on: !engine.loop.on }); updateLoopUi(); };
$('loopClear').onclick = () => { engine.setLoop({ a: null, b: null, on: false }); updateLoopUi(); };

$('back').onclick = () => {
  cancelAnimationFrame(raf);
  engine?.close(); engine = null; currentSong = null;
  releaseWake();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  show('library');
};

async function openSong(meta) {
  try {
    engine?.close();
    engine = new Engine();
    currentSong = meta;
    // По одной дорожке: в памяти не лежат сразу все куски и все AudioBuffer.
    for (const { key } of STEMS) engine.addStem(key, await loadStemChunks(meta, key));
    engine.applyGains(true);
    await engine.initShifter();
  } catch {
    toast('Не удалось открыть песню.');
    return;
  }
  $('title').textContent = meta.name;
  $('dur').textContent = fmtTime(engine.duration);
  $('cur').textContent = '0:00';
  show('player');
  buildMixer();
  peaks = computePeaks();
  updateLoopUi(); updatePlayBtn();
  cancelAnimationFrame(raf);
  tick();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: meta.name, artist: 'Минус' });
    navigator.mediaSession.setActionHandler('play', togglePlay);
    navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('seekbackward', () => engine.seek(engine.position() - 10));
    navigator.mediaSession.setActionHandler('seekforward', () => engine.seek(engine.position() + 10));
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine?.playing) requestWake();
});
window.addEventListener('resize', () => { if (engine) drawWave(); });

// ---------- Установка PWA ----------
let installEvt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvt = e; $('installBtn').hidden = false;
});
$('installBtn').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBtn').hidden = true;
};
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
$('iosHint').hidden = !(isIos && !standalone);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // Заголовки для многопоточности ставит service worker. Страница, открытая до
  // того, как он взял управление, их не получила: перезагружаем один раз.
  const reloadForIsolation = () => {
    let tries = 0;
    try { tries = Number(localStorage.getItem('coi-reload')) || 0; } catch {}
    if (window.crossOriginIsolated || tries >= 2) return; // браузер не поддерживает: не зацикливаемся
    if (!$('processing').hidden) return; // не прерываем обработку
    try { localStorage.setItem('coi-reload', String(tries + 1)); } catch {}
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadForIsolation);
  if (navigator.serviceWorker.controller) reloadForIsolation();
  if (window.crossOriginIsolated) { try { localStorage.removeItem('coi-reload'); } catch {} }
}

renderLibrary();

try {
  // Страницу закрыли посреди обработки: удаляем недописанные куски.
  const orphan = localStorage.getItem(JOB_KEY + ':id');
  if (orphan) {
    listSongs().then((songs) => {
      if (!songs.some((x) => x.id === orphan)) deletePcm(orphan).catch(() => {});
      localStorage.removeItem(JOB_KEY + ':id');
    }).catch(() => {});
  }
  const lastJob = localStorage.getItem(JOB_KEY);
  const lastBackend = localStorage.getItem(JOB_KEY + ':backend');
  localStorage.removeItem('minus:maxThreads'); // от прошлой версии с понижением потоков
  if (lastJob) {
    for (const k of ['', ':backend', ':threads']) localStorage.removeItem(JOB_KEY + k);
    let text = 'Прошлая обработка прервалась на этапе: ' + lastJob + '. Скорее всего, устройству не хватило памяти.';
    if (lastBackend === 'webgpu') {
      localStorage.setItem(NO_GPU_KEY, '1');
      text += ' Это было на видеокарте, дальше буду считать без нее.';
    } else {
      text += ' Закройте другие приложения и попробуйте еще раз.';
    }
    toast(text, 14000);
  }
} catch {}

// ---------- Скачивание микса ----------
// Микс собирается в OfflineAudioContext теми же средствами, что и при
// воспроизведении: громкость, Mute/Solo, темп (скорость дорожек) и тон (SoundTouch).
let exportFormat = 'mp3';
let exportFile = null;
let exportWorker = null;

const stemGain = (key) => (engine.isAudible(key) ? faderToGain(engine.stems[key].fader) : 0);
const pct = (g) => Math.round(g * 100) + '%';

function mixDescription() {
  const parts = STEMS.filter(({ key }) => stemGain(key) > 0).map(({ key, label }) => label + ' ' + pct(stemGain(key)));
  if (engine.semitones) parts.push('тон ' + semisLabel(engine.semitones));
  if (Math.abs(engine.tempo - 1) > 1e-6) parts.push('темп ' + Math.round(engine.tempo * 100) + '%');
  return parts.join(', ');
}

function openExport() {
  if (!engine) return;
  const ul = $('exportMix');
  ul.textContent = '';
  for (const { key, label } of STEMS) {
    const g = stemGain(key);
    const li = document.createElement('li');
    li.className = g > 0 ? '' : 'off';
    li.innerHTML = '<span></span><b></b>';
    li.firstChild.textContent = label;
    li.lastChild.textContent = g > 0 ? pct(g) : 'выключен';
    ul.append(li);
  }
  if (engine.semitones || Math.abs(engine.tempo - 1) > 1e-6) {
    const li = document.createElement('li');
    li.innerHTML = '<span>Тон и темп</span><b></b>';
    li.lastChild.textContent = semisLabel(engine.semitones) + ' · ' + Math.round(engine.tempo * 100) + '%';
    ul.append(li);
  }
  const secs = engine.duration / engine.tempo;
  $('sizeMp3').textContent = Math.max(1, Math.round(secs * 192000 / 8 / 1048576));
  $('sizeWav').textContent = Math.max(1, Math.round(secs * SAMPLE_RATE * 4 / 1048576));
  exportFile = null;
  $('exportProgress').hidden = true;
  $('exportGo').hidden = false; $('exportGo').disabled = !STEMS.some(({ key }) => stemGain(key) > 0);
  $('exportSave').hidden = true;
  $('exportSheet').hidden = false;
}

function closeExport() {
  exportWorker?.terminate(); exportWorker = null;
  exportFile = null;
  $('exportSheet').hidden = true;
}

function exportProgress(text, p) {
  $('exportProgress').hidden = false;
  $('exportStatus').textContent = text;
  $('exportFill').style.width = Math.round(p * 100) + '%';
}

async function renderMix() {
  const tempo = engine.tempo;
  const pitch = Math.pow(2, engine.semitones / 12) / tempo;
  const shift = Math.abs(pitch - 1) > 1e-4;
  const n = Math.round(engine.duration * SAMPLE_RATE);
  // Сдвиг тона дает небольшую задержку: добавляем хвост, чтобы конец не обрезался.
  const length = Math.ceil(n / tempo) + (shift ? SAMPLE_RATE / 2 : 0);
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  let out = ctx.destination;
  if (shift) {
    await ctx.audioWorklet.addModule(new URL('./pitch.worklet.js?v=1', import.meta.url));
    const node = new AudioWorkletNode(ctx, 'pitch-shift', { outputChannelCount: [2], processorOptions: { pitch } });
    node.connect(ctx.destination);
    out = node;
  }
  for (const { key } of STEMS) {
    const g = stemGain(key);
    if (!g) continue;
    const src = ctx.createBufferSource();
    src.buffer = engine.stems[key].buffer;
    src.playbackRate.value = tempo;
    const gain = ctx.createGain();
    gain.gain.value = g;
    src.connect(gain).connect(out);
    src.start(0);
  }
  const rendered = await ctx.startRendering();
  const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
  // Сумма дорожек может выйти за 0 дБ: тогда равномерно приглушаем, без перегруза.
  let peak = 0;
  for (let i = 0; i < left.length; i++) { const a = Math.abs(left[i]), b = Math.abs(right[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
  if (peak > 0.99) {
    const k = 0.99 / peak;
    for (let i = 0; i < left.length; i++) { left[i] *= k; right[i] *= k; }
  }
  return { left, right };
}

function fileName(ext) {
  const name = (currentSong.name + ' (' + mixDescription() + ')').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name.slice(0, 150) + '.' + ext;
}

async function buildExport() {
  $('exportGo').disabled = true;
  document.querySelectorAll('.formats .chip').forEach((b) => (b.disabled = true));
  try {
    exportProgress('Свожу дорожки…', 0.05);
    const { left, right } = await renderMix();
    exportProgress(exportFormat === 'mp3' ? 'Кодирую MP3…' : 'Готовлю WAV…', 0.3);
    const blob = await new Promise((resolve, reject) => {
      exportWorker = new Worker(new URL('./export.worker.js', import.meta.url), { type: 'module' });
      exportWorker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') exportProgress($('exportStatus').textContent, 0.3 + 0.7 * m.progress);
        else if (m.type === 'done') resolve(m.blob);
        else reject(new Error(m.message));
      };
      exportWorker.onerror = (e) => reject(new Error((e && e.message) || 'ошибка кодировщика'));
      exportWorker.postMessage({ left, right, sampleRate: SAMPLE_RATE, format: exportFormat, kbps: 192 }, [left.buffer, right.buffer]);
    });
    exportWorker.terminate(); exportWorker = null;
    const ext = exportFormat === 'mp3' ? 'mp3' : 'wav';
    exportFile = new File([blob], fileName(ext), { type: blob.type });
    exportProgress('Готово: ' + (blob.size / 1048576).toFixed(1) + ' МБ', 1);
    $('exportGo').hidden = true;
    $('exportSave').hidden = false;
  } catch (err) {
    exportWorker?.terminate(); exportWorker = null;
    exportProgress('Не получилось собрать файл: ' + ((err && err.message) || err), 0);
    $('exportGo').disabled = false;
  } finally {
    document.querySelectorAll('.formats .chip').forEach((b) => (b.disabled = false));
  }
}

// Отдельная кнопка: «Поделиться» на iPhone требует свежего нажатия.
async function saveExport() {
  if (!exportFile) return;
  if (navigator.canShare?.({ files: [exportFile] })) {
    try { await navigator.share({ files: [exportFile], title: exportFile.name }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(exportFile);
  const a = document.createElement('a');
  a.href = url; a.download = exportFile.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$('exportBtn').onclick = openExport;
$('exportClose').onclick = closeExport;
$('exportGo').onclick = buildExport;
$('exportSave').onclick = saveExport;
document.querySelectorAll('.formats .chip').forEach((b) => {
  b.onclick = () => {
    exportFormat = b.dataset.format;
    document.querySelectorAll('.formats .chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (exportFile) { exportFile = null; $('exportSave').hidden = true; $('exportGo').hidden = false; $('exportGo').disabled = false; $('exportProgress').hidden = true; }
  };
});

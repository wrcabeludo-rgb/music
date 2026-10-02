// Ноты из голоса: интерфейс. Распознавание — transcribe.js, отрисовка нот — abcjs.
(() => {
  'use strict';
  const T = window.Transcribe;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod = (a, n) => ((a % n) + n) % n;
  const MAX_SEC = 15 * 60;

  let toastTimer;
  function toast(text, ms = 3600) {
    const el = $('toast');
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ms);
  }
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const fmtSec = (s) => s.toFixed(1).replace('.', ',') + ' с';

  // ---------- Звук ----------
  let ctx;
  function audio() {
    if (!ctx) {
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function decode(data) {
    const ac = audio();
    return new Promise((res, rej) => {
      const p = ac.decodeAudioData(data, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }
  function mono(buf) {
    const n = buf.numberOfChannels, x = new Float32Array(buf.length);
    for (let c = 0; c < n; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) x[i] += d[i] / n; }
    return x;
  }

  // Синтезированная нота: треугольная волна с мягкой атакой.
  function tone(ac, dest, midi, t0, dur, vol = 0.22) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ac.createGain();
    const end = t0 + Math.max(0.06, dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.linearRampToValueAtTime(vol * 0.65, t0 + Math.min(0.15, dur * 0.5));
    g.gain.setValueAtTime(vol * 0.65, Math.max(t0 + 0.02, end - 0.04));
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(dest);
    const nodes = [];
    for (const [type, mul, v] of [['triangle', 1, 1], ['sine', 2, 0.18]]) {
      const o = ac.createOscillator();
      o.type = type; o.frequency.value = f * mul;
      const og = ac.createGain(); og.gain.value = v;
      o.connect(og); og.connect(g);
      o.start(t0); o.stop(end + 0.02);
      nodes.push(o);
    }
    return nodes;
  }

  // ---------- Состояние ----------
  let S = null;        // текущая запись
  let worker = null;
  let runId = 0;      // отмена обработки
  const DEFAULT_OPT = { bpm: null, meter: [4, 4], step: null, pickup: null, key: null, clef: null, transpose: 0, tune: true };

  function show(view) {
    $('start').hidden = view !== 'start';
    $('result').hidden = view !== 'result';
    window.scrollTo(0, 0);
  }

  // ---------- Загрузка и распознавание ----------
  function progress(text, frac) {
    $('processing').hidden = false;
    if (text) $('procStatus').textContent = text;
    const pct = Math.round(clamp(frac, 0, 1) * 100);
    $('procFill').style.width = pct + '%';
    $('procBar').setAttribute('aria-valuenow', pct);
  }

  async function processAudio(getData, title) {
    stopPlay();
    const id = ++runId;
    progress('Читаю файл…', 0.02);
    let buf;
    try { buf = await decode(await getData()); }
    catch { if (id === runId) { $('processing').hidden = true; toast('Не удалось прочитать файл. Подойдут mp3, wav, m4a, ogg, flac.'); } return; }
    if (id !== runId) return;
    if (buf.duration > MAX_SEC) { $('processing').hidden = true; toast('Запись длиннее 15 минут. Обрежьте её и попробуйте снова.'); return; }
    if (buf.duration < 0.5) { $('processing').hidden = true; toast('Запись слишком короткая.'); return; }

    progress('Слушаю голос…', 0.05);
    let pitch;
    try {
      pitch = await new Promise((resolve, reject) => {
        worker = new Worker('analyze.worker.js');
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.progress != null) progress(`Слушаю голос… ${Math.round(m.progress * 100)}%`, 0.05 + 0.9 * m.progress);
          else if (m.error) reject(new Error(m.error));
          else if (m.pitch) resolve(m.pitch);
        };
        worker.onerror = (e) => reject(new Error(e.message || 'ошибка воркера'));
        const x = mono(buf);
        worker.postMessage({ samples: x, sr: buf.sampleRate }, [x.buffer]);
      });
    } catch (err) {
      $('processing').hidden = true;
      if (err.message !== 'cancel') toast('Не получилось распознать: ' + err.message);
      return;
    } finally {
      if (worker) worker.terminate();
      worker = null;
    }
    if (id !== runId) return;
    progress('Записываю ноты…', 1);

    S = { title, buf, track: T.pitchTrack(pitch), opt: { ...DEFAULT_OPT, meter: [...DEFAULT_OPT.meter] }, history: [], sel: null };
    resegment();
    $('title').value = title;
    $('processing').hidden = true;
    show('result');
    render();
  }

  $('procCancel').onclick = () => {
    runId++;
    if (worker) { worker.terminate(); worker.onmessage({ data: { error: 'cancel' } }); }
    $('processing').hidden = true;
  };

  $('file').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    audio();
    processAudio(() => f.arrayBuffer(), f.name.replace(/\.[^.]+$/, ''));
  };

  // ---------- Запись с микрофона ----------
  let recState = null;
  $('recBtn').onclick = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Этот браузер не умеет записывать звук. Запишите голос диктофоном и загрузите файл.');
      return;
    }
    const ac = audio();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      toast('Нет доступа к микрофону. Разрешите его в настройках браузера.');
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 4096;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const t0 = performance.now();
    let lastPitch = 0, raf;
    recState = { stream, rec, chunks, src, raf: 0 };
    const loop = (now) => {
      an.getFloatTimeDomainData(buf);
      let e = 0;
      for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
      const db = 10 * Math.log10(e / buf.length + 1e-12);
      $('recLevel').style.width = clamp((db + 60) / 60, 0, 1) * 100 + '%';
      $('recTime').textContent = fmtTime((now - t0) / 1000);
      // Подсказка: какую ноту вы сейчас поёте.
      if (now - lastPitch > 120) {
        lastPitch = now;
        const x = ac.sampleRate > 16000 ? T.resample(buf, ac.sampleRate, 16000) : buf;
        const p = T.analyzePitch(x, Math.min(ac.sampleRate, 16000));
        const k = p.f0.length - 1;
        $('recNote').textContent = k >= 0 && p.ap[k] < 0.3 && p.db[k] > -50 ? T.noteNameRu(Math.round(69 + 12 * Math.log2(p.f0[k] / 440)), 0, false) : '';
      }
      recState.raf = raf = requestAnimationFrame(loop);
    };
    recState.raf = requestAnimationFrame(loop);
    rec.start(250);
    $('recNote').textContent = '';
    $('recorder').hidden = false;
  };
  function endRecording(keep) {
    if (!recState) return;
    const { stream, rec, chunks, src, raf } = recState;
    recState = null;
    cancelAnimationFrame(raf);
    $('recorder').hidden = true;
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      try { src.disconnect(); } catch {}
      if (!keep) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const d = new Date();
      processAudio(() => blob.arrayBuffer(), `Запись ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
    };
    rec.stop();
  }
  $('recStop').onclick = () => endRecording(true);
  $('recCancel').onclick = () => endRecording(false);

  // ---------- Ноты ----------
  function resegment() {
    S.notes = T.segmentNotes(S.track, { tune: S.opt.tune });
    S.curve = S.opt.tune ? (() => { const tc = T.tuningCurve(S.track.midi, S.track.frameTime); return S.track.midi.map((v, i) => v - tc[i]); })() : S.track.midi;
    S.history = [];
    S.sel = null;
  }

  function render() {
    const o = S.opt;
    S.score = T.quantize(S.notes, o);
    const { abc, map } = T.toABC(S.score, S.title);
    S.abc = abc;
    const has = S.score.events.some((e) => e.midi != null);
    $('noNotes').hidden = has;
    $('score').hidden = !has;
    if (has) drawScore(abc, map); else $('score').innerHTML = '';
    updateControls();
    updateSummary();
    drawRoll();
    updateEditor();
  }

  function drawScore(abc, map) {
    const el = $('score');
    const w = el.parentElement.clientWidth - 12;
    const tunes = window.ABCJS.renderAbc(el, abc, {
      responsive: 'resize',
      add_classes: true,
      staffwidth: Math.max(280, w),
      wrap: { minSpacing: 1.5, maxSpacing: 2.5, preferredMeasuresPerLine: w < 560 ? 2 : 4 },
      paddingtop: 4, paddingbottom: 8, paddingleft: 4, paddingright: 4,
      selectionColor: '#d9480f',
      clickListener: (abcelem) => {
        const hit = findMap(map, abcelem);
        if (hit) select(hit.src, true); else select(null);
      },
    });
    // Какие элементы SVG принадлежат какой ноте записи (нота с лигами — несколько).
    S.elems = new Map();
    const tune = tunes[0];
    for (const line of tune?.lines || []) for (const st of line.staff || []) for (const v of st.voices || []) for (const e of v) {
      if (e.el_type !== 'note' || !e.abselem) continue;
      const hit = findMap(map, e);
      if (!hit) continue;
      if (!S.elems.has(hit.src)) S.elems.set(hit.src, []);
      S.elems.get(hit.src).push(...(e.abselem.elemset || []));
    }
    mark('sel', S.sel);
  }

  // abcjs включает в ноту пробел перед ней, поэтому ищем по пересечению диапазонов символов.
  function findMap(map, e) {
    if (e?.startChar == null) return null;
    return map.find((m) => e.startChar < m.end && e.endChar > m.start) || null;
  }

  function mark(cls, src) {
    document.querySelectorAll('#score .' + cls).forEach((n) => n.classList.remove(cls));
    if (src == null || !S.elems) return;
    for (const n of S.elems.get(src) || []) n.classList.add(cls);
  }

  function updateSummary() {
    const sc = S.score;
    const live = S.notes.filter((x) => !x.deleted);
    if (!live.length) { $('summary').textContent = ''; return; }
    const parts = [
      `Тональность <b>${T.keyNameRu(sc.key)}</b>`,
      `темп <b>♩ = ${Math.round(sc.bpm)}</b>`,
      `размер <b>${sc.meter[0]}/${sc.meter[1]}</b>`,
      `нот: <b>${live.length}</b>`,
    ];
    if (sc.range) parts.push(`диапазон <b>${T.noteNameRu(sc.range.low, sc.key.fifths)} — ${T.noteNameRu(sc.range.high, sc.key.fifths)}</b>`);
    if (S.opt.tune) {
      const c = Math.round(T.median(live.map((x) => x.tuning)) * 100);
      if (Math.abs(c) >= 10) parts.push(`голос ${c > 0 ? 'выше' : 'ниже'} строя примерно на ${Math.abs(c)} цент.`);
    }
    $('summary').innerHTML = parts.join(' · ');
  }

  // ---------- Настройки ----------
  const keyOptions = (() => {
    const out = [];
    for (const mode of ['major', 'minor']) for (let f = -6; f <= 6; f++) {
      const k = T.keyFromFifths(f, mode);
      const sig = f === 0 ? 'без знаков' : f > 0 ? f + '♯' : -f + '♭';
      out.push({ v: `${f}:${mode}`, label: `${T.keyNameRu(k)} (${sig})` });
    }
    return out;
  })();
  function fillKeySelect() {
    const sel = $('key');
    sel.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = 'auto';
    sel.append(auto);
    for (const k of keyOptions) { const o = document.createElement('option'); o.value = k.v; o.textContent = k.label; sel.append(o); }
  }
  fillKeySelect();

  function pickupLen() { const mi = S.score.mi; return mod(mi.barUnits - S.score.pickup, mi.barUnits); }
  function fmtPickup(len) {
    if (!len) return 'нет';
    if (len % 2) return `${len}/16`;
    return `${len / 2}/8`;
  }

  function updateControls() {
    const o = S.opt, sc = S.score;
    $('bpmVal').textContent = Math.round(sc.bpm);
    $('bpmVal').parentElement.classList.toggle('changed', o.bpm != null);
    $('bpmAuto').disabled = o.bpm == null;
    for (const b of $('meter').children) b.setAttribute('aria-checked', String(b.dataset.v === sc.meter.join('/')));
    for (const b of $('step').children) b.setAttribute('aria-checked', String(+b.dataset.v === sc.step));
    $('pickVal').textContent = fmtPickup(pickupLen());
    $('pickVal').parentElement.classList.toggle('changed', o.pickup != null);
    $('pickAuto').disabled = o.pickup == null;
    $('key').options[0].textContent = `Авто: ${T.keyNameRu(sc.key)}`;
    $('key').value = o.key ? `${o.key.fifths}:${o.key.mode}` : 'auto';
    $('clef').options[0].textContent = 'Авто: ' + { treble: 'скрипичный', 'treble-8': 'скрипичный октавой ниже', bass: 'басовый' }[sc.clef];
    $('clef').value = o.clef || 'auto';
    $('trVal').textContent = o.transpose > 0 ? '+' + o.transpose : String(o.transpose);
    $('trVal').parentElement.classList.toggle('changed', o.transpose !== 0);
    $('tune').checked = o.tune;
  }

  const setOpt = (patch) => { Object.assign(S.opt, patch); stopPlay(); render(); };
  $('bpmDown').onclick = () => setOpt({ bpm: clamp(Math.round(S.score.bpm) - 1, 30, 260) });
  $('bpmUp').onclick = () => setOpt({ bpm: clamp(Math.round(S.score.bpm) + 1, 30, 260) });
  $('bpmHalf').onclick = () => setOpt({ bpm: clamp(Math.round(S.score.bpm / 2), 30, 260), pickup: null });
  $('bpmDouble').onclick = () => setOpt({ bpm: clamp(Math.round(S.score.bpm * 2), 30, 260), pickup: null });
  $('bpmAuto').onclick = () => setOpt({ bpm: null, pickup: null });
  $('meter').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (v) setOpt({ meter: v.split('/').map(Number), pickup: null }); };
  $('step').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (v) setOpt({ step: +v }); };
  const movePickup = (dir) => {
    const mi = S.score.mi, unit = S.score.step;
    const len = clamp(pickupLen() + dir * unit, 0, mi.barUnits - unit);
    setOpt({ pickup: mod(mi.barUnits - len, mi.barUnits) });
  };
  $('pickDown').onclick = () => movePickup(-1);
  $('pickUp').onclick = () => movePickup(1);
  $('pickAuto').onclick = () => setOpt({ pickup: null });
  $('key').onchange = (e) => {
    const v = e.target.value;
    if (v === 'auto') return setOpt({ key: null });
    const [f, mode] = v.split(':');
    setOpt({ key: { fifths: +f, mode } });
  };
  $('clef').onchange = (e) => setOpt({ clef: e.target.value === 'auto' ? null : e.target.value });
  const transpose = (d) => {
    const o = S.opt, t = clamp(o.transpose + d, -12, 12);
    if (t === o.transpose) return;
    // Выбранная вручную тональность сдвигается вместе с нотами.
    let key = o.key;
    if (key) {
      const k = T.keyFromFifths(key.fifths, key.mode);
      const tonic = mod(k.tonic + (t - o.transpose), 12);
      key = { fifths: T.majorFifths(key.mode === 'minor' ? tonic + 3 : tonic), mode: key.mode };
    }
    setOpt({ transpose: t, key });
  };
  $('trDown').onclick = () => transpose(-1);
  $('trUp').onclick = () => transpose(1);
  $('tune').onchange = (e) => { S.opt.tune = e.target.checked; stopPlay(); resegment(); render(); };

  let titleTimer;
  $('title').oninput = (e) => {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { S.title = e.target.value.trim(); render(); }, 500);
  };

  // ---------- Правка нот ----------
  function select(src, audible) {
    S.sel = src;
    mark('sel', src);
    updateEditor();
    drawRoll();
    if (src != null && audible) {
      const x = S.notes[src];
      const ac = audio();
      tone(ac, ac.destination, x.midi + (x.shift || 0) + S.opt.transpose, ac.currentTime + 0.02, 0.45);
    }
  }
  function updateEditor() {
    const x = S.sel != null ? S.notes[S.sel] : null;
    $('editor').hidden = !x || x.deleted;
    if (!x || x.deleted) return;
    const midi = x.midi + (x.shift || 0) + S.opt.transpose;
    $('selInfo').textContent = `${T.noteNameRu(midi, S.score.key.fifths)} · на ${fmtSec(x.start)} записи`;
  }
  function edit(fn) {
    S.history.push(S.notes.map((x) => [x.shift || 0, !!x.deleted]));
    if (S.history.length > 100) S.history.shift();
    fn(S.notes[S.sel]);
    $('undo').disabled = false;
    stopPlay();
    render();
  }
  const shiftSel = (d) => edit((x) => { x.shift = (x.shift || 0) + d; });
  $('eDown').onclick = () => { shiftSel(-1); select(S.sel, true); };
  $('eUp').onclick = () => { shiftSel(1); select(S.sel, true); };
  $('eOctDown').onclick = () => { shiftSel(-12); select(S.sel, true); };
  $('eOctUp').onclick = () => { shiftSel(12); select(S.sel, true); };
  $('eDel').onclick = () => { edit((x) => { x.deleted = true; }); select(null); };
  $('eDone').onclick = () => select(null);
  $('undo').onclick = () => {
    const snap = S.history.pop();
    if (!snap) return;
    S.notes.forEach((x, i) => { x.shift = snap[i][0]; x.deleted = snap[i][1]; });
    $('undo').disabled = !S.history.length;
    stopPlay();
    render();
  };

  // ---------- Высота голоса и ноты по времени ----------
  const PPS = 80; // пикселей в секунду
  function rollGeom() {
    const live = S.notes.filter((x) => !x.deleted);
    const pitches = live.map((x) => x.midi + (x.shift || 0));
    let lo = pitches.length ? Math.min(...pitches) : 57, hi = pitches.length ? Math.max(...pitches) : 69;
    lo -= 3; hi += 3;
    if (hi - lo < 14) { const c = (hi + lo) / 2; lo = c - 7; hi = c + 7; }
    const H = 180;
    return { lo, hi, H, y: (m) => H - (m - lo) / (hi - lo) * H, px: H / (hi - lo) };
  }
  function drawRoll() {
    const cv = $('roll');
    const wrap = $('rollWrap');
    const dur = S.buf.duration;
    const W = Math.max(wrap.clientWidth, Math.ceil(dur * PPS));
    const g = rollGeom();
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = g.H * dpr;
    cv.style.width = W + 'px'; cv.style.height = g.H + 'px';
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim(), acc = css.getPropertyValue('--acc').trim();
    // Полосы чёрных клавиш и подписи «до».
    for (let m = Math.floor(g.lo); m <= Math.ceil(g.hi); m++) {
      if ([1, 3, 6, 8, 10].includes(mod(m, 12))) { c.fillStyle = line; c.globalAlpha = 0.35; c.fillRect(0, g.y(m + 0.5), W, g.px); c.globalAlpha = 1; }
      if (mod(m, 12) === 0) {
        c.fillStyle = muted; c.font = '11px system-ui, sans-serif';
        for (let x = 4; x < W; x += 600) c.fillText(T.noteNameEn(m), x, clamp(g.y(m) + 4, 12, g.H - 3));
      }
    }
    // Голос.
    const tr = S.track;
    c.strokeStyle = muted; c.lineWidth = 1.5; c.globalAlpha = 0.9;
    c.beginPath();
    let pen = false;
    for (let i = 0; i < S.curve.length; i++) {
      const v = S.curve[i];
      if (Number.isNaN(v)) { pen = false; continue; }
      const x = (tr.t0 + i * tr.frameTime) * PPS, y = g.y(v);
      if (pen) c.lineTo(x, y); else c.moveTo(x, y);
      pen = true;
    }
    c.stroke();
    c.globalAlpha = 1;
    // Ноты.
    for (const x of S.notes) {
      if (x.deleted) continue;
      const m = x.midi + (x.shift || 0);
      c.fillStyle = x.id === S.sel ? '#d9480f' : acc;
      c.globalAlpha = x.id === S.sel ? 0.95 : 0.7;
      const xs = x.start * PPS, w = Math.max(3, (x.end - x.start) * PPS - 1);
      c.beginPath();
      if (c.roundRect) c.roundRect(xs, g.y(m + 0.5), w, g.px, 3); else c.rect(xs, g.y(m + 0.5), w, g.px);
      c.fill();
    }
    c.globalAlpha = 1;
  }
  $('roll').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - r.left) / PPS, g = rollGeom(), y = e.clientY - r.top;
    const hit = S.notes.find((x) => !x.deleted && t >= x.start && t <= x.end && Math.abs(g.y(x.midi + (x.shift || 0)) - y) < g.px * 1.5);
    select(hit ? hit.id : null, !!hit);
    if (hit) scrollToNote(hit.id);
  };
  function scrollToNote(src) {
    const el = (S.elems?.get(src) || [])[0];
    if (el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > innerHeight - 40) window.scrollBy({ top: r.top - innerHeight / 3, behavior: 'smooth' });
    }
  }

  let cursor;
  function rollCursor(t) {
    const wrap = $('rollWrap');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:var(--text);pointer-events:none';
      wrap.style.position = 'relative';
      wrap.append(cursor);
    }
    cursor.hidden = t == null;
    if (t == null) return;
    const x = t * PPS;
    cursor.style.left = x + 'px';
    if (x < wrap.scrollLeft + 20 || x > wrap.scrollLeft + wrap.clientWidth - 40) wrap.scrollLeft = x - 40;
  }

  // ---------- Прослушивание ----------
  let play = null;
  function stopPlay() {
    if (!play) return;
    for (const n of play.nodes) { try { n.stop(); } catch {} }
    try { play.out.disconnect(); } catch {}
    cancelAnimationFrame(play.raf);
    play = null;
    mark('now', null);
    rollCursor(null);
    $('playScore').classList.remove('playing');
    $('playCompare').classList.remove('playing');
    $('playScore').querySelector('span').textContent = 'Ноты';
    $('playCompare').querySelector('span').textContent = 'Запись + ноты';
  }
  function startPlay(kind) {
    const was = play?.kind;
    stopPlay();
    if (was === kind) return;
    const ac = audio();
    const out = ac.createGain();
    out.connect(ac.destination);
    const t0 = ac.currentTime + 0.12;
    const nodes = [];
    let items, end, rollTime;
    if (kind === 'score') {
      const sec = 60 / S.score.bpm / T.UPQ;
      items = S.score.events.filter((e) => e.midi != null).map((e) => ({ t: e.pos * sec, d: e.len * sec, midi: e.midi, src: e.src }));
      end = S.score.events.reduce((a, e) => Math.max(a, (e.pos + e.len) * sec), 0);
      rollTime = null;
    } else {
      items = S.notes.filter((x) => !x.deleted).map((x) => ({ t: x.start, d: x.end - x.start, midi: x.midi + (x.shift || 0), src: x.id }));
      end = S.buf.duration;
      const src = ac.createBufferSource();
      src.buffer = S.buf;
      const g = ac.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(out);
      src.start(t0);
      nodes.push(src);
      rollTime = (t) => t;
    }
    const vol = kind === 'score' ? 0.25 : 0.12;
    for (const it of items) nodes.push(...tone(ac, out, it.midi, t0 + it.t, it.d, vol));
    const btn = $(kind === 'score' ? 'playScore' : 'playCompare');
    btn.classList.add('playing');
    btn.querySelector('span').textContent = 'Стоп';
    play = { kind, nodes, out, raf: 0 };
    let cur = -1;
    const tick = () => {
      if (!play) return;
      const t = ac.currentTime - t0;
      if (t > end + 0.2) { stopPlay(); return; }
      let k = -1;
      for (let i = 0; i < items.length; i++) { if (items[i].t <= t && t < items[i].t + items[i].d) { k = i; break; } }
      if (k !== cur) { cur = k; mark('now', k >= 0 ? items[k].src : null); }
      if (rollTime) rollCursor(Math.max(0, rollTime(t)));
      play.raf = requestAnimationFrame(tick);
    };
    play.raf = requestAnimationFrame(tick);
  }
  $('playScore').onclick = () => startPlay('score');
  $('playCompare').onclick = () => startPlay('compare');

  // ---------- Сохранение ----------
  const fileName = () => (S.title || 'Мелодия').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Мелодия';
  function download(data, type, ext) {
    const blob = new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName() + ext;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  $('expXml').onclick = () => download(T.toMusicXML(S.score, S.title || 'Мелодия'), 'application/vnd.recordare.musicxml+xml', '.musicxml');
  $('expMidi').onclick = () => download(T.toMIDI(S.score), 'audio/midi', '.mid');
  $('expAbc').onclick = () => download(S.abc, 'text/plain;charset=utf-8', '.abc');
  $('expPrint').onclick = () => { select(null); window.print(); };

  $('back').onclick = () => { stopPlay(); S = null; show('start'); };

  let lastW = 0, resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = $('result').clientWidth;
      if (S && !$('result').hidden && Math.abs(w - lastW) > 30) { lastW = w; render(); }
    }, 200);
  });

  // ---------- Установка (PWA) ----------
  let installEvt;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  $('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBtn').hidden = true; };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !navigator.standalone) $('iosHint').hidden = false;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // Для проверки в браузере.
  window.__notes = { get state() { return S; }, processAudio };
})();

// Распознавание одноголосной мелодии: высота тона (YIN), ноты, темп, такты,
// тональность и запись в ABC (для показа), MusicXML и MIDI.
// Работает и в браузере (window.Transcribe / self.Transcribe в воркере), и в Node (require).
(function (root) {
  'use strict';

  // ---------- Общее ----------
  const FMIN = 65, FMAX = 1100;         // C2 … C#6: от баса до сопрано
  // Настройки эвристик ритма (подобраны на народных мелодиях, см. tools/bench.js).
  const P = { tempoCenter: 90, tempoWidth: 0.6, pickBonus: 0.1, wDown: 3, wHalf: 1.5, wBeat: 1, lastMul: 1, tuneShiftCost: 0.3 };
  const UPQ = 4;                        // единица ритма — шестнадцатая, 4 на четверть
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod = (a, n) => ((a % n) + n) % n;
  const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

  function median(arr) {
    const a = Array.from(arr).filter((v) => !Number.isNaN(v)).sort((x, y) => x - y);
    if (!a.length) return NaN;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function percentile(arr, p) {
    const a = Array.from(arr).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
    if (!a.length) return NaN;
    return a[clamp(Math.round(p * (a.length - 1)), 0, a.length - 1)];
  }

  // ---------- 1. Высота тона ----------
  // Срез низов ниже ~60 Гц (гул, удары по микрофону).
  function highpass(x, sr, fc) {
    const y = new Float32Array(x.length);
    const a = Math.exp(-2 * Math.PI * fc / sr);
    let px = 0, py = 0;
    for (let i = 0; i < x.length; i++) { py = a * (py + x[i] - px); px = x[i]; y[i] = py; }
    return y;
  }

  // Понижение частоты дискретизации: фильтр (две ступени биквада, срез 0,42·sr) и линейная интерполяция.
  function resample(x, srIn, srOut) {
    if (srIn <= srOut) return x;
    let y = x;
    const fc = 0.42 * srOut, w = 2 * Math.PI * fc / srIn, cw = Math.cos(w), al = Math.sin(w) / (2 * 0.7071);
    const b0 = (1 - cw) / 2 / (1 + al), b1 = (1 - cw) / (1 + al), a1 = -2 * cw / (1 + al), a2 = (1 - al) / (1 + al);
    for (let pass = 0; pass < 2; pass++) {
      const z = new Float32Array(y.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) {
        const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = y[i]; y2 = y1; y1 = v; z[i] = v;
      }
      y = z;
    }
    const n = Math.floor(y.length * srOut / srIn), out = new Float32Array(n), r = srIn / srOut;
    for (let i = 0; i < n; i++) { const p = i * r, k = Math.floor(p), f = p - k; out[i] = y[k] * (1 - f) + (y[k + 1] ?? y[k]) * f; }
    return out;
  }

  // YIN (de Cheveigné, Kawahara, 2002) с шагом 10 мс.
  // Возвращает частоту, «непериодичность» (0 — чистый тон, 1 — шум) и громкость каждого кадра.
  function analyzePitch(x, sr, onProgress) {
    const y = highpass(x, sr, 60);
    const hop = Math.round(sr * 0.01);
    const W = Math.round(sr * 0.03);
    const tauMin = Math.max(2, Math.floor(sr / FMAX));
    const tauMax = Math.ceil(sr / FMIN);
    const n = Math.max(0, Math.floor((y.length - W - tauMax - 2) / hop) + 1);
    const f0 = new Float32Array(n), ap = new Float32Array(n).fill(1), db = new Float32Array(n);

    for (let f = 0; f < n; f++) {
      const s = f * hop;
      let e = 0;
      for (let j = 0; j < W; j++) e += y[s + j] * y[s + j];
      db[f] = 10 * Math.log10(e / W + 1e-12);
    }
    // В тишине высоту не ищем.
    const gate = Math.max(-70, percentile(db, 0.95) - 45);

    const d = new Float64Array(tauMax + 2);
    for (let f = 0; f < n; f++) {
      if (onProgress && f % 500 === 0) onProgress(f / n);
      if (db[f] < gate) continue;
      const s = f * hop;
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        let sum = 0;
        for (let j = 0; j < W; j++) { const v = y[s + j] - y[s + j + tau]; sum += v * v; }
        d[tau] = sum;
      }
      // Нормированная разность (CMND).
      d[0] = 1;
      let run = 0;
      for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; d[tau] = run > 0 ? d[tau] * tau / run : 1; }

      let tau = -1;
      for (let t = tauMin; t <= tauMax; t++) {
        if (d[t] < 0.15) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
      }
      if (tau < 0) {
        // Нет явного провала: берём самый короткий период из почти лучших,
        // иначе голос «проваливается» на октаву вниз (кратный период).
        let best = tauMin;
        for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
        tau = best;
        for (let t = tauMin + 1; t < best; t++) {
          if (d[t] < d[t - 1] && d[t] <= d[t + 1] && d[t] < d[best] + 0.1) { tau = t; break; }
        }
      }
      // Уточняем минимум параболой.
      let tt = tau;
      if (tau > 1 && tau <= tauMax) {
        const a = d[tau - 1], b = d[tau], c = d[tau + 1];
        const den = a - 2 * b + c;
        if (den > 0) tt = tau + clamp(0.5 * (a - c) / den, -1, 1);
      }
      f0[f] = sr / tt;
      ap[f] = clamp(d[tau], 0, 1);
    }
    if (onProgress) onProgress(1);
    return { sr, hop, win: W, f0, ap, db, frameTime: hop / sr, t0: W / 2 / sr };
  }

  // Высота в полутонах MIDI по кадрам (NaN — нет голоса), с чисткой ошибок.
  function pitchTrack(p, opts = {}) {
    const n = p.f0.length;
    const apMax = opts.apMax ?? 0.3;
    const loud = percentile(Array.from(p.db).filter((_, i) => p.ap[i] < apMax), 0.95);
    const gate = (Number.isFinite(loud) ? loud : -40) - (opts.range ?? 35);
    const m = new Float32Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (p.ap[i] < apMax && p.db[i] > gate && p.f0[i] >= FMIN * 0.97 && p.f0[i] <= FMAX * 1.03) m[i] = hzToMidi(p.f0[i]);
    }
    removeShortRuns(m, 3);

    // Октавные ошибки: кадр на октаву выше/ниже окружения переносим обратно.
    const ref = medianFilter(m, 15);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(m[i]) || Number.isNaN(ref[i])) continue;
      const diff = m[i] - ref[i];
      if (Math.abs(diff) > 9) {
        const k = Math.round(diff / 12);
        if (k && Math.abs(diff - 12 * k) < 2.5) m[i] -= 12 * k;
      }
    }
    const out = medianFilter(m, 2);
    for (let i = 0; i < n; i++) if (Number.isNaN(m[i])) out[i] = NaN;
    return { midi: out, db: p.db, frameTime: p.frameTime, t0: p.t0, gate, loud };
  }

  function removeShortRuns(m, minLen) {
    let i = 0;
    while (i < m.length) {
      if (Number.isNaN(m[i])) { i++; continue; }
      let j = i;
      while (j < m.length && !Number.isNaN(m[j])) j++;
      if (j - i < minLen) for (let k = i; k < j; k++) m[k] = NaN;
      i = j;
    }
  }

  // Медиана по окну ±r среди озвученных кадров.
  function medianFilter(m, r) {
    const out = new Float32Array(m.length).fill(NaN);
    const buf = [];
    for (let i = 0; i < m.length; i++) {
      buf.length = 0;
      for (let k = Math.max(0, i - r); k <= Math.min(m.length - 1, i + r); k++) if (!Number.isNaN(m[k])) buf.push(m[k]);
      if (buf.length) { buf.sort((a, b) => a - b); out[i] = buf[buf.length >> 1]; }
    }
    return out;
  }

  // ---------- 2. Строй ----------
  // Поющий голос редко попадает ровно в A = 440 Гц и часто «уплывает» по ходу песни.
  // Считаем сдвиг строя скользящим окном (±8 с) как круговое среднее дробной части высоты.
  function tuningCurve(m, frameTime) {
    const n = m.length;
    const step = Math.max(1, Math.round(1 / frameTime));
    const half = Math.round(8 / frameTime);
    const centers = [], offs = [];
    for (let c = 0; c < n + step; c += step) {
      let cs = 0, sn = 0, cnt = 0;
      for (let i = Math.max(0, c - half); i < Math.min(n, c + half); i++) {
        if (Number.isNaN(m[i])) continue;
        cs += Math.cos(2 * Math.PI * m[i]); sn += Math.sin(2 * Math.PI * m[i]); cnt++;
      }
      if (cnt >= 150 && c < n) { centers.push(c); offs.push(Math.atan2(sn, cs) / (2 * Math.PI)); }
    }
    const out = new Float32Array(n);
    if (!offs.length) return out;
    for (let k = 1; k < offs.length; k++) {          // без скачков через ±0,5
      while (offs[k] - offs[k - 1] > 0.5) offs[k] -= 1;
      while (offs[k] - offs[k - 1] < -0.5) offs[k] += 1;
      // Строй уходит медленно: не больше 0,08 полутона в секунду.
      const lim = 0.08 * (centers[k] - centers[k - 1]) * frameTime;
      offs[k] = clamp(offs[k], offs[k - 1] - lim, offs[k - 1] + lim);
    }
    // Шум (призвуки, подпевки) может накопить «уход» больше полутона — возвращаем
    // середину в пределы ±0,5, иначе все ноты сдвинутся на полутон.
    const shift = Math.round(median(offs));
    for (let k = 0; k < offs.length; k++) offs[k] -= shift;
    let k = 0;
    for (let i = 0; i < n; i++) {
      while (k < centers.length - 1 && centers[k + 1] <= i) k++;
      if (i <= centers[0]) out[i] = offs[0];
      else if (k >= centers.length - 1) out[i] = offs[offs.length - 1];
      else { const a = (i - centers[k]) / (centers[k + 1] - centers[k]); out[i] = offs[k] * (1 - a) + offs[k + 1] * a; }
    }
    return out;
  }

  // ---------- 3. Ноты ----------
  // Делим озвученные участки на ноты: по смене высоты (с гистерезисом, чтобы не дробить
  // вибрато и подъезды) и по провалам громкости (повтор одной ноты на новом слоге).
  function segmentNotes(track, opts = {}) {
    const ft = track.frameTime;
    const tuning = opts.tune === false ? new Float32Array(track.midi.length) : tuningCurve(track.midi, ft);
    const m = track.midi.map((v, i) => v - tuning[i]);
    const minF = Math.max(3, Math.round((opts.minNote ?? 0.09) / ft));
    const maxGap = 3;
    const n = m.length;
    const sm = medianFilter(m, 5);
    const dbs = smooth(track.db, 2);
    const runs = [];

    let i = 0;
    while (i < n) {
      if (Number.isNaN(m[i])) { i++; continue; }
      // Участок голоса: короткие провалы (до 30 мс) не разрывают его.
      let j = i, last = i;
      while (j < n) {
        if (!Number.isNaN(m[j])) last = j;
        else if (j - last > maxGap) break;
        j++;
      }
      const a = i, b = last + 1;
      i = b;

      const rs = segmentRegion(m, sm, a, b, ft, minF);
      for (const r of rs) runs.push(...splitByEnergy(r, dbs, minF, ft));
    }

    // Высота ноты — медиана середины, без подъезда и спада.
    let notes = runs.map((r) => {
      const len = r.b - r.a, cut = Math.floor(len * 0.2);
      const mid = median(m.subarray(r.a + cut, r.b - cut));
      const pitch = Number.isNaN(mid) ? median(m.subarray(r.a, r.b)) : mid;
      let peak = -Infinity;
      for (let k = r.a; k < r.b; k++) peak = Math.max(peak, track.db[k]);
      return {
        start: track.t0 + (r.a - 0.5) * ft, end: track.t0 + (r.b - 0.5) * ft,
        pitch, midi: Math.round(pitch), attack: r.attack, peak,
        tuning: tuning[(r.a + r.b) >> 1],
      };
    }).filter((x) => !Number.isNaN(x.pitch));

    notes = cleanNotes(notes, track.loud);
    if (opts.tune !== false) diatonicTune(notes);

    // Соседние куски одной высоты без новой атаки — одна нота.
    const merged = [];
    for (const x of notes) {
      const p = merged[merged.length - 1];
      if (p && !x.attack && p.midi === x.midi && x.start - p.end < 0.05) { p.end = x.end; p.peak = Math.max(p.peak, x.peak); }
      else merged.push(x);
    }
    const minLen = opts.minNote ?? 0.09;
    notes = merged.filter((x) => x.end - x.start >= minLen * 0.75);
    notes.forEach((x, k) => { x.id = k; x.cents = Math.round((x.pitch - x.midi) * 100); });
    return notes;
  }

  // Чистка по контексту (ближайшие ±4 с):
  // - тихие ноты — призвуки, подпевки, остатки инструментов после разделения;
  // - нота на октаву (или октаву с квинтой) в стороне от обеих соседних — ошибка высоты, переносим.
  function cleanNotes(notes, loud) {
    const W = 4;
    const near = (x) => notes.filter((y) => y !== x && y.end > x.start - W && y.start < x.end + W);
    const keep = notes.filter((x) => {
      if (Number.isFinite(loud) && x.peak < loud - 28) return false;
      const ctx = near(x);
      const localMax = Math.max(-Infinity, ...ctx.map((y) => y.peak));
      return !(ctx.length >= 3 && x.peak < localMax - 25);
    });
    keep.forEach((x, i) => {
      const a = keep[i - 1], b = keep[i + 1];
      if (!a || !b || x.start - a.end > 1.5 || b.start - x.end > 1.5) return;
      if (Math.abs(x.pitch - a.pitch) < 9.5 || Math.abs(x.pitch - b.pitch) < 9.5) return;
      for (const sh of [12, -12, 19, -19, 24, -24]) {
        if (Math.abs(x.pitch + sh - a.pitch) <= 5 && Math.abs(x.pitch + sh - b.pitch) <= 5) { x.pitch += sh; x.midi += sh; break; }
      }
    });
    return keep;
  }

  // Голос, который поёт почти на четверть тона мимо, даёт ноты на границе полутонов.
  // Уточняем сдвиг строя так, чтобы больше звучания попадало в один диатонический звукоряд
  // (простые мелодии в основном диатоничны); далёкий сдвиг немного штрафуется.
  function diatonicTune(notes) {
    if (notes.length < 6) return;
    let best = 0, bs = -Infinity;
    for (let d = -0.45; d <= 0.4501; d += 0.03) {
      const h = new Array(12).fill(0);
      let tot = 0;
      for (const x of notes) { const w = Math.min(1, x.end - x.start); h[mod(Math.round(x.pitch - d), 12)] += w; tot += w; }
      let fit = 0;
      for (let r = 0; r < 12; r++) fit = Math.max(fit, SCALE_MAJ.reduce((a, k) => a + h[(r + k) % 12], 0));
      const score = fit / tot - P.tuneShiftCost * Math.abs(d);
      if (score > bs + 1e-9) { bs = score; best = d; }
    }
    for (const x of notes) { x.pitch -= best; x.midi = Math.round(x.pitch); x.tuning += best; }
  }

  function smooth(a, r) {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) { s += a[k]; c++; }
      out[i] = s / c;
    }
    return out;
  }

  // Участок голоса → ноты. Граница ставится там, где высота устойчиво (5+ кадров)
  // ушла больше чем на 0,6 полутона от медианы последних 200 мс текущей ноты.
  // Короткие куски потом раздаются соседям: скольжение между нотами — по середине
  // интервала, подъезд в начале — следующей ноте, случайный выброс — ближайшей по высоте.
  function segmentRegion(m, sm, a, b, ft, minF) {
    const THR = 0.6, K = 5, WIN = Math.round(0.2 / ft);
    const cuts = [a];
    let start = a, dev = 0;
    for (let k = a; k < b; k++) {
      const v = sm[k];
      if (Number.isNaN(v)) continue;
      const from = Math.max(start, k - dev - WIN), to = k - dev;
      if (to - from >= 3) {
        const ref = median(sm.subarray(from, to));
        if (Math.abs(v - ref) > THR) dev++; else dev = 0;
        if (dev >= K) { start = k - K + 1; cuts.push(start); dev = 0; }
      }
    }
    cuts.push(b);
    let segs = [];
    for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] > cuts[i]) segs.push({ a: cuts[i], b: cuts[i + 1] });
    const med = (g) => { const v = median(m.subarray(g.a, g.b)); return Number.isNaN(v) ? median(sm.subarray(g.a, g.b)) : v; };
    const plateau = (g) => {
      let c = 0, t = 0;
      for (let k = g.a; k < g.b; k++) if (!Number.isNaN(m[k])) { t++; if (Math.abs(m[k] - g.med) <= 0.3) c++; }
      return t ? c / t : 0;
    };
    segs.forEach((g) => { g.med = med(g); });
    const maxTrans = Math.round(0.16 / ft);
    const isShort = (g, i) => {
      const len = g.b - g.a;
      if (len < minF) return true;
      // Скольжение: недолго, высота между соседями и без ровного участка.
      const p = segs[i - 1], q = segs[i + 1];
      if (len >= maxTrans || plateau(g) >= 0.6) return false;
      // Подъезд в начале или спад в конце участка голоса.
      if (!p || !q) return true;
      return (g.med - p.med) * (q.med - g.med) > 0;
    };
    for (;;) {
      if (segs.length < 2) break;
      let si = -1;
      for (let i = 0; i < segs.length; i++) if (isShort(segs[i], i) && (si < 0 || segs[i].b - segs[i].a < segs[si].b - segs[si].a)) si = i;
      if (si < 0) break;
      const g = segs[si], p = segs[si - 1], q = segs[si + 1];
      if (p && q && (g.med - p.med) * (q.med - g.med) > 0) {
        // Между нотами: делим по середине интервала.
        const mid = (p.med + q.med) / 2;
        let cut = g.a;
        while (cut < g.b && (Number.isNaN(sm[cut]) || (sm[cut] - mid) * (p.med - mid) > 0)) cut++;
        p.b = cut; q.a = cut;
      } else if (!p) { q.a = g.a; }
      else if (!q) { p.b = g.b; }
      else if (Math.abs(p.med - g.med) <= Math.abs(q.med - g.med)) p.b = g.b;
      else q.a = g.a;
      segs.splice(si, 1);
      for (const x of [p, q]) if (x) x.med = med(x);
      // Соседи одной высоты сливаются.
      for (let i = 1; i < segs.length; i++) {
        if (Math.round(segs[i].med) === Math.round(segs[i - 1].med)) { segs[i - 1].b = segs[i].b; segs[i - 1].med = med(segs[i - 1]); segs.splice(i, 1); i--; }
      }
    }
    // Вибрато: A–B–A с коротким B на соседней ступени — одна нота.
    for (let i = 1; i + 1 < segs.length; i++) {
      const A = segs[i - 1], B = segs[i], C = segs[i + 1];
      if (Math.round(A.med) === Math.round(C.med) && Math.abs(B.med - A.med) < 1.5 && B.b - B.a < maxTrans && plateau(B) < 0.6) {
        A.b = C.b; A.med = med(A); segs.splice(i, 2); i = Math.max(0, i - 2);
      }
    }
    return segs.map((g, i) => ({ a: g.a, b: g.b, label: Math.round(g.med), attack: i === 0 }));
  }

  // Провал громкости на 6+ дБ внутри ноты — новый слог (повтор ноты).
  function splitByEnergy(r, dbs, minF, ft) {
    const out = [];
    let a = r.a, attack = r.attack;
    const look = Math.round(0.2 / ft);
    for (let k = r.a + minF; k < r.b - minF; k++) {
      if (k - a < minF) continue;
      const v = dbs[k];
      let isMin = true;
      for (let q = k - 3; q <= k + 3; q++) if (dbs[q] < v) { isMin = false; break; }
      if (!isMin) continue;
      let left = -Infinity, right = -Infinity;
      for (let q = Math.max(a, k - look); q < k; q++) left = Math.max(left, dbs[q]);
      for (let q = k + 1; q < Math.min(r.b, k + look); q++) right = Math.max(right, dbs[q]);
      if (left - v >= 6 && right - v >= 6) {
        out.push({ a, b: k, label: r.label, attack });
        a = k; attack = true;
      }
    }
    out.push({ a, b: r.b, label: r.label, attack });
    return out;
  }

  // ---------- 4. Темп ----------
  // Ищем шаг сетки, на который лучше всего ложатся начала нот. Сравниваем только
  // близкие пары нот (до 3 с), поэтому медленный «уход» темпа не мешает.
  function estimateTempo(notes) {
    if (notes.length < 3) return 100;
    const t = notes.map((x) => x.start);
    const w = notes.map((x) => clamp(x.end - x.start, 0.1, 1));
    const pairs = [];
    for (let j = 0; j < t.length; j++) for (let k = j + 1; k < t.length && t[k] - t[j] < 3; k++) pairs.push([t[k] - t[j], w[j] * w[k]]);
    const R = (g) => {
      let s = 0, ws = 0;
      for (const [d, ww] of pairs) { s += ww * Math.cos(2 * Math.PI * d / g); ws += ww; }
      return ws ? Math.max(0, s / ws) : 0;
    };
    const score = (bpm) => {
      const b = 60 / bpm;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / P.tempoCenter) / P.tempoWidth, 2));
      return (R(b) + R(b / 2) + 0.5 * R(b / 4)) * prior;
    };
    let best = 100, bs = -1;
    for (let bpm = 40; bpm <= 200; bpm += 1) { const s = score(bpm); if (s > bs) { bs = s; best = bpm; } }
    for (let bpm = best - 1; bpm <= best + 1; bpm += 0.1) { const s = score(bpm); if (s > bs) { bs = s; best = bpm; } }
    return Math.round(best);
  }

  // ---------- 5. Тональность ----------
  // Профили Крумхансла–Кесслер по длительностям звучания.
  const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(a, b) {
    const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
    let n = 0, da = 0, dbb = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; }
    return da && dbb ? n / Math.sqrt(da * dbb) : 0;
  }
  // Число ключевых знаков мажора с тоникой pc: от −5 (ре-бемоль) до +6 (фа-диез).
  const majorFifths = (pc) => { const f = mod(pc * 7, 12); return f > 6 ? f - 12 : f; };
  // К корреляции добавляем: штраф за звуки вне лада (в миноре разрешены VI и VII повышенные)
  // и бонус, если мелодия кончается на тонике.
  const SCALE_MAJ = [0, 2, 4, 5, 7, 9, 11], SCALE_MIN = [0, 2, 3, 5, 7, 8, 9, 10, 11];
  function estimateKey(items) {
    const h = new Array(12).fill(0);
    let total = 0;
    for (const x of items) { h[mod(x.midi, 12)] += x.w; total += x.w; }
    const last = items.length ? mod(items[items.length - 1].midi, 12) : -1;
    let best = { fifths: 0, mode: 'major', tonic: 0 }, bs = -Infinity;
    for (let pc = 0; pc < 12; pc++) {
      const rot = (prof) => prof.map((_, i) => prof[mod(i - pc, 12)]);
      const out = (scale) => h.reduce((s, v, i) => s + (scale.includes(mod(i - pc, 12)) ? 0 : v), 0) / (total || 1);
      const bonus = pc === last ? 0.15 : 0;
      const cM = corr(h, rot(KK_MAJ)) - out(SCALE_MAJ) + bonus, cm = corr(h, rot(KK_MIN)) - out(SCALE_MIN) + bonus;
      if (cM > bs) { bs = cM; best = { fifths: majorFifths(pc), mode: 'major', tonic: pc }; }
      // ми-бемоль минор (6♭) пишут чаще, чем ре-диез минор (6♯)
      if (cm > bs) { bs = cm; const f = majorFifths(pc + 3); best = { fifths: f === 6 ? -6 : f, mode: 'minor', tonic: pc }; }
    }
    return best;
  }
  function keyFromFifths(fifths, mode) {
    const tonic = mode === 'minor' ? mod(fifths * 7 - 3, 12) : mod(fifths * 7, 12);
    return { fifths, mode, tonic };
  }

  // ---------- 6. Написание нот ----------
  const LOF = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // Положение на квинтовом круге, ближайшее к тональности: диатонические ноты пишутся
  // по ключу, хроматические — тем знаком, который ближе (при равенстве — диезом).
  function spell(midi, fifths) {
    const pc = mod(midi, 12);
    const center = fifths + 2;
    let p = mod(pc * 7, 12);          // 0..11
    let best = null;
    for (const c of [p - 12, p, p + 12]) {
      // Дубль-диезы и дубль-бемоли — только для ступеней самой тональности.
      const alt = Math.floor((c + 1) / 7);
      if (Math.abs(alt) > 1 && !(c >= fifths - 1 && c <= fifths + 5)) continue;
      const dist = Math.abs(c - center);
      if (!best || dist < best.dist || (dist === best.dist && c > best.p)) best = { p: c, dist };
    }
    p = best.p;
    const step = LOF[mod(p + 1, 7)];
    const alter = Math.floor((p + 1) / 7);
    const octave = Math.floor((midi - alter) / 12) - 1;
    return { step, alter, octave };
  }
  // Знак при ноте в ключе. Диезы: F C G D A E B, бемоли: B E A D G C F.
  function keyAlter(step, fifths) {
    const i = LOF.indexOf(step);
    if (fifths > 0 && i < fifths) return 1;
    if (fifths < 0 && 6 - i < -fifths) return -1;
    return 0;
  }

  const NAMES_RU = { C: 'до', D: 'ре', E: 'ми', F: 'фа', G: 'соль', A: 'ля', B: 'си' };
  const OCT_RU = ['субконтроктавы', 'контроктавы', 'большой октавы', 'малой октавы', 'первой октавы', 'второй октавы', 'третьей октавы', 'четвёртой октавы'];
  const accRu = (alter) => (alter === 1 ? '-диез' : alter === -1 ? '-бемоль' : alter === 2 ? '-дубль-диез' : alter === -2 ? '-дубль-бемоль' : '');
  function noteNameRu(midi, fifths = 0, withOctave = true) {
    const s = spell(midi, fifths);
    const name = NAMES_RU[s.step] + accRu(s.alter);
    return withOctave ? name + ' ' + (OCT_RU[s.octave] || '') : name;
  }
  function noteNameEn(midi, fifths = 0) {
    const s = spell(midi, fifths);
    return s.step + ({ 1: '♯', '-1': '♭', 2: '𝄪', '-2': '𝄫' }[s.alter] || '') + s.octave;
  }
  function keyNameRu(key) {
    const s = spell(key.tonic + 60, key.fifths);
    return NAMES_RU[s.step] + accRu(s.alter) + (key.mode === 'minor' ? ' минор' : ' мажор');
  }

  // ---------- 7. Ритм и такты ----------
  function meterInfo(meter) {
    const [num, den] = meter;
    const barUnits = num * 16 / den;
    const compound = den === 8 && num % 3 === 0 && num > 3;
    const beatUnits = compound ? 6 : 16 / den;
    return { num, den, barUnits, beatUnits, compound };
  }

  // Из нот (секунды) — события на сетке шестнадцатых. Темп немного подстраивается
  // по ходу, потому что без метронома поют неровно.
  // opts: bpm, meter [num, den], step (1 — до шестнадцатых, 2 — до восьмых, null — авто),
  //       pickup (null — авто), transpose, key ({fifths, mode} или null — авто), clef (null — авто)
  function quantize(allNotes, opts = {}) {
    const notes = allNotes.filter((x) => !x.deleted);
    const meter = opts.meter || [4, 4];
    const mi = meterInfo(meter);
    const bpm = opts.bpm || estimateTempo(notes);
    const step = opts.step || autoStep(notes, bpm);
    const transpose = opts.transpose || 0;
    const u0 = 60 / bpm / UPQ;
    const pitchOf = (x) => x.midi + (x.shift || 0) + transpose;

    if (!notes.length) {
      return finish([], { meter, mi, bpm, step, pickup: 0, key: opts.key ? keyFromFifths(opts.key.fifths, opts.key.mode) : keyFromFifths(0, 'major'), clef: opts.clef || 'treble', range: null });
    }

    const { q, uAt } = gridOnsets(notes, u0, step);
    // Концы нот: короткие паузы (вдох, согласная) поглощаются, длинные становятся паузами.
    const beatSec = 60 / bpm * mi.beatUnits / UPQ;
    const ends = notes.map((x, k) => {
      // Перед паузой голос затихает раньше, чем кончается нота: добавляем ~80 мс.
      let e = q[k] + Math.max(step, Math.round((x.end - x.start + 0.08) / uAt[k] / step) * step);
      if (k + 1 < notes.length) {
        const gap = notes[k + 1].start - x.end;
        if (e >= q[k + 1] || gap < Math.max(0.25, 0.35 * beatSec)) e = q[k + 1];
      }
      return e;
    });

    // Где тактовая черта: сильные доли должны приходиться на долгие ноты.
    let pickup = opts.pickup;
    if (pickup == null) {
      let best = 0, bs = -Infinity;
      const all = ends[ends.length - 1];
      for (let o = 0; o < mi.barUnits; o += Math.min(step, 2)) {
        let s = o === 0 ? P.pickBonus * all : 0; // без затакта, если нет явных причин
        q.forEach((p, k) => {
          const pos = mod(p + o, mi.barUnits), len = ends[k] - p;
          const w = pos === 0 ? P.wDown : (!mi.compound && mi.num === 4 && pos === 8) ? P.wHalf : pos % mi.beatUnits === 0 ? P.wBeat : 0;
          s += w * Math.min(len, mi.barUnits) * (k === notes.length - 1 ? P.lastMul : 1);
        });
        if (s > bs + 1e-9) { bs = s; best = o; }
      }
      pickup = best;
    }
    pickup = mod(pickup, mi.barUnits);

    const events = [];
    let pos = 0;
    notes.forEach((x, k) => {
      const s = q[k] + pickup, e = ends[k] + pickup;
      if (s > pos) events.push({ pos, len: s - pos, midi: null });
      events.push({ pos: s, len: e - s, midi: pitchOf(x), src: x.id });
      pos = e;
    });
    const total = Math.ceil(pos / mi.barUnits) * mi.barUnits;
    if (total > pos) events.push({ pos, len: total - pos, midi: null });

    const weighted = events.filter((ev) => ev.midi != null).map((ev) => ({ midi: ev.midi, w: ev.len }));
    const key = opts.key ? keyFromFifths(opts.key.fifths, opts.key.mode) : estimateKey(weighted);
    const pitches = weighted.map((x) => x.midi);
    const med = median(weighted.flatMap((x) => new Array(x.w).fill(x.midi)));
    const clef = opts.clef || chooseClef(weighted);
    const range = { low: Math.min(...pitches), high: Math.max(...pitches) };
    return finish(events, { meter, mi, bpm, step, pickup, key, clef, range });
  }

  // Начала нот на сетке (шаг step шестнадцатых); u — длина шестнадцатой в секундах.
  // Опорное время доли — посередине между предсказанным и спетым началом, чтобы одна
  // неточная нота не сдвигала всю сетку.
  function gridOnsets(notes, u0, step) {
    const q = [0], uAt = [u0], raw = [0];
    let u = u0, tPrev = notes[0].start, pPrev = 0;
    for (let k = 1; k < notes.length; k++) {
      const t = notes[k].start;
      const r = pPrev + (t - tPrev) / u;
      let p = Math.round(r / step) * step;
      if (p <= pPrev) p = pPrev + step;
      const span = p - pPrev;
      const tPred = tPrev + span * u;
      const tAnchor = tPred + 0.5 * (t - tPred);
      const alpha = 0.3 * Math.min(1, span / 8);
      u = clamp(u * (1 - alpha) + ((tAnchor - tPrev) / span) * alpha, u0 * 0.8, u0 * 1.25);
      q.push(p); uAt.push(u); raw.push(r);
      tPrev = tAnchor; pPrev = p;
    }
    return { q, uAt, raw };
  }

  // Шестнадцатые нужны, если с ними начала нот ложатся на сетку заметно точнее,
  // чем на сетку восьмых; каждая нота между восьмыми — небольшой штраф за сложность.
  function autoStep(notes, bpm) {
    if (notes.length < 2) return 2;
    const u = 60 / bpm / UPQ;
    const cost = (step) => {
      const { q, raw } = gridOnsets(notes, u, step);
      return q.reduce((s, p, k) => s + (raw[k] - p) ** 2 + (p % 2 ? 0.3 : 0), 0);
    };
    return cost(1) < cost(2) ? 1 : 2;
  }

  // Ключ, при котором меньше всего добавочных линеек (с учётом длительности нот).
  const STEP_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  function chooseClef(items) {
    const staff = { treble: [30, 38], 'treble-8': [23, 31], bass: [18, 26] }; // линии E4–F5, E3–F4, G2–A3
    // Скрипичный привычнее: другой ключ — только если линеек заметно меньше.
    const total = items.reduce((a, x) => a + x.w, 0) || 1;
    let best = 'treble', bc = Infinity;
    for (const clef of ['treble', 'treble-8', 'bass']) {
      const [lo, hi] = staff[clef];
      let cost = 0;
      for (const x of items) {
        const sp = spell(x.midi, 0), d = 7 * sp.octave + STEP_IDX[sp.step];
        const ledger = d < lo ? Math.floor((lo - d) / 2) : d > hi ? Math.floor((d - hi) / 2) : 0;
        cost += x.w * ledger * ledger;
      }
      if (bc === Infinity || (cost < bc * 0.5 && (bc - cost) / total > 0.3)) { bc = cost; best = clef; }
    }
    return best;
  }

  function finish(events, info) {
    return { ...info, events, bars: layout(events, info.mi) };
  }

  // ---------- 8. Раскладка по тактам ----------
  // Ноту, которая не помещается в такт или в стандартную длительность, делим на части с лигой.
  function base(len) { return len === 12 ? 8 : len === 6 ? 4 : len === 3 ? 2 : len; }
  function allowed(pos, len, mi) {
    if (pos + len > mi.barUnits) return false;
    if (mi.compound) {
      if (len >= mi.beatUnits) return pos % mi.beatUnits === 0 && (len === 6 || len === 12);
      return Math.floor(pos / mi.beatUnits) === Math.floor((pos + len - 1) / mi.beatUnits) && pos % (len === 4 ? 2 : base(len)) === 0;
    }
    if (len < mi.beatUnits) {
      return pos % base(len) === 0 && Math.floor(pos / mi.beatUnits) === Math.floor((pos + len - 1) / mi.beatUnits);
    }
    if (pos % mi.beatUnits !== 0) return false;
    // В 4/4 середину такта видно: от второй доли длинная нота делится.
    if (mi.num === 4 && mi.den === 4 && pos !== 0 && pos < 8 && pos + len > 8) return false;
    return pos % base(len) === 0 || (mi.num === 3 && len === 8);
  }
  const LENS = [16, 12, 8, 6, 4, 3, 2, 1];
  function layout(events, mi) {
    const bars = [];
    for (const ev of events) {
      let pos = ev.pos, left = ev.len;
      while (left > 0) {
        const bar = Math.floor(pos / mi.barUnits), inBar = pos - bar * mi.barUnits;
        while (bars.length <= bar) bars.push([]);
        // Целая пауза на весь такт.
        if (ev.midi == null && inBar === 0 && left >= mi.barUnits) {
          bars[bar].push({ pos: inBar, len: mi.barUnits, midi: null, full: true });
          pos += mi.barUnits; left -= mi.barUnits; continue;
        }
        let len = 1;
        for (const L of LENS) if (L <= left && allowed(inBar, L, mi)) { len = L; break; }
        const piece = { pos: inBar, len, midi: ev.midi, src: ev.src };
        left -= len; pos += len;
        if (ev.midi != null && left > 0) piece.tie = true;
        bars[bar].push(piece);
      }
    }
    return bars;
  }

  // ---------- 9. ABC (для отрисовки abcjs) ----------
  function abcKeyName(key) {
    const s = spell(key.tonic + 60, key.fifths);
    return s.step + (s.alter === 1 ? '#' : s.alter === -1 ? 'b' : '') + (key.mode === 'minor' ? 'm' : '');
  }
  function abcPitch(s) {
    let letter = s.step;
    if (s.octave >= 5) { letter = letter.toLowerCase() + "'".repeat(s.octave - 5); }
    else letter = letter + ','.repeat(Math.max(0, 4 - s.octave));
    return letter;
  }
  const abcAcc = (a) => (a === 1 ? '^' : a === -1 ? '_' : a === 2 ? '^^' : a === -2 ? '__' : '=');

  // Возвращает текст ABC и карту «символы → нота», чтобы по щелчку найти ноту.
  // opts.barText(номер такта) — подпись над началом такта (например, время в записи),
  // opts.subtitle — строка под названием. Несколько тактов паузы подряд — одна многотактовая пауза.
  function toABC(score, title = '', opts = {}) {
    const { mi, key, clef } = score;
    const written = clef === 'treble-8' ? 12 : 0;   // abcjs не сдвигает ноты сам
    let abc = 'X:1\n';
    if (title) abc += 'T:' + title.replace(/\n/g, ' ') + '\n';
    if (opts.subtitle) abc += 'T:' + opts.subtitle.replace(/\n/g, ' ') + '\n';
    abc += `M:${mi.num}/${mi.den}\nL:1/16\nQ:1/4=${Math.round(score.bpm)}\nK:${abcKeyName(key)} clef=${clef}\n`;
    const map = [];
    const bars = score.bars;
    const isRest = (bar) => bar.length === 1 && bar[0].full;
    for (let bi = 0; bi < bars.length; bi++) {
      const bar = bars[bi];
      const text = opts.barText && opts.barText(bi);
      if (text) abc += `"^${text.replace(/"/g, '')}"`;
      if (isRest(bar)) {
        let k = 1;
        while (bi + k < bars.length && isRest(bars[bi + k])) k++;
        abc += k > 1 ? 'Z' + k : 'Z';
        bi += k - 1;
        abc += bi === bars.length - 1 ? ' |]' : ' | ';
        continue;
      }
      const state = {};
      bar.forEach((pc, k) => {
        if (k > 0 && pc.pos % (mi.compound ? 6 : mi.beatUnits) === 0) abc += ' ';
        if (pc.midi == null) { abc += pc.full ? 'Z' : 'z' + (pc.len === 1 ? '' : pc.len); return; }
        const sp = spell(pc.midi + written, key.fifths);
        const id = sp.step + sp.octave;
        const cur = id in state ? state[id] : keyAlter(sp.step, key.fifths);
        let txt = '';
        if (cur !== sp.alter) { txt += abcAcc(sp.alter); state[id] = sp.alter; }
        txt += abcPitch(sp) + (pc.len === 1 ? '' : pc.len) + (pc.tie ? '-' : '');
        map.push({ start: abc.length, end: abc.length + txt.length, src: pc.src });
        abc += txt;
      });
      abc += bi === bars.length - 1 ? ' |]' : ' | ';
    }
    return { abc: abc + '\n', map };
  }

  // ---------- 10. MusicXML ----------
  const TYPES = { 1: ['16th', 0], 2: ['eighth', 0], 3: ['eighth', 1], 4: ['quarter', 0], 6: ['quarter', 1], 8: ['half', 0], 12: ['half', 1], 16: ['whole', 0] };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function toMusicXML(score, title = 'Мелодия') {
    const { mi, key, clef } = score;
    const clefXml = clef === 'bass' ? '<sign>F</sign><line>4</line>'
      : '<sign>G</sign><line>2</line>' + (clef === 'treble-8' ? '<clef-octave-change>-1</clef-octave-change>' : '');
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
      + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
      + '<score-partwise version="4.0">\n'
      + `  <work><work-title>${esc(title)}</work-title></work>\n`
      + '  <identification><encoding><software>Ноты из голоса</software></encoding></identification>\n'
      + '  <part-list><score-part id="P1"><part-name>Голос</part-name></score-part></part-list>\n'
      + '  <part id="P1">\n';
    let tied = false;
    score.bars.forEach((bar, bi) => {
      x += `    <measure number="${bi + 1}">\n`;
      if (bi === 0) {
        x += `      <attributes><divisions>${UPQ}</divisions><key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`
          + `<time><beats>${mi.num}</beats><beat-type>${mi.den}</beat-type></time><clef>${clefXml}</clef></attributes>\n`
          + `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(score.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(score.bpm)}"/></direction>\n`;
      }
      const state = {};
      for (const pc of bar) {
        if (pc.midi == null) {
          if (pc.full) { x += `      <note><rest measure="yes"/><duration>${pc.len}</duration></note>\n`; continue; }
          const [type, dot] = TYPES[pc.len];
          x += `      <note><rest/><duration>${pc.len}</duration><type>${type}</type>${dot ? '<dot/>' : ''}</note>\n`;
          continue;
        }
        const s = spell(pc.midi, key.fifths);
        const id = s.step + s.octave;
        const cur = id in state ? state[id] : keyAlter(s.step, key.fifths);
        const accidental = cur !== s.alter ? { 1: 'sharp', '-1': 'flat', 0: 'natural', 2: 'double-sharp', '-2': 'flat-flat' }[s.alter] : null;
        state[id] = s.alter;
        const [type, dot] = TYPES[pc.len];
        const stop = tied, start = !!pc.tie;
        x += '      <note><pitch><step>' + s.step + '</step>' + (s.alter ? `<alter>${s.alter}</alter>` : '') + `<octave>${s.octave}</octave></pitch>`
          + `<duration>${pc.len}</duration>` + (stop ? '<tie type="stop"/>' : '') + (start ? '<tie type="start"/>' : '')
          + `<voice>1</voice><type>${type}</type>` + (dot ? '<dot/>' : '') + (accidental ? `<accidental>${accidental}</accidental>` : '')
          + (stop || start ? '<notations>' + (stop ? '<tied type="stop"/>' : '') + (start ? '<tied type="start"/>' : '') + '</notations>' : '')
          + '</note>\n';
        tied = start;
      }
      if (bi === score.bars.length - 1) x += '      <barline location="right"><bar-style>light-heavy</bar-style></barline>\n';
      x += '    </measure>\n';
    });
    return x + '  </part>\n</score-partwise>\n';
  }

  // ---------- 11. MIDI ----------
  function toMIDI(score) {
    const PPQ = 480, tick = PPQ / UPQ;
    const bytes = [];
    const vlq = (v) => { const a = [v & 0x7f]; while ((v >>= 7)) a.unshift((v & 0x7f) | 0x80); return a; };
    const tr = [];
    const ev = (dt, data) => tr.push(...vlq(dt), ...data);
    const mpq = Math.round(60000000 / score.bpm);
    ev(0, [0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255]);
    ev(0, [0xff, 0x58, 4, score.mi.num, Math.log2(score.mi.den), 24, 8]);
    ev(0, [0xff, 0x59, 2, score.key.fifths & 255, score.key.mode === 'minor' ? 1 : 0]);
    ev(0, [0xc0, 0]);
    let now = 0;
    for (const e of score.events) {
      if (e.midi == null) continue;
      const on = e.pos * tick, off = (e.pos + e.len) * tick;
      const n = clamp(e.midi, 0, 127);
      ev(on - now, [0x90, n, 90]); ev(off - on, [0x80, n, 0]); now = off;
    }
    ev(0, [0xff, 0x2f, 0]);
    const str = (s) => [...s].map((c) => c.charCodeAt(0));
    const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    bytes.push(...str('MThd'), ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255);
    bytes.push(...str('MTrk'), ...u32(tr.length), ...tr);
    return new Uint8Array(bytes);
  }

  const api = {
    params: P,
    FMIN, FMAX, UPQ, resample, analyzePitch, pitchTrack, tuningCurve, segmentNotes, estimateTempo, estimateKey, keyFromFifths,
    quantize, layout, meterInfo, spell, toABC, toMusicXML, toMIDI, noteNameRu, noteNameEn, keyNameRu, majorFifths, median,
  };
  root.Transcribe = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

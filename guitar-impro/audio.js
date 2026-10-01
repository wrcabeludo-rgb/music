// Звук: синтез струны (Карплус–Стронг), метроном, барабаны, бас, подложки и распознавание высоты с микрофона.
(function () {
  'use strict';
  let ctx = null, out, gtrBus, bassBus, drumBus, clickBus;
  const bufCache = new Map();
  let noiseBuf = null;
  const live = new Set(); // запущенные источники — чтобы остановить всё разом

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      out = ctx.createGain(); out.gain.value = 0.9;
      out.connect(comp); comp.connect(ctx.destination);
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 4200; tone.Q.value = 0.5;
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.gain.value = 3; body.Q.value = 1;
      gtrBus = ctx.createGain(); gtrBus.gain.value = 1;
      gtrBus.connect(body); body.connect(tone); tone.connect(out);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      bassBus = ctx.createGain(); bassBus.gain.value = 1.1; bassBus.connect(lp); lp.connect(out);
      drumBus = ctx.createGain(); drumBus.gain.value = 0.55; drumBus.connect(out);
      clickBus = ctx.createGain(); clickBus.gain.value = 0.5; clickBus.connect(out);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }
  const now = () => ensure().currentTime;

  // Карплус–Стронг: буфер с затухающей «струной», подстройка — через playbackRate
  function stringBuf(midi, bright) {
    const key = midi + '|' + bright;
    if (bufCache.has(key)) return bufCache.get(key);
    const sr = ctx.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
    const N = Math.max(2, Math.round(sr / f - 0.5));
    const rate = f / (sr / (N + 0.5));
    const dur = midi < 50 ? 3.2 : midi < 64 ? 2.6 : 2.0;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < N; i++) { lp += bright * ((Math.random() * 2 - 1) - lp); d[i] = lp; }
    let mean = 0; for (let i = 0; i < N; i++) mean += d[i]; mean /= N;
    for (let i = 0; i < N; i++) d[i] -= mean;
    const rho = midi < 50 ? 0.9985 : 0.9965;
    for (let i = N; i < len; i++) d[i] = rho * 0.5 * (d[i - N] + d[i - N - 1 < 0 ? 0 : i - N - 1]);
    let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const g = peak ? 0.6 / peak : 1;
    const fade = Math.floor(sr * 0.08);
    for (let i = 0; i < len; i++) d[i] *= g * (i > len - fade ? (len - i) / fade : 1);
    const res = { buf, rate };
    bufCache.set(key, res);
    return res;
  }

  function track(src, end) { live.add(src); src.onended = () => live.delete(src); }

  // одна нота гитары
  function pluck(midi, t, dur, o) {
    o = o || {};
    ensure();
    const { buf, rate } = stringBuf(midi, o.bright || 0.62);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const pr = src.playbackRate;
    const startRate = o.slideFrom != null ? rate * Math.pow(2, (o.slideFrom - midi) / 12) : rate;
    pr.setValueAtTime(startRate, t);
    if (o.slideFrom != null) pr.linearRampToValueAtTime(rate, t + Math.min(0.09, dur * 0.5));
    if (o.bend) {
      const up = rate * Math.pow(2, o.bend / 12);
      const bt = t + Math.min(0.05, dur * 0.15), be = t + Math.max(0.09, Math.min(0.22, dur * 0.45));
      pr.setValueAtTime(rate, bt); pr.linearRampToValueAtTime(up, be);
      if (o.release) { pr.setValueAtTime(up, t + dur * 0.7); pr.linearRampToValueAtTime(rate, t + dur * 0.95); }
    }
    if (o.vib && dur > 0.25) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(rate * 0.012, t + Math.min(0.4, dur * 0.5));
      lfo.connect(lg); lg.connect(pr); lfo.start(t + 0.1); lfo.stop(t + dur + 0.1);
    }
    const g = ctx.createGain(), v = (o.vel == null ? 0.8 : o.vel) * (o.legato ? 0.55 : 1);
    g.gain.setValueAtTime(v, t);
    const end = t + dur;
    g.gain.setValueAtTime(v, Math.max(t, end - 0.01));
    g.gain.exponentialRampToValueAtTime(0.0008, end + (o.ring || 0.06));
    src.connect(g); g.connect(o.bus || gtrBus);
    src.start(t); src.stop(end + (o.ring || 0.06) + 0.02);
    track(src);
    return src;
  }

  // аккорд: notes — midi снизу вверх
  function strum(notes, t, dur, o) {
    o = o || {};
    const gap = o.gap == null ? 0.022 : o.gap;
    const list = o.up ? notes.slice().reverse() : notes;
    list.forEach((m, i) => pluck(m, t + i * gap, Math.max(0.05, dur - i * gap), { vel: (o.vel || 0.55) * (0.9 + 0.1 * Math.random()), ring: o.ring || 0.12, bright: o.bright || 0.5 }));
  }

  function click(t, accent) {
    ensure();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 2200 : 1600;
    g.gain.setValueAtTime(accent ? 0.9 : 0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    o.connect(g); g.connect(clickBus); o.start(t); o.stop(t + 0.05); track(o);
  }

  function noise(t, dur, type, freq, vol, bus) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || drumBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02); track(s);
  }
  const drums = {
    kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); g.gain.setValueAtTime(1.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 0.32); track(o); },
    snare(t, v) { noise(t, 0.16, 'highpass', 1200, 0.7 * (v || 1)); const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 190; g.gain.setValueAtTime(0.35 * (v || 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 0.1); track(o); },
    hat(t, v) { noise(t, 0.045, 'highpass', 7500, 0.35 * (v || 1)); },
    ride(t, v) { noise(t, 0.35, 'bandpass', 6500, 0.28 * (v || 1)); },
    brush(t, v) { noise(t, 0.12, 'bandpass', 3500, 0.18 * (v || 1)); }
  };

  function bass(midi, t, dur, vel) { pluck(midi, t, dur, { bus: bassBus, bright: 0.3, vel: vel || 0.9, ring: 0.05 }); }

  function stopAll() {
    live.forEach(s => { try { s.stop(); } catch (e) {} });
    live.clear();
    if (loop) { clearInterval(loop.timer); loop = null; }
  }

  // ---------- воспроизведение фразы ----------
  // events — из Licks.parse (уже транспонированные); возвращает расписание нот во времени
  function playPhrase(events, opt) {
    ensure();
    const spb = 60 / opt.bpm;
    const t0 = opt.at || (now() + 0.12);
    const time = b => t0 + (opt.swing ? Licks.swingTime(b) : b) * spb;
    const sched = [];
    let prevMidi = null;
    events.forEach((e, i) => {
      const start = time(e.t), end = time(e.t + e.d);
      if (e.rest) { prevMidi = null; return; }
      const dur = Math.max(0.06, end - start);
      e.notes.forEach((n, k) => {
        const leg = !!e.leg && k === 0;
        pluck(n.midi, start + k * 0.012, dur - k * 0.012, {
          bend: k === 0 ? e.bend : 0, release: e.release, vib: e.vib,
          legato: leg, slideFrom: e.leg === 's' && prevMidi != null && k === 0 ? prevMidi : null,
          vel: opt.vel || 0.85, ring: 0.05
        });
      });
      prevMidi = e.notes[0].midi;
      sched.push({ i, start, end });
    });
    const total = (opt.beats || events.reduce((a, e) => Math.max(a, e.t + e.d), 0));
    return { t0, end: time(total), sched, spb };
  }

  // гармония под фразой / подложка: harm — [[rootPc, type, beats], …]
  function comp(harm, t0, spb, style, swing, vol) {
    let b = 0;
    harm.forEach(([pc, type, beats]) => {
      const v = Music.compVoicing(pc, type, 6);
      const notes = v.notes.filter(x => x != null);
      for (let k = 0; k < beats; k++) {
        const bt = b + k, t = t0 + bt * spb;
        const on = style === 'rock' ? true : style === 'shuffle' ? true : (k % 4 === 0 || k % 4 === 1);
        if (style === 'swing') {
          if (k % 4 === 0) strum(notes, t, spb * 0.9, { vel: 0.32 * vol, gap: 0.01 });
          if (k % 4 === 1) strum(notes, t + spb * 2 / 3, spb * 0.5, { vel: 0.28 * vol, gap: 0.01 });
        } else if (on) {
          strum(notes, t, spb * (style === 'rock' ? 0.45 : 0.6), { vel: 0.3 * vol, gap: 0.012 });
          if (style === 'rock') strum(notes, t + spb / 2, spb * 0.4, { vel: 0.22 * vol, gap: 0.01, up: true });
        }
      }
      b += beats;
    });
  }

  // ---------- подложка (бесконечный цикл) ----------
  let loop = null;
  // басовая нота на долю: рок — тоника, шаффл — 1-3-5-6, свинг — шагающий бас с подходом к следующему аккорду
  function bassLine(bars, i, beat, style) {
    const chords = bars[i];
    let acc = 0, ci = 0;
    while (ci < chords.length - 1 && beat >= acc + chords[ci][2]) { acc += chords[ci][2]; ci++; }
    const cur = chords[ci], local = beat - acc, len = cur[2];
    const low = pc => 28 + ((pc - 4 + 12) % 12); // E1..D#2
    const r = low(cur[0]);
    const t = Music.TYPE[cur[1]].f.map(iv => Music.IV[iv][0]);
    const third = t.find(x => x === 3 || x === 4) || 5;
    const fifth = t.find(x => x === 6 || x === 7 || x === 8) || 7;
    if (style === 'rock') return r;
    if (style === 'shuffle') return r + [0, third, fifth, third === 3 ? 10 : 9][local % 4];
    if (local === 0) return r;
    if (local === len - 1) {
      const next = ci + 1 < chords.length ? chords[ci + 1] : bars[(i + 1) % bars.length][0];
      const nr = low(next[0]);
      const cand = [nr - 1, nr + 1, nr + 11, nr - 11].filter(x => x >= 26 && x <= 45);
      return cand.reduce((a, c) => Math.abs(c - (r + fifth)) < Math.abs(a - (r + fifth)) ? c : a);
    }
    return r + (local === 1 ? third : fifth);
  }

  function startLoop(prog, keyPc, bpm, onBar) {
    stopAll(); ensure();
    const spb = 60 / bpm, swing = prog.style !== 'rock';
    const bars = prog.bars.map(b => (Array.isArray(b[0]) ? b : [b]).map((c, k, arr) => [(c[0] + keyPc) % 12, c[1], 4 / arr.length]));
    let bar = 0, barTime = now() + 0.15;
    const sw = x => swing ? Licks.swingTime(x) : x;
    const st = { timer: null, bars, spb, startedAt: barTime, queue: [] };
    function scheduleBar(i, t0) {
      const chords = bars[i];
      comp(chords, t0, spb, prog.style, swing, 1);
      for (let b = 0; b < 4; b++) {
        const t = t0 + b * spb;
        const m = bassLine(bars, i, b, prog.style);
        if (prog.style === 'rock') { bass(m, t, spb * 0.45); bass(m, t + spb / 2, spb * 0.45, 0.75); }
        else bass(m, t, spb * 0.92);
        if (prog.style === 'swing') {
          drums.ride(t, 0.9); if (b % 2 === 1) { drums.ride(t0 + sw(b + 0.5) * spb, 0.6); drums.hat(t, 1); }
          if (b === 0) drums.kick(t);
        } else if (prog.style === 'shuffle') {
          drums.hat(t, 1); drums.hat(t0 + sw(b + 0.5) * spb, 0.6);
          if (b % 2 === 0) drums.kick(t); else drums.snare(t, 0.8);
        } else {
          drums.hat(t, 1); drums.hat(t + spb / 2, 0.6);
          if (b % 2 === 0) drums.kick(t); else drums.snare(t);
          if (b === 2) drums.kick(t + spb / 2);
        }
      }
      st.queue.push({ i, t: t0 });
    }
    st.timer = setInterval(() => {
      while (barTime < ctx.currentTime + 0.35) {
        scheduleBar(bar, barTime);
        bar = (bar + 1) % bars.length;
        barTime += 4 * spb;
      }
      while (st.queue.length && st.queue[0].t <= ctx.currentTime) { const q = st.queue.shift(); onBar && onBar(q.i, bars[q.i]); }
    }, 40);
    loop = st;
    return st;
  }

  // ---------- микрофон и высота тона ----------
  let mic = null;
  async function micStart() {
    ensure();
    if (mic) return mic;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    src.connect(an);
    mic = { stream, src, an, buf: new Float32Array(2048) };
    return mic;
  }
  function micStop() {
    if (!mic) return;
    mic.stream.getTracks().forEach(t => t.stop());
    try { mic.src.disconnect(); } catch (e) {}
    mic = null;
  }
  // YIN (упрощённый): возвращает {f, rms} или null
  function detectPitch() {
    if (!mic) return null;
    const b = mic.buf; mic.an.getFloatTimeDomainData(b);
    let rms = 0; for (let i = 0; i < b.length; i++) rms += b[i] * b[i];
    rms = Math.sqrt(rms / b.length);
    if (rms < 0.008) return { f: 0, rms };
    const sr = ctx.sampleRate, W = 1024, maxLag = Math.min(Math.floor(sr / 70), b.length - W), minLag = Math.floor(sr / 1400);
    const d = new Float32Array(maxLag + 1);
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const x = b[i] - b[i + tau]; s += x * x; }
      d[tau] = s;
    }
    let run = 0, tauBest = -1;
    const cm = new Float32Array(maxLag + 1); cm[0] = 1;
    for (let tau = 1; tau <= maxLag; tau++) { run += d[tau]; cm[tau] = d[tau] * tau / (run || 1); }
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cm[tau] < 0.15) { while (tau + 1 <= maxLag && cm[tau + 1] < cm[tau]) tau++; tauBest = tau; break; }
    }
    if (tauBest < 0) return { f: 0, rms };
    const a = cm[tauBest - 1] || cm[tauBest], c = cm[tauBest + 1] || cm[tauBest], m = cm[tauBest];
    const shift = (a + c - 2 * m) ? (a - c) / (2 * (a + c - 2 * m)) : 0;
    const f = sr / (tauBest + shift);
    return { f, rms, clarity: 1 - m };
  }

  // разбивка потока высот на ноты
  function noteTracker() {
    const notes = [];
    let cand = null, candN = 0, last = null, lastRms = 0, quiet = 0;
    return {
      notes,
      push(p, t) {
        if (!p || !p.f) { quiet++; if (quiet > 3) last = null; cand = null; candN = 0; lastRms = p ? p.rms : 0; return null; }
        const midi = Math.round(69 + 12 * Math.log2(p.f / 440));
        const onset = p.rms > lastRms * 1.8 && quiet > 0;
        quiet = 0; lastRms = p.rms;
        if (midi === cand) candN++; else { cand = midi; candN = 1; }
        if (candN === 3 && (midi !== last || onset)) { notes.push({ midi, t }); last = midi; return midi; }
        return null;
      }
    };
  }

  window.Snd = { ensure, now, pluck, strum, click, drums, bass, stopAll, playPhrase, comp, startLoop, micStart, micStop, detectPitch, noteTracker, get ctx() { return ctx; }, get looping() { return !!loop; } };
})();

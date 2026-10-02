// Синтез «голоса» для проверок: гармоники с формантами, вибрато, подъезды к нотам,
// согласные, неточный строй, плавающий темп и неровный ритм.
let seed = 1;
const SR = 16000;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// melody: [[midi|null, долей(четвертей)], ...]; legato: нота без согласной в начале
function sing(melody, o) {
  const beat = 60 / o.bpm;
  const notes = [];
  let t = 0.4;
  melody.forEach(([m, b], i) => {
    const jitter = i ? gauss() * (o.jitter ?? 0.015) : 0;
    const drift = 1 + (o.drift ?? 0) * (t / 20);
    const dur = b * beat * drift;
    if (m != null) notes.push({ midi: m, start: t + jitter, end: t + dur - Math.min(o.gap ?? 0.06, 0.25 * dur), legato: o.legato && i > 0 && melody[i - 1][0] != null && melody[i - 1][0] !== m });
    t += dur;
  });
  const total = t + 0.5;
  const x = new Float32Array(Math.ceil(total * SR));
  const formants = o.low ? [[500, 80], [1000, 100], [2500, 150]] : [[750, 90], [1250, 110], [2800, 160]];
  const env = (f) => formants.reduce((s, [fc, bw]) => s + 1 / (1 + ((f - fc) / bw) ** 2), 0.05);
  let phase = new Float64Array(30);
  const detune = (o.detune ?? 0) / 100;
  for (let k = 0; k < notes.length; k++) {
    const n = notes[k];
    const prev = notes[k - 1];
    const s0 = Math.floor(n.start * SR), s1 = Math.floor(n.end * SR);
    if (!n.legato) phase = new Float64Array(30);
    // Согласная: шумовой всплеск перед нотой.
    if (!n.legato && o.consonant !== false) {
      for (let i = Math.max(0, s0 - 0.04 * SR); i < s0; i++) x[i] += 0.05 * (rnd() * 2 - 1);
    }
    const startPitch = n.legato && prev ? prev.midi : n.midi - (o.scoop ?? 0.8);
    for (let i = s0; i < s1 && i < x.length; i++) {
      const tt = (i - s0) / SR, left = (s1 - i) / SR;
      const glide = Math.min(1, tt / (n.legato ? 0.05 : 0.07));
      const vib = tt > 0.15 ? (o.vibrato ?? 0.3) * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, (tt - 0.15) / 0.2) : 0;
      const drift = (o.pitchDrift ?? 0) * (i / SR) / 20;
      const midi = startPitch + (n.midi - startPitch) * glide + vib + detune + drift;
      const f = 440 * 2 ** ((midi - 69) / 12);
      const a = Math.min(1, tt / 0.03, left / 0.04) * (0.8 + 0.2 * Math.sin(i / SR * 3));
      let v = 0;
      for (let h = 1; h < 30 && h * f < SR / 2 - 200; h++) {
        phase[h] += 2 * Math.PI * h * f / SR;
        v += env(h * f) / h * Math.sin(phase[h]);
      }
      x[i] += 0.3 * a * v;
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += (o.noise ?? 0.003) * gauss();
  return { x, notes };
}

module.exports = { SR, sing, rnd, gauss, setSeed: (s) => { seed = s; for (let i = 0; i < 5; i++) rnd(); } };

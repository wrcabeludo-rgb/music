// Быстрая проверка распознавания: node notes/tools/check.js (большая — tools/bench.js)
// Синтезируем «голос» (гармоники с формантами, вибрато, подъезды к нотам, согласные,
// неточный строй и плавающий темп), распознаём и сравниваем с исходными нотами.
const T = require('../transcribe.js');

const { SR, sing } = require('./synth.js');

const Q = 1, E = 0.5, S = 0.25, H = 2, DQ = 1.5, DH = 3, DE = 0.75;
const N = (name) => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  return 12 * (+m[3] + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const mel = (s) => s.trim().split(/\s+/).map((tok) => { const [n, d] = tok.split(':'); return [n === 'r' ? null : N(n), eval(d)]; });

const CASES = [
  { name: 'Ода к радости, до мажор', meter: [4, 4], pickup: 0, key: 'до мажор',
    m: mel('E4:Q E4:Q F4:Q G4:Q G4:Q F4:Q E4:Q D4:Q C4:Q C4:Q D4:Q E4:Q E4:DQ D4:E D4:H E4:Q E4:Q F4:Q G4:Q G4:Q F4:Q E4:Q D4:Q C4:Q C4:Q D4:Q E4:Q D4:DQ C4:E C4:H'),
    o: { bpm: 100, detune: -25 } },
  { name: 'Ёлочка, фа мажор, восьмые', meter: [2, 4], pickup: null, key: 'фа мажор',
    m: mel('C4:E A4:E A4:E G4:E A4:E F4:E C4:E C4:E C4:E A4:E A4:E Bb4:E G4:E C5:Q r:E C5:E D4:E D4:E Bb4:E Bb4:E A4:E G4:E F4:E C4:E C4:E A4:E A4:E G4:E A4:E F4:Q r:Q'),
    o: { bpm: 120, detune: 15, vibrato: 0.2 } },
  { name: 'Минорный вальс, мужской голос', meter: [3, 4], pickup: 0, key: 'ля минор',
    m: mel('A2:H C3:Q E3:H A3:Q G#3:DQ F3:E E3:Q D3:H F3:Q E3:DH C3:H B2:Q A2:Q B2:Q C3:Q D3:H E3:Q A2:DH'),
    o: { bpm: 132, detune: 35, low: true, vibrato: 0.35 } },
  { name: 'Шестнадцатые, затакт, паузы', meter: [4, 4], pickup: 14, key: 'соль мажор',
    m: mel('D4:E G4:Q G4:E. A4:S B4:Q A4:Q G4:E F#4:E E4:E F#4:E G4:H r:Q B4:E C5:E D5:Q D5:S C5:S B4:S A4:S B4:Q G4:Q A4:Q F#4:Q G4:H.'.replace(/E\./g, 'DE').replace(/H\./g, 'DH')),
    o: { bpm: 84, detune: -10, jitter: 0.02 } },
  { name: 'Плывущий строй и темп, легато', meter: [4, 4], pickup: 0, key: 'ре минор',
    m: mel('D4:Q F4:Q A4:H G4:Q F4:Q E4:H F4:Q G4:Q A4:Q Bb4:Q A4:H r:H D5:Q C5:Q Bb4:Q A4:Q G4:Q E4:Q F4:Q E4:Q D4:H'),
    o: { bpm: 76, detune: 10, pitchDrift: 0.4, drift: -0.04, legato: true, vibrato: 0.45 } },
];

let fails = 0;
const fail = (m) => { fails++; console.log('  ОШИБКА:', m); };

for (const c of CASES) {
  const { x, notes: truth } = sing(c.m, c.o);
  const t0 = Date.now();
  const p = T.analyzePitch(x, SR);
  const track = T.pitchTrack(p);
  const notes = T.segmentNotes(track);
  const ms = Date.now() - t0;
  console.log(`${c.name}: ${truth.length} нот, найдено ${notes.length} (${ms} мс на ${(x.length / SR).toFixed(1)} с)`);

  // Совпадение нот: начало ±80 мс и та же высота.
  let hit = 0;
  const used = new Set();
  for (const n of truth) {
    const k = notes.findIndex((d, i) => !used.has(i) && Math.abs(d.start - n.start) < 0.08 && d.midi === n.midi);
    if (k >= 0) { hit++; used.add(k); }
  }
  const P = hit / notes.length, R = hit / truth.length, F = 2 * P * R / (P + R || 1);
  console.log(`  ноты: точность ${(P * 100).toFixed(0)}%, полнота ${(R * 100).toFixed(0)}%`);
  if (F < 0.9) {
    fail(`F1 ${(F * 100).toFixed(0)}%`);
    console.log('  исходные:', truth.map((n) => `${T.noteNameEn(n.midi)}@${n.start.toFixed(2)}`).join(' '));
    console.log('  найдено: ', notes.map((n) => `${T.noteNameEn(n.midi)}@${n.start.toFixed(2)}`).join(' '));
  }

  const bpm = T.estimateTempo(notes);
  const score = T.quantize(notes, { meter: c.meter });
  const keyName = T.keyNameRu(score.key);
  const scale = Math.round(Math.log2(bpm / c.o.bpm));
  console.log(`  темп ${bpm} (задан ${c.o.bpm}), тональность ${keyName}, ключ ${score.clef}, затакт ${score.pickup}`);
  if (scale === 0 && c.pickup != null && score.pickup !== c.pickup) fail(`затакт ${score.pickup}, ожидался ${c.pickup}`);
  if (keyName !== c.key) fail(`тональность ${keyName}, ожидалась ${c.key}`);
  const ratio = bpm / c.o.bpm;
  if (![0.5, 1, 2].some((r) => Math.abs(ratio / r - 1) < 0.06)) fail(`темп ${bpm}`);

  // Ритм: длительности (в долях заданного темпа) должны совпасть с исходными.
  const k = 2 ** scale;
  const want = []; // [midi, четвертей до следующей ноты]
  c.m.forEach(([m, b]) => { if (m == null) { if (want.length) want[want.length - 1][2] += b; } else want.push([m, b, 0]); });
  const got = score.events.filter((e) => e.midi != null).map((e) => [e.midi, e.len / 4 / k]);
  let rhythmOk = 0;
  want.forEach(([m, b], i) => { if (got[i] && got[i][0] === m && Math.abs(got[i][1] - b) < 1e-6) rhythmOk++; });
  console.log(`  ритм: ${rhythmOk} из ${want.length} нот с точной длительностью`);
  if (rhythmOk / want.length < 0.85) {
    fail('ритм');
    console.log('  ожидалось:', want.map(([m, b]) => `${T.noteNameEn(m)}:${b}`).join(' '));
    console.log('  получено: ', got.map(([m, b]) => `${T.noteNameEn(m)}:${b}`).join(' '));
  }

  // Форматы должны собираться без ошибок, такты — быть полными.
  score.bars.forEach((bar, i) => { const s = bar.reduce((a, p) => a + p.len, 0); if (s !== score.mi.barUnits) fail(`такт ${i + 1}: ${s} шестнадцатых`); });
  const { abc } = T.toABC(score, c.name);
  const xml = T.toMusicXML(score, c.name);
  const mid = T.toMIDI(score);
  if (!abc.includes('|]') || !xml.includes('</score-partwise>') || mid.length < 30) fail('экспорт');
}

// Написание нот
const spellCases = [[61, 0, 'C♯4'], [70, 0, 'B♭4'], [68, 0, 'G♯4'], [66, -5, 'G♭4'], [63, -3, 'E♭4'], [60, 7, 'B♯3'], [71, -6, 'C♭5']];
for (const [m, f, want] of spellCases) { const got = T.noteNameEn(m, f); if (got !== want) fail(`${m} при ${f}: ${got}, ожидалось ${want}`); }

console.log(fails ? `\nОшибок: ${fails}` : '\nВсё в порядке');
process.exit(fails ? 1 : 0);

// Проверка данных: node tools/check.js
// Каждая аппликатура во всех 12 тональностях должна содержать только звуки аккорда
// и все обязательные звуки; фразы — ровные такты и ноты из заявленного лада.
const M = require('../music.js');
const L = require('../licks.js');
let errors = 0, count = 0;
const err = m => { errors++; console.log('ОШИБКА:', m); };

const semis = ivs => ivs.map(iv => M.IV[iv][0]);
for (const t of M.TYPES) {
  const allowed = new Set(semis(t.f));
  const cats = [t.cat].concat(M.SHELL_TYPES.includes(t.id) ? ['shell'] : []);
  for (let pc = 0; pc < 12; pc++) for (const cat of cats) {
    const groups = M.voicings(pc, t.id, cat);
    const n = groups.reduce((a, g) => a + g.items.length, 0);
    if (!n) err(`${M.chordName(pc, t.id)} [${cat}]: нет аппликатур`);
    for (const g of groups) {
      if (!g.items.length) err(`${M.chordName(pc, t.id)} [${cat}] «${g.name}»: пустая группа`);
      for (const v of g.items) {
        count++;
        const name = `${M.chordName(pc, t.id)} [${cat}] ${g.name} ${v.frets.map(f => f == null ? 'x' : f).join(' ')}`;
        const played = v.notes.filter(x => x != null).map(m => ((m - pc) % 12 + 12) % 12);
        played.forEach(s => { if (!allowed.has(s)) err(`${name}: лишний звук (${s} пт.)`); });
        const set = new Set(played);
        const req = cat === 'shell' ? [] : t.req;
        req.forEach(iv => { if (!set.has(M.IV[iv][0])) err(`${name}: нет ${iv}`); });
        if (t.alt && !['b9', '#9', '#11', 'b13'].some(iv => set.has(M.IV[iv][0]))) err(`${name}: нет альтераций`);
        if (cat === 'shell') { const sh = { maj7: 11, '7': 10, m7: 10, m7b5: 10, dim7: 9, '6': 9, m6: 9, mMaj7: 11, '7sus4': 10 }[t.id]; if (!set.has(sh) || !set.has(0)) err(`${name}: shell без корня/септимы`); }
        const fr = v.frets.filter(f => f != null && f > 0);
        if (fr.length && Math.max(...fr) - Math.min(...fr) > 5) err(`${name}: растяжка ${Math.max(...fr) - Math.min(...fr)} ладов`);
        if (v.frets.some(f => f != null && (f < 0 || f > 17))) err(`${name}: лад вне грифа`);
        if (!v.rootless && cat !== 'shell' && !set.has(0)) err(`${name}: нет корня`);
      }
    }
  }
}
console.log('аппликатур проверено:', count);

// фразы
for (const lk of L.LICKS) {
  const ev = L.parse(lk.tab);
  const beats = ev.reduce((a, e) => Math.max(a, e.t + e.d), 0);
  const harmBeats = lk.harm.reduce((a, h) => a + h[2], 0);
  if (Math.abs(beats - Math.round(beats)) > 1e-6 || Math.round(beats) % 4) err(`${lk.id}: длительность ${beats} долей — не целое число тактов`);
  if (Math.abs(harmBeats - beats) > 1e-6) err(`${lk.id}: гармония ${harmBeats} долей, фраза ${beats}`);
  const allowed = new Set();
  lk.scales.forEach(sc => M.SCALES[sc].f.forEach(iv => allowed.add((M.IV[iv][0] + lk.key) % 12)));
  (lk.extra || []).forEach(iv => allowed.add((M.IV[iv][0] + lk.key) % 12));
  for (const e of ev) {
    if (e.rest) continue;
    e.notes.forEach(n => {
      if (n.f < 0 || n.f > 22) err(`${lk.id}: лад ${n.f}`);
      const pcs = [n.midi % 12];
      if (n === e.notes[0] && e.bend) pcs.push((n.midi + e.bend) % 12);
      pcs.forEach(pc => { if (!allowed.has(pc)) err(`${lk.id}: нота ${M.pcName(pc)} (${n.s}:${n.f}) вне лада`); });
    });
  }
  for (let k = 0; k < 12; k++) {
    const tr = L.transpose(ev, lk.key, k);
    if (tr.some(e => !e.rest && e.notes.some(n => n.f < 0 || n.f > 22))) err(`${lk.id}: транспонирование в ${M.pcName(k)} вышло за гриф`);
  }
}
console.log('фраз проверено:', L.LICKS.length);
console.log(errors ? `ошибок: ${errors}` : 'всё в порядке');
process.exit(errors ? 1 : 0);

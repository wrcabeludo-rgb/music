// Теория: ноты, интервалы, аккорды, лады, аппликатуры на грифе (строй E A D G B E).
(function (root) {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  // 12 тональностей с «привычным» написанием
  const ROOTS = [
    { n: 'C', pc: 0, l: 0 }, { n: 'Db', pc: 1, l: 1 }, { n: 'D', pc: 2, l: 1 }, { n: 'Eb', pc: 3, l: 2 },
    { n: 'E', pc: 4, l: 2 }, { n: 'F', pc: 5, l: 3 }, { n: 'F#', pc: 6, l: 3 }, { n: 'G', pc: 7, l: 4 },
    { n: 'Ab', pc: 8, l: 5 }, { n: 'A', pc: 9, l: 5 }, { n: 'Bb', pc: 10, l: 6 }, { n: 'B', pc: 11, l: 6 }
  ];
  const rootByPc = pc => ROOTS[((pc % 12) + 12) % 12];

  // интервал: [полутоны, ступень]
  const IV = {
    '1': [0, 1], 'b2': [1, 2], '2': [2, 2], '#2': [3, 2], 'b3': [3, 3], '3': [4, 3], '4': [5, 4], '#4': [6, 4],
    'b5': [6, 5], '5': [7, 5], '#5': [8, 5], 'b6': [8, 6], '6': [9, 6], 'bb7': [9, 7], 'b7': [10, 7], '7': [11, 7],
    'b9': [1, 9], '9': [2, 9], '#9': [3, 9], '11': [5, 11], '#11': [6, 11], 'b13': [8, 13], '13': [9, 13]
  };
  const DEFAULT_IV = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', '#5', '6', 'b7', '7'];
  const IV_NAMES = {
    '1': 'прима (тоника)', 'b2': 'малая секунда', '2': 'большая секунда', 'b3': 'малая терция', '3': 'большая терция',
    '4': 'чистая кварта', '#4': 'увеличенная кварта', 'b5': 'уменьшённая квинта', '5': 'чистая квинта', '#5': 'увеличенная квинта',
    'b6': 'малая секста', '6': 'большая секста', 'bb7': 'уменьшённая септима', 'b7': 'малая септима', '7': 'большая септима',
    'b9': 'малая нона', '9': 'большая нона', '#9': 'увеличенная нона', '11': 'ундецима', '#11': 'увеличенная ундецима',
    'b13': 'малая терцдецима', '13': 'терцдецима'
  };

  function spell(rootN, iv) {
    const r = ROOTS.find(x => x.n === rootN) || rootByPc(0);
    const [semi, deg] = IV[iv];
    const letter = (r.l + deg - 1) % 7;
    const target = (r.pc + semi) % 12;
    const acc = ((target - LETTER_PC[letter] + 18) % 12) - 6;
    return LETTERS[letter] + (acc < 0 ? 'b'.repeat(-acc) : '#'.repeat(acc));
  }
  // красивое отображение: b → ♭, # → ♯
  const pretty = s => String(s).replace(/([A-G])bb/g, '$1𝄫').replace(/([A-G])b/g, '$1♭').replace(/b(?=\d)/g, '♭').replace(/#/g, '♯');
  const pcName = pc => rootByPc(pc).n;

  // ---------- типы аккордов ----------
  // cat: triad | seventh | ext | alt ; req — звуки, обязательные в каждой аппликатуре
  const TYPES = [
    { id: 'maj', sym: '', name: 'Мажорное трезвучие', cat: 'triad', f: ['1', '3', '5'], req: ['3', '5'], sc: ['ionian', 'majpent', 'lydian'], d: 'Основа мажорной гармонии. Светлое, устойчивое звучание.' },
    { id: 'm', sym: 'm', name: 'Минорное трезвучие', cat: 'triad', f: ['1', 'b3', '5'], req: ['b3', '5'], sc: ['aeolian', 'dorian', 'minpent'], d: 'Отличается от мажорного только терцией: ♭3 вместо 3.' },
    { id: 'dim', sym: 'dim', name: 'Уменьшённое трезвучие', cat: 'triad', f: ['1', 'b3', 'b5'], req: ['b3', 'b5'], sc: ['locrian', 'dim'], d: 'Две малые терции. VII ступень мажора; неустойчиво, тянет разрешиться.' },
    { id: 'aug', sym: 'aug', name: 'Увеличенное трезвучие', cat: 'triad', f: ['1', '3', '#5'], req: ['3', '#5'], sc: ['wholetone'], d: 'Две большие терции, симметричный аккорд: каждое обращение — снова увеличенное трезвучие.' },
    { id: 'sus2', sym: 'sus2', name: 'Задержание (sus2)', cat: 'triad', f: ['1', '2', '5'], req: ['2', '5'], sc: ['ionian', 'mixolydian', 'majpent'], d: 'Терция заменена на секунду: ни мажор, ни минор, «открытое» звучание.' },
    { id: 'sus4', sym: 'sus4', name: 'Задержание (sus4)', cat: 'triad', f: ['1', '4', '5'], req: ['4', '5'], sc: ['mixolydian', 'ionian'], d: 'Терция заменена на кварту; обычно разрешается в мажор (4 → 3).' },
    { id: '5', sym: '5', name: 'Квинта (пауэр-аккорд)', cat: 'triad', f: ['1', '5'], req: ['5'], sc: ['minpent', 'blues', 'aeolian'], d: 'Только тоника и квинта — основа рок-риффов, особенно с перегрузом.' },

    { id: 'maj7', sym: 'maj7', name: 'Большой мажорный септаккорд', cat: 'seventh', f: ['1', '3', '5', '7'], req: ['3', '7'], sc: ['ionian', 'lydian'], d: 'Мажор + большая септима. I и IV ступени мажора, мягкое «джазовое» звучание.' },
    { id: '7', sym: '7', name: 'Доминантсептаккорд', cat: 'seventh', f: ['1', '3', '5', 'b7'], req: ['3', 'b7'], sc: ['mixolydian', 'blues', 'majpent', 'bebopdom'], d: 'Мажор + малая септима. V ступень; в блюзе — все аккорды формы. Тритон 3–♭7 создаёт напряжение.' },
    { id: 'm7', sym: 'm7', name: 'Малый минорный септаккорд', cat: 'seventh', f: ['1', 'b3', '5', 'b7'], req: ['b3', 'b7'], sc: ['dorian', 'aeolian', 'minpent'], d: 'II, III и VI ступени мажора. В ii–V–I это «ii».' },
    { id: 'm7b5', sym: 'm7b5', name: 'Полууменьшённый (m7♭5, ø)', cat: 'seventh', f: ['1', 'b3', 'b5', 'b7'], req: ['b5', 'b7'], sc: ['locrian', 'locrian2'], d: 'VII ступень мажора, «ii» в минорной ii–V–i. Обозначается также Ø.' },
    { id: 'dim7', sym: 'dim7', name: 'Уменьшённый септаккорд', cat: 'seventh', f: ['1', 'b3', 'b5', 'bb7'], req: ['b3', 'b5', 'bb7'], sc: ['wholehalf'], d: 'Три малые терции подряд — симметричный: любая нота может быть басом. Проходящий аккорд.' },
    { id: 'mMaj7', sym: 'm(maj7)', name: 'Минорный с большой септимой', cat: 'seventh', f: ['1', 'b3', '5', '7'], req: ['b3', '7'], sc: ['melmin', 'harmmin'], d: 'Тоника мелодического/гармонического минора; «шпионское» звучание.' },
    { id: '6', sym: '6', name: 'Мажорный секстаккорд', cat: 'seventh', f: ['1', '3', '5', '6'], req: ['3', '6'], sc: ['ionian', 'majpent'], d: 'Тоника в свинге и раннем джазе. C6 = Am7 с басом C.' },
    { id: 'm6', sym: 'm6', name: 'Минорный секстаккорд', cat: 'seventh', f: ['1', 'b3', '5', '6'], req: ['b3', '6'], sc: ['dorian', 'melmin'], d: 'Минорная тоника в джазе (Cm6). Большая секста даёт дорийский цвет.' },
    { id: '7sus4', sym: '7sus4', name: 'Доминанта с задержанием', cat: 'seventh', f: ['1', '4', '5', 'b7'], req: ['4', 'b7'], sc: ['mixolydian', 'dorian'], d: 'Доминанта без терции. Часто разрешается в обычный 7.' },

    { id: 'maj9', sym: 'maj9', name: 'Мажорный нонаккорд', cat: 'ext', f: ['1', '3', '5', '7', '9'], req: ['3', '7', '9'], sc: ['ionian', 'lydian'], d: 'maj7 + нона. Заменяет maj7 почти всегда.' },
    { id: '9', sym: '9', name: 'Доминантовый нонаккорд', cat: 'ext', f: ['1', '3', '5', 'b7', '9'], req: ['3', 'b7', '9'], sc: ['mixolydian', 'bebopdom'], d: 'Самая частая замена 7 в блюзе, фанке и джазе.' },
    { id: 'm9', sym: 'm9', name: 'Минорный нонаккорд', cat: 'ext', f: ['1', 'b3', '5', 'b7', '9'], req: ['b3', 'b7', '9'], sc: ['dorian', 'aeolian'], d: 'm7 + нона. Мягкий современный минор.' },
    { id: '69', sym: '6/9', name: 'Секстнонаккорд (6/9)', cat: 'ext', f: ['1', '3', '5', '6', '9'], req: ['3', '6', '9'], sc: ['majpent', 'ionian', 'lydian'], d: 'Мажорная тоника без септимы — по сути мажорная пентатоника в аккорде.' },
    { id: 'add9', sym: 'add9', name: 'Мажор с добавленной ноной', cat: 'ext', f: ['1', '3', '5', '9'], req: ['3', '9'], sc: ['ionian', 'majpent'], d: 'Трезвучие + нона без септимы. Поп, рок, баллады.' },
    { id: 'madd9', sym: 'm(add9)', name: 'Минор с добавленной ноной', cat: 'ext', f: ['1', 'b3', '5', '9'], req: ['b3', '9'], sc: ['aeolian', 'dorian'], d: 'Минорное трезвучие + нона, без септимы.' },
    { id: '9sus4', sym: '9sus4', name: 'Нонаккорд с задержанием (11)', cat: 'ext', f: ['1', '4', '5', 'b7', '9'], req: ['4', 'b7', '9'], sc: ['mixolydian', 'dorian'], d: 'Часто пишут C11 или Bb/C. Модальный джаз, соул, фьюжн.' },
    { id: 'm11', sym: 'm11', name: 'Минорный ундецимаккорд', cat: 'ext', f: ['1', 'b3', '5', 'b7', '9', '11'], req: ['b3', 'b7', '11'], sc: ['dorian', 'minpent'], d: 'Минор с квартовым звучанием; хорошо ложится под минорную пентатонику.' },
    { id: 'maj7s11', sym: 'maj7#11', name: 'Лидийский мажор (maj7♯11)', cat: 'ext', f: ['1', '3', '5', '7', '#11'], req: ['3', '7', '#11'], sc: ['lydian'], d: 'IV ступень мажора, лидийский лад. «Воздушное» звучание.' },
    { id: '13', sym: '13', name: 'Доминантовый терцдецимаккорд', cat: 'ext', f: ['1', '3', '5', 'b7', '9', '13'], req: ['3', 'b7', '13'], sc: ['mixolydian', 'bebopdom'], d: 'Доминанта с 13 (= 6). Блюз, свинг, фанк. Квинту и нону обычно опускают.' },
    { id: 'm13', sym: 'm13', name: 'Минорный терцдецимаккорд', cat: 'ext', f: ['1', 'b3', '5', 'b7', '9', '13'], req: ['b3', 'b7', '13'], sc: ['dorian'], d: 'Дорийский минор: m7 + 13 (большая секста).' },

    { id: '7b9', sym: '7b9', name: 'Доминанта с малой ноной', cat: 'alt', f: ['1', '3', '5', 'b7', 'b9'], req: ['3', 'b7', 'b9'], sc: ['wholehalf', 'phrdom'], d: 'Острая доминанта, особенно перед минором. Без корня = уменьшённый септаккорд.' },
    { id: '7s9', sym: '7#9', name: 'Доминанта с увеличенной ноной', cat: 'alt', f: ['1', '3', '5', 'b7', '#9'], req: ['3', 'b7', '#9'], sc: ['blues', 'altered', 'wholehalf'], d: '«Аккорд Хендрикса»: одновременно мажорная терция и «минорная» (#9). Блюз-рок и фанк.' },
    { id: '7s11', sym: '7#11', name: 'Лидийская доминанта', cat: 'alt', f: ['1', '3', '5', 'b7', '#11'], req: ['3', 'b7', '#11'], sc: ['lyddom'], d: 'Доминанта, которая не обязательно разрешается: bII7, IV7 в блюзе, тритоновые замены.' },
    { id: '7s5', sym: '7#5', name: 'Увеличенная доминанта (7♯5 / 7♭13)', cat: 'alt', f: ['1', '3', '#5', 'b7'], req: ['3', '#5', 'b7'], sc: ['wholetone', 'altered'], d: 'Повышенная квинта тянется вверх, в терцию следующего аккорда.' },
    { id: '13b9', sym: '13b9', name: 'Доминанта 13♭9', cat: 'alt', f: ['1', '3', '5', 'b7', 'b9', '13'], req: ['3', 'b7', 'b9', '13'], sc: ['wholehalf'], d: 'Звучание уменьшённого лада (полутон–тон): ♭9 и 13 вместе.' },
    { id: '7alt', sym: '7alt', name: 'Альтерированная доминанта', cat: 'alt', f: ['1', '3', 'b7', 'b9', '#9', '#11', 'b13'], req: ['3', 'b7'], alt: true, sc: ['altered'], d: 'Доминанта со всеми альтерациями: ♭9, ♯9, ♯11, ♭13. Максимальное напряжение перед разрешением.' }
  ];
  const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));
  const CATS = [
    { id: 'triad', name: 'Трезвучия' },
    { id: 'shell', name: 'Shell' },
    { id: 'seventh', name: 'Септаккорды' },
    { id: 'ext', name: 'Надстройки' },
    { id: 'alt', name: 'Альтерации' }
  ];
  const SHELL_TYPES = ['maj7', '7', 'm7', 'm7b5', 'dim7', '6', 'm6', 'mMaj7', '7sus4'];
  const typesInCat = c => c === 'shell' ? SHELL_TYPES.map(id => TYPE[id]) : TYPES.filter(t => t.cat === c);

  function intervalName(type, semi) {
    semi = ((semi % 12) + 12) % 12;
    const f = TYPE[type] ? TYPE[type].f : [];
    const hit = f.find(iv => IV[iv][0] === semi);
    return hit || DEFAULT_IV[semi];
  }
  const chordName = (rootPc, type) => rootByPc(rootPc).n + TYPE[type].sym;
  const chordNotes = (rootPc, type) => TYPE[type].f.map(iv => spell(rootByPc(rootPc).n, iv));

  // ---------- лады ----------
  const SCALES = {
    ionian: { name: 'Ионийский (мажор)', f: ['1', '2', '3', '4', '5', '6', '7'], d: 'Натуральный мажор. Над maj7, maj9, 6.' },
    dorian: { name: 'Дорийский', f: ['1', '2', 'b3', '4', '5', '6', 'b7'], d: 'Минор с большой секстой. Главный лад над m7 в джазе, фанке, роке (Santana).' },
    phrygian: { name: 'Фригийский', f: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'], d: 'Минор с ♭2 — испанский, металлический колорит.' },
    lydian: { name: 'Лидийский', f: ['1', '2', '3', '#4', '5', '6', '7'], d: 'Мажор с ♯4. Над maj7♯11, IV ступень.' },
    mixolydian: { name: 'Миксолидийский', f: ['1', '2', '3', '4', '5', '6', 'b7'], d: 'Мажор с ♭7. Над доминантой 7, 9, 13; рок и блюз.' },
    aeolian: { name: 'Эолийский (натуральный минор)', f: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], d: 'Натуральный минор. Рок, поп, баллады.' },
    locrian: { name: 'Локрийский', f: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'], d: 'Над m7♭5 (полууменьшённым).' },
    minpent: { name: 'Минорная пентатоника', f: ['1', 'b3', '4', '5', 'b7'], d: 'Пять нот без полутонов. Главный «язык» блюза и рока.' },
    majpent: { name: 'Мажорная пентатоника', f: ['1', '2', '3', '5', '6'], d: 'Светлая пентатоника: кантри, соул, мажорный блюз (B.B. King).' },
    blues: { name: 'Блюзовый лад', f: ['1', 'b3', '4', 'b5', '5', 'b7'], d: 'Минорная пентатоника + «блюзовая нота» ♭5.' },
    majblues: { name: 'Мажорный блюзовый', f: ['1', '2', 'b3', '3', '5', '6'], d: 'Мажорная пентатоника + ♭3 как проходящая к 3.' },
    bebopdom: { name: 'Бибоп-доминантовый', f: ['1', '2', '3', '4', '5', '6', 'b7', '7'], d: 'Миксолидийский + проходящая 7. Восемь нот: аккордовые звуки попадают на сильные доли.' },
    melmin: { name: 'Мелодический минор', f: ['1', '2', 'b3', '4', '5', '6', '7'], d: 'Минор с большими 6 и 7. Над m(maj7), m6.' },
    harmmin: { name: 'Гармонический минор', f: ['1', '2', 'b3', '4', '5', 'b6', '7'], d: 'Минор с большой септимой — даёт доминанту V7 в миноре.' },
    phrdom: { name: 'Фригийская доминанта', f: ['1', 'b2', '3', '4', '5', 'b6', 'b7'], d: '5-й лад гармонического минора. Над V7♭9 в миноре.' },
    altered: { name: 'Альтерированный (суперлокрийский)', f: ['1', 'b9', '#9', '3', '#11', 'b13', 'b7'], d: '7-й лад мелодического минора. Над 7alt: все альтерации сразу.' },
    lyddom: { name: 'Лидийская доминанта', f: ['1', '2', '3', '#11', '5', '13', 'b7'], d: '4-й лад мелодического минора. Над 7♯11, тритоновыми заменами.' },
    locrian2: { name: 'Локрийский ♮2', f: ['1', '2', 'b3', '4', 'b5', 'b6', 'b7'], d: '6-й лад мелодического минора. Над m7♭5 с ноной.' },
    wholehalf: { name: 'Уменьшённый (полутон–тон)', f: ['1', 'b9', '#9', '3', '#11', '5', '13', 'b7'], d: 'Симметричный лад из 8 нот. Над 7♭9, 13♭9, dim7.' },
    dim: { name: 'Уменьшённый (тон–полутон)', f: ['1', '2', 'b3', '4', 'b5', 'b6', '6', '7'], d: 'Над уменьшёнными аккордами dim, dim7.' },
    wholetone: { name: 'Целотонный', f: ['1', '2', '3', '#4', '#5', 'b7'], d: 'Шесть нот через тон. Над 7♯5, aug.' }
  };

  // ---------- гриф ----------
  const TUNING = [40, 45, 50, 55, 59, 64]; // индекс 0 = 6-я струна (E2), 5 = 1-я (E4)
  const si = s => 6 - s; // номер струны (1..6) → индекс
  const midiAt = (s, f) => TUNING[si(s)] + f;
  const midiName = m => pcName(m % 12) + (Math.floor(m / 12) - 1);

  // пальцы: простая эвристика «палец на лад» с баррэ, если пальцев не хватает
  function fingers(frets) {
    const fr = frets.map((f, i) => [f, i]).filter(([f]) => f != null && f > 0);
    const out = frets.map(f => f === 0 ? 0 : null);
    if (!fr.length) return out;
    const minF = Math.min(...fr.map(x => x[0]));
    const byFret = {};
    fr.forEach(([f, i]) => (byFret[f] = byFret[f] || []).push(i));
    let prev = 0;
    Object.keys(byFret).map(Number).sort((a, b) => a - b).forEach(f => {
      const idx = byFret[f];
      if (f === minF) { idx.forEach(i => out[i] = 1); prev = 1; return; }
      let start = Math.max(prev + 1, f - minF + 1);
      if (start > 4) start = 4;
      if (start + idx.length - 1 <= 4) idx.forEach((i, k) => out[i] = start + k);
      else idx.forEach(i => out[i] = start);
      prev = Math.min(4, start + idx.length - 1);
    });
    return out;
  }

  function makeVoicing(frets, rootPc, type, extra) {
    const notes = frets.map((f, i) => f == null ? null : TUNING[i] + f);
    const ivs = notes.map(m => m == null ? null : intervalName(type, m - rootPc));
    const fr = frets.filter(f => f != null && f > 0);
    return Object.assign({
      frets, notes, ivs, fingers: fingers(frets),
      minFret: fr.length ? Math.min(...fr) : 0, maxFret: fr.length ? Math.max(...fr) : 0,
      bass: ivs.find(x => x != null)
    }, extra);
  }

  // разместить «стопку» нот на струнах: strings — индексы снизу вверх, semis — высота над басом
  function placeStack(strings, semis, bassPc, maxSpan) {
    let best = null;
    const open = TUNING[strings[0]];
    for (let f0 = 0; f0 <= 17; f0++) {
      if ((open + f0) % 12 !== bassPc) continue;
      const base = open + f0;
      const frets = [null, null, null, null, null, null];
      let ok = true;
      strings.forEach((s, k) => { const f = base + semis[k] - TUNING[s]; if (f < 0 || f > 17) ok = false; frets[s] = f; });
      if (!ok) continue;
      const fr = frets.filter(f => f != null && f > 0);
      const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
      if (span > (maxSpan || 4)) continue;
      const hi = Math.max(...frets.filter(f => f != null));
      const score = hi + (frets.includes(0) ? 100 : 0) + (hi > 15 ? 200 : 0); // movable-формы без открытых струн
      if (!best || score < best.score) best = { frets, score };
    }
    return best && best.frets;
  }

  const semisOf = (type, iv) => IV[iv][0];
  const BASS_LABEL = { '1': 'бас — тоника (основной вид)', '3': 'бас — терция', 'b3': 'бас — терция', '5': 'бас — квинта', 'b5': 'бас — квинта', '#5': 'бас — квинта', '7': 'бас — септима', 'b7': 'бас — септима', 'bb7': 'бас — септима', '6': 'бас — секста', '2': 'бас — секунда', '4': 'бас — кварта' };
  const INV_NAME = ['основной вид', '1-е обращение', '2-е обращение', '3-е обращение'];
  const setName = arr => arr.map(i => 6 - i).join('-');

  // закрытые трезвучия на 4 наборах соседних струн, 3 обращения
  function triadVoicings(rootPc, type) {
    const t = TYPE[type];
    const tones = t.f.map(iv => IV[iv][0]);
    const sets = [[3, 4, 5], [2, 3, 4], [1, 2, 3], [0, 1, 2]];
    const groups = [];
    if (tones.length === 3) {
      sets.forEach(strs => {
        const items = [];
        for (let inv = 0; inv < 3; inv++) {
          const rot = tones.slice(inv).concat(tones.slice(0, inv));
          const semis = [0]; let prev = rot[0];
          for (let k = 1; k < 3; k++) { let d = (rot[k] - prev + 12) % 12; semis.push(semis[k - 1] + d); prev = rot[k]; }
          const frets = placeStack(strs, semis, (rootPc + rot[0]) % 12, 4);
          if (frets) items.push(makeVoicing(frets, rootPc, type, { label: INV_NAME[inv] }));
        }
        items.sort((a, b) => a.minFret - b.minFret);
        groups.push({ name: 'Струны ' + setName(strs), items });
      });
    } else {
      // пауэр-аккорды: 1-5 и 1-5-8 от 6-й, 5-й и 4-й струны
      [[0, 1, 2], [1, 2, 3], [2, 3, 4]].forEach(strs => {
        const a = placeStack(strs.slice(0, 2), [0, 7], rootPc, 4);
        const b = placeStack(strs, [0, 7, 12], rootPc, 4);
        const items = [];
        if (a) items.push(makeVoicing(a, rootPc, type, { label: '1–5' }));
        if (b) items.push(makeVoicing(b, rootPc, type, { label: '1–5–8' }));
        groups.push({ name: 'Корень на ' + (6 - strs[0]) + '-й струне', items });
      });
    }
    return groups;
  }

  // shell: корень + терция + септима (у m7♭5 и dim7 добавлена ♭5)
  const SHELL = {
    maj7: ['3', '7'], '7': ['3', 'b7'], m7: ['b3', 'b7'], m7b5: ['b3', 'b7', 'b5'], dim7: ['b3', 'bb7', 'b5'],
    '6': ['3', '6'], m6: ['b3', '6'], mMaj7: ['b3', '7'], '7sus4': ['4', 'b7']
  };
  function shellVoicings(rootPc, type) {
    const [g3, g7, add] = SHELL[type];
    const s3 = IV[g3][0], s7 = IV[g7][0];
    const pats = [
      { root: 6, strs: [0, 2, 3], semis: [0, s7, s3 + 12], lab: 'R–7–3' },
      { root: 6, strs: [0, 1, 2], semis: [0, s3, s7], lab: 'R–3–7' },
      { root: 5, strs: [1, 2, 3], semis: [0, s3, s7], lab: 'R–3–7' },
      { root: 5, strs: [1, 3, 4], semis: [0, s7, s3 + 12], lab: 'R–7–3' }
    ];
    const groups = [{ name: 'Корень на 6-й струне', items: [] }, { name: 'Корень на 5-й струне', items: [] }];
    pats.forEach(p => {
      let strs = p.strs.slice(), semis = p.semis.slice(), lab = p.lab;
      if (add) {
        const sa = IV[add][0];
        if (lab === 'R–3–7') { semis[1] = sa; lab = 'R–♭5–7'; }
        else { strs.push(strs[2] + 1); semis.push(sa + 12); lab = 'R–7–3–♭5'; }
      }
      const frets = placeStack(strs, semis, rootPc, 4);
      if (frets) groups[p.root === 6 ? 0 : 1].items.push(makeVoicing(frets, rootPc, type, { label: lab }));
    });
    return groups;
  }

  // drop 2 / drop 3 — четыре обращения на наборах струн
  function dropVoicings(rootPc, type, drop) {
    const tones = TYPE[type].f.map(iv => IV[iv][0]);
    if (tones.length !== 4) return [];
    const sets = drop === 2 ? [[2, 3, 4, 5], [1, 2, 3, 4], [0, 1, 2, 3]] : [[0, 2, 3, 4], [1, 3, 4, 5]];
    return sets.map(strs => {
      const items = [];
      for (let inv = 0; inv < 4; inv++) {
        const rot = tones.slice(inv).concat(tones.slice(0, inv));
        const close = [0]; let prev = rot[0];
        for (let k = 1; k < 4; k++) { close.push(close[k - 1] + (rot[k] - prev + 12) % 12); prev = rot[k]; }
        const abs = close.map((s, k) => s + rot[0]);
        let v;
        if (drop === 2) v = [abs[2] - 12, abs[0], abs[1], abs[3]];
        else v = [abs[1] - 12, abs[0], abs[2], abs[3]];
        const semis = v.map(x => x - v[0]);
        const frets = placeStack(strs, semis, ((rootPc + v[0]) % 12 + 12) % 12, 5);
        if (frets) {
          const vc = makeVoicing(frets, rootPc, type, {});
          vc.label = BASS_LABEL[vc.bass] || ('бас — ' + vc.bass);
          items.push(vc);
        }
      }
      items.sort((a, b) => a.minFret - b.minFret);
      return { name: 'Drop ' + drop + ' · струны ' + setName(strs), items };
    });
  }

  // ручные аппликатуры: эталон — корень на 3-м ладу (6-я: G, 5-я: C, 4-я: F)
  // r — струна корня; nr — без корня (корень не звучит)
  const SHAPES = [
    { t: 'maj', r: 6, f: '3 5 5 4 3 3', g: 'Баррэ' }, { t: 'maj', r: 5, f: 'x 3 5 5 5 3', g: 'Баррэ' },
    { t: 'm', r: 6, f: '3 5 5 3 3 3', g: 'Баррэ' }, { t: 'm', r: 5, f: 'x 3 5 5 4 3', g: 'Баррэ' },
    { t: 'sus4', r: 5, f: 'x 3 5 5 6 3', g: 'Баррэ' }, { t: 'sus2', r: 5, f: 'x 3 5 5 3 3', g: 'Баррэ' },
    { t: 'sus4', r: 6, f: '3 5 5 5 3 3', g: 'Баррэ' },
    { t: '7', r: 6, f: '3 5 3 4 3 3', g: 'Баррэ' }, { t: '7', r: 5, f: 'x 3 5 3 5 3', g: 'Баррэ' },
    { t: 'm7', r: 6, f: '3 5 3 3 3 3', g: 'Баррэ' }, { t: 'm7', r: 5, f: 'x 3 5 3 4 3', g: 'Баррэ' },
    { t: 'maj7', r: 5, f: 'x 3 5 4 5 3', g: 'Баррэ' }, { t: '7sus4', r: 6, f: '3 5 3 5 3 3', g: 'Баррэ' },
    { t: '7sus4', r: 5, f: 'x 3 5 3 6 3', g: 'Баррэ' },

    { t: 'maj9', r: 6, f: '3 2 4 2 3 x' }, { t: 'maj9', r: 5, f: 'x 3 2 4 3 x' }, { t: 'maj9', r: 4, f: 'x x 3 2 5 3' }, { t: 'maj9', r: 5, f: 'x x 2 4 3 3', nr: 1 },
    { t: '9', r: 6, f: '3 x 3 4 3 5' }, { t: '9', r: 5, f: 'x 3 2 3 3 3' }, { t: '9', r: 4, f: 'x x 3 2 4 3' }, { t: '9', r: 5, f: 'x x 2 3 3 3', nr: 1 },
    { t: 'm9', r: 6, f: '3 x 3 3 3 5' }, { t: 'm9', r: 5, f: 'x 3 1 3 3 x' }, { t: 'm9', r: 4, f: 'x x 3 1 4 3' }, { t: 'm9', r: 5, f: 'x x 1 3 3 3', nr: 1 },
    { t: '69', r: 6, f: '3 2 2 2 3 3' }, { t: '69', r: 5, f: 'x 3 2 2 3 3' }, { t: '69', r: 4, f: 'x x 3 2 3 3' },
    { t: 'add9', r: 6, f: '3 2 x 2 3 x' }, { t: 'add9', r: 5, f: 'x 3 2 x 3 3' },
    { t: 'madd9', r: 6, f: '3 1 x 2 3 x' }, { t: 'madd9', r: 5, f: 'x 3 1 x 3 3' },
    { t: '9sus4', r: 6, f: '3 x 3 2 1 x' }, { t: '9sus4', r: 5, f: 'x 3 3 3 3 x' },
    { t: 'm11', r: 6, f: '3 x 3 3 1 x' }, { t: 'm11', r: 5, f: 'x 3 1 3 3 1' },
    { t: 'maj7s11', r: 6, f: '3 x 4 4 2 x' }, { t: 'maj7s11', r: 5, f: 'x 3 2 4 x 2' },
    { t: '13', r: 6, f: '3 x 3 4 5 x' }, { t: '13', r: 5, f: 'x 3 x 3 5 5' }, { t: '13', r: 5, f: 'x x 2 3 3 5', nr: 1 },
    { t: 'm13', r: 6, f: '3 x 3 3 5 5' }, { t: 'm13', r: 5, f: 'x 3 1 3 3 5' },

    { t: '7b9', r: 6, f: '3 x 3 4 3 4' }, { t: '7b9', r: 5, f: 'x 3 2 3 2 x' }, { t: '7b9', r: 5, f: 'x x 2 3 2 3', nr: 1 },
    { t: '7s9', r: 6, f: '3 2 3 3 x x' }, { t: '7s9', r: 5, f: 'x 3 2 3 4 x' },
    { t: '7s11', r: 6, f: '3 x 3 4 2 x' }, { t: '7s11', r: 5, f: 'x 3 2 3 x 2' },
    { t: '7s5', r: 6, f: '3 x 3 4 4 x' }, { t: '7s5', r: 5, f: 'x 3 x 3 5 4' },
    { t: '13b9', r: 6, f: '3 x 3 4 5 4' }, { t: '13b9', r: 5, f: 'x 3 2 3 2 5' },
    { t: '7alt', r: 6, f: '3 x 3 4 4 4' }, { t: '7alt', r: 5, f: 'x 3 2 3 4 4' }, { t: '7alt', r: 5, f: 'x x 2 3 4 4', nr: 1 }
  ];
  const parseFrets = s => s.split(' ').map(x => x === 'x' ? null : +x);
  const refPc = r => (TUNING[si(r)] + 3) % 12;

  function shapeVoicing(sh, rootPc) {
    const base = parseFrets(sh.f);
    const delta = (rootPc - refPc(sh.r) + 12) % 12;
    let best = null;
    [delta - 12, delta].forEach(d => {
      const fr = base.map(f => f == null ? null : f + d);
      if (fr.some(f => f != null && f < 0)) return;
      const hi = Math.max(...fr.filter(f => f != null));
      const score = hi + (fr.includes(0) ? 100 : 0) + (hi > 15 ? 200 : 0);
      if (!best || score < best.score) best = { fr, score };
    });
    return makeVoicing(best.fr, rootPc, sh.t, { label: sh.nr ? 'без корня' : 'корень на ' + sh.r + '-й', rootless: !!sh.nr });
  }
  function handGroups(rootPc, type) {
    const list = SHAPES.filter(s => s.t === type);
    if (!list.length) return [];
    const by = {};
    list.forEach(sh => {
      const g = sh.g || (sh.nr ? 'Без корня (rootless)' : 'Корень на ' + sh.r + '-й струне');
      (by[g] = by[g] || []).push(shapeVoicing(sh, rootPc));
    });
    return Object.keys(by).map(name => ({ name, items: by[name] }));
  }

  // все аппликатуры аккорда для категории
  function voicings(rootPc, type, cat) {
    if (cat === 'shell') return shellVoicings(rootPc, type);
    if (cat === 'triad') return triadVoicings(rootPc, type).concat(handGroups(rootPc, type));
    if (cat === 'seventh') return dropVoicings(rootPc, type, 2).concat(dropVoicings(rootPc, type, 3), handGroups(rootPc, type));
    return handGroups(rootPc, type);
  }
  const allVoicings = (rootPc, type) => {
    const cat = TYPE[type].cat;
    let g = voicings(rootPc, type, cat);
    if (SHELL[type]) g = g.concat(shellVoicings(rootPc, type));
    return g.flatMap(x => x.items);
  };

  // аппликатура для аккомпанемента: средний регистр, 3–4 ноты
  function compVoicing(rootPc, type, prefer) {
    let pool = [];
    if (type === '5') pool = triadVoicings(rootPc, '5')[0].items.slice(1).concat(triadVoicings(rootPc, '5')[1].items.slice(1));
    else if (TYPE[type].cat === 'triad') pool = triadVoicings(rootPc, type)[1].items.concat(triadVoicings(rootPc, type)[2].items);
    else if (TYPE[type].f.length === 4 && SHELL[type]) pool = dropVoicings(rootPc, type, 2)[1].items.concat(dropVoicings(rootPc, type, 3)[0].items);
    else pool = handGroups(rootPc, type).flatMap(g => g.items).filter(v => !v.rootless);
    if (!pool.length) pool = allVoicings(rootPc, type);
    const target = prefer || 5;
    pool.sort((a, b) => Math.abs((a.minFret + a.maxFret) / 2 - target) - Math.abs((b.minFret + b.maxFret) / 2 - target));
    return pool[0];
  }

  // ноты лада на грифе в диапазоне ладов
  function scaleFrets(rootPc, scaleId, from, to) {
    const set = SCALES[scaleId].f.map(iv => IV[iv][0]);
    const out = [];
    for (let s = 0; s < 6; s++) for (let f = from; f <= to; f++) {
      const semi = ((TUNING[s] + f - rootPc) % 12 + 12) % 12;
      const k = set.indexOf(semi);
      if (k >= 0) out.push({ s: 6 - s, f, iv: SCALES[scaleId].f[k], midi: TUNING[s] + f });
    }
    return out;
  }
  const scaleNotes = (rootPc, scaleId) => SCALES[scaleId].f.map(iv => spell(rootByPc(rootPc).n, iv));

  // диатонические септаккорды
  const DIATONIC = {
    major: { name: 'Мажор', steps: [[0, 'maj7', 'I'], [2, 'm7', 'ii'], [4, 'm7', 'iii'], [5, 'maj7', 'IV'], [7, '7', 'V'], [9, 'm7', 'vi'], [11, 'm7b5', 'vii']] },
    minor: { name: 'Натуральный минор', steps: [[0, 'm7', 'i'], [2, 'm7b5', 'ii'], [3, 'maj7', '♭III'], [5, 'm7', 'iv'], [7, 'm7', 'v'], [8, 'maj7', '♭VI'], [10, '7', '♭VII']] },
    harm: { name: 'Гармонический минор', steps: [[0, 'mMaj7', 'i'], [2, 'm7b5', 'ii'], [3, 'maj7', '♭III+'], [5, 'm7', 'iv'], [7, '7', 'V'], [8, 'maj7', '♭VI'], [11, 'dim7', 'vii°']] }
  };

  // ---------- прогрессии для подложек ----------
  // [смещение от тоники, тип, долей]
  const PROGS = [
    { id: 'blues12', name: 'Блюз 12 тактов', style: 'shuffle', key: 9, bpm: 96, sc: [['blues', 0], ['majpent', 0]], bars: [[0, '7'], [5, '7'], [0, '7'], [0, '7'], [5, '7'], [5, '7'], [0, '7'], [0, '7'], [7, '7'], [5, '7'], [0, '7'], [7, '7']] },
    { id: 'minblues', name: 'Минорный блюз', style: 'shuffle', key: 9, bpm: 84, sc: [['minpent', 0], ['dorian', 0]], bars: [[0, 'm7'], [0, 'm7'], [0, 'm7'], [0, 'm7'], [5, 'm7'], [5, 'm7'], [0, 'm7'], [0, 'm7'], [8, '7'], [7, '7'], [0, 'm7'], [7, '7']] },
    { id: 'jazzblues', name: 'Джазовый блюз', style: 'swing', key: 5, bpm: 120, sc: [['blues', 0], ['mixolydian', 0]], bars: [[0, '7'], [5, '7'], [0, '7'], [[7, 'm7'], [0, '7']], [5, '7'], [[6, 'dim7']], [0, '7'], [[4, 'm7'], [9, '7']], [7, 'm7'], [0, '7'], [[0, '7'], [9, '7']], [[2, 'm7'], [7, '7']]] },
    { id: '251', name: 'ii–V–I мажор', style: 'swing', key: 0, bpm: 110, sc: [['ionian', 0]], bars: [[2, 'm7'], [7, '7'], [0, 'maj7'], [0, 'maj7']] },
    { id: '251min', name: 'ii–V–i минор', style: 'swing', key: 0, bpm: 100, sc: [['harmmin', 0]], bars: [[2, 'm7b5'], [7, '7b9'], [0, 'm6'], [0, 'm6']] },
    { id: 'rock1', name: 'Рок: I–♭VII–IV', style: 'rock', key: 4, bpm: 112, sc: [['mixolydian', 0], ['minpent', 0]], bars: [[0, '5'], [10, '5'], [5, '5'], [0, '5']] },
    { id: 'rock2', name: 'Рок: i–♭VI–♭VII', style: 'rock', key: 9, bpm: 100, sc: [['aeolian', 0], ['minpent', 0]], bars: [[0, 'm'], [0, 'm'], [8, 'maj'], [10, 'maj']] },
    { id: 'modal', name: 'Модальный: Dm7 (дорийский)', style: 'swing', key: 2, bpm: 130, sc: [['dorian', 0], ['minpent', 0]], bars: [[0, 'm7'], [0, 'm7'], [0, 'm7'], [0, 'm7']] }
  ];

  const api = {
    LETTERS, ROOTS, rootByPc, pcName, IV, IV_NAMES, spell, pretty, TYPES, TYPE, CATS, typesInCat, SHELL_TYPES,
    intervalName, chordName, chordNotes, SCALES, TUNING, midiAt, midiName, si,
    voicings, allVoicings, compVoicing, triadVoicings, shellVoicings, dropVoicings, handGroups, SHAPES, parseFrets, refPc,
    scaleFrets, scaleNotes, DIATONIC, PROGS, fingers
  };
  root.Music = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Шаблоны текстов, подсчёт слогов, проверка рифмы и генератор новых шаблонов.
//
// Шаблон: { id, name, about, sections: [{ title, lines: [...] }] }
// Строка:
//   { syl: 2 }                    — любые слова, ровно 2 слога
//   { start: 'ты', syl: 5 }       — начинается с «ты», всего 5 слогов
//   { start: 'и в твоём' }        — начинается с «и в твоём», длина свободная
//   { fixed: 'он был' }           — готовая строка, её не пишут
//   { frame: 'сделайте… и я…' }   — заполнить конструкцию своими словами
//   rhyme: 4                      — рифма на 4-ю строку этой же части
(function (root) {
  const VOWELS = 'аеёиоуыэюяaeiouy';

  // В русском слове слогов столько же, сколько гласных.
  function syllables(text) {
    let n = 0;
    for (const ch of String(text).toLowerCase()) if (VOWELS.includes(ch)) n++;
    return n;
  }

  function lastWord(text) {
    const words = String(text).toLowerCase().match(/[a-zа-яё-]+/g);
    if (!words) return '';
    for (let i = words.length - 1; i >= 0; i--) if (syllables(words[i])) return words[i].replace(/-/g, '');
    return '';
  }

  // Звучание конца слова: йотированные гласные и звонкие на конце сводятся к парным.
  const VOWEL_SOUND = { я: 'а', ю: 'у', е: 'э', ё: 'о', ы: 'и' };
  const DEVOICE = { б: 'п', в: 'ф', г: 'к', д: 'т', ж: 'ш', з: 'с' };
  function tail(word) {
    let i = word.length - 1;
    while (i >= 0 && !VOWELS.includes(word[i])) i--;
    if (i < 0) return null;
    const vowel = VOWEL_SOUND[word[i]] || word[i];
    let cons = word.slice(i + 1).replace(/[ьъ]/g, '');
    cons = cons.split('').map((c, k) => (k === cons.length - 1 && DEVOICE[c]) || c).join('');
    return { vowel, cons };
  }

  // 'rhyme' — рифма, 'near' — созвучие (совпадает последняя гласная), null — не рифмуется.
  function rhymeQuality(a, b) {
    const wa = lastWord(a), wb = lastWord(b);
    if (!wa || !wb) return null;
    if (wa === wb) return 'same';
    const ta = tail(wa), tb = tail(wb);
    if (!ta || !tb || ta.vowel !== tb.vowel) return null;
    return ta.cons === tb.cons ? 'rhyme' : 'near';
  }

  // ---------- Исходные шаблоны ----------

  const s = (n, extra) => Object.assign({ syl: n }, extra);

  const BASE = [
    {
      id: 'base-on-byl', name: 'Он был', about: 'Строки по 2 слога, каждая четверостишие — с опорного слова.',
      sections: [
        { title: 'Куплет', lines: [
          { fixed: 'он был' }, s(2), s(2), s(2),
          { fixed: 'один' }, s(2), s(2), s(2, { rhyme: 4 }),
          { fixed: 'забыл' }, s(2), s(2), s(2),
          { fixed: 'и не' }, s(2), s(2), s(2, { rhyme: 12 }),
        ] },
        { title: 'Припев', lines: [s(4)] },
      ],
    },
    {
      id: 'base-ne-mogu-ponyat', name: 'Я не могу понять', about: '«Ты» и «я» по 5 слогов, остальное по 6, рефрен в конце.',
      sections: [
        { title: 'Куплет', lines: [
          { start: 'ты', syl: 5 }, s(6), { start: 'я', syl: 5 }, s(6, { rhyme: 2 }),
          { fixed: 'я не могу понять' }, s(6), s(6), s(6, { rhyme: 6 }),
        ] },
        { title: 'Припев', lines: [s(2), s(6, { rhyme: 4 }), s(6), { fixed: 'я не могу понять' }] },
      ],
    },
    {
      id: 'base-moy-tip', name: 'Это мой тип', about: 'Все строки по 7 слогов, три из них — с готового начала.',
      sections: [
        { title: 'Куплет', lines: [
          { start: 'это мой тип', syl: 7 }, s(7), { start: 'это мой тип', syl: 7 }, s(7, { rhyme: 2 }),
          { start: 'я не прошу', syl: 7 }, s(7), s(7), s(7, { rhyme: 6 }),
        ] },
      ],
    },
    {
      id: 'base-ramki', name: 'Рамки', about: 'Готовые конструкции — заполни их своими словами.',
      sections: [
        { title: 'Куплет', lines: [
          { frame: 'сделайте… и я…' },
          { frame: 'они говорили…, но…' },
          { frame: 'я не (кто-то), …' },
          { frame: 'мне похуй, …' },
          { frame: 'так много людей…' },
          { frame: 'я (что-то делаю) так, что…, но…' },
          { frame: 'какой нахуй…, я что…' },
          { frame: 'я не (кто-то), но…' },
        ] },
      ],
    },
    {
      id: 'base-inogda', name: 'Иногда', about: 'Длинный текст из строк по 3 слога с опорными словами.',
      sections: [
        { title: 'Куплет', lines: [
          { fixed: 'иногда' }, s(3), s(3), s(3),
          { fixed: 'иногда' }, s(3), s(3), s(3, { rhyme: 4 }),
          { fixed: 'мы могли' }, s(3), s(3), s(3),
          s(3), s(3), s(3), s(3, { rhyme: 12 }),
          { start: 'ты', syl: 3 }, s(3), s(3), s(3),
          { start: 'я', syl: 3 }, s(3), s(3), s(3, { rhyme: 20 }),
          { start: 'и в твоём' }, s(3), s(3), s(3),
          s(3), s(3), s(3), s(3, { rhyme: 28 }),
        ] },
      ],
    },
  ];

  // ---------- Генератор ----------

  // Короткие опорные слова для строк по 2–4 слога.
  const ANCHORS = [
    'ты', 'я', 'мы', 'он', 'там', 'здесь', 'всё', 'нет', 'где', 'как',
    'он был', 'один', 'забыл', 'и не', 'опять', 'всегда', 'никто', 'зачем', 'потом', 'сейчас', 'вчера', 'куда',
    'она', 'не жди', 'и ты', 'а я', 'прости', 'молчи', 'смотри', 'держись', 'домой', 'без слов', 'с тобой', 'во мне',
    'иногда', 'мы могли', 'навсегда', 'без тебя', 'посмотри', 'каждый день', 'я хочу', 'по ночам', 'и опять',
    'я любил', 'мы с тобой', 'никогда', 'просто так', 'это всё', 'не звони', 'в тишине', 'до утра', 'я один',
    'это мой тип', 'я не прошу', 'я не могу', 'мне всё равно', 'ты говоришь', 'каждую ночь', 'все говорят',
    'я не хочу', 'если бы ты', 'мы были там', 'больше не жди',
  ];

  // Пары начал для строк 1 и 3 в куплетах из длинных строк.
  const PAIRS = [
    ['ты', 'я'], ['ты', 'я'], ['это мой тип', 'это мой тип'], ['ты говоришь', 'я говорю'], ['мне снится', 'мне снится'],
    ['ты хочешь', 'я хочу'], ['вы видите', 'я вижу'], ['она', 'а я'], ['вчера', 'сегодня'], ['мы были', 'мы будем'],
    ['ты знаешь', 'я знаю'], ['каждый раз', 'каждый раз'], ['я помню', 'я помню'], ['где-то там', 'где-то здесь'],
    ['мама', 'папа'], ['они', 'а мы'], ['утром', 'ночью'], ['ты ждёшь', 'я жду'],
  ];

  // Начало пятой строки, если вместо рефрена — ещё одно опорное слово.
  const TURNS = ['я не прошу', 'я не хочу', 'я не боюсь', 'я не забыл', 'мне не нужны', 'но я опять', 'и я молчу',
    'я ухожу', 'я не держу', 'я не люблю', 'я не скажу'];

  // Готовые строки-рефрены.
  const REFRAINS = [
    'я не могу понять', 'я больше не вернусь', 'никто не виноват', 'всё будет хорошо', 'не отпускай меня',
    'и снова тишина', 'я помню этот день', 'зачем нам это всё', 'так было всегда', 'это не про нас', 'останься со мной',
    'давай не сейчас', 'мы были детьми', 'ты знаешь сама', 'мне некуда идти', 'я не хочу домой', 'это моя жизнь',
    'никто не говорил', 'я не умею ждать', 'мне не о чем жалеть', 'я не хочу быть как все', 'ты никогда не поймёшь',
    'мы не вернёмся назад', 'я никому не скажу', 'это последний раз', 'я так и не уснул',
  ];

  // Конструкции для шаблонов-рамок.
  const FRAMES = [
    'сделайте… и я…', 'они говорили…, но…', 'я не (кто-то), …', 'мне похуй, …', 'так много людей…',
    'я (что-то делаю) так, что…, но…', 'какой нахуй…, я что…', 'я не (кто-то), но…',
    'все думают, что…, а я…', 'если бы…, я бы…', 'каждый раз, когда…, я…', 'мне говорят: «…», а я…',
    'я помню, как…', 'никто не знает, что…', 'дайте мне…, и я…', 'я был (кем-то), теперь…', 'пока вы…, я…',
    'зачем мне…, если…', 'у меня нет…, зато…', 'я не прошу…, просто…', 'вы видите…, а я вижу…',
    'мама говорила: «…»', 'я слишком (какой-то), чтобы…', 'это не…, это…', 'сколько ещё…?', 'я сделал…, чтобы…',
    'не надо…, я сам…', 'мне не нужно…, мне нужно…', 'вчера…, сегодня…', 'я (кто-то), и я…',
    'они хотят, чтобы я…', 'я не такой, как…', 'смотри, как я…', 'я бы мог…, но…', 'где были вы, когда…?',
    'мне снится, что…', 'я не верю в…, я верю в…', 'мой город…, мои люди…',
  ];

  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const chance = (p) => Math.random() < p;
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const slogov = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'слог' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'слога' : 'слогов');

  // Опорное слово: если оно занимает всю строку — строка готовая, иначе — начало строки.
  const anchorLine = (a, n) => (syllables(a) === n ? { fixed: a } : { start: a, syl: n });

  // Короткие строки, каждое четверостишие — с опорного слова (как «Он был» и «Иногда»).
  function genAnaphora(n) {
    const blocks = rnd([1, 2, 2, 2, 3, 4]);
    let pool = shuffle(ANCHORS.filter((a) => syllables(a) <= n && syllables(a) >= Math.max(1, n - 2)));
    // Лучше, когда опора занимает всю строку — таких берём первыми почаще.
    pool = pool.filter((a) => syllables(a) === n).concat(pool.filter((a) => syllables(a) !== n));
    pool = shuffle(pool.slice(0, 8)).concat(pool.slice(8));
    const lines = [];
    let k = 0;
    for (let q = 0; q < blocks * 2; q++) {
      const useAnchor = q === 0 || chance(0.8);
      lines.push(useAnchor && k < pool.length ? anchorLine(pool[k++], n) : s(n));
      lines.push(s(n), s(n));
      // Рифма — последняя строка второго четверостишия на последнюю строку первого.
      lines.push(q % 2 === 1 ? s(n, { rhyme: lines.length - 3 }) : s(n));
    }
    if (chance(0.25)) {
      // Иногда рифмуются ещё и вторые строки четверостиший.
      for (let i = 5; i < lines.length; i += 8) if (!lines[i].fixed && !lines[i].start) lines[i].rhyme = i - 3;
    }
    const sections = [{ title: 'Куплет', lines }];
    if (chance(0.6)) {
      const m = rnd([n * 2, n * 2, 4, 5, 6]);
      sections.push({ title: 'Припев', lines: chance(0.5) ? [s(m)] : [s(m), s(m, { rhyme: 1 })] });
    }
    const first = lines[0].fixed || lines[0].start;
    return { name: cap(first) + ' · ' + slogov(n), about: 'Строки по ' + slogov(n) + ', четверостишия начинаются с опорных слов.', sections };
  }

  // Длинные строки, пары «ты… / я…» и рефрен (как «Я не могу понять» и «Это мой тип»).
  function genPairs(n) {
    const n2 = chance(0.5) ? n : n + 1; // длина чётных строк
    const pairs = PAIRS.filter(([a, b]) => syllables(a) < n && syllables(b) < n);
    const [a, b] = rnd(pairs);
    const refrains = REFRAINS.filter((r) => syllables(r) === n2);
    const useRefrain = refrains.length && chance(0.65);
    const refrain = useRefrain ? rnd(refrains) : null;
    const turns = TURNS.filter((t) => syllables(t) < n2);
    const fifth = refrain ? { fixed: refrain } : turns.length ? { start: rnd(turns), syl: n2 } : s(n2);
    const lines = [
      { start: a, syl: n }, s(n2), { start: b, syl: n }, s(n2, { rhyme: 2 }),
      fifth, s(n2), s(n2), s(n2, { rhyme: 6 }),
    ];
    const sections = [{ title: 'Куплет', lines }];
    if (refrain && chance(0.6)) {
      sections.push({ title: 'Припев', lines: [s(rnd([2, 2, 3])), s(n2, { rhyme: 4 }), s(n2), { fixed: refrain }] });
    } else if (chance(0.3)) {
      sections.push({ title: 'Куплет 2', lines: lines.map((l) => Object.assign({}, l)) });
    }
    const name = refrain ? cap(refrain) : cap(a) + '… ' + b + '…';
    const lens = n === n2 ? slogov(n) : n + ' и ' + slogov(n2);
    return { name: name + ' · ' + lens, about: 'Строки по ' + lens + ', готовые начала' + (refrain ? ' и рефрен.' : '.'), sections };
  }

  // Конструкции, которые надо заполнить (как «Рамки»).
  function genFrames() {
    const count = rnd([6, 8, 8, 8]);
    const picked = shuffle(FRAMES).slice(0, count);
    const rhymed = chance(0.4);
    const lines = picked.map((f, i) => (rhymed && i % 2 === 1 ? { frame: f, rhyme: i } : { frame: f }));
    return { name: 'Рамки · ' + count + ' строк', about: rhymed ? 'Заполни конструкции, соседние строки рифмуются.' : 'Заполни конструкции своими словами, рифма по желанию.', sections: [{ title: 'Куплет', lines }] };
  }

  // kind: 'any' | 'short' | 'long' | 'frames'; syl: число слогов или 0 (любое).
  function generate(kind, syl) {
    kind = kind || 'any';
    if (kind === 'any') kind = syl ? (syl <= 4 ? 'short' : 'long') : rnd(['short', 'short', 'long', 'long', 'frames']);
    let t;
    if (kind === 'frames') t = genFrames();
    else if (kind === 'short') t = genAnaphora(syl || rnd([2, 2, 3, 3, 4]));
    else t = genPairs(Math.max(syl || rnd([5, 6, 6, 7]), 3));
    t.id = 'gen-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    t.generated = true;
    return t;
  }

  // Подпись к строке шаблона: что в ней писать.
  function lineHint(l) {
    if (l.fixed) return 'готовая строка';
    if (l.frame) return 'конструкция';
    if (l.start && l.syl) {
      const rest = l.syl - syllables(l.start);
      return '«' + l.start + '» + ещё ' + slogov(rest);
    }
    if (l.start) return '«' + l.start + '…» — продолжи';
    return slogov(l.syl);
  }

  root.Lyrics = { BASE, generate, syllables, lastWord, rhymeQuality, lineHint, slogov, FRAMES, ANCHORS, REFRAINS, PAIRS, TURNS };
  if (typeof module !== 'undefined') module.exports = root.Lyrics;
})(typeof window !== 'undefined' ? window : globalThis);

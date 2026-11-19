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

  function vowelSequence(text) {
    return [...String(text).toLowerCase()].filter((ch) => VOWELS.includes(ch));
  }

  function parseVowelPattern(value, maxPosition) {
    const pattern = {};
    const errors = [];
    const parts = String(value || '').split(/[;,]+/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const match = part.match(/^(\d+)\s*[=:]\s*([аеёиоуыэюя])$/i);
      if (!match) { errors.push('Укажи позицию и гласную, например 3=И'); continue; }
      const position = Number(match[1]);
      const vowel = match[2].toLowerCase();
      if (position < 1 || position > Number(maxPosition)) {
        errors.push('Позиция ' + position + ' выходит за пределы строки (' + maxPosition + ' слогов)');
      } else if (pattern[position]) {
        errors.push('Позиция ' + position + ' указана дважды');
      } else pattern[position] = vowel;
    }
    return { pattern, error: errors.join('. ') };
  }

  function checkVowelPattern(text, pattern) {
    const vowels = vowelSequence(text);
    const errors = [];
    Object.keys(pattern || {}).forEach((key) => {
      const position = Number(key);
      const expected = String(pattern[key]).toLowerCase();
      const actual = vowels[position - 1];
      if (!actual) errors.push(position + '-й слог: нет гласной');
      else if (actual !== expected) errors.push(position + '-й слог: нужна ' + expected.toUpperCase() + ', сейчас ' + actual.toUpperCase());
    });
    return { ok: errors.length === 0, vowels, errors };
  }

  function formatVowelPattern(pattern) {
    return Object.keys(pattern || {}).sort((a, b) => Number(a) - Number(b))
      .map((position) => position + '=' + String(pattern[position]).toUpperCase()).join(', ');
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


  // ---------- Конструктор песни и каталог шаблонов ----------
  // Один или два тематических зачина занимают начало строк 1 и 3.
  const THEME_STARTS = {
    love: ['ты', 'ты рядом', 'между нами', 'свет любви'],
    sad: ['нет', 'и ночь', 'без тебя', 'пусто внутри'],
    day: ['день', 'новый день', 'первый свет', 'с утра'],
    strength: ['я', 'мой путь', 'я смогу', 'без страха'],
    city: ['ночь', 'мой город', 'до утра', 'в пути'],
    general: ['я', 'я помню', 'внутри меня', 'этот день'],
  };

  const RHYME_SCHEMES = {
    abab: { label: 'Перекрёстная ABAB', pattern: ['a', 'b', 'a', 'b'] },
    aabb: { label: 'Парная AABB', pattern: ['a', 'a', 'b', 'b'] },
    abba: { label: 'Охватная ABBA', pattern: ['a', 'b', 'b', 'a'] },
    aaaa: { label: 'Монорим AAAA', pattern: ['a', 'a', 'a', 'a'] },
    free: { label: 'Без схемы', pattern: null },
  };

  function defaultRhymeScheme(style) {
    return style === 'rap' ? 'aabb' : 'abab';
  }

  function normalizeRhymeScheme(scheme, style) {
    return RHYME_SCHEMES[scheme] ? scheme : defaultRhymeScheme(style);
  }

  function applyRhymeScheme(section, schemeName) {
    const scheme = RHYME_SCHEMES[schemeName];
    if (!scheme || !scheme.pattern) return;
    const firstAt = {};
    section.lines.forEach((line, index) => {
      const key = Math.floor(index / 4) + ':' + scheme.pattern[index % 4];
      if (Object.prototype.hasOwnProperty.call(firstAt, key)) line.rhyme = firstAt[key] + 1;
      else firstAt[key] = index;
    });
  }

  function addVowelPattern(sections, pattern) {
    if (!pattern || !Object.keys(pattern).length) return;
    sections.forEach((section) => section.lines.forEach((line) => {
      if (!line.fixed) line.vowelPattern = Object.assign({}, pattern);
    }));
  }

  function topicKey(topic) {
    const x = String(topic || '').toLowerCase();
    if (/люб|любов|сердц|встреч|нежн|роман|отношен/.test(x)) return 'love';
    if (/груст|печал|тос|одиноч|потер|расстав|разлук|боль|слёз|памят/.test(x)) return 'sad';
    if (/нов|день|утр|рассвет|начал|завтр|надежд|солнц/.test(x)) return 'day';
    if (/сил|побед|цель|смел|свобод|борь|путь|мечт/.test(x)) return 'strength';
    if (/город|улиц|ноч|район|метро|дорог|дом/.test(x)) return 'city';
    return 'general';
  }

  function chooseThemePhrases(topic, key, meter) {
    if (!topic) return [];
    const raw = topic.replace(/\s+/g, ' ').trim();
    const bank = THEME_STARTS[key].filter((candidate) => syllables(candidate) < meter);
    const maxSyllables = Math.min(4, meter - 1);
    const direct = syllables(raw) > 0 && syllables(raw) <= maxSyllables ? raw : '';
    const first = direct || bank.find((candidate) => syllables(candidate) >= 2) || bank[0] || '';
    if (!first) return [];
    if (meter < 6) return [first];
    const second = bank.find((candidate) => candidate.toLowerCase() !== first.toLowerCase() && syllables(candidate) >= 2)
      || bank.find((candidate) => candidate.toLowerCase() !== first.toLowerCase());
    return second ? [first, second] : [first];
  }

  function songSection(title, count, meter, style, hook, hookAtEnd, hookIndex, rhymeScheme) {
    const lines = [];
    for (let i = 0; i < count; i++) {
      const hookLine = hookAtEnd ? count - 1 : hookIndex;
      if (hook && i === hookLine) lines.push({ fixed: hook });
      else lines.push({ syl: meter });
    }
    const section = { title, lines };
    applyRhymeScheme(section, rhymeScheme || defaultRhymeScheme(style));
    return section;
  }

  function themeAnchors(section, phrases) {
    if (!phrases || !phrases.length) return;
    section.lines[0].start = phrases[0];
    section.lines[2].start = phrases[1] || phrases[0];
  }

  function songPair(verseNumber, meter, style, themePhrases, hook, copiedChorus, rhymeScheme, vowelPattern) {
    const verse = songSection('Куплет ' + verseNumber, 8, meter, style, hook, false, 4, rhymeScheme);
    themeAnchors(verse, themePhrases);
    const chorus = copiedChorus
      ? { title: 'Припев', lines: copiedChorus.lines.map((line) => Object.assign({}, line)) }
      : songSection('Припев', 4, meter, style, hook, true, null, rhymeScheme);
    addVowelPattern([verse, chorus], vowelPattern);
    return [verse, chorus];
  }

  function appendSongVerse(tpl, copiedChorus) {
    if (!tpl || tpl.structure !== 'chorus') return null;
    const verseCount = tpl.sections.filter((section) => /^Куплет(?: \d+)?$/.test(section.title)).length;
    if (verseCount >= 3) return null;
    const themePhrases = tpl.themePhrases || (tpl.themeStart ? [tpl.themeStart] : []);
    const pair = songPair(verseCount + 1, tpl.meter || 9, tpl.style || 'rap', themePhrases,
      tpl.hook || '', copiedChorus, tpl.rhymeScheme || defaultRhymeScheme(tpl.style), tpl.vowelPattern || {});
    tpl.sections.push(...pair);
    return pair;
  }

  function generateSong(options) {
    options = options || {};
    const structure = options.structure === 'free' ? 'free' : 'chorus';
    const style = options.style === 'song' ? 'song' : 'rap';
    const meter = Math.max(2, Math.min(10, Number(options.syl) || 9));
    const topic = String(options.topic || '').trim();
    const key = topicKey(topic);
    const themePhrases = chooseThemePhrases(topic, key, meter);
    const hook = String(options.hook || '').trim();
    const rhymeScheme = normalizeRhymeScheme(options.rhymeScheme, style);
    const parsedVowels = parseVowelPattern(style === 'rap' ? options.vowels : '', meter);
    const name = topic || 'Новая песня';
    let sections;
    if (structure === 'free') {
      const count = Math.max(8, Math.min(16, Number(options.lines) || 12));
      const section = songSection('Сплошной текст', count, meter, style, hook, true, null, rhymeScheme);
      themeAnchors(section, themePhrases);
      sections = [section];
    } else sections = songPair(1, meter, style, themePhrases, hook, null, rhymeScheme, parsedVowels.pattern);
    if (structure === 'free') addVowelPattern(sections, parsedVowels.pattern);
    const styleName = style === 'rap' ? 'рэп' : 'песенная';
    const formName = structure === 'free' ? sections[0].lines.length + ' строк' : '1 куплет + припев';
    const notes = [];
    if (themePhrases.length === 1) notes.push('зачин «' + themePhrases[0] + '» стоит в 1-й и 3-й строках');
    else if (themePhrases.length > 1) notes.push('зачины «' + themePhrases[0] + '» и «' + themePhrases[1] + '» стоят в 1-й и 3-й строках');
    if (hook) notes.push(structure === 'free' ? 'своя фраза завершает текст' : 'своя фраза стоит в 5-й строке куплета и завершает припев');
    else notes.push('остальные строки остаются пустыми для твоего текста');
    if (structure === 'chorus') notes.push('в редакторе можно добавить ещё два куплета, припев скопируется сам');
    const vowelsNote = Object.keys(parsedVowels.pattern).length
      ? 'гласные по позициям: ' + formatVowelPattern(parsedVowels.pattern)
      : '';
    const rhymeLabel = RHYME_SCHEMES[rhymeScheme].label;
    return {
      id: 'song-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: 'Песня · ' + name,
      about: (topic ? 'Тема: «' + topic + '». ' : '') + styleName + ' подача, строки по ' + meter + ' слогов, ' + formName +
        '. Рифмовка: ' + rhymeLabel + '. ' + (vowelsNote ? vowelsNote + '. ' : '') + notes.join('. ') + '.',
      sections,
      generated: true,
      structure,
      meter,
      topic,
      themePhrases,
      hook,
      style,
      rhymeScheme,
      vowelPattern: parsedVowels.pattern,
      patternError: parsedVowels.error,
    };
  }

  function makeRapCatalogTemplate(index) {
    const meter = [5, 6, 7, 8, 9, 10][index % 6];
    const pair = PAIRS[(index * 7) % PAIRS.length];
    const scheme = ['aabb', 'abab', 'abba', 'aaaa'][index % 4];
    const hasRefrain = index % 2 === 0;
    const refrain = REFRAINS[(index * 11 + Math.floor(index / 2)) % REFRAINS.length];
    const turnPool = TURNS.filter((turn) => syllables(turn) < meter);
    const turn = turnPool.length ? turnPool[(index * 3) % turnPool.length] : '';
    const verseLines = [
      { start: pair[0], syl: meter }, s(meter), { start: pair[1], syl: meter }, s(meter),
      hasRefrain ? { fixed: refrain } : { start: turn, syl: meter },
      s(meter), s(meter), s(meter),
    ];
    const verse = { title: 'Куплет', lines: verseLines };
    applyRhymeScheme(verse, scheme);
    const sections = [verse];
    if (hasRefrain) {
      const chorus = { title: 'Припев', lines: [s(meter), s(meter), s(meter), { fixed: refrain }] };
      applyRhymeScheme(chorus, scheme);
      sections.push(chorus);
    }
    return {
      id: 'catalog-' + String(index + 1).padStart(3, '0'),
      name: 'Рэп · ' + cap(pair[0]) + ' / ' + pair[1] + ' · ' + meter + ' слогов',
      about: 'Заготовленные начала стоят в 1-й и 3-й строках куплета. ' +
        (hasRefrain ? 'Фраза-рефрен повторяется в 5-й строке и конце припева. ' : 'Пятая строка начинается с поворота. ') +
        'Схема: ' + RHYME_SCHEMES[scheme].label + '.',
      sections,
      generated: true,
      templateType: 'rap',
      meter,
      style: 'rap',
      rhymeScheme: scheme,
    };
  }

  function makeSongCatalogTemplate(index) {
    const meter = [2, 3, 4, 5, 6][index % 5];
    const scheme = ['abab', 'abba', 'aabb', 'aaaa'][Math.floor(index / 5) % 4];
    const blockCount = index % 2 === 0 ? 2 : 4;
    const pool = ANCHORS.filter((anchor) => syllables(anchor) > 0 && syllables(anchor) <= meter);
    const turnPool = TURNS.filter((turn) => syllables(turn) < meter);
    const lines = [];
    for (let block = 0; block < blockCount; block++) {
      const anchor = pool[(index * 7 + block * 11 + Math.floor(index / 5)) % pool.length];
      lines.push(anchorLine(anchor, meter), s(meter), s(meter), s(meter));
    }
    const verse = { title: 'Куплет', lines };
    applyRhymeScheme(verse, scheme);
    const sections = [verse];
    const addChorus = index % 3 === 0;
    const refrain = REFRAINS[(index * 5 + 3) % REFRAINS.length];
    if (addChorus) {
      const turn = turnPool.length ? turnPool[index % turnPool.length] : (pool[0] || 'я');
      const chorus = {
        title: 'Припев',
        lines: [s(meter), s(meter), { start: turn, syl: meter }, { fixed: refrain }],
      };
      applyRhymeScheme(chorus, scheme);
      sections.push(chorus);
    }
    const first = verse.lines[0].fixed || verse.lines[0].start;
    return {
      id: 'catalog-' + String(index + 51).padStart(3, '0'),
      name: 'Песенный · ' + cap(first || 'зачин') + ' · ' + meter + ' слогов',
      about: 'Опорная фраза начинает каждую строфу; остальные строки допиши сам. ' +
        (addChorus ? 'В припеве закреплён рефрен. ' : '') +
        'Схема: ' + RHYME_SCHEMES[scheme].label + '.',
      sections,
      generated: true,
      templateType: 'song',
      meter,
      style: 'song',
      rhymeScheme: scheme,
    };
  }

  function buildTemplateCatalog() {
    const catalog = [];
    for (let i = 0; i < 50; i++) catalog.push(makeRapCatalogTemplate(i));
    for (let i = 0; i < 50; i++) catalog.push(makeSongCatalogTemplate(i));
    return catalog;
  }

  const TEMPLATE_CATALOG = buildTemplateCatalog();
  const TEMPLATE_COUNT = TEMPLATE_CATALOG.length;

  function templateAt(index) {
    const n = ((Number(index) || 0) % TEMPLATE_COUNT + TEMPLATE_COUNT) % TEMPLATE_COUNT;
    return JSON.parse(JSON.stringify(TEMPLATE_CATALOG[n]));
  }

  root.Lyrics = { BASE, generate, generateSong, appendSongVerse, templateAt, TEMPLATE_COUNT, RHYME_SCHEMES, syllables, vowelSequence, parseVowelPattern, checkVowelPattern, formatVowelPattern, lastWord, rhymeQuality, lineHint, slogov, FRAMES, ANCHORS, REFRAINS, PAIRS, TURNS };
  if (typeof module !== 'undefined') module.exports = root.Lyrics;
})(typeof window !== 'undefined' ? window : globalThis);

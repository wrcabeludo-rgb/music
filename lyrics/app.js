// «Тексты по шаблонам»: выбор шаблона, письмо с подсчётом слогов и проверкой рифм, сохранение в браузере.
(function () {
  const L = window.Lyrics;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'lyrics-works';

  // ---------- Хранилище ----------

  function hasUserContent(w) {
    if (!w || !w.tpl || !Array.isArray(w.tpl.sections)) return false;
    if (String(w.title || '').trim()) return true;
    return w.tpl.sections.some((sec, si) => sec.lines && sec.lines.some((line, li) => {
      if (line.fixed) return false;
      const value = String((w.text && w.text[si] && w.text[si][li]) || '').trim();
      return value && !(line.start && value.toLowerCase() === line.start.trim().toLowerCase());
    }));
  }

  function loadWorks() {
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY)) || [];
      saved = Array.isArray(parsed) ? parsed : [];
    } catch (e) {}
    const kept = saved.filter(hasUserContent);
    if (kept.length !== saved.length) saveWorks(kept);
    return kept;
  }
  function saveWorks(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { toast('Не получилось сохранить'); }
  }
  let works = loadWorks();
  let cur = null; // открытый текст

  function newWork(tpl) {
    const t = JSON.parse(JSON.stringify(tpl));
    const text = t.sections.map((sec) => sec.lines.map((l) => (l.start ? l.start + ' ' : '')));
    return { id: 'w' + Date.now().toString(36), title: '', tpl: t, text, updated: Date.now() };
  }

  let saveTimer = 0;
  function touch() {
    if (!cur) return;
    clearTimeout(saveTimer);
    const exists = works.some((w) => w.id === cur.id);
    if (hasUserContent(cur)) {
      cur.updated = Date.now();
      if (!exists) works.unshift(cur);
      saveTimer = setTimeout(() => saveWorks(works), 300);
    } else if (exists) {
      works = works.filter((w) => w.id !== cur.id);
      saveTimer = setTimeout(() => saveWorks(works), 300);
    }
  }

  // ---------- Главная ----------

  const song = { structure: 'chorus', style: 'rap', syl: 9, lines: 12, topic: '', hook: '', tpl: null };

  function seg(id, onPick) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      $(id).querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      onPick(b.dataset.v);
    });
  }

  function previewHTML(t) {
    let h = '<b class="name">' + esc(t.name) + '</b><div class="about">' + esc(t.about || '') + '</div>';
    const first = t.sections[0];
    if (!first) return h;
    h += '<div class="preview-example"><b>Пример строк</b><ol>';
    first.lines.slice(0, 4).forEach((l) => {
      let line = l.fixed ? esc(l.fixed) : l.suggestion ? esc(l.suggestion) : esc(L.lineHint(l));
      h += '<li>' + line + (l.syl ? ' <span class="rh">· ' + L.slogov(l.syl) + '</span>' : '') + '</li>';
    });
    h += '</ol></div>';
    const total = t.sections.reduce((n, sec) => n + sec.lines.length, 0);
    h += '<div class="preview-count">Всего строк: ' + total + '</div>';
    return h;
  }

  function regenSong() {
    song.tpl = L.generateSong(song);
    $('songPreview').innerHTML = previewHTML(song.tpl);
  }

  function renderHome() {
    $('baseList').innerHTML = L.BASE.map((t) =>
      '<button class="item" data-base="' + t.id + '"><span><b>' + esc(t.name) + '</b><small>' + esc(t.about) + '</small></span><i class="go">›</i></button>').join('');
    works = loadWorks();
    $('worksList').innerHTML = works.map((w) => {
      const p = progress(w);
      const date = new Date(w.updated).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      return '<div class="item work-item"><button type="button" class="work-open" data-work="' + esc(w.id) + '"><span><b>' +
        esc(w.title || w.tpl.name) + '</b><small>' + (w.title ? esc(w.tpl.name) + ' · ' : '') +
        p.filled + ' из ' + p.total + ' строк · ' + date + '</small></span><i class="go">›</i></button>' +
        '<button type="button" class="work-remove" data-delete-work="' + esc(w.id) + '" aria-label="Удалить текст «' +
        esc(w.title || w.tpl.name) + '">×</button></div>';
    }).join('');
    $('worksEmpty').hidden = works.length > 0;
  }

  $('baseList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-base]');
    if (b) openWork(newWork(L.BASE.find((t) => t.id === b.dataset.base)));
  });
  $('worksList').addEventListener('click', (e) => {
    const remove = e.target.closest('[data-delete-work]');
    if (remove) {
      const work = works.find((w) => w.id === remove.dataset.deleteWork);
      if (!work || !confirm('Удалить «' + (work.title || work.tpl.name) + '»?')) return;
      works = works.filter((w) => w.id !== work.id);
      saveWorks(works);
      renderHome();
      return;
    }
    const open = e.target.closest('[data-work]');
    if (open) openWork(works.find((w) => w.id === open.dataset.work));
  });

  seg('songStructure', (v) => {
    song.structure = v;
    $('songLinesField').hidden = v !== 'free';
    regenSong();
  });
  seg('songStyle', (v) => { song.style = v; regenSong(); });
  $('songMeter').addEventListener('change', () => { song.syl = +$('songMeter').value; regenSong(); });
  seg('songLines', (v) => { song.lines = +v; regenSong(); });
  $('songTopic').addEventListener('input', () => { song.topic = $('songTopic').value; regenSong(); });
  $('songHook').addEventListener('input', () => { song.hook = $('songHook').value; regenSong(); });
  $('songWrite').onclick = () => { openWork(newWork(song.tpl || L.generateSong(song))); };


  // ---------- Письмо ----------

  const lineText = (w, si, li) => {
    const l = w.tpl.sections[si].lines[li];
    return l.fixed || w.text[si][li] || '';
  };

  function lineOk(w, si, li) {
    const l = w.tpl.sections[si].lines[li];
    if (l.fixed) return true;
    const t = lineText(w, si, li).trim();
    if (!t || (l.start && t.toLowerCase() === l.start.toLowerCase())) return false;
    return !l.syl || L.syllables(t) === l.syl;
  }

  function progress(w) {
    let total = 0, filled = 0, exact = 0, sized = 0;
    w.tpl.sections.forEach((sec, si) => sec.lines.forEach((l, li) => {
      if (l.fixed) return;
      total++;
      const t = (w.text[si][li] || '').trim();
      const written = t && !(l.start && t.toLowerCase() === l.start.toLowerCase());
      if (written) filled++;
      if (l.syl) { sized++; if (written && L.syllables(t) === l.syl) exact++; }
    }));
    return { total, filled, exact, sized };
  }

  function openWork(w) {
    cur = w;
    $('home').hidden = true;
    $('write').hidden = false;
    $('title').value = w.title;
    $('tplInfo').textContent = 'Шаблон «' + w.tpl.name + '». ' + (w.tpl.about || '');
    renderSheet();
    history.pushState({ w: w.id }, '');
    window.scrollTo(0, 0);
  }

  function closeWork() {
    clearTimeout(saveTimer);
    if (cur) saveWorks(works);
    cur = null;
    $('write').hidden = true;
    $('home').hidden = false;
    renderHome();
  }

  function renderSheet() {
    const w = cur;
    let h = '';
    // Кто рифмуется на строку: для подсказки «← рифма со стр. N».
    w.tpl.sections.forEach((sec, si) => {
      const back = {};
      sec.lines.forEach((l, li) => { if (l.rhyme) (back[l.rhyme - 1] = back[l.rhyme - 1] || []).push(li + 1); });
      if (w.tpl.sections.length > 1 || sec.title !== 'Куплет') h += '<div class="part">' + esc(sec.title) + '</div>';
      sec.lines.forEach((l, li) => {
        const id = si + '-' + li;
        h += '<div class="line" id="ln' + id + '"><span class="no">' + (li + 1) + '</span>';
        if (l.fixed) h += '<div class="fixedtext">' + esc(l.fixed) + '</div>';
        else h += '<input data-s="' + si + '" data-l="' + li + '" value="' + esc(w.text[si][li] || '') + '" placeholder="' +
          esc(l.frame || (l.start ? l.start + '…' : L.slogov(l.syl))) + '" autocomplete="off" autocapitalize="none" spellcheck="true" enterkeyhint="next">';
        h += '<span class="cnt" id="cn' + id + '"></span>';
        if (l.suggestion) h += '<div class="suggestion">Вариант: «' + esc(l.suggestion) + '» <button type="button" data-use-suggestion data-s="' + si + '" data-l="' + li + '">Вставить</button></div>';
        h += '<div class="hintline"><span>' + esc(L.lineHint(l)) + (l.frame ? ': ' + esc(l.frame) : '') + '</span>' +
          (l.idea ? '<span>Идея: ' + esc(l.idea) + '</span>' : '') +
          (back[li] ? '<span>← рифма со стр. ' + back[li].join(', ') + '</span>' : '') +
          '<span id="rh' + id + '"></span><span id="st' + id + '" class="bad"></span></div></div>';
      });
    });
    if (w.tpl.structure === 'chorus') {
      const verseCount = w.tpl.sections.filter((sec) => /^Куплет(?: \d+)?$/.test(sec.title)).length;
      if (verseCount < 3) {
        h += '<div class="add-verse-control"><button type="button" class="ghost" data-add-verse>+ Добавить куплет</button>' +
          '<span class="muted">' + verseCount + ' из 3 куплетов</span></div>';
      } else h += '<p class="add-verse-limit muted">Добавлено 3 куплета</p>';
    }
    $('sheet').innerHTML = h;
    w.tpl.sections.forEach((sec, si) => sec.lines.forEach((l, li) => updateLine(si, li)));
    updateProgress();
  }

  function updateLine(si, li) {
    const w = cur, l = w.tpl.sections[si].lines[li], id = si + '-' + li;
    const t = lineText(w, si, li);
    const n = L.syllables(t);
    const cnt = $('cn' + id);
    if (l.syl) {
      cnt.textContent = n + '/' + l.syl;
      cnt.className = 'cnt ' + (!t.trim() ? '' : n === l.syl ? 'ok' : n < l.syl ? 'under' : 'over');
    } else cnt.textContent = n ? String(n) : '';
    const st = $('st' + id);
    if (st) st.textContent = l.start && t.trim() && !t.trim().toLowerCase().startsWith(l.start.toLowerCase()) ? 'начни с «' + l.start + '»' : '';
    if (l.rhyme) {
      const other = lineText(w, si, l.rhyme - 1);
      const ow = L.lastWord(other);
      const q = L.rhymeQuality(t, other);
      const rh = $('rh' + id);
      let s = 'рифма на стр. ' + l.rhyme + (ow ? ' «' + ow + '»' : '');
      let cls = '';
      if (q === 'rhyme') { s += ' ✓'; cls = 'rh-ok'; } else if (q === 'near') { s += ' ≈'; cls = 'rh-near'; } else if (q === 'same') { s += ' — то же слово'; cls = 'rh-near'; }
      rh.textContent = s;
      rh.className = cls;
    }
  }

  function updateProgress() {
    const p = progress(cur);
    $('progress').textContent = 'Написано строк: ' + p.filled + ' из ' + p.total + (p.sized ? ' · точно по слогам: ' + p.exact + ' из ' + p.sized : '');
  }

  $('sheet').addEventListener('click', (e) => {
    const addVerse = e.target.closest('[data-add-verse]');
    if (addVerse) {
      let chorusIndex = -1;
      for (let i = cur.tpl.sections.length - 1; i >= 0; i--) {
        if (cur.tpl.sections[i].title === 'Припев') { chorusIndex = i; break; }
      }
      const copiedChorus = chorusIndex >= 0 ? cur.tpl.sections[chorusIndex] : null;
      const copiedChorusText = chorusIndex >= 0 && cur.text[chorusIndex] ? cur.text[chorusIndex].slice() : null;
      const added = L.appendSongVerse(cur.tpl, copiedChorus);
      if (!added) return;
      cur.text.push(added[0].lines.map((line) => (line.start ? line.start + ' ' : '')));
      cur.text.push(copiedChorusText || added[1].lines.map((line) => (line.start ? line.start + ' ' : '')));
      renderSheet();
      touch();
      return;
    }
    const button = e.target.closest('[data-use-suggestion]');
    if (!button) return;
    const input = $('sheet').querySelector('input[data-s="' + button.dataset.s + '"][data-l="' + button.dataset.l + '"]');
    if (!input) return;
    input.value = cur.tpl.sections[+button.dataset.s].lines[+button.dataset.l].suggestion;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });

  $('sheet').addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp.dataset.s) return;
    const si = +inp.dataset.s, li = +inp.dataset.l;
    cur.text[si][li] = inp.value;
    updateLine(si, li);
    // Обновить строки, которые рифмуются на эту.
    cur.tpl.sections[si].lines.forEach((l, k) => { if (l.rhyme === li + 1) updateLine(si, k); });
    updateProgress();
    touch();
  });

  // Подсветка строки, на которую нужна рифма.
  $('sheet').addEventListener('focusin', (e) => {
    document.querySelectorAll('.line.target').forEach((x) => x.classList.remove('target'));
    const inp = e.target;
    if (!inp.dataset.s) return;
    const l = cur.tpl.sections[+inp.dataset.s].lines[+inp.dataset.l];
    if (l.rhyme) $('ln' + inp.dataset.s + '-' + (l.rhyme - 1)).classList.add('target');
  });

  // Enter — к следующей строке.
  $('sheet').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const all = [...$('sheet').querySelectorAll('input')];
    const next = all[all.indexOf(e.target) + 1];
    if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); } else e.target.blur();
  });

  $('title').addEventListener('input', () => { cur.title = $('title').value; touch(); });

  function plainText(w) {
    const parts = [];
    if (w.title.trim()) parts.push(w.title.trim());
    w.tpl.sections.forEach((sec, si) => {
      const lines = sec.lines.map((l, li) => lineText(w, si, li).trim());
      parts.push((w.tpl.sections.length > 1 ? '[' + sec.title + ']\n' : '') + lines.join('\n'));
    });
    return parts.join('\n\n');
  }

  $('copyBtn').onclick = async () => {
    const t = plainText(cur);
    try { await navigator.clipboard.writeText(t); toast('Текст скопирован'); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Текст скопирован'); } catch (e2) { toast('Не получилось скопировать'); }
      ta.remove();
    }
  };
  if (navigator.share) {
    $('shareBtn').hidden = false;
    $('shareBtn').onclick = () => navigator.share({ title: cur.title || cur.tpl.name, text: plainText(cur) }).catch(() => {});
  }
  $('clearBtn').onclick = () => {
    if (!confirm('Стереть все написанные строки?')) return;
    cur.text = cur.tpl.sections.map((sec) => sec.lines.map((l) => (l.start ? l.start + ' ' : '')));
    renderSheet();
    touch();
  };
  $('delBtn').onclick = () => {
    if (!confirm('Удалить этот текст?')) return;
    works = works.filter((w) => w !== cur);
    saveWorks(works);
    cur = null;
    history.back();
  };

  $('backBtn').onclick = () => history.back();
  window.addEventListener('popstate', () => { if (!$('write').hidden) closeWork(); });
  window.addEventListener('pagehide', () => { if (cur) saveWorks(works); });

  let toastTimer = 0;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 1800);
  }

  // ---------- Установка ----------

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  $('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBtn').hidden = true; };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !navigator.standalone) $('iosHint').hidden = false;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  regenSong();
  renderHome();
})();

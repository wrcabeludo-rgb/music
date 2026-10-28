// «Тексты по шаблонам»: выбор шаблона, письмо с подсчётом слогов и проверкой рифм, сохранение в браузере.
(function () {
  const L = window.Lyrics;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'lyrics-works';

  // ---------- Хранилище ----------

  function loadWorks() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function saveWorks(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { toast('Не получилось сохранить'); }
  }
  let works = loadWorks();
  let cur = null; // открытый текст

  function newWork(tpl) {
    const t = JSON.parse(JSON.stringify(tpl));
    const text = t.sections.map((sec) => sec.lines.map((l) => (l.start ? l.start + ' ' : '')));
    const w = { id: 'w' + Date.now().toString(36), title: '', tpl: t, text, updated: Date.now() };
    works.unshift(w);
    saveWorks(works);
    return w;
  }

  let saveTimer = 0;
  function touch() {
    cur.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWorks(works), 300);
  }

  // ---------- Главная ----------

  const gen = { kind: 'any', syl: 0, tpl: null };

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
    for (const sec of t.sections) {
      if (t.sections.length > 1) h += '<h4>' + esc(sec.title) + '</h4>';
      h += '<ol>';
      for (const l of sec.lines) {
        let txt;
        if (l.fixed) txt = '<span class="fx">' + esc(l.fixed) + '</span>';
        else if (l.frame) txt = '<span class="fx">' + esc(l.frame) + '</span>';
        else if (l.start) txt = '<span class="fx">' + esc(l.start) + '…</span>' + (l.syl ? ' (' + L.slogov(l.syl) + ')' : '');
        else txt = L.slogov(l.syl);
        if (l.rhyme) txt += ' <span class="rh">— рифма на ' + l.rhyme + '</span>';
        h += '<li>' + txt + '</li>';
      }
      h += '</ol>';
    }
    return h;
  }

  function regen() {
    gen.tpl = L.generate(gen.kind, gen.syl);
    $('genPreview').innerHTML = previewHTML(gen.tpl);
  }

  function renderHome() {
    $('baseList').innerHTML = L.BASE.map((t) =>
      '<button class="item" data-base="' + t.id + '"><span><b>' + esc(t.name) + '</b><small>' + esc(t.about) + '</small></span><i class="go">›</i></button>').join('');
    works = loadWorks();
    $('worksList').innerHTML = works.map((w) => {
      const p = progress(w);
      const date = new Date(w.updated).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      return '<button class="item" data-work="' + w.id + '"><span><b>' + esc(w.title || w.tpl.name) + '</b><small>' +
        (w.title ? esc(w.tpl.name) + ' · ' : '') + p.filled + ' из ' + p.total + ' строк · ' + date + '</small></span><i class="go">›</i></button>';
    }).join('');
    $('worksEmpty').hidden = works.length > 0;
  }

  $('baseList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-base]');
    if (b) openWork(newWork(L.BASE.find((t) => t.id === b.dataset.base)));
  });
  $('worksList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-work]');
    if (b) openWork(works.find((w) => w.id === b.dataset.work));
  });

  seg('genKind', (v) => {
    gen.kind = v;
    $('genSylField').hidden = v === 'frames';
    regen();
  });
  seg('genSyl', (v) => { gen.syl = +v; regen(); });
  $('genAgain').onclick = regen;
  $('genWrite').onclick = () => { const t = gen.tpl; regen(); openWork(newWork(t)); };

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
        h += '<div class="hintline"><span>' + esc(L.lineHint(l)) + (l.frame ? ': ' + esc(l.frame) : '') + '</span>' +
          (back[li] ? '<span>← рифма со стр. ' + back[li].join(', ') + '</span>' : '') +
          '<span id="rh' + id + '"></span><span id="st' + id + '" class="bad"></span></div></div>';
      });
    });
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

  regen();
  renderHome();
})();

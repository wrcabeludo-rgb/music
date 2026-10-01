(function () {
  'use strict';
  const M = window.Music, L = window.Licks, T = window.THEORY;
  const app = document.getElementById('app');
  const P = M.pretty;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const $ = s => app.querySelector(s);
  const $$ = s => Array.from(app.querySelectorAll(s));
  const on = (sel, ev, fn) => $$(sel).forEach(el => el.addEventListener(ev, e => fn(el, e)));

  // ---------- хранилище ----------
  const KEY = 'guitar_impro_v1';
  const store = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  ['fav', 'best', 'tries', 'ui', 'rep', 'back', 'quiz'].forEach(k => store[k] = store[k] || {});
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };

  // ---------- общий жизненный цикл экрана ----------
  let cleanups = [];
  const onLeave = fn => cleanups.push(fn);
  function leave() { cleanups.forEach(f => { try { f(); } catch (e) {} }); cleanups = []; Snd.stopAll(); }
  function raf(fn) { let id; const loop = () => { if (fn() !== false) id = requestAnimationFrame(loop); }; id = requestAnimationFrame(loop); onLeave(() => cancelAnimationFrame(id)); }
  function later(fn, ms) { const id = setTimeout(fn, ms); onLeave(() => clearTimeout(id)); return id; }
  // звук гитары: авто (рок — перегруз, остальное — нейлон), нейлон, перегруз, синтез
  const INST = [['auto', 'Авто'], ['nylon', 'Нейлон'], ['drive', 'Перегруз'], ['synth', 'Синтез']];
  Snd.setMode(store.ui.inst || 'auto');
  const soundChips = () => `<div class="chips wrap">${INST.map(([k, n]) => `<button class="chip sm${(store.ui.inst || 'auto') === k ? ' on' : ''}" data-inst="${k}">${n}</button>`).join('')}</div>`;
  function bindSound() {
    on('[data-inst]', 'click', el => {
      store.ui.inst = el.dataset.inst; save(); Snd.setMode(store.ui.inst);
      $$('[data-inst]').forEach(b => b.classList.toggle('on', b === el));
    });
  }
  // аккомпанемент: фортепиано или гитара + громкость (0–100, 60 = обычная)
  const compVolGain = v => v / 60;
  Snd.setComp(store.ui.compInst || 'piano');
  Snd.setCompVolume(compVolGain(store.ui.compVol == null ? 60 : store.ui.compVol));
  const compControls = () => {
    const ci = store.ui.compInst || 'piano', cv = store.ui.compVol == null ? 60 : store.ui.compVol;
    return `<div class="comprow"><div class="chips wrap">${[['piano', 'Фортепиано'], ['guitar', 'Гитара']].map(([k, n]) => `<button class="chip sm${ci === k ? ' on' : ''}" data-ci="${k}">${n}</button>`).join('')}</div>
      <div class="tempo"><span class="small muted">Громкость</span><input type="range" class="compvol" min="0" max="100" step="5" value="${cv}"><b class="compvolv">${cv}%</b></div></div>`;
  };
  function bindComp() {
    on('[data-ci]', 'click', el => {
      store.ui.compInst = el.dataset.ci; save(); Snd.setComp(store.ui.compInst);
      $$('[data-ci]').forEach(b => b.classList.toggle('on', b === el));
    });
    on('.compvol', 'input', el => {
      store.ui.compVol = +el.value; save(); Snd.setCompVolume(compVolGain(store.ui.compVol));
      $$('.compvolv').forEach(b => b.textContent = el.value + '%');
    });
  }
  function audioOn() { Snd.ensure(); try { if (navigator.audioSession && navigator.audioSession.type !== 'play-and-record') navigator.audioSession.type = 'playback'; } catch (e) {} }

  const rootName = pc => P(M.rootByPc(pc).n);
  const chordLabel = (pc, type) => P(M.chordName(pc, type));
  const STYLE_OF = { blues: 'shuffle', rock: 'rock', jazz: 'swing' };
  const SCALE_IV = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
  const levelDots = n => '<span class="lvl">' + '●'.repeat(n) + '<span class="muted">' + '●'.repeat(3 - n) + '</span></span>';

  // ---------- SVG: аккордовая диаграмма ----------
  function diagram(v, mode, rootPc) {
    const fr = v.frets.filter(f => f != null && f > 0);
    const maxF = fr.length ? Math.max(...fr) : 0, minF = fr.length ? Math.min(...fr) : 1;
    const start = maxF <= 4 ? 1 : minF;
    const n = Math.max(4, maxF - start + 1);
    const sx = 16, fy = 21, Lx = 22, Ty = 20;
    const W = Lx + 5 * sx + 12, H = Ty + n * fy + 6;
    const label = i => {
      if (mode === 'none') return '';
      if (mode === 'finger') return v.fingers[i] || '';
      if (mode === 'note') return P(M.spell(M.rootByPc(rootPc).n, v.ivs[i]));
      return P(v.ivs[i]);
    };
    let s = `<svg class="dg" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
    if (start === 1) s += `<line class="nut" x1="${Lx - 1}" x2="${Lx + 5 * sx + 1}" y1="${Ty}" y2="${Ty}"/>`;
    else s += `<text class="fn" x="${Lx - 6}" y="${Ty + fy / 2}">${start}</text>`;
    for (let k = 0; k <= n; k++) s += `<line class="ln" x1="${Lx}" x2="${Lx + 5 * sx}" y1="${Ty + k * fy}" y2="${Ty + k * fy}"/>`;
    for (let i = 0; i < 6; i++) s += `<line class="ln" x1="${Lx + i * sx}" x2="${Lx + i * sx}" y1="${Ty}" y2="${Ty + n * fy}"/>`;
    v.frets.forEach((f, i) => {
      const x = Lx + i * sx, isR = v.ivs[i] === '1';
      if (f == null) s += `<text class="mk" x="${x}" y="${Ty - 6}">×</text>`;
      else if (f === 0) {
        const lb = label(i);
        s += lb === '' ? `<circle cx="${x}" cy="${Ty - 9}" r="4.5" fill="none" stroke="currentColor" class="ln"/>`
          : `<circle class="dot${isR ? ' r' : ''}" cx="${x}" cy="${Ty - 9}" r="6.5" opacity=".75"/><text class="dt${isR ? ' r' : ''}" x="${x}" y="${Ty - 9}">${lb}</text>`;
      } else {
        const y = Ty + (f - start + 0.5) * fy;
        s += `<circle class="dot${isR ? ' r' : ''}" cx="${x}" cy="${y}" r="7.3"/><text class="dt${isR ? ' r' : ''}" x="${x}" y="${y}">${label(i)}</text>`;
      }
    });
    return s + '</svg>';
  }

  // ---------- SVG: горизонтальный гриф ----------
  // dots: [{s, f, label, root, dim, id}]
  function fretboard(dots, from, to, o) {
    o = o || {};
    const fw = o.fw || 34, sh = 17, Ty = 10;
    const Lx = from === 0 ? 24 : 12;
    const first = from === 0 ? 1 : from;
    const cols = to - first + 1;
    const W = Lx + cols * fw + 8, H = Ty + 5 * sh + 22;
    const xOf = f => f === 0 ? Lx - 12 : Lx + (f - first + 0.5) * fw;
    let s = `<svg class="fb" viewBox="0 0 ${W} ${H}" ${o.fit ? 'width="100%"' : `width="${W}"`} aria-hidden="true">`;
    s += `<rect class="wood" x="${Lx}" y="${Ty - 4}" width="${cols * fw}" height="${5 * sh + 8}" rx="3"/>`;
    for (let f = first; f <= to; f++) {
      const cx = Lx + (f - first + 0.5) * fw, cy = Ty + 2.5 * sh;
      if ([3, 5, 7, 9, 15, 17, 19].includes(f)) s += `<circle class="inl" cx="${cx}" cy="${cy}" r="4"/>`;
      if (f === 12) s += `<circle class="inl" cx="${cx}" cy="${cy - sh}" r="4"/><circle class="inl" cx="${cx}" cy="${cy + sh}" r="4"/>`;
      if ([3, 5, 7, 9, 12, 15, 17, 19].includes(f) || f === first) s += `<text class="num" x="${cx}" y="${Ty + 5 * sh + 16}">${f}</text>`;
    }
    for (let k = 0; k <= cols; k++) s += `<line class="${k === 0 && from <= 1 ? 'nut' : 'fr'}" x1="${Lx + k * fw}" x2="${Lx + k * fw}" y1="${Ty - 4}" y2="${Ty + 5 * sh + 4}"/>`;
    for (let st = 1; st <= 6; st++) s += `<line class="str" x1="${from === 0 ? Lx - 20 : Lx}" x2="${Lx + cols * fw}" y1="${Ty + (st - 1) * sh}" y2="${Ty + (st - 1) * sh}" style="stroke-width:${0.6 + st * 0.25}"/>`;
    dots.forEach(d => {
      if (d.f < from || d.f > to) return;
      const x = xOf(d.f), y = Ty + (d.s - 1) * sh;
      s += `<g ${d.id != null ? `data-p="${d.id}"` : ''}><circle class="dot${d.root ? ' r' : ''}${d.dim ? ' dim' : ''}" cx="${x}" cy="${y}" r="7.6"/><text class="dt${d.root ? ' r' : ''}" x="${x}" y="${y}">${d.label}</text></g>`;
    });
    return s + '</svg>';
  }

  // ---------- SVG: табулатура ----------
  function tabSvg(events, o) {
    o = o || {};
    const beats = events.reduce((a, e) => Math.max(a, e.t + e.d), 0);
    const pxb = events.some(e => !e.rest && e.d < 0.4) ? 74 : 52;
    const Lx = 24, Ty = 32, sh = 13;
    const W = Lx + beats * pxb + 10, H = Ty + 5 * sh + 12;
    let s = `<svg class="tab" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Табулатура">`;
    ['T', 'A', 'B'].forEach((c, i) => s += `<text class="tl" x="6" y="${Ty + 18 + i * 13}">${c}</text>`);
    for (let st = 0; st < 6; st++) s += `<line class="ln" x1="${Lx - 4}" x2="${Lx + beats * pxb}" y1="${Ty + st * sh}" y2="${Ty + st * sh}"/>`;
    for (let b = 0; b <= beats; b += 4) s += `<line class="bar" x1="${Lx + b * pxb}" x2="${Lx + b * pxb}" y1="${Ty}" y2="${Ty + 5 * sh}"/>`;
    if (o.harm) { let b = 0; o.harm.forEach(([pc, type, n]) => { s += `<text class="ch" x="${Lx + b * pxb + 4}" y="11">${esc(chordLabel(pc, type))}</text>`; b += n; }); }
    events.forEach((e, i) => {
      if (e.rest) return;
      const x = Lx + 12 + e.t * pxb;
      let tq = '';
      if (e.bend) tq += e.release ? '↑↓' : '↑' + ({ 1: '½', 2: '1', 3: '1½' }[e.bend] || e.bend);
      if (e.leg) tq += ({ h: 'h', p: 'p', s: '/' })[e.leg];
      if (e.vib) tq += '~';
      if (tq) s += `<text class="tq" x="${x}" y="${Ty - 8}">${tq}</text>`;
      e.notes.forEach(n => {
        const y = Ty + (n.s - 1) * sh, w = n.f > 9 ? 17 : 11;
        s += `<g class="n" data-i="${i}"><rect x="${x - w / 2}" y="${y - 6.5}" width="${w}" height="13"/><text x="${x}" y="${y}">${n.f}</text></g>`;
      });
    });
    return s + '</svg>';
  }

  // точки фразы на грифе
  function lickBoard(events, keyPc, mode) {
    const pos = new Map();
    events.forEach(e => !e.rest && e.notes.forEach(n => {
      const k = n.s + ':' + n.f;
      if (!pos.has(k)) {
        const semi = ((n.midi - keyPc) % 12 + 12) % 12;
        pos.set(k, { s: n.s, f: n.f, id: k, root: semi === 0, label: mode === 'note' ? P(M.pcName(n.midi % 12)) : P(SCALE_IV[semi]) });
      }
    }));
    const dots = [...pos.values()];
    const fr = dots.map(d => d.f);
    let from = Math.max(0, Math.min(...fr) - 1), to = Math.max(...fr) + 1;
    if (to - from < 6) to = from + 6;
    if (from === 1) from = 0;
    return fretboard(dots, from, to, { fit: true });
  }

  function highlight(events, run) {
    const t = Snd.ctx ? Snd.ctx.currentTime : 0;
    let cur = -1;
    if (run) for (const x of run.sched) if (t >= x.start && t < x.end) cur = x.i;
    $$('svg.tab .n').forEach(g => g.classList.toggle('on', +g.dataset.i === cur));
    const keys = cur >= 0 ? events[cur].notes.map(n => n.s + ':' + n.f) : [];
    $$('svg.fb g[data-p]').forEach(g => g.classList.toggle('on', keys.includes(g.dataset.p)));
    return cur;
  }

  const keyChips = (sel, cls) => `<div class="keys ${cls || ''}">` + M.ROOTS.map(r => `<button class="chip sm${r.pc === sel ? ' on' : ''}" data-key="${r.pc}">${P(r.n)}</button>`).join('') + '</div>';
  const top = (title, back) => `<div class="top"><button class="back" data-back="${back}" aria-label="Назад">←</button><h1>${title}</h1></div>`;
  function bindBack() { on('[data-back]', 'click', el => { location.hash = el.dataset.back; }); }

  function playVoicing(v, arp) {
    audioOn();
    const notes = v.notes.filter(x => x != null);
    Snd.prepare('chords').then(() => {
      const t = Snd.now() + 0.05;
      if (arp) notes.forEach((m, i) => Snd.pluck(m, t + i * 0.22, 1.6 - i * 0.1, { vel: 0.7 }));
      else Snd.strum(notes, t, 2.2, { vel: 0.7, gap: 0.03 });
    });
  }

  // ===================== ЭКРАН: АККОРДЫ =====================
  function viewChords() {
    const ui = store.ui;
    ui.cat = ui.cat || 'triad'; ui.root = ui.root == null ? 0 : ui.root; ui.mode = ui.mode || 'iv'; ui.snd = ui.snd || 'strum';
    let types = M.typesInCat(ui.cat);
    if (!types.find(t => t.id === ui.type)) ui.type = types[0].id;
    const t = M.TYPE[ui.type], rn = M.rootByPc(ui.root).n;
    const groups = M.voicings(ui.root, ui.type, ui.cat);
    const scales = t.sc.map(id => M.SCALES[id].name).join(', ');
    app.innerHTML = `
      <h1>Аккорды</h1>
      <div class="chips">${M.CATS.map(c => `<button class="chip${c.id === ui.cat ? ' on' : ''}" data-cat="${c.id}">${c.name}</button>`).join('')}</div>
      <div class="chips">${types.map(x => `<button class="chip sm${x.id === ui.type ? ' on' : ''}" data-type="${x.id}">${P(rn + x.sym)}</button>`).join('')}</div>
      ${keyChips(ui.root)}
      <div class="card">
        <div class="chordhead"><span class="nm">${P(rn + t.sym)}</span><span class="muted">${esc(t.name)}</span></div>
        <div class="formula">${t.f.map(iv => `<span>${P(iv)}<em>${P(M.spell(rn, iv))}</em></span>`).join('')}</div>
        <p class="small" style="margin:6px 0">${esc(t.d)}</p>
        <p class="small muted" style="margin:4px 0">Лады для импровизации: ${esc(scales)}</p>
        ${ui.cat === 'shell' ? '<p class="small muted" style="margin:4px 0">Shell — только корень, терция и септима (у m7♭5 и dim7 добавлена ♭5). Подробнее — в «Теории».</p>' : ''}
      </div>
      <div class="row" style="justify-content:space-between">
        <div class="chips wrap">${[['iv', 'Ступени'], ['note', 'Ноты'], ['finger', 'Пальцы']].map(([k, n]) => `<button class="chip sm${ui.mode === k ? ' on' : ''}" data-mode="${k}">${n}</button>`).join('')}</div>
        <div class="chips wrap">${[['strum', 'Аккорд'], ['arp', 'Арпеджио']].map(([k, n]) => `<button class="chip sm${ui.snd === k ? ' on' : ''}" data-snd="${k}">♪ ${n}</button>`).join('')}</div>
      </div>
      <p class="small muted" style="margin:2px 0">Нажмите на аппликатуру, чтобы услышать. Оранжевая точка — корень.</p>
      ${groups.map((g, gi) => `<div class="vgroup"><h3>${esc(g.name)}</h3><div class="vgrid">${g.items.map((v, vi) =>
        `<button class="vcard" data-v="${gi}.${vi}">${diagram(v, ui.mode, ui.root)}<small>${esc(v.label || '')}</small></button>`).join('')}</div></div>`).join('')}
      <footer>Трезвучия, shell и drop-аккорды построены по формулам; аппликатуры с надстройками — классические «ручные» формы. Все проверены на соответствие формуле во всех тональностях.</footer>`;
    const rerender = () => { save(); viewChords(); };
    on('[data-cat]', 'click', el => { ui.cat = el.dataset.cat; rerender(); });
    on('[data-type]', 'click', el => { ui.type = el.dataset.type; rerender(); });
    on('[data-key]', 'click', el => { ui.root = +el.dataset.key; rerender(); });
    on('[data-mode]', 'click', el => { ui.mode = el.dataset.mode; rerender(); });
    on('[data-snd]', 'click', el => { ui.snd = el.dataset.snd; rerender(); });
    on('[data-v]', 'click', el => {
      const [gi, vi] = el.dataset.v.split('.').map(Number);
      $$('.vcard.playing').forEach(x => x.classList.remove('playing'));
      el.classList.add('playing');
      playVoicing(groups[gi].items[vi], ui.snd === 'arp');
    });
  }

  // ===================== ЭКРАН: СПИСОК ФРАЗ =====================
  function viewLicks() {
    const f = store.ui.lf || 'all';
    const list = L.LICKS.filter(l => f === 'all' || (f === 'fav' ? store.fav[l.id] : l.style === f));
    app.innerHTML = `
      <h1>Фразы</h1>
      <p class="muted small" style="margin:0 0 8px">${L.LICKS.length} фраз для импровизации. Слушайте, смотрите табулатуру, транспонируйте и повторяйте за приложением.</p>
      <div class="chips">${[['all', 'Все'], ['blues', 'Блюз'], ['rock', 'Рок'], ['jazz', 'Джаз'], ['fav', '★ Избранные']].map(([k, n]) => `<button class="chip${f === k ? ' on' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
      ${list.length ? list.map(l => {
        const harm = l.harm.map(h => chordLabel((h[0] + l.key) % 12, h[1])).filter((x, i, a) => a.indexOf(x) === i).join(' – ');
        const best = store.best[l.id];
        return `<a class="menu" href="#/lick/${l.id}"><b>${store.fav[l.id] ? '★ ' : ''}${esc(l.title)}</b>
          <small><span class="badge ${l.style}">${L.STYLES[l.style]}</span> ${levelDots(l.level)} · ${esc(harm)}${best != null ? ` · лучший результат ${best}%` : ''}</small></a>`;
      }).join('') : '<div class="empty">Здесь пока пусто. Отмечайте фразы звёздочкой ★.</div>'}`;
    on('[data-f]', 'click', el => { store.ui.lf = el.dataset.f; save(); viewLicks(); });
  }

  // ===================== ЭКРАН: ФРАЗА =====================
  function viewLick(id) {
    const lk = L.LICKS.find(l => l.id === id);
    if (!lk) { location.hash = '#/licks'; return; }
    const st = store.ui['lk_' + id] || (store.ui['lk_' + id] = { key: lk.key, bpm: lk.bpm });
    const ui = store.ui;
    ui.lcomp = ui.lcomp == null ? true : ui.lcomp; ui.lmetro = !!ui.lmetro; ui.lloop = !!ui.lloop; ui.lmode = ui.lmode || 'iv';
    const base = L.parse(lk.tab);
    let ev = L.transpose(base, lk.key, st.key);
    const beats = base.reduce((a, e) => Math.max(a, e.t + e.d), 0);
    const harm = () => lk.harm.map(h => [(h[0] + st.key) % 12, h[1], h[2]]);
    let run = null, playing = false;

    function render() {
      ev = L.transpose(base, lk.key, st.key);
      app.innerHTML = `
        ${top(esc(lk.title), '#/licks')}
        <div class="row small"><span class="badge ${lk.style}">${L.STYLES[lk.style]}</span> ${levelDots(lk.level)}
          <span class="muted">· ${lk.swing ? 'свинг' : 'ровные восьмые'} · ${beats / 4} такт${beats / 4 === 1 ? '' : 'а'}</span>
          <span class="grow"></span><button class="icon-btn${store.fav[id] ? ' on' : ''}" id="fav" aria-label="В избранное">${store.fav[id] ? '★' : '☆'}</button></div>
        <p>${esc(lk.desc)}</p>
        <label class="f">Тональность</label>
        ${keyChips(st.key)}
        <div class="tabwrap" id="tabw">${tabSvg(ev, { harm: harm() })}</div>
        <div class="row" style="justify-content:space-between"><span class="small muted">На грифе</span>
          <div class="chips wrap">${[['iv', 'Ступени'], ['note', 'Ноты']].map(([k, n]) => `<button class="chip sm${ui.lmode === k ? ' on' : ''}" data-lm="${k}">${n}</button>`).join('')}</div></div>
        <div class="fbwrap">${lickBoard(ev, st.key, ui.lmode)}</div>
        <div class="note-tip">💡 ${esc(lk.tip)}</div>
        <p class="small muted">Лад: ${lk.scales.map(s => M.SCALES[s].name).join(', ')} от ${rootName(st.key)}.</p>
        <div class="card" style="padding:4px 14px">
          <label class="toggle">Аккомпанемент <input type="checkbox" id="tcomp" ${ui.lcomp ? 'checked' : ''}></label>
          ${compControls()}
          <label class="toggle">Метроном и отсчёт <input type="checkbox" id="tmetro" ${ui.lmetro ? 'checked' : ''}></label>
          <label class="toggle">Повторять по кругу <input type="checkbox" id="tloop" ${ui.lloop ? 'checked' : ''}></label>
          <div class="toggle" style="cursor:default">Звук ${soundChips()}</div>
        </div>
        <a class="btn wide big" href="#/repeat/${id}">🎧 Повтори за мной</a>
        <div class="player"><div class="row">
          <button class="play" id="play" aria-label="Играть">▶</button>
          <div class="tempo"><span class="small muted">Темп</span><input type="range" id="bpm" min="40" max="220" step="2" value="${st.bpm}"><b id="bpmv">${st.bpm}</b></div>
        </div></div>`;
      bindBack();
      on('[data-key]', 'click', el => { stop(); st.key = +el.dataset.key; save(); render(); });
      on('[data-lm]', 'click', el => { ui.lmode = el.dataset.lm; save(); render(); });
      bindSound(); bindComp();
      $('#fav').onclick = () => { store.fav[id] = !store.fav[id]; save(); render(); };
      $('#tcomp').onchange = e => { ui.lcomp = e.target.checked; save(); };
      $('#tmetro').onchange = e => { ui.lmetro = e.target.checked; save(); };
      $('#tloop').onchange = e => { ui.lloop = e.target.checked; save(); };
      $('#bpm').oninput = e => { st.bpm = +e.target.value; $('#bpmv').textContent = st.bpm; save(); };
      $('#bpm').onchange = () => { if (playing) { stop(); start(); } };
      $('#play').onclick = () => playing ? stop() : start();
    }
    function once(t) {
      const spb = 60 / st.bpm;
      run = Snd.playPhrase(ev, { bpm: st.bpm, swing: lk.swing, at: t, beats });
      if (ui.lcomp) Snd.comp(harm(), t, spb, STYLE_OF[lk.style], lk.swing, 0.8);
      if (ui.lmetro) for (let b = 0; b < beats; b++) Snd.click(t + b * spb, b % 4 === 0);
      if (ui.lloop) later(() => { if (playing) once(run.end); }, Math.max(0, (run.end - Snd.now() - 0.3) * 1000));
      else later(() => { if (playing) stop(); }, (run.end - Snd.now() + 0.4) * 1000);
    }
    function start() {
      audioOn(); playing = true; $('#play').textContent = '■';
      Snd.prepare(lk.style).then(() => { if (playing) go(); });
    }
    function go() {
      let t = Snd.now() + 0.12;
      const spb = 60 / st.bpm;
      if (ui.lmetro) { for (let b = 0; b < 4; b++) Snd.click(t + b * spb, b === 0); t += 4 * spb; }
      once(t);
      raf(() => { if (!playing) return false; highlight(ev, run); });
    }
    function stop() { playing = false; Snd.stopAll(); const b = $('#play'); if (b) b.textContent = '▶'; highlight(ev, null); }
    onLeave(() => { playing = false; });
    render();
  }

  // ===================== ЭКРАН: ПРАКТИКА =====================
  function viewPractice() {
    const q = store.quiz;
    const tries = Object.values(store.tries).reduce((a, b) => a + b, 0);
    app.innerHTML = `
      <h1>Гитара: аккорды и импровизация</h1>
      <p class="muted small" style="margin:0 0 6px">Аппликатуры, фразы для импровизации, теория и тренажёры.</p>
      <div class="tools2">
        <a class="tool" href="#/metro"><svg viewBox="0 0 24 24"><path d="M9 3h6l4 18H5z"/><path d="M12 17l5-10"/><path d="M8 17h8"/></svg><b>Метроном</b></a>
        <a class="tool" href="#/tuner">${FORK.replace('width="22" height="22"', '')}<b>Тюнер</b></a>
      </div>
      <a class="menu hero" href="#/repeat"><b>🎧 Повтори за мной</b><small>Приложение играет фразу — вы повторяете в паузе. Смена тональностей по кругу, проверка нот через микрофон.</small></a>
      <a class="menu" href="#/backing"><b>🥁 Подложки для импровизации</b><small>Блюз, джазовый блюз, ii–V–I, рок: бас, барабаны, аккорды и подсказка лада.</small></a>
      <a class="menu" href="#/ear"><b>👂 Слух: тип аккорда</b><small>Приложение играет аккорд — определите maj7, m7, 7, m7♭5…${q.ear ? ` · верно ${q.ear.ok} из ${q.ear.n}` : ''}</small></a>
      <a class="menu" href="#/dq"><b>🔲 Аккорд по диаграмме</b><small>Узнайте аккорд по аппликатуре на грифе.${q.dq ? ` · верно ${q.dq.ok} из ${q.dq.n}` : ''}</small></a>
      <a class="menu" href="#/fq"><b>🧮 Формулы и ноты</b><small>Ступени и звуки аккордов: от трезвучий до альтераций.${q.fq ? ` · верно ${q.fq.ok} из ${q.fq.n}` : ''}</small></a>
      <h2>Звук гитары</h2>
      ${soundChips()}
      <p class="small muted" style="margin:4px 0 0">«Авто»: рок — электрогитара с перегрузом, блюз, джаз и аккорды — нейлон. «Синтез» — лёгкий запасной звук без записей.</p>
      <h2>Быстрый старт</h2>
      <div class="stat3">
        <div><b>${M.TYPES.length}</b><span class="small muted">типов аккордов</span></div>
        <div><b>${L.LICKS.length}</b><span class="small muted">фраз</span></div>
        <div><b>${tries}</b><span class="small muted">повторов</span></div>
      </div>
      <ol class="small" style="padding-left:1.2em;line-height:1.6">
        <li>Откройте <a href="#/chords">Аккорды</a> → «Shell» → 7 и сыграйте формы по всем тональностям.</li>
        <li>В <a href="#/licks">Фразах</a> выберите блюзовую фразу, послушайте и посмотрите табулатуру.</li>
        <li>Нажмите «Повтори за мной» и повторяйте фразу, пока приложение ведёт её по тональностям.</li>
        <li>Включите <a href="#/backing">подложку</a> и вставьте фразу в своё соло.</li>
      </ol>
      <footer>Работает без интернета. Чтобы установить: в браузере «Поделиться» → «На экран Домой» (iPhone) или меню → «Установить приложение» (Android).<br>На iPhone проверьте, что выключен беззвучный режим.<br>Записи гитары и фортепиано: tonejs-instruments (N. Brosowsky), FluidR3_GM (F. Wen) — <a href="samples/CREDITS.md">подробнее</a>.</footer>`;
    bindSound();
  }

  // ===================== МЕТРОНОМ =====================
  const SIGS = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 8], [7, 8], [12, 8]];
  const SUBS = [[1, '♩'], [2, '♫'], [3, '³'], [4, '𝅘𝅥𝅯']];
  const DIAL = { cx: 160, cy: 160, r: 130, min: 30, max: 270 };
  const bpmAngle = b => (b - 150) * 1.2; // градусы от верха, по часовой
  const polar = (deg, r) => { const a = deg * Math.PI / 180; return [DIAL.cx + r * Math.sin(a), DIAL.cy - r * Math.cos(a)]; };
  function arcPath(a0, a1, r) {
    const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }

  const ACCENT = '<svg viewBox="0 0 24 14" aria-hidden="true"><path d="M3 2 L21 7 L3 12"/></svg>';
  // блок доли: акцент — значок «>» и полная заливка, доля — нота, пауза — крестик
  function beatHtml(lv, i, d) {
    const note = d === 8 ? '♪' : '♩';
    return `<button class="mbeat lv${lv}" data-b="${i}" aria-label="Доля ${i + 1}: ${lv === 2 ? 'акцент' : lv === 1 ? 'обычная' : 'пауза'}"><span class="mbin">
      <i>${lv === 2 ? ACCENT : ''}</i><i></i><i>${lv === 0 ? '✕' : note}</i></span></button>`;
  }

  function viewMetro() {
    const m = store.ui.metro = store.ui.metro || {};
    if (!m.bpm) m.bpm = 70;
    if (m.sig == null) m.sig = 2;
    if (m.sub == null) m.sub = 0;
    const beatsN = () => SIGS[m.sig][0];
    if (!Array.isArray(m.lv) || m.lv.length !== beatsN()) m.lv = Array.from({ length: beatsN() }, (_, i) => i === 0 ? 2 : 1);
    let playing = false, timer = null, next = 0, beat = 0, sub = 0, queue = [], taps = [];
    const clamp = b => Math.max(DIAL.min, Math.min(DIAL.max, Math.round(b)));

    function render() {
      const [n, d] = SIGS[m.sig];
      app.innerHTML = `
        <div class="mtop">${top('Метроном', '#/practice')}<a class="icon-btn mfork" href="#/tuner" aria-label="Тюнер">${FORK}</a></div>
        <div class="mbeats" style="--n:${n}">${m.lv.map((lv, i) => beatHtml(lv, i, d)).join('')}</div>
        <div class="mlegend small muted"><span><i class="mk acc">${ACCENT}</i> акцент</span><span><i class="mk">${d === 8 ? '♪' : '♩'}</i> доля</span><span><i class="mk off">✕</i> пауза</span></div>
        <div class="mbpm"><button class="mpm" data-d="-1" aria-label="Медленнее">−</button><b id="bpm">${m.bpm}</b><button class="mpm" data-d="1" aria-label="Быстрее">+</button></div>
        <div class="mdial">
          <svg viewBox="0 0 320 320" id="dial" aria-label="Темп">
            <path d="${arcPath(bpmAngle(DIAL.min), bpmAngle(DIAL.max), DIAL.r)}" class="track"/>
            ${[50, 100, 150, 200, 250].map(v => { const [x, y] = polar(bpmAngle(v), DIAL.r - 48); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${v}</text>`; }).join('')}
            <circle id="knob" r="22"/>
          </svg>
          <button class="mplay" id="play" aria-label="Старт">${playing ? '■' : '▶'}</button>
        </div>
        <div class="mbottom">
          <button class="mlink" id="sig">${n}/${d}</button>
          <button class="mlink" id="sub" aria-label="Дробление доли">${SUBS[m.sub][1]}</button>
          <button class="mlink" id="tap">Тап</button>
        </div>`;
      bindBack();
      placeKnob();
      on('[data-b]', 'click', el => { const i = +el.dataset.b; m.lv[i] = m.lv[i] === 1 ? 2 : m.lv[i] === 2 ? 0 : 1; save(); render(); });
      // − / +: нажатие — шаг 1, удержание — непрерывно
      $$('.mpm').forEach(el => {
        let t1 = null, t2 = null;
        const step = () => setBpm(m.bpm + +el.dataset.d);
        const end = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
        el.addEventListener('pointerdown', e => { e.preventDefault(); step(); t1 = setTimeout(() => { t2 = setInterval(step, 70); }, 420); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, end));
        el.addEventListener('click', e => { if (e.detail === 0) step(); }); // клавиатура
        onLeave(end);
      });
      $('#play').onclick = () => playing ? stop() : start();
      $('#sig').onclick = () => { m.sig = (m.sig + 1) % SIGS.length; const n2 = SIGS[m.sig][0]; m.lv = Array.from({ length: n2 }, (_, i) => i === 0 ? 2 : 1); if (SIGS[m.sig][1] === 8 && n2 % 3 === 0) for (let i = 3; i < n2; i += 3) m.lv[i] = 2; save(); const was = playing; stop(); render(); if (was) start(); };
      $('#sub').onclick = () => { m.sub = (m.sub + 1) % SUBS.length; save(); $('#sub').textContent = SUBS[m.sub][1]; };
      $('#tap').onclick = () => {
        const t = performance.now();
        taps = taps.filter(x => t - x < 2500); taps.push(t);
        if (taps.length >= 2) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); setBpm(60000 / iv); }
      };
      // перетаскивание ручки по кругу
      const svg = $('#dial');
      let drag = false;
      const fromEvent = e => {
        const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 320 - DIAL.cx, y = (e.clientY - r.top) / r.height * 320 - DIAL.cy;
        return { a: Math.atan2(x, -y) * 180 / Math.PI, d: Math.hypot(x, y) };
      };
      svg.addEventListener('pointerdown', e => { const p = fromEvent(e); if (p.d < 75) return; drag = true; svg.setPointerCapture(e.pointerId); move(p); });
      svg.addEventListener('pointermove', e => { if (drag) move(fromEvent(e)); });
      svg.addEventListener('pointerup', () => { drag = false; });
      const move = p => { let a = Math.max(bpmAngle(DIAL.min), Math.min(bpmAngle(DIAL.max), p.a)); setBpm(150 + a / 1.2); };
    }
    function placeKnob() { const [x, y] = polar(bpmAngle(m.bpm), DIAL.r); const k = $('#knob'); k.setAttribute('cx', x.toFixed(1)); k.setAttribute('cy', y.toFixed(1)); }
    function setBpm(b) { m.bpm = clamp(b); $('#bpm').textContent = m.bpm; placeKnob(); save(); }

    function start() {
      audioOn(); playing = true; $('#play').textContent = '■';
      next = Snd.now() + 0.08; beat = 0; sub = 0; queue = [];
      timer = setInterval(schedule, 25);
      raf(() => {
        if (!playing) return false;
        const t = Snd.ctx.currentTime;
        while (queue.length > 1 && queue[1].t <= t) queue.shift();
        const cur = queue.length && queue[0].t <= t ? queue[0].b : -1;
        $$('.mbeat').forEach((el, i) => el.classList.toggle('now', i === cur));
      });
    }
    function schedule() {
      const spb = 60 / m.bpm, k = SUBS[m.sub][0];
      while (next < Snd.ctx.currentTime + 0.12) {
        const lv = m.lv[beat] || 0;
        if (sub === 0) { if (lv) Snd.tick(next, lv); queue.push({ t: next, b: beat }); }
        else if (lv) Snd.tick(next, 0.5);
        next += spb / k;
        if (++sub >= k) { sub = 0; beat = (beat + 1) % m.lv.length; }
      }
    }
    function stop() { playing = false; clearInterval(timer); const b = $('#play'); if (b) b.textContent = '▶'; $$('.mbeat').forEach(el => el.classList.remove('now')); }
    onLeave(() => { playing = false; clearInterval(timer); });
    render();
  }

  // ===================== ТЮНЕР =====================
  const FORK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 2v8a3 3 0 0 0 6 0V2"/><path d="M12 13v9"/></svg>';
  const STRINGS = [[40, '6'], [45, '5'], [50, '4'], [55, '3'], [59, '2'], [64, '1']];
  function viewTuner() {
    const ui = store.ui; ui.a4 = ui.a4 || 440;
    let hist = [], shown = null, lastSeen = 0;
    app.innerHTML = `
      ${top('Тюнер', '#/practice')}
      <div class="tuner">
        <div class="tnote" id="tn"><span id="tl">–</span><sup id="ta"></sup><sub id="to"></sub></div>
        <div class="tscale"><div class="tticks">${Array.from({ length: 21 }, (_, i) => `<i class="${i === 10 ? 'c' : i % 5 === 0 ? 'l' : ''}"></i>`).join('')}</div><div class="tneedle" id="needle"></div></div>
        <div class="tinfo"><span id="tc">&nbsp;</span><span id="thz" class="muted">&nbsp;</span></div>
        <div class="tstr" id="tstr">${STRINGS.map(([mm, n]) => `<span data-m="${mm}">${n}<b>${P(M.pcName(mm % 12))}</b></span>`).join('')}</div>
        <div id="tmsg" class="small muted" style="text-align:center;margin-top:14px">Нажмите «Включить» и сыграйте одну струну.</div>
        <button class="btn wide big" id="go" style="margin-top:14px">🎤 Включить</button>
        <div class="row" style="justify-content:center;margin-top:16px"><button class="icon-btn" id="am">−</button><span class="small">Ля = <b id="a4">${ui.a4}</b> Гц</span><button class="icon-btn" id="ap">+</button></div>
      </div>`;
    bindBack();
    const setA = d => { ui.a4 = Math.max(430, Math.min(450, ui.a4 + d)); $('#a4').textContent = ui.a4; save(); };
    $('#am').onclick = () => setA(-1); $('#ap').onclick = () => setA(1);
    $('#go').onclick = async () => {
      audioOn();
      try {
        try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
        await Snd.micStart();
      } catch (e) { $('#tmsg').textContent = 'Нет доступа к микрофону. Разрешите его в настройках браузера.'; return; }
      $('#go').remove(); $('#tmsg').textContent = 'Сыграйте одну струну и дайте ей звучать.';
      onLeave(() => Snd.micStop());
      raf(() => {
        const p = Snd.detectPitch(), now = performance.now();
        if (p && p.f > 60 && p.f < 1400 && p.rms > 0.01) {
          hist.push(p.f); if (hist.length > 7) hist.shift();
          lastSeen = now;
        } else if (now - lastSeen > 1200) { hist = []; }
        if (!hist.length) { if (shown !== null) { shown = null; $('#tn').classList.add('idle'); } return; }
        const f = hist.slice().sort((a, b) => a - b)[hist.length >> 1];
        const midiF = 69 + 12 * Math.log2(f / ui.a4), mi = Math.round(midiF), cents = Math.round((midiF - mi) * 100);
        shown = mi;
        const name = M.pcName(((mi % 12) + 12) % 12);
        $('#tn').classList.remove('idle');
        $('#tl').textContent = name[0]; $('#ta').textContent = name.length > 1 ? (name[1] === '#' ? '♯' : '♭') : ''; $('#to').textContent = Math.floor(mi / 12) - 1;
        const ok = Math.abs(cents) <= 5;
        const nd = $('#needle'); nd.style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%'; nd.classList.toggle('ok', ok);
        $('#tn').classList.toggle('ok', ok);
        $('#tc').textContent = ok ? '✓ точно' : (cents > 0 ? '+' : '') + cents + ' центов ' + (cents > 0 ? '(выше)' : '(ниже)');
        $('#thz').textContent = f.toFixed(1) + ' Гц';
        const near = STRINGS.reduce((a, s) => Math.abs(s[0] - midiF) < Math.abs(a[0] - midiF) ? s : a);
        $$('#tstr span').forEach(el => el.classList.toggle('on', +el.dataset.m === near[0] && Math.abs(near[0] - midiF) < 1.5));
      });
    };
  }

  // ===================== УПРАЖНЕНИЕ: ПОВТОРИ ЗА МНОЙ =====================
  function viewRepeat(id) {
    const S = store.rep;
    const def = { lick: 'random', style: 'all', keyMode: 'fourths', reps: 2, tempo: 80, tabMode: 'always', mic: false, comp: true, metro: true, auto: true };
    Object.keys(def).forEach(k => { if (S[k] == null) S[k] = def[k]; });
    if (id) S.lick = id;
    const pool = () => L.LICKS.filter(l => S.style === 'all' || l.style === S.style);

    function setup() {
      const opts = L.LICKS.map(l => `<option value="${l.id}" ${S.lick === l.id ? 'selected' : ''}>${L.STYLES[l.style]}: ${esc(l.title)}</option>`).join('');
      app.innerHTML = `
        ${top('Повтори за мной', id ? '#/lick/' + id : '#/practice')}
        <p class="muted small" style="margin:0">Отсчёт 4 доли → приложение играет фразу → в паузе той же длины вы её повторяете. Потом — следующая тональность.</p>
        <label class="f">Фраза</label>
        <select id="lick"><option value="random" ${S.lick === 'random' ? 'selected' : ''}>Случайная</option>${opts}</select>
        <div id="stylebox" ${S.lick === 'random' ? '' : 'hidden'}>
          <label class="f">Стиль случайных фраз</label>
          <div class="chips wrap">${[['all', 'Все'], ['blues', 'Блюз'], ['rock', 'Рок'], ['jazz', 'Джаз']].map(([k, n]) => `<button class="chip sm${S.style === k ? ' on' : ''}" data-st="${k}">${n}</button>`).join('')}</div>
        </div>
        <label class="f">Тональности</label>
        <div class="chips wrap">${[['fixed', 'Исходная'], ['fourths', 'По квартам'], ['random', 'Случайно']].map(([k, n]) => `<button class="chip sm${S.keyMode === k ? ' on' : ''}" data-km="${k}">${n}</button>`).join('')}</div>
        <label class="f">Повторов в каждой тональности</label>
        <div class="chips wrap">${[1, 2, 3, 4].map(k => `<button class="chip sm${S.reps === k ? ' on' : ''}" data-reps="${k}">${k}</button>`).join('')}</div>
        <label class="f">Темп: <b id="tv">${S.tempo}%</b> от исходного</label>
        <input type="range" id="tempo" min="40" max="130" step="5" value="${S.tempo}">
        <label class="f">Звук гитары</label>
        ${soundChips()}
        <label class="f">Табулатура</label>
        <div class="chips wrap">${[['always', 'Видна'], ['after', 'После попытки'], ['never', 'Только на слух']].map(([k, n]) => `<button class="chip sm${S.tabMode === k ? ' on' : ''}" data-tm="${k}">${n}</button>`).join('')}</div>
        <div class="card" style="padding:4px 14px;margin-top:14px">
          <label class="toggle"><span>Проверять по микрофону<br><span class="small muted">лучше в наушниках; аккомпанемент в вашей паузе выключается</span></span><input type="checkbox" id="mic" ${S.mic ? 'checked' : ''}></label>
          <label class="toggle">Аккомпанемент <input type="checkbox" id="comp" ${S.comp ? 'checked' : ''}></label>
          ${compControls()}
          <label class="toggle">Метроном <input type="checkbox" id="metro" ${S.metro ? 'checked' : ''}></label>
          <label class="toggle"><span>Автопродолжение<br><span class="small muted">без остановок — руки остаются на грифе</span></span><input type="checkbox" id="auto" ${S.auto ? 'checked' : ''}></label>
        </div>
        <button class="btn wide big" id="go">▶ Начать</button>`;
      bindBack();
      $('#lick').onchange = e => { S.lick = e.target.value; save(); setup(); };
      on('[data-st]', 'click', el => { S.style = el.dataset.st; save(); setup(); });
      on('[data-km]', 'click', el => { S.keyMode = el.dataset.km; save(); setup(); });
      on('[data-reps]', 'click', el => { S.reps = +el.dataset.reps; save(); setup(); });
      on('[data-tm]', 'click', el => { S.tabMode = el.dataset.tm; save(); setup(); });
      $('#tempo').oninput = e => { S.tempo = +e.target.value; $('#tv').textContent = S.tempo + '%'; save(); };
      ['mic', 'comp', 'metro', 'auto'].forEach(k => $('#' + k).onchange = e => { S[k] = e.target.checked; save(); });
      bindSound(); bindComp();
      $('#go').onclick = begin;
    }

    let R = null;
    async function begin() {
      audioOn();
      const lk = S.lick === 'random' ? pick(pool()) : L.LICKS.find(l => l.id === S.lick);
      R = { lk, key: lk.key, rep: 0, round: 0, done: 0, scores: [], micOk: false, stopped: false };
      if (S.mic) {
        try {
          try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
          await Snd.micStart(); R.micOk = true;
        } catch (e) { R.micErr = 'Нет доступа к микрофону — проверка выключена. Разрешите микрофон в настройках браузера.'; }
      }
      onLeave(() => { Snd.micStop(); if (R) R.stopped = true; });
      cycle();
    }

    function nextKey() {
      R.rep++;
      if (R.rep < S.reps) return;
      R.rep = 0; R.round++;
      if (S.lick === 'random') R.lk = pick(pool().filter(l => l !== R.lk)) || R.lk;
      if (S.keyMode === 'fourths') R.key = (R.key + 5) % 12;
      else if (S.keyMode === 'random') { let k; do { k = Math.floor(Math.random() * 12); } while (k === R.key); R.key = k; }
      else R.key = R.lk.key;
    }

    function cycle() {
      if (R.stopped) return;
      Snd.stopAll();
      Snd.prepare(R.lk.style).then(() => { if (!R.stopped) cycleRun(); });
    }

    function cycleRun() {
      const lk = R.lk, base = L.parse(lk.tab);
      const ev = L.transpose(base, lk.key, R.key);
      const beats = base.reduce((a, e) => Math.max(a, e.t + e.d), 0);
      const bpm = Math.round(lk.bpm * S.tempo / 100), spb = 60 / bpm;
      const harm = lk.harm.map(h => [(h[0] + R.key) % 12, h[1], h[2]]);
      const t0 = Snd.now() + 0.25, tCall = t0 + 4 * spb, tYou = tCall + beats * spb, tEnd = tYou + beats * spb;
      const micOn = R.micOk;
      const targets = ev.map((e, i) => ({ e, i })).filter(x => !x.e.rest && x.e.notes.length === 1)
        .map(x => ({ i: x.i, midi: x.e.notes[0].midi + (x.e.bend && !x.e.release ? x.e.bend : 0) }));
      const checkable = micOn && targets.length >= 3;
      const showTab = S.tabMode === 'always';
      const chordsTxt = harm.map(h => chordLabel(h[0], h[1])).filter((x, i, a) => a.indexOf(x) === i).join(' – ');

      app.innerHTML = `
        ${top('Повтори за мной', '#/practice')}
        <div class="row small"><b>${esc(lk.title)}</b><span class="badge ${lk.style}">${L.STYLES[lk.style]}</span></div>
        <div class="row small muted">Тональность ${rootName(R.key)} · ${esc(chordsTxt)} · ${bpm} уд/мин · повтор ${R.rep + 1}/${S.reps}</div>
        ${R.micErr ? `<div class="note-tip">${R.micErr}</div>` : ''}
        ${micOn && !checkable ? '<div class="note-tip">Во фразе двойные ноты и аккорды — микрофон их не проверяет. Слушайте себя сами.</div>' : ''}
        <div class="stage" id="stage"><div class="small muted" id="ph">Приготовьтесь</div><div class="big" id="msg">1 · 2 · 3 · 4</div>
          <div class="beats" id="beats">${'<i></i>'.repeat(4)}</div><div class="prog"><i id="pr"></i></div>
          <div class="notes" id="heard"></div></div>
        <div class="tabwrap ${showTab ? '' : 'hidden-tab'}" id="tabw">${tabSvg(ev, { harm })}</div>
        <div class="fbwrap ${showTab ? '' : 'hidden-tab'}" id="fbw">${lickBoard(ev, R.key, 'iv')}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn alt grow" style="padding:10px 6px" id="stop">■ Стоп</button>
          <button class="btn alt grow" style="padding:10px 6px" id="again">↻ Повтор</button>
          <button class="btn grow" style="padding:10px 6px" id="next">Дальше →</button>
        </div>
        <p class="small muted" style="text-align:center">Пройдено: ${R.done}${R.scores.length ? ` · средняя точность ${Math.round(R.scores.reduce((a, b) => a + b, 0) / R.scores.length)}%` : ''}</p>`;
      bindBack();
      $('#stop').onclick = () => { R.stopped = true; Snd.stopAll(); Snd.micStop(); setup(); };
      $('#again').onclick = () => { R.stopped = false; cycle(); };
      $('#next').onclick = () => { R.stopped = false; R.rep = S.reps - 1; nextKey(); cycle(); };

      // звук
      const run = Snd.playPhrase(ev, { bpm, swing: lk.swing, at: tCall, beats });
      for (let b = 0; b < 4; b++) Snd.click(t0 + b * spb, b === 0);
      if (S.metro) for (let b = 0; b < beats * 2; b++) Snd.click(tCall + b * spb, b % 4 === 0);
      if (S.comp) {
        Snd.comp(harm, tCall, spb, STYLE_OF[lk.style], lk.swing, 0.75);
        if (!micOn) Snd.comp(harm, tYou, spb, STYLE_OF[lk.style], lk.swing, 0.75);
      }

      const tracker = Snd.noteTracker();
      let phase = '', finished = false;
      const myCycle = R.cycleId = (R.cycleId || 0) + 1;
      raf(() => {
        if (R.stopped || R.cycleId !== myCycle) return false;
        const t = Snd.ctx.currentTime;
        let ph, p0, p1;
        if (t < tCall) { ph = 'count'; p0 = t0; p1 = tCall; }
        else if (t < tYou) { ph = 'call'; p0 = tCall; p1 = tYou; }
        else if (t < tEnd + 0.35) { ph = 'you'; p0 = tYou; p1 = tEnd; }
        else ph = 'end';
        if (ph !== phase) {
          phase = ph;
          const stg = $('#stage');
          stg.className = 'stage ' + ({ call: 'listen', you: 'you', end: 'done' }[ph] || '');
          if (ph === 'call') { $('#ph').textContent = 'Слушайте'; $('#msg').textContent = '🎸 Приложение играет'; }
          if (ph === 'you') { $('#ph').textContent = micOn ? 'Слушаю вас…' : 'Ваша очередь'; $('#msg').textContent = 'Повторите фразу!'; highlight(ev, null); }
        }
        if (ph === 'end') { if (!finished) { finished = true; finish(); } return false; }
        $('#pr').style.width = Math.min(100, 100 * (t - p0) / (p1 - p0)) + '%';
        const beat = Math.floor((t - (ph === 'count' ? t0 : p0)) / spb);
        $$('#beats i').forEach((el, k) => el.classList.toggle('on', ph === 'count' ? k <= beat : k === beat % 4));
        if (ph === 'count') $('#msg').textContent = [1, 2, 3, 4].map((n, k) => k <= beat ? n : '·').join(' ');
        if (ph === 'call') highlight(ev, run);
        if (ph === 'you' && micOn) {
          const p = Snd.detectPitch();
          const m = tracker.push(p, t);
          if (m != null) $('#heard').insertAdjacentHTML('beforeend', `<span class="cur">${P(M.midiName(m))}</span>`);
        }
      });

      function finish() {
        R.done++;
        store.tries[lk.id] = (store.tries[lk.id] || 0) + 1;
        $('#tabw').classList.remove('hidden-tab'); $('#fbw').classList.remove('hidden-tab');
        if (S.tabMode === 'never') { $('#tabw').classList.add('hidden-tab'); $('#fbw').classList.add('hidden-tab'); }
        let delay = 900;
        if (checkable) {
          const res = compare(targets.map(x => x.midi), tracker.notes.map(n => n.midi));
          R.scores.push(res.score);
          store.best[lk.id] = Math.max(store.best[lk.id] || 0, res.score);
          $('#ph').textContent = res.score >= 90 ? 'Отлично!' : res.score >= 70 ? 'Хорошо' : res.score >= 40 ? 'Почти получилось' : 'Попробуйте ещё раз';
          $('#msg').innerHTML = `<span class="score">${res.score}%</span>`;
          $('#heard').innerHTML = targets.map((x, k) => `<span class="${res.hit[k] ? 'ok' : 'miss'}">${P(M.pcName(x.midi % 12))}</span>`).join('') +
            (tracker.notes.length ? `<div class="small muted" style="width:100%">услышано: ${tracker.notes.map(n => P(M.midiName(n.midi))).join(' ')}</div>` : '<div class="small muted" style="width:100%">ничего не услышано — проверьте микрофон</div>');
          targets.forEach((x, k) => $$(`svg.tab .n[data-i="${x.i}"]`).forEach(g => g.classList.add(res.hit[k] ? 'ok' : 'miss')));
          delay = 2600;
          if (S.auto && res.score < 50) { R.rep = Math.max(-1, R.rep - 1); }
        } else {
          $('#ph').textContent = 'Готово'; $('#msg').textContent = S.auto ? 'Следующий круг…' : 'Ещё раз или дальше?';
        }
        save();
        if (S.auto) later(() => { if (!R.stopped && R.cycleId === myCycle) { nextKey(); cycle(); } }, delay);
      }
    }

    // сравнение по высотным классам: наибольшая общая подпоследовательность
    function compare(target, heard) {
      const collapse = a => a.filter((x, i) => i === 0 || x % 12 !== a[i - 1] % 12);
      const tIdx = target.map((x, i) => i).filter(i => i === 0 || target[i] % 12 !== target[i - 1] % 12);
      const t = tIdx.map(i => target[i] % 12), h = collapse(heard).map(x => x % 12);
      const n = t.length, m = h.length;
      const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = t[i - 1] === h[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      const hitC = new Array(n).fill(false);
      for (let i = n, j = m; i > 0 && j > 0;) {
        if (t[i - 1] === h[j - 1]) { hitC[i - 1] = true; i--; j--; } else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
      }
      const hit = target.map(() => false);
      tIdx.forEach((ti, k) => { const end = k + 1 < tIdx.length ? tIdx[k + 1] : target.length; for (let q = ti; q < end; q++) hit[q] = hitC[k]; });
      return { score: n ? Math.round(100 * dp[n][m] / n) : 0, hit };
    }

    setup();
  }

  // ===================== УПРАЖНЕНИЕ: ПОДЛОЖКИ =====================
  function viewBacking() {
    const B = store.back;
    B.prog = B.prog || 'blues12';
    let prog = M.PROGS.find(p => p.id === B.prog) || M.PROGS[0];
    if (B.key == null || B.forProg !== prog.id) { B.key = prog.key; B.bpm = prog.bpm; B.forProg = prog.id; }
    let playing = false, curBar = -1;
    const bars = () => prog.bars.map(b => (Array.isArray(b[0]) ? b : [b]).map(c => [(c[0] + B.key) % 12, c[1]]));
    const sc = prog.sc[0][0];
    function render() {
      const bs = bars();
      app.innerHTML = `
        ${top('Подложки', '#/practice')}
        <div class="chips">${M.PROGS.map(p => `<button class="chip sm${p.id === prog.id ? ' on' : ''}" data-pr="${p.id}">${esc(p.name)}</button>`).join('')}</div>
        ${keyChips(B.key)}
        <div class="card" style="text-align:center">
          <div class="nowchord" id="now">${esc(chordLabel(bs[0][0][0], bs[0][0][1]))}</div>
          <div class="small muted" id="nxt">нажмите ▶</div>
        </div>
        <div class="bars" id="bars">${bs.map((b, i) => `<div data-b="${i}">${b.map(c => esc(chordLabel(c[0], c[1]))).join(' ')}</div>`).join('')}</div>
        <div class="note-tip">Лад: <b>${esc(prog.sc.map(([s]) => M.SCALES[s].name + ' от ' + rootName(B.key)).join(' или '))}</b>.
          Ноты: ${M.scaleNotes(B.key, sc).map(P).join(' ')}. На грифе подписаны звуки текущего аккорда — цельтесь в них на сильных долях; бледные точки — остальные ноты лада.</div>
        <div class="fbwrap" id="fbw"></div>
        <div class="row small muted">Звук: ${soundChips()}</div>
        <div class="card" style="padding:6px 14px"><div class="small muted">Аккорды</div>${compControls()}</div>
        <div class="row"><div class="grow"></div><div style="width:120px" id="dgw"></div><div class="grow"></div></div>
        <div class="player"><div class="row">
          <button class="play" id="play" aria-label="Играть">▶</button>
          <div class="tempo"><span class="small muted">Темп</span><input type="range" id="bpm" min="50" max="220" step="2" value="${B.bpm}"><b id="bpmv">${B.bpm}</b></div>
        </div></div>`;
      bindBack();
      on('[data-pr]', 'click', el => { stop(); B.prog = el.dataset.pr; prog = M.PROGS.find(p => p.id === B.prog); B.key = prog.key; B.bpm = prog.bpm; B.forProg = prog.id; save(); render(); });
      on('[data-key]', 'click', el => { const was = playing; stop(); B.key = +el.dataset.key; save(); render(); if (was) start(); });
      $('#bpm').oninput = e => { B.bpm = +e.target.value; $('#bpmv').textContent = B.bpm; save(); };
      $('#bpm').onchange = () => { if (playing) { stop(); start(); } };
      $('#play').onclick = () => playing ? stop() : start();
      bindSound(); bindComp();
      showBar(0, false);
    }
    function showBar(i, live) {
      const bs = bars(), b = bs[i], n = bs[(i + 1) % bs.length];
      $$('#bars div').forEach(d => d.classList.toggle('on', live && +d.dataset.b === i));
      $('#now').textContent = b.map(c => chordLabel(c[0], c[1])).join(' ');
      if (live) $('#nxt').textContent = 'дальше: ' + n.map(c => chordLabel(c[0], c[1])).join(' ');
      const [pc, type] = b[0];
      const ct = M.TYPE[type].f.map(iv => (pc + M.IV[iv][0]) % 12);
      // звуки аккорда — с подписями, остальные ноты лада — бледные
      const inScale = new Set(M.scaleFrets(B.key, sc, 0, 11).map(d => d.midi % 12));
      const dots = [];
      for (let st = 1; st <= 6; st++) for (let f = 0; f <= 15; f++) {
        const m = M.midiAt(st, f), isCt = ct.includes(m % 12);
        if (isCt) dots.push({ s: st, f, label: P(M.intervalName(type, m - pc)), root: m % 12 === pc });
        else if (inScale.has(m % 12)) dots.push({ s: st, f, label: '', dim: true });
      }
      $('#fbw').innerHTML = fretboard(dots, 0, 15, { fw: 30 });
      $('#dgw').innerHTML = diagram(M.compVoicing(pc, type, 6), 'iv', pc);
    }
    function start() {
      audioOn(); playing = true; $('#play').textContent = '■';
      Snd.prepare(prog.style === 'rock' ? 'rock' : 'jazz').then(() => {
        if (playing) Snd.startLoop(prog, B.key, B.bpm, i => { if (playing) { curBar = i; showBar(i, true); } });
      });
    }
    function stop() { playing = false; Snd.stopAll(); const b = $('#play'); if (b) b.textContent = '▶'; }
    onLeave(() => { playing = false; });
    render();
  }

  // ===================== УПРАЖНЕНИЯ: СЛУХ / ДИАГРАММЫ / ФОРМУЛЫ =====================
  const SETS = {
    triad: { name: 'Трезвучия', types: ['maj', 'm', 'dim', 'aug', 'sus4'] },
    seventh: { name: 'Септаккорды', types: ['maj7', '7', 'm7', 'm7b5', 'dim7'] },
    more: { name: 'Ещё септаккорды', types: ['6', 'm6', 'mMaj7', '7sus4', 'maj7', 'm7'] },
    ext: { name: 'Надстройки', types: ['maj9', '9', 'm9', '13', '69', 'm11'] },
    alt: { name: 'Альтерации', types: ['7', '7b9', '7s9', '7s5', '7alt', '7s11'] }
  };
  function quizVoicing(pc, type) {
    let vs = M.allVoicings(pc, type).filter(v => !v.rootless && v.notes.filter(x => x != null).length >= 3 && v.minFret >= 1);
    if (!vs.length) vs = M.allVoicings(pc, type);
    return pick(vs);
  }
  function bump(k, ok) { const q = store.quiz[k] = store.quiz[k] || { n: 0, ok: 0 }; q.n++; if (ok) q.ok++; save(); }
  function quizStats(k) { const q = store.quiz[k]; return q ? `Всего: верно ${q.ok} из ${q.n} (${Math.round(100 * q.ok / q.n)}%)` : ''; }

  function viewEar() {
    const ui = store.ui; ui.earSet = ui.earSet || 'seventh';
    let cur = null, answered = false, streak = 0;
    function question() {
      const set = SETS[ui.earSet];
      const type = pick(set.types), pc = Math.floor(Math.random() * 12);
      cur = { type, pc, v: quizVoicing(pc, type) }; answered = false;
      render();
      playVoicing(cur.v, false);
    }
    function render() {
      const set = SETS[ui.earSet];
      app.innerHTML = `
        ${top('Слух: тип аккорда', '#/practice')}
        <div class="chips">${Object.entries(SETS).map(([k, s]) => `<button class="chip sm${k === ui.earSet ? ' on' : ''}" data-set="${k}">${s.name}</button>`).join('')}</div>
        <div class="stage"><div class="small muted">Серия: ${streak}</div><div class="big">${answered ? esc(chordLabel(cur.pc, cur.type)) : 'Какой это аккорд?'}</div>
          <div class="row" style="justify-content:center;margin-top:10px"><button class="btn alt" id="pl">▶ Аккорд</button><button class="btn alt" id="arp">♪ Арпеджио</button></div></div>
        <div class="opts">${set.types.map(t => `<button class="opt" data-t="${t}">${P(M.TYPE[t].sym || 'maj')}<br><span class="small muted" style="font-weight:400">${esc(M.TYPE[t].name)}</span></button>`).join('')}</div>
        <div id="after"></div>
        <p class="small muted" style="text-align:center">${quizStats('ear')}</p>`;
      bindBack();
      on('[data-set]', 'click', el => { ui.earSet = el.dataset.set; save(); question(); });
      $('#pl').onclick = () => playVoicing(cur.v, false);
      $('#arp').onclick = () => playVoicing(cur.v, true);
      on('[data-t]', 'click', el => {
        if (answered) { playVoicing(Object.assign({}, quizVoicing(cur.pc, el.dataset.t)), false); return; }
        answered = true;
        const ok = el.dataset.t === cur.type;
        streak = ok ? streak + 1 : 0; bump('ear', ok);
        $$('[data-t]').forEach(b => { if (b.dataset.t === cur.type) b.classList.add('ok'); else if (b === el) b.classList.add('bad'); });
        $('.stage .big').textContent = chordLabel(cur.pc, cur.type);
        $('#after').innerHTML = `<div class="card row"><div style="width:110px">${diagram(cur.v, 'iv', cur.pc)}</div><div class="grow small">${ok ? '✅ Верно!' : '❌ Это ' + esc(M.TYPE[cur.type].name.toLowerCase()) + '.'}<br><span class="muted">${esc(M.TYPE[cur.type].d)}</span><br><span class="muted">Нажимайте на варианты, чтобы сравнить звучание.</span></div></div>
          <button class="btn wide big" id="nx">Следующий →</button>`;
        $('#nx').onclick = question;
      });
    }
    question();
  }

  function viewDiagramQuiz() {
    const ui = store.ui; ui.dqSet = ui.dqSet || 'seventh';
    let cur = null, answered = false;
    function question() {
      const set = SETS[ui.dqSet];
      const type = pick(set.types), pc = Math.floor(Math.random() * 12);
      const v = quizVoicing(pc, type);
      const others = shuffle(set.types.filter(t => t !== type)).slice(0, 2).map(t => [pc, t]);
      let opts = [[pc, type]].concat(others);
      let opc; do { opc = Math.floor(Math.random() * 12); } while (opc === pc);
      opts.push([opc, type]);
      cur = { pc, type, v, opts: shuffle(opts) }; answered = false;
      render();
    }
    function render() {
      app.innerHTML = `
        ${top('Аккорд по диаграмме', '#/practice')}
        <div class="chips">${Object.entries(SETS).map(([k, s]) => `<button class="chip sm${k === ui.dqSet ? ' on' : ''}" data-set="${k}">${s.name}</button>`).join('')}</div>
        <p class="small muted" style="margin:4px 0">Что это за аккорд? Оранжевая точка — корень.</p>
        <div class="row"><div class="grow"></div><div style="width:170px" id="dg">${diagram(cur.v, 'none', cur.pc)}</div><div class="grow"></div></div>
        <div class="opts">${cur.opts.map(([p, t], k) => `<button class="opt" data-o="${k}">${esc(chordLabel(p, t))}</button>`).join('')}</div>
        <div id="after"></div>
        <p class="small muted" style="text-align:center">${quizStats('dq')}</p>`;
      bindBack();
      on('[data-set]', 'click', el => { ui.dqSet = el.dataset.set; save(); question(); });
      on('[data-o]', 'click', el => {
        if (answered) return;
        answered = true;
        const [p, t] = cur.opts[+el.dataset.o], ok = p === cur.pc && t === cur.type;
        bump('dq', ok);
        $$('[data-o]').forEach(b => { const [bp, bt] = cur.opts[+b.dataset.o]; if (bp === cur.pc && bt === cur.type) b.classList.add('ok'); else if (b === el) b.classList.add('bad'); });
        $('#dg').innerHTML = diagram(cur.v, 'iv', cur.pc);
        playVoicing(cur.v, false);
        $('#after').innerHTML = `<p class="small">${ok ? '✅ Верно!' : '❌ Это ' + esc(chordLabel(cur.pc, cur.type)) + '.'} Ступени: ${cur.v.ivs.filter(Boolean).map(P).join(' ')}.</p><button class="btn wide big" id="nx">Следующий →</button>`;
        $('#nx').onclick = question;
      });
    }
    question();
  }

  function viewFormulaQuiz() {
    let cur = null, answered = false;
    const fmt = t => M.TYPE[t].f.map(P).join(' ');
    function question() {
      const t = pick(M.TYPES), pc = Math.floor(Math.random() * 12), rn = M.rootByPc(pc).n;
      const kind = pick(['formula', 'name', 'notes']);
      const sameCat = M.TYPES.filter(x => x.id !== t.id && x.f.length === t.f.length);
      const pool = shuffle(sameCat.length >= 3 ? sameCat : M.TYPES.filter(x => x.id !== t.id)).slice(0, 3).concat([t]);
      let q, opts;
      if (kind === 'formula') { q = `Ступени аккорда <b>${esc(P(rn + t.sym))}</b>?`; opts = pool.map(x => ({ ok: x === t, txt: fmt(x.id) })); }
      else if (kind === 'name') { q = `Какой аккорд имеет формулу <b>${esc(fmt(t.id))}</b>?`; opts = pool.map(x => ({ ok: x === t, txt: P('C' + x.sym) + ' — ' + x.name })); }
      else { q = `Звуки аккорда <b>${esc(P(rn + t.sym))}</b>?`; opts = pool.map(x => ({ ok: x === t, txt: M.chordNotes(pc, x.id).map(P).join(' ') })); }
      cur = { t, pc, q, opts: shuffle(opts) }; answered = false;
      render();
    }
    function render() {
      app.innerHTML = `
        ${top('Формулы и ноты', '#/practice')}
        <div class="stage"><div class="big" style="font-size:1.25rem;font-weight:600">${cur.q}</div></div>
        <div>${cur.opts.map((o, k) => `<button class="opt" style="width:100%;margin:6px 0;text-align:left" data-o="${k}">${esc(o.txt)}</button>`).join('')}</div>
        <div id="after"></div>
        <p class="small muted" style="text-align:center">${quizStats('fq')}</p>`;
      bindBack();
      on('[data-o]', 'click', el => {
        if (answered) return;
        answered = true;
        const ok = cur.opts[+el.dataset.o].ok;
        bump('fq', ok);
        $$('[data-o]').forEach(b => { if (cur.opts[+b.dataset.o].ok) b.classList.add('ok'); else if (b === el) b.classList.add('bad'); });
        const rn = M.rootByPc(cur.pc).n;
        $('#after').innerHTML = `<div class="card small"><b>${esc(P(rn + cur.t.sym))}</b> — ${esc(cur.t.name)}<div class="formula">${cur.t.f.map(iv => `<span>${P(iv)}<em>${P(M.spell(rn, iv))}</em></span>`).join('')}</div><span class="muted">${esc(cur.t.d)}</span></div><button class="btn wide big" id="nx">Следующий →</button>`;
        playVoicing(M.compVoicing(cur.pc, cur.t.id, 6), false);
        $('#nx').onclick = question;
      });
    }
    question();
  }

  // ===================== ТЕОРИЯ =====================
  function viewTheory() {
    const groups = [...new Set(T.map(a => a.group))];
    app.innerHTML = `<h1>Теория</h1><p class="muted small" style="margin:0">Справочник: аккорды, гармония, лады и приёмы импровизации.</p>` +
      groups.map(g => `<h2>${esc(g)}</h2>` + T.filter(a => a.group === g).map(a => `<a class="menu" href="#/t/${a.id}"><b>${esc(a.title)}</b></a>`).join('')).join('');
  }
  function viewArticle(id) {
    const a = T.find(x => x.id === id);
    if (!a) { location.hash = '#/theory'; return; }
    const i = T.indexOf(a), nx = T[i + 1];
    app.innerHTML = `${top(esc(a.title), '#/theory')}<div class="article">${a.html}</div>` +
      (nx ? `<a class="menu" href="#/t/${nx.id}"><small>Дальше</small><b>${esc(nx.title)} →</b></a>` : '');
    bindBack();
    $$('[data-w]').forEach(el => (WIDGETS[el.dataset.w] || (() => {}))(el));
  }

  const WIDGETS = {
    intervals(el) {
      const rows = [['1', 0], ['b2', 1], ['2', 2], ['b3', 3], ['3', 4], ['4', 5], ['b5', 6], ['5', 7], ['#5', 8], ['6', 9], ['b7', 10], ['7', 11]];
      el.innerHTML = `<table class="t"><tr><th>Ступень</th><th>Полутонов</th><th>Интервал</th><th>от C</th></tr>${rows.map(([iv, s]) =>
        `<tr class="click" data-s="${s}"><td><b>${P(iv)}</b></td><td>${s}</td><td>${esc(M.IV_NAMES[iv])}</td><td>${P(M.spell('C', iv))} ▶</td></tr>`).join('')}</table>`;
      el.querySelectorAll('[data-s]').forEach(tr => tr.onclick = () => { audioOn(); Snd.prepare('chords').then(() => { const t = Snd.now() + 0.05; Snd.pluck(48, t, 1.2); Snd.pluck(48 + +tr.dataset.s, t + 0.6, 1.4); Snd.pluck(48, t + 1.4, 1.4, { vel: 0.5 }); Snd.pluck(48 + +tr.dataset.s, t + 1.4, 1.4, { vel: 0.5 }); }); });
    },
    chordtable(el) {
      el.innerHTML = M.CATS.filter(c => c.id !== 'shell').map(c => `<h3>${c.name}</h3><table class="t"><tr><th>Аккорд</th><th>Формула</th><th>Ноты</th></tr>${M.TYPES.filter(t => t.cat === c.id).map(t =>
        `<tr class="click" data-t="${t.id}"><td><b>${P('C' + t.sym)}</b><br><span class="small muted">${esc(t.name)}</span></td><td>${t.f.map(P).join(' ')}</td><td>${M.chordNotes(0, t.id).map(P).join(' ')}</td></tr>`).join('')}</table>`).join('');
      el.querySelectorAll('[data-t]').forEach(tr => tr.onclick = () => playVoicing(M.compVoicing(0, tr.dataset.t, 6), false));
    },
    diatonic(el) {
      let key = 0, mode = 'major';
      const draw = () => {
        const d = M.DIATONIC[mode];
        el.innerHTML = keyChips(key) + `<div class="chips wrap" style="margin-top:6px">${Object.entries(M.DIATONIC).map(([k, x]) => `<button class="chip sm${k === mode ? ' on' : ''}" data-md="${k}">${x.name}</button>`).join('')}</div>
          <table class="t"><tr><th>Ступень</th><th>Аккорд</th><th>Лад</th></tr>${d.steps.map(([s, t, r], k) => {
            const modes = { major: ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'], minor: ['aeolian', 'locrian', 'ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian'], harm: ['harmmin', 'locrian', 'ionian', 'dorian', 'phrdom', 'lydian', 'dim'] }[mode];
            return `<tr class="click" data-c="${(key + s) % 12}|${t}"><td><b>${r}</b></td><td>${esc(chordLabel((key + s) % 12, t))} ▶</td><td class="small">${esc(M.SCALES[modes[k]].name)}</td></tr>`;
          }).join('')}</table>`;
        el.querySelectorAll('[data-key]').forEach(b => b.onclick = () => { key = +b.dataset.key; draw(); });
        el.querySelectorAll('[data-md]').forEach(b => b.onclick = () => { mode = b.dataset.md; draw(); });
        el.querySelectorAll('[data-c]').forEach(tr => tr.onclick = () => { const [p, t] = tr.dataset.c.split('|'); playVoicing(M.compVoicing(+p, t, 6), false); });
      };
      draw();
    },
    scales(el) {
      let key = 9, sc = 'minpent', mode = 'iv';
      const draw = () => {
        const S = M.SCALES[sc];
        const dots = M.scaleFrets(key, sc, 0, 15).map(d => ({ s: d.s, f: d.f, root: d.iv === '1', label: mode === 'iv' ? P(d.iv) : P(M.spell(M.rootByPc(key).n, d.iv)) }));
        const fits = M.TYPES.filter(t => t.sc.includes(sc)).map(t => P('C' + t.sym).replace(/^C/, '')).map(x => x || 'maj');
        el.innerHTML = keyChips(key) + `<select style="margin-top:8px" id="scsel">${Object.entries(M.SCALES).map(([k, s]) => `<option value="${k}" ${k === sc ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          <div class="formula">${S.f.map(iv => `<span>${P(iv)}<em>${P(M.spell(M.rootByPc(key).n, iv))}</em></span>`).join('')}</div>
          <p class="small" style="margin:4px 0">${esc(S.d)}${fits.length ? ` <span class="muted">Аккорды: ${fits.join(', ')}.</span>` : ''}</p>
          <div class="row"><button class="btn alt" id="scp">▶ Сыграть</button><div class="chips wrap">${[['iv', 'Ступени'], ['note', 'Ноты']].map(([k, n]) => `<button class="chip sm${mode === k ? ' on' : ''}" data-sm="${k}">${n}</button>`).join('')}</div></div>
          <div class="fbwrap">${fretboard(dots, 0, 15, { fw: 30 })}</div>`;
        el.querySelectorAll('[data-key]').forEach(b => b.onclick = () => { key = +b.dataset.key; draw(); });
        el.querySelectorAll('[data-sm]').forEach(b => b.onclick = () => { mode = b.dataset.sm; draw(); });
        el.querySelector('#scsel').onchange = e => { sc = e.target.value; draw(); };
        el.querySelector('#scp').onclick = () => {
          audioOn(); Snd.stopAll();
          Snd.prepare('chords').then(() => playScale());
        };
        const playScale = () => {
          const r = 45 + ((key - 9 + 12) % 12) + (key < 4 ? 12 : 0);
          const steps = S.f.map(iv => M.IV[iv][0]).sort((a, b) => a - b).concat([12]);
          const seq = steps.concat(steps.slice(0, -1).reverse());
          const t = Snd.now() + 0.05;
          seq.forEach((s, i) => Snd.pluck(r + s, t + i * 0.24, 0.3, { vel: 0.75 }));
        };
      };
      draw();
    },
    pent(el) {
      let key = 9, kind = 'minpent';
      const draw = () => {
        const set = M.SCALES[kind].f.map(iv => M.IV[iv][0]);
        const r6 = (key - 4 + 12) % 12;
        const startPitch = 40 + r6;
        const boxes = [];
        for (let k = 0; k < 5; k++) {
          // 12 соседних звуков пентатоники, по два на струну, начиная с k-го звука от тоники на 6-й струне
          const seq = [];
          let p = startPitch;
          while (seq.length < 12 + k) { const semi = ((p - 40 - r6) % 12 + 12) % 12; if (set.includes(semi)) seq.push(p); p++; }
          const notes = seq.slice(k, k + 12);
          let dots = notes.map((m, i) => { const s = 6 - Math.floor(i / 2); return { s, f: m - M.TUNING[6 - s], midi: m }; });
          if (dots.some(d => d.f < 0)) dots = dots.map(d => Object.assign(d, { f: d.f + 12 }));
          if (Math.max(...dots.map(d => d.f)) > 17) dots = dots.map(d => Object.assign(d, { f: d.f - 12 }));
          dots = dots.map(d => { const semi = ((d.midi - key) % 12 + 12) % 12; return { s: d.s, f: d.f, root: semi === 0, label: P(SCALE_IV[semi]) }; });
          boxes.push(dots);
        }
        el.innerHTML = keyChips(key) + `<div class="chips wrap" style="margin-top:6px">${[['minpent', 'Минорная'], ['majpent', 'Мажорная']].map(([k, n]) => `<button class="chip sm${k === kind ? ' on' : ''}" data-pk="${k}">${n}</button>`).join('')}</div>` +
          boxes.map((d, k) => { const fr = d.map(x => x.f); const from = Math.max(0, Math.min(...fr) - 1), to = Math.max(...fr) + 1; return `<h3>Позиция ${k + 1}</h3><div class="fbwrap">${fretboard(d, from === 1 ? 0 : from, Math.max(to, from + 5), { fit: true })}</div>`; }).join('');
        el.querySelectorAll('[data-key]').forEach(b => b.onclick = () => { key = +b.dataset.key; draw(); });
        el.querySelectorAll('[data-pk]').forEach(b => b.onclick = () => { kind = b.dataset.pk; draw(); });
      };
      draw();
    }
  };

  // ===================== МАРШРУТИЗАЦИЯ =====================
  const TAB = { practice: 'practice', metro: 'practice', tuner: 'practice', repeat: 'practice', backing: 'practice', ear: 'practice', dq: 'practice', fq: 'practice', chords: 'chords', licks: 'licks', lick: 'licks', theory: 'theory', t: 'theory' };
  function route() {
    leave();
    const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'practice').split('/');
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === (TAB[name] || 'practice')));
    window.scrollTo(0, 0);
    ({
      practice: viewPractice, metro: viewMetro, tuner: viewTuner, chords: viewChords, licks: viewLicks, lick: () => viewLick(arg), repeat: () => viewRepeat(arg),
      backing: viewBacking, ear: viewEar, dq: viewDiagramQuiz, fq: viewFormulaQuiz, theory: viewTheory, t: () => viewArticle(arg)
    }[name] || viewPractice)();
  }
  window.addEventListener('hashchange', route);
  route();
})();

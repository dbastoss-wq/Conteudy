(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const DB_KEY = 'teleconsulta.db.v1';
  const MAX_SEC = 30 * 60;

  /* ---------------- texto ---------------- */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (s) => esc(s)
    .replace(/\[\[tel:([^|\]]+)\|([^\]]+)\]\]/g, '<a href="tel:$1">$2</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const plain = (s) => String(s).replace(/\[\[tel:[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/\*\*/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
  const dateBR = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /* ---------------- estado ---------------- */
  let db = { current: null, items: {} };
  let cur;

  function blankConsulta() {
    const id = 'c' + Date.now().toString(36);
    return { id, created: Date.now(), f: {}, c: {}, elapsed: 0, tab: 0 };
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(DB_KEY));
      if (raw && raw.items) db = raw;
    } catch (e) { /* storage indisponível ou corrompido */ }
    if (!db.current || !db.items[db.current]) {
      const c = blankConsulta();
      db.items[c.id] = c;
      db.current = c.id;
    }
    cur = db.items[db.current];
  }
  let saveTimer;
  function save(now) {
    $('#saved').classList.add('pending');
    clearTimeout(saveTimer);
    const run = () => {
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); $('#saved').textContent = 'salvo'; }
      catch (e) { $('#saved').textContent = 'não salvou!'; }
      $('#saved').classList.remove('pending');
    };
    if (now) run(); else saveTimer = setTimeout(run, 250);
  }
  const val = (id) => (cur.f[id] || '').toString().trim();

  /* ---------------- construção da tela ---------------- */
  function fieldHTML(row) {
    const [id, , kind = 'text', opts] = row;
    if (kind === 'sr') {
      return `<div class="sr" data-f="${id}" data-kind="sr">` +
        ['S', 'N', 'Recusou'].map((v) => `<button type="button" data-v="${v}">${v}</button>`).join('') + '</div>';
    }
    if (kind === 'select') {
      return `<select data-f="${id}"><option value="">—</option>` +
        opts.map((o) => `<option>${esc(o)}</option>`).join('') + '</select>';
    }
    if (kind === 'number') return `<input type="number" inputmode="numeric" min="0" max="6" data-f="${id}">`;
    return `<textarea rows="1" data-f="${id}" aria-label="${esc(plain(row[1]))}"></textarea>`;
  }

  function renderBlock(b) {
    switch (b.t) {
      case 'h3': return `<h3>${esc(b.text)}</h3>`;
      case 'p': return `<p>${fmt(b.text)}</p>`;
      case 'say': return `<div class="say">${fmt(b.text)}</div>`;
      case 'check':
        return '<ul class="checks">' + b.items.map(([id, t]) =>
          `<li><label><input type="checkbox" data-c="${id}"><span>${fmt(t)}</span></label></li>`).join('') + '</ul>';
      case 'kv':
        return `<table class="tbl stack"><thead><tr><th>${b.head[0]}</th><th>${b.head[1]}</th></tr></thead><tbody>` +
          b.rows.map(([k, v, id]) => {
            let cell;
            if (v === null) cell = `<textarea rows="1" data-f="${id}" aria-label="${esc(plain(k))}"></textarea>`;
            else if (typeof v === 'object') {
              cell = `${fmt(v.t)}<div class="inline-edit"><textarea rows="1" data-f="${v.e}" aria-label="${esc(plain(k))}"></textarea></div>`;
            } else cell = fmt(v);
            return `<tr><td class="k" data-h="${b.head[0]}">${fmt(k)}</td><td data-h="${b.head[1]}">${cell}</td></tr>`;
          }).join('') + '</tbody></table>';
      case 'table':
        return `<table class="tbl stack"${b.ranges ? ' data-map' : ''}><thead><tr>${b.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
          b.rows.map((r, i) => `<tr${b.ranges ? ` data-r="${b.ranges[i].join(',')}"` : ''}>` +
            r.map((c, j) => `<td${j === 0 ? ' class="k"' : ''} data-h="${b.head[j]}">${fmt(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>';
      case 'fields':
        return `<table class="tbl stack"><thead><tr><th>${b.head[0]}</th><th>${b.head[1]}</th></tr></thead><tbody>` +
          b.rows.map((r) =>
            `<tr><td class="k" data-h="${b.head[0]}">${fmt(r[1])}</td><td data-h="${b.head[1]}">${fieldHTML(r)}</td></tr>`).join('') +
          '</tbody></table>';
      case 'asqbadge': return '<div id="asqBadge"></div>';
      case 'actions':
        return '<div class="actions row">' + b.buttons.map(([act, label]) =>
          `<button type="button" class="btn" data-act="${act}">${label}</button>`).join('') + '</div>';
      case 'draft':
        return `<div class="draft"><label for="${b.id}">${fmt(b.label)}</label>` +
          `<textarea id="${b.id}" rows="6" data-f="${b.id}" data-nocount data-default="${esc(b.text)}"></textarea>` +
          `<div class="row"><button type="button" class="btn sm" data-act="copy" data-src="${b.id}">Copiar</button>` +
          `<button type="button" class="btn sm ghost" data-act="share" data-src="${b.id}">Compartilhar</button>` +
          `<button type="button" class="btn sm ghost" data-act="print" data-src="${b.id}">Imprimir / PDF</button></div></div>`;
      default: return '';
    }
  }

  function build() {
    $('#pNome').textContent = META.nome;
    $('#pIdade').textContent = META.idade;
    $('#pAlergia').textContent = 'ALERGIA: ' + META.alergia;
    $('#main').innerHTML = SECTIONS.map((s, i) =>
      `<section class="sec" id="${s.id}" data-i="${i}"><h1>${esc(s.title)}</h1>${s.blocks.map(renderBlock).join('')}</section>`).join('');
    $('#nav').innerHTML = SECTIONS.map((s, i) =>
      `<button type="button" data-i="${i}"><span class="num">${s.num}</span><span>${esc(s.nav)}</span><span class="cnt"></span></button>`).join('');
  }

  /* ---------------- sincronização estado -> tela ---------------- */
  function grow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 4 + 'px'; }

  function refresh() {
    $$('[data-f]').forEach((el) => {
      const id = el.dataset.f;
      let v = cur.f[id];
      if (el.dataset.kind === 'sr') {
        $$('button', el).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
        return;
      }
      if (v === undefined && el.dataset.default) v = el.dataset.default;
      el.value = v || '';
      el.classList.toggle('filled', !!(cur.f[id] || '').toString().trim());
      if (el.tagName === 'TEXTAREA') grow(el);
    });
    $$('[data-c]').forEach((el) => { el.checked = !!cur.c[el.dataset.c]; });
    derived();
  }

  function derived() {
    // progresso por seção
    $$('#nav button').forEach((btn) => {
      const sec = $('#' + SECTIONS[btn.dataset.i].id);
      const fields = $$('[data-f]:not([data-nocount])', sec);
      const checks = $$('[data-c]', sec);
      const done = fields.filter((el) => (cur.f[el.dataset.f] || '').toString().trim()).length + checks.filter((el) => cur.c[el.dataset.c]).length;
      btn.querySelector('.cnt').textContent = `${done}/${fields.length + checks.length}`;
    });

    // ASQ
    const asq = ['asq1', 'asq2', 'asq3', 'asq4', 'asq5'].map((k) => cur.f[k]);
    const answered = asq.filter(Boolean).length;
    const pos = asq.some((v) => v === 'S' || v === 'Recusou');
    const box = $('#asqBadge');
    if (box) {
      let h;
      if (!answered) h = '<span class="badge wait">ASQ: aguardando respostas</span>';
      else if (pos) h = '<span class="badge pos">ASQ POSITIVO</span>';
      else h = `<span class="badge neg">ASQ negativo (${answered}/5 respondidas)</span>`;
      const cs = ['cs1', 'cs2', 'cs3', 'cs4'].filter((k) => cur.f[k] === 'S' || cur.f[k] === 'Recusou').length;
      if (cs) h += `<span class="badge pos">C-SSRS: ${cs} item(ns) positivo(s)</span>`;
      const n = cur.f.crafft;
      if (n !== undefined && n !== '') h += Number(n) >= 2 ? '<span class="badge pos">CRAFFT POSITIVO</span>' : '<span class="badge neg">CRAFFT negativo</span>';
      box.innerHTML = h;
    }
    $('#alertAsq').hidden = cur.f.asq5 !== 'S';
    document.body.style.setProperty('--top-h', $('#top').offsetHeight + 'px');
  }

  /* ---------------- navegação ---------------- */
  function show(i, scroll = true) {
    i = Math.max(0, Math.min(SECTIONS.length - 1, i));
    cur.tab = i;
    $$('section.sec').forEach((s) => s.classList.toggle('on', +s.dataset.i === i));
    $$('#nav button').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
    if (scroll) window.scrollTo({ top: 0 });
    $$('section.sec.on textarea').forEach(grow);
    save();
  }

  /* ---------------- cronômetro ---------------- */
  let running = false, started = 0, base = 0, tick, wake;
  const elapsed = () => Math.floor(running ? base + (Date.now() - started) / 1000 : base);

  function renderTimer() {
    const s = elapsed();
    $('#tTime').textContent = clock(s);
    $('.timer').classList.toggle('over', s > MAX_SEC);
    $('#tToggle').textContent = running ? 'Pausar' : (s > 0 ? 'Continuar' : 'Iniciar');
    const min = s / 60;
    const idx = STAGES.findIndex(([a, b]) => min >= a && min < b);
    const label = !running && s === 0 ? 'Cronômetro parado'
      : idx >= 0 ? `Agora (${STAGES[idx][0]}–${STAGES[idx][1]} min): ` : 'Tempo esgotado: registrar, SINAN em até 24 h, ';
    $('#tStage').innerHTML = !running && s === 0 ? label : `<b>${esc(label)}${idx >= 0 ? esc(STAGES[idx][2]) : 'Conselho Tutelar'}</b>`;
    $$('[data-map] tr[data-r]').forEach((tr) => {
      const [a, b] = tr.dataset.r.split(',').map(Number);
      tr.classList.toggle('now', (running || s > 0) && min >= a && min < b);
    });
  }
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* sem suporte */ }
  }
  function startTimer() {
    if (running) return;
    running = true; started = Date.now();
    tick = setInterval(() => { renderTimer(); cur.elapsed = elapsed(); if (elapsed() % 5 === 0) save(); }, 1000);
    keepAwake(); renderTimer();
  }
  function pauseTimer() {
    if (!running) return;
    base = elapsed(); running = false; clearInterval(tick);
    cur.elapsed = base; save(true); renderTimer();
  }
  function resetTimer() {
    if (elapsed() > 0 && !confirm('Zerar o cronômetro?')) return;
    running = false; clearInterval(tick); base = 0; cur.elapsed = 0; save(true); renderTimer();
  }

  /* ---------------- modal ---------------- */
  function openModal(title, html) {
    $('#mTitle').textContent = title;
    $('#mBody').innerHTML = html;
    $('#modal').hidden = false;
    $('#mClose').focus();
  }
  function closeModal() { $('#modal').hidden = true; $('#mBody').innerHTML = ''; }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 1800);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado'); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copiado'); } catch (e2) { toast('Não foi possível copiar'); }
      ta.remove();
    }
  }
  async function shareText(text, title) {
    if (navigator.share) { try { await navigator.share({ title, text }); } catch (e) { /* cancelado */ } }
    else copyText(text);
  }
  function printText(text) {
    $('#printArea').textContent = text;
    window.print();
  }

  function textOfDraft(id) {
    const el = $('#' + id);
    return el ? el.value : '';
  }

  /* ---------------- SOS ---------------- */
  function openSOS() {
    const tel = val('resp_tel'), end = val('endereco'), resp = val('resp');
    let h = `<a class="call" href="tel:192"><span>SAMU 192<small>Informe o endereço onde ele está agora</small></span><span>Ligar</span></a>`;
    h += `<a class="call soft" href="tel:188"><span>CVV 188<small>Apoio emocional 24 h</small></span><span>Ligar</span></a>`;
    h += `<p><strong>Endereço confirmado:</strong><br>${end ? esc(end) : '<em>(ainda não preenchido na seção 1)</em>'}</p>`;
    if (tel) h += `<a class="call soft" href="tel:${esc(tel.replace(/[^\d+]/g, ''))}"><span>Responsável${resp ? ': ' + esc(resp) : ''}<small>${esc(tel)}</small></span><span>Ligar</span></a>`;
    else h += '<p><strong>Responsável:</strong> <em>(telefone não preenchido)</em></p>';
    h += `<a class="call soft" href="tel:${esc(META.psicTel)}"><span>${esc(META.psicNome)}<small>${esc(META.psicTelLabel)}</small></span><span>Ligar</span></a>`;
    [['ct_ps', 'PS / UPA'], ['ct_caps', 'CAPS IJ'], ['ct_uvis', 'UVIS'], ['ct_ct', 'Conselho Tutelar']].forEach(([k, n]) => {
      if (val(k)) h += `<p><strong>${n}:</strong> ${esc(val(k))}</p>`;
    });
    h += '<p><strong>Iminente:</strong> não encerrar a chamada, responsável junto, ficar na linha.</p>';
    openModal('Emergência', h);
  }

  /* ---------------- saídas ---------------- */
  function buildProntuario() {
    const L = [];
    L.push(`TELECONSULTA — ${META.nome}, ${META.idade}`);
    L.push(`Data: ${META.data} · Alergia: ${META.alergia}${val('alergia_reacao') ? ' (' + val('alergia_reacao') + ')' : ''}`);
    L.push('');
    SECTIONS.forEach((s) => {
      const out = [];
      let sub = '';
      s.blocks.forEach((b) => {
        const lines = [];
        if (b.t === 'h3') { sub = b.text; return; }
        if (b.t === 'check') {
          b.items.forEach(([id, t]) => { if (cur.c[id]) lines.push(`[x] ${plain(t)}`); });
        } else if (b.t === 'fields') {
          b.rows.forEach((r) => { const v = val(r[0]); if (v) lines.push(`${plain(r[1])}: ${v}`); });
        } else if (b.t === 'kv') {
          b.rows.forEach(([k, v, id]) => {
            const fid = id || (v && v.e);
            if (fid && val(fid)) lines.push(`${plain(k)}: ${val(fid)}`);
          });
        }
        if (lines.length) {
          if (sub) { out.push('', sub.toUpperCase()); sub = ''; }
          out.push(...lines);
        }
      });
      if (s.id === 's2') {
        const asq = ['asq1', 'asq2', 'asq3', 'asq4', 'asq5'].map((k) => cur.f[k]);
        if (asq.some(Boolean)) out.unshift(`ASQ: ${asq.some((v) => v === 'S' || v === 'Recusou') ? 'POSITIVO' : 'negativo'} (${asq.map((v) => v || '-').join('/')})`);
      }
      if (out.length) { L.push(s.title.toUpperCase()); L.push(...out.filter((x, i) => !(i === 0 && x === ''))); L.push(''); }
    });
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function buildPlano() {
    const plan = SECTIONS.find((s) => s.id === 's3').blocks.find((b) => b.t === 'fields' && b.rows[0][0] === 'ps1');
    const L = [`PLANO DE SEGURANÇA — ${META.nome.split(' ')[0]}`, `Feito com o Dr. Daniel em ${META.data}`, ''];
    plan.rows.forEach((r) => { L.push(plain(r[1]).replace(/:.*$/, r[0] === 'ps5' ? '' : '$&')); L.push(val(r[0]) || '______________________'); L.push(''); });
    L.push('Se a dor ficar grande demais e você não conseguir se manter seguro:');
    L.push('SAMU 192 · CVV 188 (24 h) · CAPS IJ recebe em crise sem encaminhamento');
    L.push(`${META.psicNome}: ${META.psicTelCurto}`);
    return L.join('\n');
  }

  function showOutput(title, text) {
    openModal(title, `<textarea id="outText" spellcheck="false"></textarea>
      <div class="row"><button class="btn" data-m="copy">Copiar</button><button class="btn ghost" data-m="share">Compartilhar</button><button class="btn ghost" data-m="print">Imprimir / PDF</button></div>`);
    $('#outText').value = text;
    $('#modal').dataset.title = title;
  }

  /* ---------------- consultas ---------------- */
  function openList() {
    const items = Object.values(db.items).sort((a, b) => b.created - a.created);
    let h = '<div class="row"><button class="btn" data-m="new">Nova consulta</button><button class="btn ghost" data-m="export">Exportar backup</button><button class="btn ghost" data-m="import">Importar backup</button></div>';
    h += items.map((c) => {
      const nfilled = Object.values(c.f).filter((v) => (v || '').toString().trim()).length + Object.values(c.c).filter(Boolean).length;
      return `<div class="list-item${c.id === db.current ? ' cur' : ''}"><div><strong>${dateBR(c.created)}</strong><small>${nfilled} itens preenchidos · ${clock(c.elapsed || 0)}</small></div>
        <div>${c.id === db.current ? '' : `<button class="btn sm" data-m="open" data-id="${c.id}">Abrir</button> `}<button class="btn sm danger" data-m="del" data-id="${c.id}">Apagar</button></div></div>`;
    }).join('');
    h += '<p style="color:var(--muted);font-size:14px">Os dados ficam só neste aparelho. Use "Exportar backup" para guardar uma cópia.</p><input type="file" id="importFile" accept=".json,application/json" hidden>';
    openModal('Consultas', h);
  }

  function switchTo(id) {
    pauseTimer();
    db.current = id; cur = db.items[id];
    base = cur.elapsed || 0;
    refresh(); renderTimer(); show(cur.tab || 0, false); save(true);
  }

  /* ---------------- eventos ---------------- */
  function bind() {
    const main = $('#main');

    main.addEventListener('input', (e) => {
      const el = e.target.closest('[data-f]');
      if (el) {
        cur.f[el.dataset.f] = el.value;
        el.classList.toggle('filled', !!el.value.trim());
        if (el.tagName === 'TEXTAREA') grow(el);
        derived(); save();
        return;
      }
      const ck = e.target.closest('[data-c]');
      if (ck) { cur.c[ck.dataset.c] = ck.checked; if (navigator.vibrate) navigator.vibrate(8); derived(); save(); }
    });

    main.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.closest('.sr')) {
        const g = b.closest('.sr'), id = g.dataset.f;
        cur.f[id] = cur.f[id] === b.dataset.v ? '' : b.dataset.v;
        $$('button', g).forEach((x) => x.classList.toggle('on', x.dataset.v === cur.f[id]));
        if (navigator.vibrate) navigator.vibrate(8);
        derived(); save();
        return;
      }
      const act = b.dataset.act;
      if (!act) return;
      if (act === 'prontuario') showOutput('Prontuário', buildProntuario());
      else if (act === 'plano') showOutput('Plano de segurança', buildPlano());
      else {
        const t = textOfDraft(b.dataset.src);
        if (act === 'copy') copyText(t);
        else if (act === 'share') shareText(t, 'Teleconsulta');
        else if (act === 'print') printText(t);
      }
    });

    $('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) show(+b.dataset.i);
    });

    $('#tToggle').addEventListener('click', () => (running ? pauseTimer() : startTimer()));
    $('#tReset').addEventListener('click', resetTimer);
    $('#sos').addEventListener('click', openSOS);
    $('#btnList').addEventListener('click', openList);
    $('#mClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

    $('#modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      const title = $('#modal').dataset.title || 'Teleconsulta';
      if (m === 'copy') copyText($('#outText').value);
      else if (m === 'share') shareText($('#outText').value, title);
      else if (m === 'print') printText($('#outText').value);
      else if (m === 'new') {
        if (!confirm('Começar uma nova consulta em branco? A atual continua guardada na lista.')) return;
        pauseTimer();
        const c = blankConsulta(); db.items[c.id] = c; switchTo(c.id); closeModal(); show(0);
      } else if (m === 'open') { switchTo(b.dataset.id); closeModal(); }
      else if (m === 'del') {
        if (!confirm('Apagar esta consulta definitivamente?')) return;
        delete db.items[b.dataset.id];
        if (b.dataset.id === db.current) {
          const rest = Object.keys(db.items);
          if (rest.length) switchTo(rest[0]);
          else { const c = blankConsulta(); db.items[c.id] = c; switchTo(c.id); }
        }
        save(true); openList();
      } else if (m === 'export') {
        const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `teleconsulta-backup-${Date.now()}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } else if (m === 'import') $('#importFile').click();
    });
    $('#modal').addEventListener('change', (e) => {
      if (e.target.id !== 'importFile' || !e.target.files[0]) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const inc = JSON.parse(r.result);
          if (!inc.items) throw new Error('formato');
          Object.assign(db.items, inc.items);
          save(true); openList(); toast('Backup importado');
        } catch (err) { toast('Arquivo de backup inválido'); }
      };
      r.readAsText(e.target.files[0]);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { if (running) keepAwake(); renderTimer(); }
      else save(true);
    });
    window.addEventListener('pagehide', () => { cur.elapsed = elapsed(); save(true); });
    window.addEventListener('resize', () => document.body.style.setProperty('--top-h', $('#top').offsetHeight + 'px'));
  }

  /* ---------------- início ---------------- */
  load();
  build();
  bind();
  base = cur.elapsed || 0;
  refresh();
  show(cur.tab || 0, false);
  renderTimer();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();

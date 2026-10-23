'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const pill = $('#pill');
const panel = $('#panel');
let state = { usage: null, error: null };
let isExpanded = false;

// ---------- opmaak ----------

function level(pct) {
  if (pct >= 80) return 'lvl-crit';
  if (pct >= 50) return 'lvl-warn';
  return 'lvl-ok';
}

function setLevel(el, pct) {
  el.classList.remove('lvl-ok', 'lvl-warn', 'lvl-crit');
  if (pct != null) el.classList.add(level(pct));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const timeFmt = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const numFmt = new Intl.NumberFormat('nl-NL');

function formatReset(iso, short = false) {
  if (!iso) return 'Nog niet gestart';
  const at = new Date(iso);
  const ms = at - Date.now();
  if (ms <= 0) return 'Wordt nu gereset';
  const min = Math.round(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const rel = d ? `${d}d ${h}u` : h ? `${h}u ${m}m` : `${m}m`;
  const sameDay = at.toDateString() === new Date().toDateString();
  const when = sameDay ? timeFmt.format(at) : dayFmt.format(at);
  return short ? `↻ ${rel} · ${when}` : `Reset over ${rel} · ${when}`;
}

function formatAgo(iso) {
  if (!iso) return 'Nog niet bijgewerkt';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'Zojuist bijgewerkt';
  if (s < 3600) return `${Math.round(s / 60)} min geleden`;
  return `${Math.round(s / 3600)} uur geleden`;
}

function formatTokens(n) {
  const f = (v, d) => v.toLocaleString('nl-NL', { maximumFractionDigits: d });
  if (n >= 1e9) return `${f(n / 1e9, 1)} mld`;
  if (n >= 1e6) return `${f(n / 1e6, 1)} mln`;
  if (n >= 1e3) return `${f(n / 1e3, 0)}k`;
  return numFmt.format(n);
}

const pctText = (w) => (w ? `${Math.round(w.percent)}%` : '–');

function setRing(circle, w) {
  const c = 2 * Math.PI * Number(circle.getAttribute('r'));
  circle.style.strokeDasharray = `${c}`;
  // Een klein stukje laten zien bij 0%, zodat de ring als ring herkenbaar blijft.
  const pct = w ? Math.max(w.percent, 0.5) : 0;
  circle.style.strokeDashoffset = `${c * (1 - pct / 100)}`;
  setLevel(circle, w && w.percent);
}

// ---------- weergave limieten ----------

function render() {
  const u = state.usage || {};

  for (const ring of $$('.ring')) setRing(ring, u[ring.dataset.ring]);

  // pil
  for (const key of ['fiveHour', 'sevenDay']) {
    const b = $(`[data-pct="${key}"]`, pill);
    b.textContent = pctText(u[key]);
    setLevel(b, u[key] && u[key].percent);
  }
  $('.pill-alert', pill).hidden = !state.error;
  pill.title = `5 uur ${pctText(u.fiveHour)} · week ${pctText(u.sevenDay)}\nKlik voor details, sleep om te verplaatsen`;

  // hero
  $('#center-pct').textContent = pctText(u.fiveHour);
  for (const stat of $$('.stat')) {
    const w = u[stat.dataset.key];
    setLevel(stat, w && w.percent);
    $('.stat-value', stat).innerHTML = w ? `${Math.round(w.percent)}<small>%</small>` : '–';
    $('.stat-reset', stat).textContent = w ? formatReset(w.resetsAt, true) : 'Geen gegevens';
    $('.stat-reset', stat).title = w && w.resetsAt ? `Reset op ${dateFmt.format(new Date(w.resetsAt))}` : '';
  }

  // extra regels: per model, extra gebruik en alles wat Anthropic nieuw toevoegt
  const rows = [
    ['Week · Opus', u.sevenDayOpus],
    ['Week · Sonnet', u.sevenDaySonnet],
    ['Extra gebruik', u.extra],
    ...(u.other || []).map((o) => [o.label, o]),
  ].filter(([, w]) => w);
  $('#rows').replaceChildren(
    ...rows.map(([label, w]) => {
      const row = el('div', 'row');
      setLevel(row, w.percent);
      const bar = el('div', 'bar');
      const fill = el('div', 'fill');
      fill.style.width = `${w.percent}%`;
      bar.append(fill);
      row.title = w.resetsAt ? formatReset(w.resetsAt) : '';
      row.append(el('span', null, label), bar, el('b', null, pctText(w)));
      return row;
    })
  );

  const plan = $('.plan', panel);
  plan.hidden = !u.plan;
  plan.textContent = u.plan || '';

  const err = $('#error');
  err.hidden = !state.error;
  err.textContent = state.error ? state.error.message : '';

  const sub = $('#updated');
  sub.textContent = formatAgo(u.fetchedAt);
  sub.classList.toggle('failed', !!state.error);
  sub.classList.toggle('stale', !state.error && (!u.fetchedAt || Date.now() - new Date(u.fetchedAt) > 10 * 60e3));
}

// ---------- projecten ----------

let view = 'limits';
let period = 'week';
let projTimer = null;
const openProjects = new Set();

// "Deze week" loopt vanaf de laatste weekreset, net als je weeklimiet.
function periodStart() {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === '30') return now.getTime() - 30 * 86400e3;
  const reset = state.usage && state.usage.sevenDay && state.usage.sevenDay.resetsAt;
  if (reset) {
    let start = new Date(reset).getTime() - 7 * 86400e3;
    while (start > now.getTime()) start -= 7 * 86400e3;
    return start;
  }
  return now.getTime() - 7 * 86400e3;
}

function renderProjects(data) {
  const list = $('#proj-list');
  list.replaceChildren();
  $('#proj-total').textContent = formatTokens(data.total);
  $('#proj-count').textContent = data.projects.length === 1 ? '1 project' : `${data.projects.length} projecten`;
  $('#proj-since').textContent = `Sinds ${dateFmt.format(new Date(data.since))}`;
  if (!data.projects.length) {
    list.append(el('li', 'proj-empty', 'Geen Claude Code-sessies in deze periode.'));
    return;
  }
  const max = data.projects[0].tokens;
  for (const p of data.projects) {
    const li = el('li', 'proj');
    li.classList.toggle('open', openProjects.has(p.path));
    li.title = p.path;
    const top = el('div', 'proj-top');
    top.append(el('span', 'proj-name', p.name), el('span', 'proj-tokens', formatTokens(p.tokens)));
    const bar = el('div', 'bar');
    const fill = el('div', 'fill');
    fill.style.width = `${(p.tokens / max) * 100}%`;
    bar.append(fill);
    const share = data.total ? Math.round((p.tokens / data.total) * 100) : 0;
    const models = p.models.map((m) => `${m.name} ${Math.round((m.tokens / p.tokens) * 100)}%`).join(' · ');
    const meta = el('div', 'proj-meta', `${share}% · ${p.sessions} ${p.sessions === 1 ? 'sessie' : 'sessies'} · ${models}`);
    const detail = el('div', 'proj-detail');
    for (const [label, value] of [
      ['Invoer', p.input],
      ['Uitvoer', p.output],
      ['Cache geschreven', p.cacheWrite],
      ['Cache gelezen', p.cacheRead],
      ['Antwoorden', p.messages],
    ]) {
      detail.append(el('span', null, label), el('b', null, numFmt.format(value)));
    }
    detail.append(el('span', 'path', p.path));
    li.append(top, bar, meta, detail);
    li.addEventListener('click', () => {
      if (openProjects.has(p.path)) openProjects.delete(p.path);
      else openProjects.add(p.path);
      li.classList.toggle('open');
    });
    list.append(li);
  }
}

async function loadProjects() {
  clearTimeout(projTimer);
  try {
    renderProjects(await window.widget.projects(periodStart()));
  } catch {
    $('#proj-list').replaceChildren(el('li', 'proj-empty', 'Kon de sessielogboeken niet lezen.'));
  }
  if (view === 'projects') projTimer = setTimeout(loadProjects, 2 * 60 * 1000);
}

function setView(next) {
  view = next;
  panel.dataset.view = view;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === view);
  for (const v of $$('.view')) v.hidden = v.dataset.view !== view;
  if (view === 'projects') loadProjects();
  else clearTimeout(projTimer);
}

for (const t of $$('.tab')) t.addEventListener('click', () => setView(t.dataset.view));
for (const b of $$('.period')) {
  b.addEventListener('click', () => {
    period = b.dataset.period;
    for (const x of $$('.period')) x.classList.toggle('active', x === b);
    loadProjects();
  });
}

// ---------- in- en uitklappen ----------

const panelHeight = () => panel.offsetHeight + 16; // + body-padding

function expand() {
  if (isExpanded) return;
  isExpanded = true;
  pill.hidden = true;
  panel.hidden = false;
  window.widget.expand(panelHeight());
}

function collapse() {
  if (!isExpanded) return;
  isExpanded = false;
  panel.hidden = true;
  pill.hidden = false;
  window.widget.collapse();
}

new ResizeObserver(() => {
  if (isExpanded) window.widget.resize(panelHeight());
}).observe(panel);

// ---------- slepen vs. klikken ----------

function draggable(target, onClick) {
  let start = null;
  let dragging = false;
  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    start = { x: e.screenX, y: e.screenY };
    dragging = false;
    target.setPointerCapture(e.pointerId);
  });
  target.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!dragging && Math.hypot(e.screenX - start.x, e.screenY - start.y) > 4) {
      dragging = true;
      window.widget.dragStart();
    }
    if (dragging) window.widget.dragMove();
  });
  target.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    if (dragging) window.widget.dragEnd();
    else if (onClick) onClick();
  });
}

draggable(pill, expand);
draggable($('.panel-head'));

// ---------- knoppen ----------

const refreshBtn = $('#btn-refresh');
refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.add('spin');
  window.widget.refresh();
  if (view === 'projects') loadProjects();
  setTimeout(() => refreshBtn.classList.remove('spin'), 900);
});
$('#btn-collapse').addEventListener('click', collapse);
$('#btn-hide').addEventListener('click', () => {
  collapse();
  window.widget.hide();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') collapse();
});
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.widget.contextMenu();
});

// ---------- start ----------

window.widget.onUsage((payload) => {
  state = payload;
  render();
});

window.widget.getState().then((s) => {
  state = s;
  const keys = s.shortcut.replace('CommandOrControl', navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl');
  $('#shortcut').textContent = keys.replaceAll('+', ' ');
  $('#shortcut').title = 'Sneltoets om de widget te tonen of te verbergen';
  panel.dataset.view = view;
  render();
});

setInterval(render, 15000); // aftellers en "bijgewerkt"-tijd bijhouden

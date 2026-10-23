'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const RING = 97.4;

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

const timeFmt = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function formatReset(iso) {
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
  return `Reset over ${rel} · ${sameDay ? timeFmt.format(at) : dayFmt.format(at)}`;
}

function formatAgo(iso) {
  if (!iso) return 'Nog niet bijgewerkt';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 30) return 'Zojuist bijgewerkt';
  if (s < 3600) return `${Math.round(s / 60)} min geleden bijgewerkt`;
  return `${Math.round(s / 3600)} uur geleden bijgewerkt`;
}

const pctText = (w) => (w ? `${Math.round(w.percent)}%` : '–');

// ---------- weergave ----------

function render() {
  const u = state.usage || {};

  // pil
  const five = u.fiveHour;
  const gauge = $('.gauge', pill);
  setLevel(gauge, five && five.percent);
  $('.arc', gauge).style.strokeDashoffset = five ? RING * (1 - five.percent / 100) : RING;
  $('.gauge-value', gauge).textContent = five ? Math.round(five.percent) : '–';
  for (const key of ['fiveHour', 'sevenDay']) {
    setLevel($(`.dot[data-key="${key}"]`, pill), u[key] && u[key].percent);
    $(`[data-pct="${key}"]`, pill).textContent = pctText(u[key]);
  }
  $('.pill-alert', pill).hidden = !state.error;

  // kaarten
  for (const card of $$('.card', panel)) {
    const w = u[card.dataset.key];
    setLevel(card, w && w.percent);
    $('.card-pct', card).innerHTML = w ? `${Math.round(w.percent)}<small>%</small>` : '–';
    $('.fill', card).style.width = w ? `${w.percent}%` : '0';
    $('.card-reset', card).textContent = w ? formatReset(w.resetsAt) : 'Geen gegevens';
  }
  for (const row of $$('.mini', panel)) {
    const w = u[row.dataset.key];
    row.hidden = !w;
    if (!w) continue;
    setLevel(row, w.percent);
    $('.fill', row).style.width = `${w.percent}%`;
    $('b', row).textContent = pctText(w);
  }

  const plan = $('.plan', panel);
  plan.hidden = !u.plan;
  plan.textContent = u.plan || '';

  const err = $('#error');
  err.hidden = !state.error;
  err.textContent = state.error ? state.error.message : '';

  $('#updated').textContent = formatAgo(u.fetchedAt);
  pill.title = `5 uur ${pctText(u.fiveHour)} · week ${pctText(u.sevenDay)} — klik voor details, sleep om te verplaatsen`;
}

// ---------- in- en uitklappen ----------

const panelHeight = () => panel.offsetHeight + 12; // + body-padding

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

function draggable(el, onClick) {
  let start = null;
  let dragging = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    start = { x: e.screenX, y: e.screenY };
    dragging = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!dragging && Math.hypot(e.screenX - start.x, e.screenY - start.y) > 4) {
      dragging = true;
      window.widget.dragStart();
    }
    if (dragging) window.widget.dragMove();
  });
  el.addEventListener('pointerup', () => {
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

// ---------- projecten ----------

let view = 'limits';
let days = 7;
let projTimer = null;
const openProjects = new Set();
const numFmt = new Intl.NumberFormat('nl-NL');

function formatTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} mld`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} mln`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}k`;
  return numFmt.format(n);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderProjects(data) {
  const list = $('#proj-list');
  list.replaceChildren();
  $('#proj-total').textContent = `${formatTokens(data.total)} tokens`;
  $('#proj-count').textContent = data.projects.length === 1 ? '1 project' : `${data.projects.length} projecten`;
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
    const meta = el('div', 'proj-meta', `${share}% van totaal · ${p.sessions} ${p.sessions === 1 ? 'sessie' : 'sessies'} · ${models}`);
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
    renderProjects(await window.widget.projects(days));
  } catch {
    $('#proj-list').replaceChildren(el('li', 'proj-empty', 'Kon de sessielogboeken niet lezen.'));
  }
  if (view === 'projects') projTimer = setTimeout(loadProjects, 2 * 60 * 1000);
}

function setView(next) {
  view = next;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === view);
  for (const v of $$('.view')) v.hidden = v.dataset.view !== view;
  if (view === 'projects') loadProjects();
  else clearTimeout(projTimer);
}

for (const t of $$('.tab')) t.addEventListener('click', () => setView(t.dataset.view));
for (const b of $$('.period')) {
  b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    for (const x of $$('.period')) x.classList.toggle('active', x === b);
    loadProjects();
  });
}

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
  render();
});

setInterval(render, 15000); // aftellers en "bijgewerkt"-tijd bijhouden

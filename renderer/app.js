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
  render();
});

setInterval(render, 15000); // aftellers en "bijgewerkt"-tijd bijhouden

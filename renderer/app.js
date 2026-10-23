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
const money = (n) =>
  `$${n.toLocaleString('nl-NL', { minimumFractionDigits: n < 10 ? 2 : 0, maximumFractionDigits: n < 10 ? 2 : 0 })}`;
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const WEEK_MS = 7 * 86400e3;

// Verwacht weekverbruik bij de reset, op basis van het tempo tot nu toe.
function weekPace(u) {
  const w = u && u.sevenDay;
  if (!w || !w.resetsAt) return null;
  const end = new Date(w.resetsAt).getTime();
  const elapsed = Math.min(1, Math.max(0, 1 - (end - Date.now()) / WEEK_MS));
  const resetDay = new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(new Date(end));
  if (elapsed < 0.04) return { level: 'lvl-ok', text: `Je week is net begonnen. Reset op ${resetDay}.` };
  const projected = w.percent / elapsed;
  if (w.percent >= 100) return { level: 'lvl-crit', text: `Weeklimiet bereikt. Weer beschikbaar op ${resetDay}.` };
  if (projected <= 85) return { level: 'lvl-ok', projected, text: `Op koers. Je haalt de reset van ${resetDay} ruim.` };
  if (projected <= 100) return { level: 'lvl-warn', projected, text: `Krap. In dit tempo zit je rond ${Math.round(projected)}% bij de reset van ${resetDay}.` };
  const rate = w.percent / (elapsed * WEEK_MS); // procent per ms
  const full = new Date(Date.now() + (100 - w.percent) / rate);
  return {
    level: 'lvl-crit',
    projected,
    text: `Te snel. In dit tempo is je weeklimiet rond ${dayFmt.format(full)} op, vóór de reset van ${resetDay}.`,
  };
}

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

  const pace = weekPace(u);
  const paceEl = $('#pace');
  paceEl.hidden = !pace;
  if (pace) {
    paceEl.classList.remove('lvl-ok', 'lvl-warn', 'lvl-crit');
    paceEl.classList.add(pace.level);
    $('span', paceEl).textContent = pace.text;
  }

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
  const shortDate = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
  $('#rows').replaceChildren(
    ...rows.map(([label, w]) => {
      const row = el('div', 'row');
      setLevel(row, w.percent);
      const bar = el('div', 'bar');
      const fill = el('div', 'fill');
      fill.style.width = `${w.percent}%`;
      bar.append(fill);
      row.title = w.resetsAt ? (w.expires ? `Verloopt op ${dateFmt.format(new Date(w.resetsAt))}` : formatReset(w.resetsAt)) : '';
      const name = el('span', null, label);
      const parts = [];
      if (w.remainingDollars != null) parts.push(`${money(w.remainingDollars)} van ${money(w.limitDollars)} over`);
      if (w.expires && w.resetsAt) parts.push(`verloopt ${shortDate.format(new Date(w.resetsAt))}`);
      row.append(name, bar, el('b', null, pctText(w)));
      if (parts.length) row.append(el('small', null, parts.join(' · ')));
      return row;
    })
  );

  // verdeling per product
  const products = u.products && u.products.rows.filter((r) => r.percent > 0);
  const prodEl = $('#products');
  prodEl.hidden = !(products && products.length);
  if (products && products.length) {
    const colors = { cowork: '#a78bfa', chat: '#ff8a65', claude_code: '#38bdf8', other: '#8a8896' };
    $('.stack', prodEl).replaceChildren(
      ...products.map((r) => {
        const seg = el('i');
        seg.style.width = `${r.percent}%`;
        seg.style.background = colors[r.key] || '#8a8896';
        seg.title = `${r.name}: ${r.percent}%`;
        return seg;
      })
    );
    $('.legend', prodEl).replaceChildren(
      ...products.map((r) => {
        const item = el('span');
        const dot = el('i');
        dot.style.background = colors[r.key] || '#8a8896';
        item.append(dot, `${r.name} `, el('b', null, `${r.percent}%`));
        return item;
      })
    );
  }

  // iets nieuws van Anthropic, bijvoorbeeld een gratis reset
  const news = $('#news');
  const fresh = u.newFields || [];
  news.hidden = !fresh.length;
  if (fresh.length) {
    news.replaceChildren(
      el('b', null, 'Er staat iets nieuws in je account. '),
      `Mogelijk een gratis reset of aanbieding; kijk op claude.ai bij Gebruik. (${fresh.map((f) => f.key).join(', ')})`
    );
  }

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
  $('#proj-cost').textContent = money(data.cost || 0);
  $('#proj-count').textContent = `${formatTokens(data.total)} tokens · ${data.projects.length === 1 ? '1 map' : `${data.projects.length} mappen`}`;
  $('#proj-since').textContent = `Sinds ${dateFmt.format(new Date(data.since))}`;

  // Welk deel van je weekverbruik staat niet op deze computer? (alleen voor "Deze week")
  const coverage = $('#coverage');
  const products = state.usage && state.usage.products ? state.usage.products.rows : [];
  const hasCowork = data.projects.some((p) => p.source === 'Cowork');
  const missing = products.filter((r) => r.percent > 0 && (r.key === 'chat' || r.key === 'other' || (r.key === 'cowork' && !hasCowork)));
  coverage.hidden = period !== 'week' || !missing.length;
  if (!coverage.hidden) {
    coverage.replaceChildren(
      el('b', null, `${missing.reduce((a, r) => a + r.percent, 0)}% van je weekverbruik staat niet op deze computer`),
      ` (${missing.map((r) => `${r.name} ${r.percent}%`).join(', ')}). ` +
        (missing.some((r) => r.key === 'cowork') ? 'Cowork-sessies die in de cloud draaien laten hier geen logboek achter. ' : '') +
        'De verdeling per product staat bij Limieten.'
    );
  }
  if (!data.projects.length) {
    list.append(el('li', 'proj-empty', 'Geen Claude Code- of Cowork-sessies in deze periode.'));
    return;
  }
  const max = data.projects[0].cost || data.projects[0].tokens;
  for (const p of data.projects) {
    const li = el('li', 'proj');
    li.classList.toggle('open', openProjects.has(p.path));
    li.title = p.path;
    const top = el('div', 'proj-top');
    const name = el('span', 'proj-name', p.name);
    name.prepend(el('i', `src src-${p.source.toLowerCase()}`, p.source));
    top.append(name, el('span', 'proj-tokens', money(p.cost)));
    const bar = el('div', 'bar');
    const fill = el('div', 'fill');
    fill.style.width = `${((data.projects[0].cost ? p.cost : p.tokens) / max) * 100}%`;
    bar.append(fill);
    const models = p.models.map((m) => `${m.name} ${share(m.cost, p.cost)}%`).join(' · ');
    const meta = el(
      'div',
      'proj-meta',
      `${share(p.cost, data.cost)}% · ${formatTokens(p.tokens)} tokens · ${p.sessions} ${p.sessions === 1 ? 'sessie' : 'sessies'} · ${models}`
    );
    const detail = el('div', 'proj-detail');
    for (const [label, value] of [
      ['Invoer', p.input],
      ['Uitvoer', p.output],
      ['Cache geschreven', p.cacheWrite],
      ['Cache gelezen', p.cacheRead],
      ['Waarvan denktokens', p.thinking],
      ['Antwoorden', p.messages],
      ['Context per antwoord', p.messages ? Math.round((p.input + p.cacheRead + p.cacheWrite) / p.messages) : 0],
    ]) {
      detail.append(el('span', null, label), el('b', null, numFmt.format(value)));
    }
    const efforts = p.efforts.filter((e) => e.name !== 'onbekend');
    if (efforts.length) {
      detail.append(el('span', 'wide', `Effort: ${efforts.map((e) => `${e.name} ${share(e.cost, p.cost)}%`).join(' · ')}`));
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

// ---------- tips ----------

function tip(icon, level, title, body) {
  const li = el('li', `tip ${level}`);
  const text = el('div');
  text.append(el('div', 'tip-title', title), el('div', 'tip-body', body));
  li.append(el('div', 'tip-icon', icon), text);
  return li;
}

function buildTips(u, d) {
  const out = [];
  const pace = weekPace(u);
  if (pace) out.push(tip('📈', pace.level, 'Weektempo', pace.text));
  if (u.fiveHour && u.fiveHour.percent >= 80) {
    out.push(tip('⏳', 'lvl-crit', '5-uurslimiet bijna op', `Grote taken kun je beter na de reset doen (${formatReset(u.fiveHour.resetsAt)}).`));
  }

  const s = d && d.summary;
  if (!s || !s.messages) {
    out.push(
      tip('💬', 'lvl-ok', 'Je verbruik zit in chats',
        'Van gewone chats staan geen details op je computer. Wat helpt: per onderwerp een nieuw gesprek beginnen (elk bericht stuurt het hele gesprek opnieuw mee), vaste bestanden in een project zetten in plaats van ze steeds opnieuw te uploaden, en voor eenvoudige vragen Sonnet of een lagere effort kiezen.')
    );
    return out;
  }

  const top = d.projects[0];
  if (top && d.projects.length > 1) {
    out.push(tip('📁', 'lvl-ok', 'Grootste map', `${top.name} (${top.source}) is ${share(top.cost, s.cost)}% van je Code- en Cowork-verbruik deze week (${money(top.cost)} API-waarde).`));
  }

  const heavy = s.efforts.filter((e) => ['high', 'xhigh', 'max'].includes(e.name)).reduce((a, e) => a + e.cost, 0);
  if (share(heavy, s.cost) >= 50) {
    out.push(tip('🎚️', 'lvl-warn', 'Veel werk op hoge effort',
      `${share(heavy, s.cost)}% van je verbruik draait op effort high of hoger. Voor routinewerk (kleine aanpassingen, uitleg, opmaak) is medium of low vaak genoeg. Zet effort alleen hoog voor lastige problemen.`));
  }
  if (s.output && share(s.thinking, s.output) >= 50) {
    out.push(tip('🧠', 'lvl-warn', 'Veel denkwerk',
      `${share(s.thinking, s.output)}% van de uitvoer is denken. Een lagere effort maakt antwoorden korter en goedkoper bij eenvoudige vragen.`));
  }

  const premium = s.models.filter((m) => ['Opus', 'Fable', 'Mythos'].includes(m.name)).reduce((a, m) => a + m.cost, 0);
  if (share(premium, s.cost) >= 60) {
    out.push(tip('🧩', 'lvl-warn', 'Vooral Opus',
      `${share(premium, s.cost)}% van je verbruik is Opus (of zwaarder). Sonnet 5.5 kost per token de helft van Opus 5.5; gebruik het voor routinetaken en houd Opus voor ontwerp en lastig debugwerk.`));
  }

  const avgContext = (s.input + s.cacheRead + s.cacheWrite) / s.messages;
  if (avgContext > 120000) {
    out.push(tip('📚', 'lvl-warn', 'Lange sessies',
      `Elk antwoord leest gemiddeld ${formatTokens(avgContext)} tokens context. Begin per taak een nieuwe sessie, of gebruik /clear of /compact als een sessie lang wordt.`));
  }
  if (share(s.cacheWrite * 1.25, s.input + s.cacheRead * 0.1 + s.cacheWrite * 1.25) >= 40) {
    out.push(tip('📝', 'lvl-ok', 'Veel nieuwe context',
      'Een groot deel gaat op aan nieuwe context in de cache schrijven. Laat Claude gericht bestanden lezen in plaats van hele mappen, en houd CLAUDE.md beknopt.'));
  }
  if (out.length <= 2) out.push(tip('✅', 'lvl-ok', 'Efficiënt bezig', 'Geen duidelijke verspilling gevonden in je Code- en Cowork-sessies van deze week.'));
  return out;
}

async function loadTips() {
  let data = null;
  try {
    const saved = period;
    period = 'week';
    const since = periodStart();
    period = saved;
    data = await window.widget.projects(since);
  } catch { /* zonder logboeken alleen limiet-tips */ }
  $('#tips').replaceChildren(...buildTips(state.usage || {}, data));
}

function setView(next) {
  view = next;
  panel.dataset.view = view;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === view);
  for (const v of $$('.view')) v.hidden = v.dataset.view !== view;
  if (view === 'projects') loadProjects();
  else clearTimeout(projTimer);
  if (view === 'tips') loadTips();
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

// Mappen alleen tonen als er de afgelopen 30 dagen lokale Code- of Cowork-sessies zijn.
async function updateMappenTab() {
  let has = true;
  try {
    const data = await window.widget.projects(Date.now() - 30 * 86400e3);
    has = data.projects.length > 0;
  } catch { /* bij twijfel tonen */ }
  $('.tab[data-view="projects"]').hidden = !has;
  if (!has && view === 'projects') setView('limits');
}

function expand() {
  if (isExpanded) return;
  isExpanded = true;
  updateMappenTab();
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
  if (view === 'tips') loadTips();
  setTimeout(() => refreshBtn.classList.remove('spin'), 900);
});
$('#btn-collapse').addEventListener('click', collapse);
// ---------- thema ----------

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let themeSetting = 'dark';

function applyTheme(setting) {
  themeSetting = setting || 'dark';
  const resolved = themeSetting === 'system' ? (systemDark.matches ? 'dark' : 'light') : themeSetting;
  document.documentElement.dataset.theme = resolved;
}

systemDark.addEventListener('change', () => applyTheme(themeSetting));
window.widget.onTheme(applyTheme);
$('#btn-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  window.widget.setTheme(next);
});
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
  applyTheme(s.theme);
  updateMappenTab();
  const keys = s.shortcut.replace('CommandOrControl', navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl');
  $('#shortcut').textContent = keys.replaceAll('+', ' ');
  $('#shortcut').title = 'Sneltoets om de widget te tonen of te verbergen';
  panel.dataset.view = view;
  render();
});

setInterval(render, 15000); // aftellers en "bijgewerkt"-tijd bijhouden

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

// Korte resttijd voor de pil: "2u18", "45m", "3d14u".
function shortLeft(iso) {
  const min = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d}d${h}u`;
  if (h) return `${h}u${String(m).padStart(2, '0')}`;
  return `${m}m`;
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
  for (const key of ['fiveHour', 'sevenDay']) {
    const w = u[key];
    $(`[data-reset="${key}"]`, pill).textContent = w && w.resetsAt ? shortLeft(w.resetsAt) : '';
  }
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
    const colors = Object.fromEntries(Object.entries(PRODUCT_VARS).map(([k, v]) => [k, css(v)]));
    $('.stack', prodEl).replaceChildren(
      ...products.map((r) => {
        const seg = el('i');
        seg.style.width = `${r.percent}%`;
        seg.style.background = colors[r.key] || css('--s-other');
        seg.title = `${r.name}: ${r.percent}%`;
        return seg;
      })
    );
    $('.legend', prodEl).replaceChildren(
      ...products.map((r) => {
        const item = el('span');
        const dot = el('i');
        dot.style.background = colors[r.key] || css('--s-other');
        item.append(dot, `${r.name} `, el('b', null, `${r.percent}%`));
        return item;
      })
    );
  }

  // iets nieuws van Anthropic, bijvoorbeeld een gratis reset
  const news = $('#news');
  const acked = new Set(state.ackNews || []);
  const fresh = (u.newFields || []).filter((f) => !acked.has(f.key));
  news.hidden = !fresh.length;
  if (fresh.length) {
    const ok = el('button', 'link-btn', 'Begrepen');
    ok.addEventListener('click', () => window.widget.ackNews(fresh.map((f) => f.key)));
    news.replaceChildren(
      el('b', null, 'Er staat iets nieuws in je account. '),
      `Mogelijk een gratis reset of aanbieding; kijk op claude.ai bij Instellingen → Gebruik. (${fresh.map((f) => f.key).join(', ')}) `,
      ok
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
    const where = (u.products ? u.products.rows : [])
      .filter((r) => r.percent > 0 && r.key !== 'claude_code')
      .map((r) => `${r.name} ${r.percent}%`);
    out.push(
      tip('💬', 'lvl-ok', where.length ? `Je verbruik zit in ${where.join(' en ')}` : 'Je verbruik zit in chats en Cowork',
        'Daarvan staan geen details op je computer. Wat helpt: per taak een nieuw gesprek of een nieuwe Cowork-sessie beginnen (elk bericht stuurt het hele gesprek opnieuw mee), vaste bestanden in een project zetten in plaats van ze steeds opnieuw te uploaden, en voor eenvoudig werk Sonnet of een lagere effort kiezen.')
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

// ---------- verloop (grafieken) ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
const SERIES_VARS = ['--s1', '--s2', '--s3', '--s4'];
let trendDays = 7;
let trendMetric = 'cost';
let trendTimer = null;
let lastTimeline = null;

function svgEl(tag, attrs = {}, cls) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (cls) e.setAttribute('class', cls);
  return e;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hourFmt = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
const dayShortFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
const tipFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Gedeelde opbouw: plotvlak, horizontale hulplijnen met labels, tijdlabels onderaan.
function chartFrame(box, { yMax, yTicks, yFormat, xStart, xEnd, xLabels }) {
  box.replaceChildren();
  const W = box.clientWidth || 296;
  const H = box.clientHeight || 128;
  const pad = { l: 30, r: 6, t: 6, b: 16 };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const x = (t) => pad.l + ((t - xStart) / Math.max(1, xEnd - xStart)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  for (const v of yTicks) {
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, 'gridline'));
    const lbl = svgEl('text', { x: pad.l - 5, y: y(v) + 3, 'text-anchor': 'end' }, 'axis-label');
    lbl.textContent = yFormat(v);
    svg.append(lbl);
  }
  for (const [t, text, anchor] of xLabels) {
    const lbl = svgEl('text', { x: x(t), y: H - 3, 'text-anchor': anchor || 'middle' }, 'axis-label');
    lbl.textContent = text;
    svg.append(lbl);
  }
  box.append(svg);
  return { svg, W, H, pad, x, y };
}

function showTooltip(box, px, py, head, rows) {
  let tip = $('.tooltip', box);
  if (!tip) {
    tip = el('div', 'tooltip');
    box.append(tip);
  }
  tip.replaceChildren(el('div', 'tt-head', head));
  for (const [color, label, value] of rows) {
    const row = el('div', 'tt-row');
    const key = el('i', 'key key-box');
    key.style.background = color;
    row.append(key, el('span', null, label), el('b', null, value));
    tip.append(row);
  }
  tip.hidden = false;
  const bw = box.clientWidth;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(0, px + 10), bw - tw)}px`;
  if (px + 10 + tw > bw) tip.style.left = `${Math.max(0, px - tw - 10)}px`;
  tip.style.top = `${Math.max(0, py - 10)}px`;
}

const hideTooltip = (box) => {
  const tip = $('.tooltip', box);
  if (tip) tip.hidden = true;
};

function timeLabels(start, end, bucketHours) {
  const span = end - start;
  const fmt = span <= 1.5 * 86400e3 ? (t) => hourFmt.format(t) : span <= 8 * 86400e3 ? (t) => dayShortFmt.format(t) : (t) => dateShortFmt.format(t);
  return [[start, fmt(start), 'start'], [start + span / 2, fmt(start + span / 2)], [end, fmt(end), 'end']];
}

// Grafiek 1: 5-uurs- en weeklimiet door de tijd, uit de eigen metingen van de widget.
function drawLimits(points, sinceMs) {
  const box = $('#chart-limits');
  const now = Date.now();
  const f = chartFrame(box, {
    yMax: 100, yTicks: [0, 50, 100], yFormat: (v) => `${v}%`,
    xStart: sinceMs, xEnd: now, xLabels: timeLabels(sinceMs, now),
  });
  const note = $('#limits-note');
  // Over meerdere dagen is de 5-uurslijn een zaag zonder betekenis: dan alleen de week.
  const showFive = now - sinceMs <= 1.5 * 86400e3;
  $('#legend-5h').hidden = !showFive;
  if (points.length < 2) {
    box.append(el('div', 'chart-empty', 'Nog te weinig metingen. De widget houdt je limieten bij zolang hij openstaat; dit vult zich vanzelf.'));
    note.textContent = '';
    return;
  }
  // Lijn onderbreken waar de widget een tijd dicht was (geen metingen).
  const gap = Math.max(2 * 3600e3, (now - sinceMs) / 40);
  const keys = showFive ? [['w', css('--s2')], ['f', css('--s1')]] : [['w', css('--s2')]];
  for (const [key, color] of keys) {
    let d = '';
    points.forEach((p, i) => {
      const jump = i === 0 || p.t - points[i - 1].t > gap;
      d += `${jump ? 'M' : 'L'}${f.x(p.t).toFixed(1)},${f.y(p[key]).toFixed(1)}`;
    });
    f.svg.append(svgEl('path', { d, stroke: color }, 'line'));
  }
  // Waarde aan het eind van elke lijn (geen getal op elk punt).
  const lastP = points[points.length - 1];
  const crosshair = svgEl('line', { y1: f.pad.t, y2: f.H - f.pad.b, visibility: 'hidden' }, 'crosshair');
  const dotF = svgEl('circle', { r: 4, fill: css('--s1'), visibility: 'hidden' }, 'dot');
  const dotW = svgEl('circle', { r: 4, fill: css('--s2'), visibility: 'hidden' }, 'dot');
  const hit = svgEl('rect', { x: f.pad.l, y: 0, width: f.W - f.pad.l - f.pad.r, height: f.H }, 'hit');
  f.svg.append(crosshair, dotW, dotF, hit);
  const nearest = (t) => points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), points[0]);
  hit.addEventListener('pointermove', (e) => {
    const r = f.svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * f.W;
    const t = sinceMs + ((sx - f.pad.l) / (f.W - f.pad.l - f.pad.r)) * (now - sinceMs);
    const p = nearest(t);
    const px = f.x(p.t);
    for (const [elm, key] of showFive ? [[dotF, 'f'], [dotW, 'w']] : [[dotW, 'w']]) {
      elm.setAttribute('cx', px);
      elm.setAttribute('cy', f.y(p[key]));
      elm.setAttribute('visibility', 'visible');
    }
    crosshair.setAttribute('x1', px);
    crosshair.setAttribute('x2', px);
    crosshair.setAttribute('visibility', 'visible');
    const rows = [[css('--s2'), 'Week', `${Math.round(p.w)}%`]];
    if (showFive) rows.unshift([css('--s1'), '5 uur', `${Math.round(p.f)}%`]);
    showTooltip(box, (px / f.W) * box.clientWidth, (f.y(showFive ? Math.max(p.f, p.w) : p.w) / f.H) * box.clientHeight, tipFmt.format(p.t), rows);
  });
  hit.addEventListener('pointerleave', () => {
    for (const elm of [dotF, dotW, crosshair]) elm.setAttribute('visibility', 'hidden');
    hideTooltip(box);
  });
  const first = points[0].t;
  note.textContent =
    (first > sinceMs + 3600e3 ? `Bijgehouden sinds ${tipFmt.format(first)}. ` : '') +
    `Nu: 5 uur ${Math.round(lastP.f)}%, week ${Math.round(lastP.w)}%.` +
    (showFive ? '' : ' De 5-uurslimiet zie je bij 24 uur.');
}

// Grafiek 2: verbruik per dag (of per uur bij 24 uur), gestapeld per map.
// Gestapelde staven per tijdsbakje; gedeeld door "verbruik per map" en "verbruik per product".
function drawStacked(box, { starts, bucket, series, fmt, emptyText }) {
  const totals = starts.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const max = Math.max(...totals, 0);
  const step = bucket === 'hour' ? 3600e3 : 86400e3;
  const end = starts[starts.length - 1] + step;
  const nice = (m) => {
    if (m <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(m));
    return [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= m);
  };
  const yMax = nice(max);
  const f = chartFrame(box, {
    yMax, yTicks: [0, yMax / 2, yMax], yFormat: (v) => (v === 0 ? '0' : fmt(v)),
    xStart: starts[0], xEnd: end, xLabels: timeLabels(starts[0], starts[starts.length - 1] + step / 2).map((l, i) => (i === 0 ? [starts[0] + step / 2, l[1], 'start'] : l)),
  });
  if (max <= 0) box.append(el('div', 'chart-empty', emptyText));
  const slot = (f.W - f.pad.l - f.pad.r) / starts.length;
  const barW = Math.min(24, Math.max(2, slot - 2));
  starts.forEach((t, i) => {
    const cx = f.x(t + step / 2);
    const g = svgEl('g');
    const hover = svgEl('rect', { x: cx - slot / 2, y: f.pad.t, width: slot, height: f.H - f.pad.t - f.pad.b, visibility: 'hidden' }, 'bar-hover');
    g.append(hover);
    let acc = 0;
    const segs = series.map((sr, si) => ({ v: sr.values[i], si })).filter((x) => x.v > 0);
    segs.forEach(({ v, si }, k) => {
      const y0 = f.y(acc);
      const y1 = f.y(acc + v);
      acc += v;
      const h = Math.max(1, y0 - y1 - (k < segs.length - 1 ? 2 : 0)); // 2px naad tussen segmenten
      g.append(svgEl('rect', { x: cx - barW / 2, y: y0 - h, width: barW, height: h, rx: k === segs.length - 1 ? Math.min(2, barW / 3) : 0, fill: series[si].color }));
    });
    const hit = svgEl('rect', { x: cx - slot / 2, y: 0, width: slot, height: f.H }, 'hit');
    g.append(hit);
    hit.addEventListener('pointerenter', () => {
      hover.setAttribute('visibility', 'visible');
      const label = bucket === 'hour'
        ? `${dateShortFmt.format(t)} · ${hourFmt.format(t)}–${hourFmt.format(t + step)}`
        : weekdayFmt.format(t);
      const rows = segs.slice().reverse().map(({ v, si }) => [series[si].color, series[si].name, fmt(v)]);
      if (!rows.length) rows.push([css('--s-other'), 'Geen verbruik', '–']);
      else if (rows.length > 1) rows.push(['transparent', 'Totaal', fmt(totals[i])]);
      showTooltip(box, (cx / f.W) * box.clientWidth, (f.y(totals[i]) / f.H) * box.clientHeight, label, rows);
    });
    hit.addEventListener('pointerleave', () => {
      hover.setAttribute('visibility', 'hidden');
      hideTooltip(box);
    });
    f.svg.append(g);
  });
}

// Dezelfde cijfers als tabel (zonder kleur leesbaar); open met de knop onder de grafiek.
function renderTable(card, { starts, bucket, series, fmt }) {
  let wrap = $('.data-table', card);
  if (!wrap) {
    const toggle = el('button', 'link-btn table-toggle', 'Als tabel');
    wrap = el('div', 'data-table');
    wrap.hidden = true;
    toggle.addEventListener('click', () => {
      wrap.hidden = !wrap.hidden;
      toggle.textContent = wrap.hidden ? 'Als tabel' : 'Tabel verbergen';
    });
    card.append(toggle, wrap);
  }
  const table = el('table');
  const head = el('tr');
  head.append(el('th', null, bucket === 'hour' ? 'Uur' : 'Dag'), ...series.map((sr) => el('th', null, sr.name)));
  table.append(head);
  starts.forEach((t, i) => {
    if (!series.some((sr) => sr.values[i] > 0)) return; // lege rijen weglaten
    const tr = el('tr');
    tr.append(el('td', null, bucket === 'hour' ? hourFmt.format(t) : dayShortFmt.format(t)), ...series.map((sr) => el('td', null, sr.values[i] ? fmt(sr.values[i]) : '–')));
    table.append(tr);
  });
  wrap.replaceChildren(table);
}

// Legenda met totaal per reeks: ook leesbaar zonder kleur.
function renderLegend(ul, series, fmt) {
  ul.replaceChildren(
    ...series.map((sr) => {
      const li = el('li');
      const key = el('i', 'key key-box');
      key.style.background = sr.color;
      li.title = sr.title || sr.name;
      li.append(key, el('span', null, sr.label || sr.name), el('b', null, fmt(sr.values.reduce((a, v) => a + v, 0))));
      return li;
    })
  );
}

// Verbruik per map (lokale logboeken).
function drawUsage(timeline) {
  const { starts, series, bucket } = timeline;
  const fmt = (n) => (trendMetric === 'cost' ? money(n) : formatTokens(n));
  const mapped = series.map((sr, i) => ({
    name: sr.name,
    label: sr.source ? `${sr.name} · ${sr.source}` : sr.name,
    title: sr.path || sr.name,
    color: sr.other ? css('--s-other') : css(SERIES_VARS[i]),
    values: sr.values.map((v) => (trendMetric === 'cost' ? v.cost : v.tokens)),
  }));
  $('#usage-title').textContent = bucket === 'hour' ? 'Per map, per uur' : 'Per map, per dag';
  drawStacked($('#chart-usage'), { starts, bucket, series: mapped, fmt, emptyText: 'Geen Claude Code- of Cowork-sessies op deze computer in deze periode.' });
  renderLegend($('#usage-legend'), mapped, fmt);
  renderTable($('#chart-usage').closest('.chart-card'), { starts, bucket, series: mapped, fmt });
  const products = state.usage && state.usage.products ? state.usage.products.rows : [];
  const notLocal = products.filter((r) => r.percent > 0 && r.key !== 'claude_code').map((r) => `${r.name} ${r.percent}%`);
  $('#usage-note').textContent =
    'Alleen Claude Code en Cowork op deze computer' +
    (notLocal.length ? `; ${notLocal.join(', ')} van je week staat er niet in.` : '.');
}

// Verbruik per product (Chats, Cowork, Claude Code) in procent van de weeklimiet, uit eigen metingen.
const PRODUCT_ORDER = ['chat', 'cowork', 'claude_code', 'other'];
const PRODUCT_VARS = { chat: '--s1', cowork: '--s2', claude_code: '--s3', other: '--s-other' }; // overal dezelfde kleur per product
const PRODUCT_NAMES = { chat: 'Chats', cowork: 'Cowork', claude_code: 'Claude Code', other: 'Overig' };

function drawProducts(data) {
  const { starts, bucket, series } = data;
  const sorted = series.slice().sort((a, b) => PRODUCT_ORDER.indexOf(a.key) - PRODUCT_ORDER.indexOf(b.key));
  const mapped = sorted
    .filter((sr) => sr.values.some((v) => v > 0))
    .map((sr) => {
      return {
        name: PRODUCT_NAMES[sr.key] || sr.key,
        color: css(PRODUCT_VARS[sr.key] || '--s-other'),
        values: sr.values,
      };
    });
  const fmt = (n) => `${n.toLocaleString('nl-NL', { maximumFractionDigits: n < 10 ? 1 : 0 })}%`;
  $('#products-title').textContent = bucket === 'hour' ? 'Per product, per uur' : 'Per product, per dag';
  drawStacked($('#chart-products'), {
    starts, bucket, series: mapped, fmt,
    emptyText: 'Nog te weinig metingen. De widget houdt dit bij zolang hij draait; dit vult zich vanzelf.',
  });
  renderLegend($('#products-legend'), mapped, fmt);
  renderTable($('#chart-products').closest('.chart-card'), { starts, bucket, series: mapped, fmt });
}

// Patronen: vergelijking met vorige week en een heatmap per dag en tijdvak.
const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const DAYS_LONG = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

function drawPatterns(p) {
  const fmt = (n) => `${Math.round(n)}%`;
  const c = p.compare;
  const tile = (label, value, extra) => {
    const t = el('div', 'tile');
    const b = el('b', null, value);
    t.append(el('span', null, label), b);
    if (extra) b.after(el('small', null, extra));
    return t;
  };
  const tiles = [];
  if (c) {
    const diff = c.lastWeekSameTime != null ? c.now - c.lastWeekSameTime : null;
    tiles.push(tile('Deze week tot nu', fmt(c.now), diff != null ? `${diff > 0 ? '+' : ''}${Math.round(diff)} t.o.v. vorige week` : null));
    tiles.push(tile('Vorige week in totaal', c.lastWeekTotal != null ? fmt(c.lastWeekTotal) : '–', c.lastWeekTotal == null ? 'nog niet gemeten' : null));
  }
  $('#compare').replaceChildren(...tiles);

  const box = $('#heatmap');
  box.replaceChildren();
  const max = Math.max(0, ...p.heat.flat());
  const cols = p.heat[0].length;
  const W = box.clientWidth || 296;
  const labelW = 22;
  const cell = (W - labelW) / cols;
  const H = 7 * cell + 14;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const s1 = css('--s1');
  p.heat.forEach((row, d) => {
    const lbl = svgEl('text', { x: 0, y: d * cell + cell / 2 + 3 }, 'axis-label');
    lbl.textContent = DAYS[d];
    svg.append(lbl);
    row.forEach((v, b) => {
      const r = svgEl('rect', { x: labelW + b * cell, y: d * cell, width: cell, height: cell, rx: 3, fill: s1, 'fill-opacity': max ? 0.07 + 0.93 * (v / max) : 0.07 }, 'cell');
      r.addEventListener('pointerenter', () => {
        const from = String(b * p.blockHours).padStart(2, '0');
        const to = String((b + 1) * p.blockHours).padStart(2, '0');
        showTooltip(box, labelW + b * cell + cell, d * cell, `${DAYS_LONG[d]} ${from}:00–${to}:00`, [[s1, 'Verbruikt', `${v.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}% van een week`]]);
      });
      r.addEventListener('pointerleave', () => hideTooltip(box));
      svg.append(r);
    });
  });
  for (const hr of [0, 6, 12, 18]) {
    const lbl = svgEl('text', { x: labelW + (hr / p.blockHours) * cell, y: H - 2 }, 'axis-label');
    lbl.textContent = String(hr).padStart(2, '0');
    svg.append(lbl);
  }
  box.append(svg);
  const scale = el('div', 'heat-scale');
  scale.append('minder', el('i'), 'meer');
  box.append(scale);
  if (p.coveredDays < 3) {
    box.append(el('div', 'chart-empty', 'Nog te weinig metingen voor patronen. Na een paar dagen met de widget open verschijnt hier wanneer je het meest verbruikt.'));
  }
  // Drukste tijdvak in woorden: ook leesbaar zonder kleur.
  let best = null;
  p.heat.forEach((row, d) => row.forEach((v, b) => { if (v > 0 && (!best || v > best.v)) best = { v, d, b }; }));
  $('#patterns-note').textContent = best && p.coveredDays >= 3
    ? `Je verbruikt het meest op ${DAYS_LONG[best.d]} tussen ${String(best.b * p.blockHours).padStart(2, '0')}:00 en ${String((best.b + 1) * p.blockHours).padStart(2, '0')}:00. Gemeten over ${Math.round(p.coveredDays)} dagen.`
    : '';
}

async function loadTrend() {
  clearTimeout(trendTimer);
  const now = Date.now();
  const since = trendDays === 1 ? now - 86400e3 : (() => {
    const d = new Date(now - (trendDays - 1) * 86400e3);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  try {
    const bucket = trendDays === 1 ? 'hour' : 'day';
    const [points, usage, products] = await Promise.all([
      window.widget.history(since),
      window.widget.projects(since, bucket),
      window.widget.productUsage(since, bucket),
    ]);
    drawLimits(points, since);
    drawProducts(products);
    window.widget.patterns().then(drawPatterns).catch(() => {});
    lastTimeline = usage.timeline;
    drawUsage(lastTimeline);
  } catch {
    $('#chart-usage').replaceChildren(el('div', 'chart-empty', 'Kon de gegevens niet laden.'));
  }
  if (view === 'trend') trendTimer = setTimeout(loadTrend, 3 * 60 * 1000);
}

for (const b of $$('.vperiod')) {
  b.addEventListener('click', () => {
    trendDays = Number(b.dataset.range);
    for (const x of $$('.vperiod')) x.classList.toggle('active', x === b);
    loadTrend();
  });
}
for (const b of $$('.metric')) {
  b.addEventListener('click', () => {
    trendMetric = b.dataset.metric;
    for (const x of $$('.metric')) x.classList.toggle('active', x === b);
    if (lastTimeline) drawUsage(lastTimeline);
  });
}

function setView(next) {
  view = next;
  panel.dataset.view = view;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === view);
  for (const v of $$('.view')) v.hidden = v.dataset.view !== view;
  $('.panel-body').scrollTop = 0;
  if (view === 'projects') loadProjects();
  else clearTimeout(projTimer);
  if (view === 'tips') loadTips();
  if (view === 'trend') loadTrend();
  else clearTimeout(trendTimer);
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
  window.widget.expand(); // het paneel houdt zijn eigen hoogte; langere inhoud scrolt
  if (view === 'settings') openSettings();
  else setView(view); // actuele gegevens laden voor het open tabblad
}

// Interface terug naar de pil. `tellMain` is false als het hoofdproces het venster al klein maakte.
function collapse(tellMain = true) {
  if (!isExpanded) return;
  isExpanded = false;
  clearTimeout(trendTimer); // dicht: grafieken en mappen niet op de achtergrond verversen
  clearTimeout(projTimer);
  panel.hidden = true;
  pill.hidden = false;
  if (tellMain) window.widget.collapse();
}

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
draggable($('.panel-head'), () => collapse()); // klik op de bovenbalk = inklappen, slepen = verplaatsen

// ---------- formaat: aan een hoek slepen ----------
// Het hoofdproces schaalt het hele venster (zoom), dus de verhoudingen blijven gelijk.

for (const grip of $$('.rz')) {
  let active = false;
  const end = () => {
    if (!active) return;
    active = false;
    document.body.classList.remove('resizing');
    window.widget.resizeEnd();
  };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    active = true;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    window.widget.resizeStart(grip.dataset.corner);
  });
  grip.addEventListener('pointermove', () => active && window.widget.resizeMove());
  grip.addEventListener('pointerup', end);
  grip.addEventListener('lostpointercapture', end);
}

// ---------- knoppen ----------

const refreshBtn = $('#btn-refresh');
refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.add('spin');
  window.widget.refresh();
  if (view === 'projects') loadProjects();
  if (view === 'tips') loadTips();
  setTimeout(() => refreshBtn.classList.remove('spin'), 900);
});
// ---------- thema ----------

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let themeSetting = 'dark';

function applyTheme(setting) {
  themeSetting = setting || 'dark';
  const resolved = themeSetting === 'system' ? (systemDark.matches ? 'dark' : 'light') : themeSetting;
  document.documentElement.dataset.theme = resolved;
  render(); // kleuren van de productbalk komen uit het thema
  if (view === 'trend') loadTrend(); // grafiekkleuren ook
}

systemDark.addEventListener('change', () => applyTheme(themeSetting));
window.widget.onTheme(applyTheme);

// Rustig: de pil vervaagt als je muis er niet op staat (de CSS doet het vervagen).
const FADE_OPACITY = { light: 0.6, strong: 0.3 };
function applyFade(mode) {
  if (FADE_OPACITY[mode]) {
    document.body.dataset.fade = mode;
    document.body.style.setProperty('--fade', FADE_OPACITY[mode]);
  } else {
    delete document.body.dataset.fade;
  }
}
window.widget.onFade(applyFade);
// Net weer getoond: even helder (en een klein sprongetje), zodat je ziet waar hij staat.
let shownTimer = null;
window.widget.onShown(() => {
  document.body.classList.remove('just-shown');
  void document.body.offsetWidth; // animatie opnieuw starten
  document.body.classList.add('just-shown');
  clearTimeout(shownTimer);
  shownTimer = setTimeout(() => document.body.classList.remove('just-shown'), 2500);
});
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

// ---------- instellingen ----------

let settings = null;
let viewBeforeSettings = 'limits';

function renderSettings(s) {
  settings = s;
  for (const seg of $$('.seg[data-setting]')) {
    for (const b of $$('button', seg)) b.classList.toggle('active', b.dataset.value === s[seg.dataset.setting]);
  }
  for (const input of $$('input.switch[data-setting]')) input.checked = !!s[input.dataset.setting];
  $('#row-hook').hidden = !s.hookAvailable;
  $('#row-openclaude').hidden = !s.openClaudeAvailable;
  $('#row-tray-status').hidden = !s.trayStatusAvailable;
  $('#tray-status-title').textContent = s.trayStatusMac ? 'Menubalk' : 'Systeemvak';
  $('#tray-status-hint').textContent = s.trayStatusMac ? 'Naast het icoon' : 'Ring in het icoon';
  const group = $('#notify-group');
  $$('.set-row', group).forEach((r) => r.remove());
  for (const [key, label] of s.notifyLabels) {
    const row = el('label', 'set-row');
    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.checked = !!s.notify[key];
    input.addEventListener('change', async () => renderSettings(await window.widget.setSetting('notify', { [key]: input.checked })));
    row.append(el('span', null, label), input);
    group.append(row);
  }
  // sneltoets
  if (!recordingShortcut) $('#btn-shortcut').textContent = s.shortcutLabel;
  $('#shortcut').textContent = s.shortcutLabel;
  $('#shortcut').hidden = s.shortcut === 'none';
  // stille uren
  $('#quiet-enabled').checked = !!s.quietHours.enabled;
  $('#quiet-from').value = s.quietHours.from;
  $('#quiet-to').value = s.quietHours.to;
  $('#quiet-times').classList.toggle('disabled', !s.quietHours.enabled);
  $('#btn-test-notify').disabled = !s.notificationsSupported;
  $('#set-version').textContent = s.version;
  $('#set-update').textContent = s.update
    ? `Versie ${s.update.version} ${s.update.status === 'ready' ? 'staat klaar' : s.update.status === 'downloading' ? 'wordt gedownload' : 'is beschikbaar'}`
    : s.packaged ? 'Je hebt de nieuwste versie' : 'Ontwikkelversie (bijwerken met git pull)';
  $('#btn-check-update').hidden = !s.packaged;
  $('#btn-size-reset').disabled = !!s.sizeDefault;
}

async function openSettings() {
  if (view !== 'settings') viewBeforeSettings = view;
  setView('settings');
  renderSettings(await window.widget.getSettings());
}

$('#btn-settings').addEventListener('click', () => (view === 'settings' ? setView(viewBeforeSettings) : openSettings()));
$('#btn-settings-back').addEventListener('click', () => setView(viewBeforeSettings));
for (const seg of $$('.seg[data-setting]')) {
  for (const b of $$('button', seg)) {
    b.addEventListener('click', async () => {
      const s = await window.widget.setSetting(seg.dataset.setting, b.dataset.value);
      renderSettings(s);
      if (seg.dataset.setting === 'theme') applyTheme(s.theme);
    });
  }
}
for (const input of $$('input.switch[data-setting]')) {
  input.addEventListener('change', async () => renderSettings(await window.widget.setSetting(input.dataset.setting, input.checked)));
}
$('#btn-size-reset').addEventListener('click', async () => renderSettings(await window.widget.setSetting('resetSize', true)));
$('#btn-check-update').addEventListener('click', () => {
  window.widget.checkUpdate();
  $('#set-update').textContent = 'Bezig met controleren…';
  setTimeout(async () => renderSettings(await window.widget.getSettings()), 4000);
});
// Sneltoets opnemen: klik, druk de combinatie, klaar. Esc annuleert.
let recordingShortcut = false;
const shortcutBtn = $('#btn-shortcut');
function stopRecording() {
  recordingShortcut = false;
  shortcutBtn.classList.remove('recording');
  window.widget.pauseShortcut(false);
  window.removeEventListener('keydown', onShortcutKey, true);
}
async function onShortcutKey(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopRecording();
    renderSettings(await window.widget.getSettings());
    return;
  }
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return; // wachten op de echte toets
  const res = await window.widget.setShortcut({ code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
  stopRecording();
  renderSettings(res.settings);
  $('#shortcut-hint').textContent = res.error || 'Opgeslagen. Werkt vanuit elk programma.';
}
shortcutBtn.addEventListener('click', () => {
  if (recordingShortcut) return;
  recordingShortcut = true;
  shortcutBtn.classList.add('recording');
  shortcutBtn.textContent = 'Druk op toetsen…';
  $('#shortcut-hint').textContent = 'Bijv. Ctrl + Shift + M. Esc om te annuleren.';
  window.widget.pauseShortcut(true);
  window.addEventListener('keydown', onShortcutKey, true);
});
shortcutBtn.addEventListener('blur', () => {
  if (recordingShortcut) {
    stopRecording();
    window.widget.getSettings().then(renderSettings);
  }
});
for (const [id, value] of [['#btn-shortcut-reset', 'default'], ['#btn-shortcut-off', 'none']]) {
  $(id).addEventListener('click', async () => {
    const res = await window.widget.setShortcut(value);
    renderSettings(res.settings);
    $('#shortcut-hint').textContent = res.error || (value === 'none' ? 'Geen sneltoets.' : 'Standaard hersteld.');
  });
}

// Stille uren
$('#quiet-enabled').addEventListener('change', async (e) => renderSettings(await window.widget.setSetting('quietHours', { enabled: e.target.checked })));
for (const id of ['#quiet-from', '#quiet-to']) {
  const input = $(id);
  input.pattern = '([01]?\\d|2[0-3]):[0-5]\\d';
  input.addEventListener('change', async () => {
    // "9" of "930" mag ook: aanvullen tot 09:00 / 09:30
    let v = input.value.trim().replace('.', ':');
    if (/^\d{1,2}$/.test(v)) v = `${v}:00`;
    if (/^\d{3,4}$/.test(v)) v = `${v.slice(0, -2)}:${v.slice(-2)}`;
    if (/^\d:/.test(v)) v = `0${v}`;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      renderSettings(await window.widget.getSettings()); // ongeldig: oude waarde terug
      return;
    }
    renderSettings(await window.widget.setSetting('quietHours', { [id === '#quiet-from' ? 'from' : 'to']: v }));
  });
}
$('#btn-test-notify').addEventListener('click', async () => {
  const r = await window.widget.testNotification();
  $('#test-result').textContent = r.supported
    ? 'Verstuurd. Zie je niets? Zet meldingen voor Claude Meter aan in de systeeminstellingen.'
    : 'Meldingen worden op dit systeem niet ondersteund.';
});

// Exporteren
for (const b of $$('[data-export]')) {
  b.addEventListener('click', async () => {
    const out = $('#export-result');
    $$('[data-export]').forEach((x) => (x.disabled = true));
    out.textContent = 'Bezig…';
    const r = await window.widget.exportReport(b.dataset.export);
    $$('[data-export]').forEach((x) => (x.disabled = false));
    out.textContent = r.error || (r.canceled ? '' : `Opgeslagen: ${r.path}`);
  });
}

$('#btn-open-raw').addEventListener('click', () => window.widget.openRaw());
$('#btn-open-logcheck').addEventListener('click', () => window.widget.openLogCheck());

// ---------- nieuwe versie ----------

function renderUpdate(u) {
  const btn = $('#update');
  btn.hidden = !u;
  if (!u) return;
  btn.disabled = u.status === 'downloading';
  btn.replaceChildren(
    el('b', null, `Nieuwe versie ${u.version}`),
    u.status === 'ready' ? ' · klik om te herstarten en bij te werken'
      : u.status === 'downloading' ? ` · wordt gedownload…${u.progress ? ` ${u.progress}%` : ''}`
        : ' · klik om te downloaden'
  );
}
$('#update').addEventListener('click', () => window.widget.installUpdate());
window.widget.onUpdate(renderUpdate);
window.widget.onOpenPanel(() => expand()); // klik op een melding opent het paneel
window.widget.onForceCollapse(() => collapse(false));

window.widget.getState().then((s) => {
  state = s;
  applyTheme(s.theme);
  applyFade(s.idleFade);
  renderUpdate(s.update);
  updateMappenTab();
  $('#shortcut').textContent = s.shortcut;
  $('#shortcut').hidden = s.shortcut === 'Geen';
  $('#shortcut').title = 'Sneltoets om de widget te tonen of te verbergen (wijzigen in de instellingen)';
  panel.dataset.view = view;
  render();
});

setInterval(render, 15000); // aftellers en "bijgewerkt"-tijd bijhouden

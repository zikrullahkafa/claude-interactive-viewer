'use strict';
// Overzicht van de afgelopen weken uit de eigen metingen (en lokale logboeken), als CSV of
// als HTML die main.js naar PDF omzet. Pure functies: geen Electron nodig.

const { productUsage } = require('./history');

const DAY_MS = 86400e3;
const PRODUCTS = [['chat', 'Chats'], ['cowork', 'Cowork'], ['claude_code', 'Claude Code'], ['other', 'Overig']];

const dayStart = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function dayStarts(sinceMs, untilMs) {
  const out = [];
  for (let t = dayStart(sinceMs); t <= untilMs; ) {
    out.push(t);
    const d = new Date(t);
    d.setDate(d.getDate() + 1);
    t = d.getTime();
  }
  return out;
}

/**
 * Per dag: weeklimiet aan het eind van de dag, hoogste 5-uursstand, verbruik per product
 * (procentpunten van de weeklimiet) en lokale API-waarde.
 * @param {object[]} points  metingen {t, f, w, p}
 * @param {object|null} local  tijdlijn uit projectUsage ({starts, series[{values[{cost,tokens}]}]})
 */
function buildDays(points, sinceMs, untilMs, local) {
  const starts = dayStarts(sinceMs, untilMs);
  const prod = Object.fromEntries(productUsage(points, starts, DAY_MS).map((s) => [s.key, s.values]));
  const localByDay = new Map();
  if (local) {
    local.starts.forEach((t, i) => {
      const sum = local.series.reduce((a, s) => ({ cost: a.cost + s.values[i].cost, tokens: a.tokens + s.values[i].tokens }), { cost: 0, tokens: 0 });
      localByDay.set(dayStart(t), sum);
    });
  }
  return starts.map((t, i) => {
    const inDay = points.filter((p) => p.t >= t && p.t < t + DAY_MS);
    const used = Object.fromEntries(PRODUCTS.map(([k]) => [k, prod[k] ? prod[k][i] : 0]));
    return {
      t,
      measured: inDay.length > 0,
      weekEnd: inDay.length ? inDay[inDay.length - 1].w : null,
      fivePeak: inDay.length ? Math.max(...inDay.map((p) => p.f)) : null,
      used,
      usedTotal: Object.values(used).reduce((a, v) => a + v, 0),
      local: localByDay.get(t) || { cost: 0, tokens: 0 },
    };
  });
}

/**
 * Weken volgens je eigen weekreset (uit de huidige resets_at, steeds 7 dagen terug).
 */
function buildWeeks(points, days, weekResetAt, untilMs, count = 4) {
  if (!weekResetAt) return [];
  let end = new Date(weekResetAt).getTime();
  while (end - 7 * DAY_MS > untilMs) end -= 7 * DAY_MS;
  const weeks = [];
  for (let i = 0; i < count; i++) {
    const start = end - 7 * DAY_MS;
    const inWeek = points.filter((p) => p.t >= start && p.t < end);
    const daysIn = days.filter((d) => d.t + DAY_MS > start && d.t < end);
    const used = Object.fromEntries(PRODUCTS.map(([k]) => [k, daysIn.reduce((a, d) => a + d.used[k], 0)]));
    const busiest = daysIn.reduce((b, d) => (d.usedTotal > (b ? b.usedTotal : 0) ? d : b), null);
    weeks.push({
      start, end, current: i === 0,
      maxWeek: inWeek.length ? Math.max(...inWeek.map((p) => p.w)) : null,
      used, busiest: busiest ? busiest.t : null,
      local: daysIn.reduce((a, d) => ({ cost: a.cost + d.local.cost, tokens: a.tokens + d.local.tokens }), { cost: 0, tokens: 0 }),
    });
    end = start;
  }
  return weeks;
}

// Nederlandse Excel: puntkomma als scheidingsteken en een komma als decimaalteken.
const nl = (v, digits = 1) => (v == null ? '' : Number(v).toFixed(digits).replace('.', ','));
const csvCell = (s) => (/[;"\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));

function toCsv(days) {
  const iso = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const head = ['Datum', 'Weeklimiet eind van de dag (%)', 'Hoogste 5-uurslimiet (%)',
    ...PRODUCTS.map(([, n]) => `${n} (% van week)`), 'Totaal verbruikt (% van week)',
    'Lokale API-waarde ($)', 'Lokale tokens'];
  const rows = days.map((d) => [
    iso(d.t), nl(d.weekEnd), nl(d.fivePeak), ...PRODUCTS.map(([k]) => nl(d.used[k])), nl(d.usedTotal),
    nl(d.local.cost, 2), String(d.local.tokens),
  ]);
  // BOM zodat Excel de UTF-8-tekens goed toont.
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toHtml({ days, weeks, folders, plan, generatedAt, firstMeasurement }) {
  const df = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
  const dfl = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const pct = (v) => (v == null ? '–' : `${nl(v, v < 10 ? 1 : 0)}%`);
  const money = (v) => `$${nl(v, 2)}`;
  const colors = { chat: '#2a78d6', cowork: '#eb6834', claude_code: '#1baf7a', other: '#a3a1ab' };
  const bar = (used, scale) => `<div class="bar">${PRODUCTS.map(([k]) => used[k] > 0
    ? `<i style="width:${(used[k] / scale) * 100}%;background:${colors[k]}"></i>` : '').join('')}</div>`;
  const maxDay = Math.max(1, ...days.map((d) => d.usedTotal));
  const legend = PRODUCTS.map(([k, n]) => `<span><i style="background:${colors[k]}"></i>${n}</span>`).join('');

  const weekRows = weeks.map((w) => `<tr>
    <td>${esc(df.format(w.start))} – ${esc(df.format(w.end))}${w.current ? ' <em>(nu)</em>' : ''}</td>
    <td class="n">${pct(w.maxWeek)}</td>
    ${PRODUCTS.slice(0, 3).map(([k]) => `<td class="n">${pct(w.used[k])}</td>`).join('')}
    <td>${w.busiest ? esc(df.format(w.busiest)) : '–'}</td>
    <td class="n">${w.local.cost ? money(w.local.cost) : '–'}</td></tr>`).join('');

  const dayRows = days.slice().reverse().map((d) => `<tr${d.measured ? '' : ' class="dim"'}>
    <td>${esc(df.format(d.t))}</td>
    <td class="n">${pct(d.weekEnd)}</td><td class="n">${pct(d.fivePeak)}</td>
    <td class="n">${pct(d.usedTotal)}</td><td class="barcell">${bar(d.used, maxDay)}</td>
    <td class="n">${d.local.cost ? money(d.local.cost) : '–'}</td></tr>`).join('');

  const folderRows = folders.slice(0, 10).map((f) => `<tr><td>${esc(f.name)} <em>${esc(f.source)}</em></td>
    <td class="n">${money(f.cost)}</td><td class="n">${f.tokens.toLocaleString('nl-NL')}</td><td class="n">${f.sessions}</td></tr>`).join('');

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Claude Meter – overzicht</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font: 10.5pt/1.45 "Segoe UI", -apple-system, Helvetica, Arial, sans-serif; color: #15141a; }
  h1 { font-size: 18pt; margin: 0 0 2pt; } h2 { font-size: 12.5pt; margin: 18pt 0 6pt; }
  .sub { color: #6f6b66; margin-bottom: 10pt; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 9pt; color: #6f6b66; font-weight: 600; border-bottom: 1px solid #d9d7d2; padding: 4pt 5pt; }
  td { padding: 3.5pt 5pt; border-bottom: 1px solid #eeece8; vertical-align: middle; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tr.dim td { color: #a3a1ab; }
  em { color: #6f6b66; font-style: normal; font-size: 9pt; }
  .barcell { width: 32%; } .bar { display: flex; gap: 1px; height: 8pt; }
  .bar i { display: block; height: 100%; border-radius: 1.5pt; }
  .legend { display: flex; gap: 12pt; font-size: 9pt; color: #52514e; margin: 4pt 0; }
  .legend i { display: inline-block; width: 8pt; height: 8pt; border-radius: 2pt; margin-right: 4pt; vertical-align: -1pt; }
  .note { font-size: 8.5pt; color: #6f6b66; margin-top: 16pt; }
  tr { page-break-inside: avoid; }
</style></head><body>
<h1>Claude Meter – overzicht</h1>
<div class="sub">Gemaakt op ${esc(dfl.format(generatedAt))}${plan ? ` · abonnement ${esc(plan)}` : ''}${firstMeasurement ? ` · metingen sinds ${esc(dfl.format(firstMeasurement))}` : ''}</div>

<h2>Per week</h2>
<table><tr><th>Week (tot de reset)</th><th class="n">Weeklimiet</th><th class="n">Chats</th><th class="n">Cowork</th><th class="n">Claude Code</th><th>Drukste dag</th><th class="n">Lokaal (API-waarde)</th></tr>
${weekRows || '<tr><td colspan="7">Nog geen metingen.</td></tr>'}</table>

<h2>Per dag</h2>
<div class="legend">${legend}</div>
<table><tr><th>Dag</th><th class="n">Weeklimiet</th><th class="n">5 uur (piek)</th><th class="n">Verbruikt</th><th>Verdeling</th><th class="n">Lokaal</th></tr>
${dayRows}</table>

${folderRows ? `<h2>Mappen op deze computer (30 dagen)</h2>
<table><tr><th>Map</th><th class="n">API-waarde</th><th class="n">Tokens</th><th class="n">Sessies</th></tr>${folderRows}</table>` : ''}

<p class="note">Percentages zijn van je weeklimiet. Ze komen uit metingen die Claude Meter zelf doet zolang de app
draait; dagen zonder metingen staan grijs. "Lokaal" telt alleen Claude Code- en Cowork-sessies die op deze computer
draaiden, gewogen met de API-prijzen van Anthropic; met een abonnement betaal je die niet.</p>
</body></html>`;
}

module.exports = { buildDays, buildWeeks, toCsv, toHtml };

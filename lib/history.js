'use strict';
// Bewaart bij elke meting de limietpercentages, zodat de widget een verloop kan tekenen.
// Anthropic geeft alleen de huidige stand terug; de geschiedenis bouwen we zelf op.
// Eén JSON-regel per meting in <userData>/limietverloop.jsonl, maximaal 62 dagen terug.

const fs = require('fs');

const KEEP_MS = 62 * 86400e3;
const MIN_GAP_MS = 5 * 60 * 1000; // vaker opslaan voegt niets toe

function createHistory(file) {
  let last = null;

  function read(sinceMs = 0) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const s = JSON.parse(line);
        if (s.t >= sinceMs) out.push(s);
      } catch { /* kapotte regel overslaan */ }
    }
    return out;
  }

  function append(usage, now = Date.now()) {
    if (!usage || !usage.fiveHour || !usage.sevenDay) return false;
    const snap = {
      t: now,
      f: Math.round(usage.fiveHour.percent * 10) / 10,
      w: Math.round(usage.sevenDay.percent * 10) / 10,
    };
    // Verdeling van het weekverbruik over producten (aandelen in procenten).
    if (usage.products && usage.products.rows) {
      snap.p = Object.fromEntries(usage.products.rows.map((r) => [r.key, r.percent]));
    }
    if (last === null) {
      const prev = read(now - KEEP_MS);
      last = prev[prev.length - 1] || {};
      if (prev.length && prev[0].t < now - KEEP_MS + 86400e3) prune(prev);
    }
    const same = last.f === snap.f && last.w === snap.w && JSON.stringify(last.p) === JSON.stringify(snap.p);
    if (same && now - last.t < MIN_GAP_MS * 6) return false; // niets veranderd: hooguit elk half uur
    if (!same && now - last.t < MIN_GAP_MS && last.t) return false;
    try {
      fs.appendFileSync(file, `${JSON.stringify(snap)}\n`);
      last = snap;
      return true;
    } catch {
      return false;
    }
  }

  // Oude metingen weggooien zodat het bestand niet blijft groeien.
  function prune(prev) {
    const keep = prev.filter((s) => s.t >= Date.now() - KEEP_MS);
    try {
      fs.writeFileSync(file, keep.map((s) => JSON.stringify(s)).join('\n') + (keep.length ? '\n' : ''));
    } catch { /* volgende keer opnieuw */ }
  }

  return { read, append };
}

// Hoeveel procent van de weeklimiet elk product per bakje (uur of dag) verbruikte.
// Per meting: weekpercentage x aandeel van het product = absoluut verbruik van dat product deze week.
// Het verschil met de vorige meting is het verbruik in die tussentijd; na een weekreset telt alles opnieuw.
function productUsage(points, starts, bucketMs) {
  const keys = [];
  const series = new Map();
  const idx = (t) => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > t) i--;
    return t >= starts[0] && t < starts[starts.length - 1] + bucketMs ? i : -1;
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!b.p) continue;
    const reset = b.w < a.w - 1; // weekreset tussen deze twee metingen
    const bi = idx(b.t);
    if (bi < 0) continue;
    for (const [key, share] of Object.entries(b.p)) {
      const now = (b.w * share) / 100;
      const before = !reset && a.p && a.p[key] != null ? (a.w * a.p[key]) / 100 : reset ? 0 : now;
      const delta = Math.max(0, now - before);
      if (!series.has(key)) {
        series.set(key, new Array(starts.length).fill(0));
        keys.push(key);
      }
      series.get(key)[bi] += delta;
    }
  }
  return keys.map((key) => ({ key, values: series.get(key).map((v) => Math.round(v * 10) / 10) }));
}

const BLOCK_H = 2; // uren per vakje in de heatmap
const MAX_GAP_MS = 6 * 3600e3; // langer geen metingen: niet te zeggen wanneer het verbruik viel

/**
 * Patronen uit de eigen metingen:
 *  - heat[dag 0=ma..6=zo][blok 0..11]: verbruikte procentpunten weeklimiet per dag/tijdvak
 *  - vergelijking van deze week met vorige week op hetzelfde moment na de reset
 * @param {object[]} points  metingen {t, w}
 * @param {string|null} weekResetAt  resets_at van de huidige week (uit de laatste meting)
 */
function patterns(points, weekResetAt, now = Date.now()) {
  const heat = Array.from({ length: 7 }, () => new Array(24 / BLOCK_H).fill(0));
  let covered = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.t - a.t > MAX_GAP_MS) continue;
    covered += b.t - a.t;
    const delta = b.w < a.w - 1 ? b.w : Math.max(0, b.w - a.w); // na een weekreset telt alles opnieuw
    if (!delta) continue;
    const d = new Date(b.t);
    heat[(d.getDay() + 6) % 7][Math.floor(d.getHours() / BLOCK_H)] += delta;
  }

  let compare = null;
  if (weekResetAt && points.length) {
    const weekStart = new Date(weekResetAt).getTime() - 7 * 86400e3;
    const ref = now - 7 * 86400e3; // zelfde moment vorige week
    const near = points.reduce((best, p) => (Math.abs(p.t - ref) < Math.abs((best ? best.t : Infinity) - ref) ? p : best), null);
    const prevWeek = points.filter((p) => p.t < weekStart && p.t >= weekStart - 7 * 86400e3);
    compare = {
      now: points[points.length - 1].w,
      lastWeekSameTime: near && Math.abs(near.t - ref) < 3 * 3600e3 && near.t < weekStart ? near.w : null,
      lastWeekTotal: prevWeek.length ? Math.max(...prevWeek.map((p) => p.w)) : null,
    };
  }
  return { heat, blockHours: BLOCK_H, coveredDays: covered / 86400e3, compare };
}

module.exports = { createHistory, productUsage, patterns };

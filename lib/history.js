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
    if (last === null) {
      const prev = read(now - KEEP_MS);
      last = prev[prev.length - 1] || {};
      if (prev.length && prev[0].t < now - KEEP_MS + 86400e3) prune(prev);
    }
    const same = last.f === snap.f && last.w === snap.w;
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

module.exports = { createHistory };

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHistory } = require('../lib/history');

const u = (f, w) => ({ fiveHour: { percent: f }, sevenDay: { percent: w } });

test('slaat metingen op, niet vaker dan nodig', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-h-')), 'h.jsonl');
  const h = createHistory(file);
  const t0 = Date.now();
  assert.strictEqual(h.append(u(5, 29), t0), true);
  assert.strictEqual(h.append(u(6, 29), t0 + 60e3), false); // te snel na de vorige
  assert.strictEqual(h.append(u(6, 29), t0 + 6 * 60e3), true);
  assert.strictEqual(h.append(u(6, 29), t0 + 12 * 60e3), false); // onveranderd
  assert.strictEqual(h.append(u(6, 29), t0 + 40 * 60e3), true); // onveranderd, maar half uur later
  assert.strictEqual(h.append(null, t0 + 50 * 60e3), false);
  const all = createHistory(file).read(0);
  assert.deepStrictEqual(all.map((s) => [s.f, s.w]), [[5, 29], [6, 29], [6, 29]]);
  assert.strictEqual(createHistory(file).read(t0 + 1).length, 2);
});

test('verbruik per product per dag, ook over een weekreset heen', () => {
  const { productUsage } = require('../lib/history');
  const D = 86400e3;
  const t0 = Date.parse('2026-10-20T00:00:00');
  const starts = [t0, t0 + D, t0 + 2 * D];
  const points = [
    { t: t0 + 1e6, w: 10, p: { chat: 50, cowork: 50 } }, // 5% chat, 5% cowork
    { t: t0 + 2e6, w: 20, p: { chat: 25, cowork: 75 } }, // 5% chat, 15% cowork: +0 chat, +10 cowork
    { t: t0 + D + 1e6, w: 40, p: { chat: 50, cowork: 50 } }, // 20/20: +15 chat, +5 cowork
    { t: t0 + 2 * D + 1e6, w: 4, p: { chat: 100, cowork: 0 } }, // reset: +4 chat
  ];
  const r = productUsage(points, starts, D);
  const byKey = Object.fromEntries(r.map((s) => [s.key, s.values]));
  assert.deepStrictEqual(byKey.chat, [0, 15, 4]);
  assert.deepStrictEqual(byKey.cowork, [10, 5, 0]);
});

test('patronen: heatmap per dag en tijdvak, vergelijking met vorige week', () => {
  const { patterns } = require('../lib/history');
  const D = 86400e3;
  // maandag 19 okt 2026, lokale tijd
  const mon = new Date(2026, 9, 19, 0, 0, 0).getTime();
  const reset = new Date(mon + 7 * D + 9 * 3600e3).toISOString(); // huidige week: ma 26 okt 09:00 reset
  const pts = [
    { t: mon - 6 * D + 10 * 3600e3, w: 10 }, // vorige week di
    { t: mon - 6 * D + 11 * 3600e3, w: 30 },
    { t: mon + 9.5 * 3600e3, w: 2 }, // na reset (ma 19 okt 09:00): telt als 2
    { t: mon + 10.5 * 3600e3, w: 7 }, // ma 10:30: +5
    { t: mon + D + 15 * 3600e3, w: 20 }, // gat > 6 uur: niet meegeteld
    { t: mon + D + 16 * 3600e3, w: 26 }, // di 16:00: +6
  ];
  const r = patterns(pts, reset, mon + D + 16 * 3600e3);
  assert.strictEqual(r.heat[0][4], 0); // ma 09:30: gat van dagen ervoor, dus niet toe te wijzen
  assert.strictEqual(r.heat[0][5], 5); // ma 10-12
  assert.strictEqual(r.heat[1][8], 6); // di 16-18
  assert.strictEqual(r.heat[1][5], 20); // vorige week di 10-12
  assert.strictEqual(r.compare.now, 26);
  assert.strictEqual(r.compare.lastWeekTotal, 30);
  assert.strictEqual(r.compare.lastWeekSameTime, null); // geen meting precies een week eerder
});

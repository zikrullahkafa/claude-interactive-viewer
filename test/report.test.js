'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildDays, buildWeeks, toCsv, toHtml } = require('../lib/report');

const D = 86400e3;
const d0 = new Date(2026, 9, 19).getTime(); // maandag 19 okt, lokale tijd
const points = [
  { t: d0 + 9 * 3600e3, f: 10, w: 10, p: { chat: 50, cowork: 50 } },
  { t: d0 + 10 * 3600e3, f: 30, w: 20, p: { chat: 50, cowork: 50 } }, // +5 chat, +5 cowork
  { t: d0 + D + 9 * 3600e3, f: 5, w: 20, p: { chat: 50, cowork: 50 } },
  { t: d0 + D + 10 * 3600e3, f: 15, w: 30, p: { chat: 20, cowork: 80 } }, // chat 10->6 (0), cowork 10->24 (+14)
];

test('dagen en weken uit metingen', () => {
  const local = { starts: [d0, d0 + D, d0 + 2 * D], series: [{ values: [{ cost: 1.5, tokens: 100 }, { cost: 0, tokens: 0 }, { cost: 0, tokens: 0 }] }] };
  const days = buildDays(points, d0, d0 + 2 * D + 1, local);
  assert.strictEqual(days.length, 3);
  assert.deepStrictEqual([days[0].weekEnd, days[0].fivePeak, days[0].used.chat, days[0].used.cowork], [20, 30, 5, 5]);
  assert.deepStrictEqual([days[1].used.chat, days[1].used.cowork], [0, 14]);
  assert.strictEqual(days[0].local.cost, 1.5);
  assert.strictEqual(days[2].measured, false);

  const reset = new Date(d0 + 6 * D + 9 * 3600e3).toISOString(); // zondag 09:00
  const weeks = buildWeeks(points, days, reset, d0 + 2 * D, 2);
  assert.strictEqual(weeks.length, 2);
  assert.strictEqual(weeks[0].maxWeek, 30);
  assert.strictEqual(weeks[0].used.cowork, 19);
  assert.strictEqual(weeks[0].busiest, d0 + D);
  assert.strictEqual(weeks[1].maxWeek, null);

  const csv = toCsv(days);
  assert.ok(csv.startsWith('﻿Datum;'));
  assert.match(csv, /2026-10-19;20,0;30,0;5,0;5,0;0,0;0,0;10,0;1,50;100/);

  const html = toHtml({ days, weeks, folders: [{ name: 'Map <x>', source: 'Code', cost: 1.5, tokens: 100, sessions: 1 }], plan: 'pro', generatedAt: new Date(), firstMeasurement: points[0].t });
  assert.match(html, /Per week/);
  assert.match(html, /Map &lt;x&gt;/); // namen worden ge-escaped
});

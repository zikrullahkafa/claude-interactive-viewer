'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { evaluate, pruneSent } = require('../lib/alerts');

const NOW = Date.parse('2026-10-24T12:00:00Z');
const H = 3600e3;
const usage = (f, w, extra = {}) => ({
  fiveHour: { percent: f, resetsAt: new Date(NOW + 2 * H).toISOString() },
  sevenDay: { percent: w, resetsAt: new Date(NOW + 1 * 86400e3).toISOString() },
  ...extra,
});
const keys = (list) => list.map((a) => a.kind);
const sentFrom = (list) => Object.fromEntries(list.map((x) => [x.key, NOW]));

test('drempels 5 uur en week, één keer per venster', () => {
  const a = evaluate(null, usage(85, 20), undefined, {}, NOW);
  assert.deepStrictEqual(keys(a), ['5h:80']);
  const sent = sentFrom(a);
  assert.deepStrictEqual(evaluate(null, usage(86, 20), undefined, sent, NOW), []);
  assert.deepStrictEqual(keys(evaluate(null, usage(92, 91), undefined, sent, NOW)), ['5h:90', 'wk:80', 'wk:90']);
});

test('tempo: waarschuwen als de week te snel opraakt', () => {
  // 6 van de 7 dagen voorbij en 95%: haalt het net niet, maar >= 90% -> geen tempo-melding meer
  assert.deepStrictEqual(keys(evaluate(null, usage(0, 95), { week: false }, {}, NOW)), []);
  // halverwege de week al op 70% -> 140% verwacht
  const mid = { fiveHour: null, sevenDay: { percent: 70, resetsAt: new Date(NOW + 3.5 * 86400e3).toISOString() } };
  assert.deepStrictEqual(keys(evaluate(null, mid, undefined, {}, NOW)), ['pace']);
});

test('resets, nieuwe velden en verlopend tegoed', () => {
  const prev = { fiveHour: { percent: 95, resetsAt: 'oud' }, sevenDay: { percent: 60, resetsAt: 'oudw' } };
  const curr = usage(3, 2, {
    newFields: [{ key: 'amber_cistern_offer' }],
    other: [{ key: 'iguana_necktie', label: 'Cloudsessietegoed', expires: true, remainingDollars: 91.25, resetsAt: new Date(NOW + 2 * 86400e3).toISOString() }],
  });
  assert.deepStrictEqual(keys(evaluate(prev, curr, undefined, {}, NOW)), ['reset5h', 'resetwk', 'news:amber_cistern_offer', 'credit:iguana_necktie']);
  assert.deepStrictEqual(evaluate(prev, curr, { reset: false, news: false, credit: false }, {}, NOW), []);
});

// Zoals Anthropic de resettijd stuurt: tot op de microseconde, elke meting een fractie anders.
const iso = (ms, micro) => new Date(ms).toISOString().replace(/\.\d+Z$/, `.${micro}+00:00`);

test('verschuivende resettijd: geen nieuwe melding binnen hetzelfde venster', () => {
  const at = NOW + 2 * H - 1;
  const m = (pct, micro) => ({ fiveHour: { percent: pct, resetsAt: iso(at, micro) }, sevenDay: { percent: 85, resetsAt: iso(NOW + 86400e3 - 1, micro) } });
  const first = evaluate(null, m(81, '943648'), undefined, {}, NOW);
  assert.deepStrictEqual(keys(first), ['5h:80', 'wk:80']);
  let sent = sentFrom(first);
  // Volgende metingen: zelfde venster, resettijd een fractie anders.
  for (const micro of ['512301', '999999', '000417']) {
    assert.deepStrictEqual(evaluate(null, m(83, micro), undefined, sent, NOW + 3 * 60e3), []);
  }
  // Pas bij 90% de volgende drempel, en die ook maar één keer.
  const ninety = evaluate(null, m(91, '120000'), undefined, sent, NOW);
  assert.deepStrictEqual(keys(ninety), ['5h:90']);
  sent = { ...sent, ...sentFrom(ninety) };
  assert.deepStrictEqual(evaluate(null, m(92, '777777'), undefined, sent, NOW), []);
  // Nieuw 5-uursvenster (5 uur later): weer een melding bij 80%.
  const next = { ...m(82, '100000'), fiveHour: { percent: 82, resetsAt: iso(at + 5 * H, '100000') } };
  assert.deepStrictEqual(keys(evaluate(null, next, undefined, sent, NOW + 5 * H)), ['5h:80']);
});

test('meldingen van vóór deze versie tellen mee', () => {
  const sent = { '5h:80:2026-10-24T14:00:00.000Z': NOW, 'wk:80:2026-10-25T12:00:00.000Z': NOW };
  const curr = { fiveHour: { percent: 84, resetsAt: '2026-10-24T13:59:59.943648+00:00' }, sevenDay: { percent: 81, resetsAt: '2026-10-25T11:59:59.943679+00:00' } };
  assert.deepStrictEqual(evaluate(null, curr, undefined, sent, NOW), []);
});

test('reset: niet door een verschuivende resettijd, wel bij een nieuw venster', () => {
  const prev = { fiveHour: { percent: 95, resetsAt: '2026-10-24T13:59:59.943648+00:00' }, sevenDay: { percent: 60, resetsAt: '2026-10-25T11:59:59.943679+00:00' } };
  const jitter = { fiveHour: { percent: 94, resetsAt: '2026-10-24T13:59:59.512000+00:00' }, sevenDay: { percent: 59, resetsAt: '2026-10-25T11:59:59.512000+00:00' } };
  const only = { fiveHour: false, week: false, pace: false }; // alleen resets bekijken
  assert.deepStrictEqual(evaluate(prev, jitter, only, {}, NOW), []);
  const idle = { fiveHour: { percent: 0, resetsAt: null }, sevenDay: prev.sevenDay };
  const reset = evaluate(prev, idle, only, {}, NOW + 2 * H);
  assert.deepStrictEqual(keys(reset), ['reset5h']);
  assert.deepStrictEqual(evaluate(prev, idle, only, sentFrom(reset), NOW + 2 * H), [], 'één keer');
});

test('oude sleutels verdwijnen', () => {
  assert.deepStrictEqual(pruneSent({ a: NOW - 20 * 86400e3, b: NOW - 86400e3 }, NOW), { b: NOW - 86400e3 });
});

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
const keys = (list) => list.map((a) => a.key.split(':')[0] + ':' + (a.key.split(':')[1] || ''));

test('drempels 5 uur en week, één keer per venster', () => {
  const a = evaluate(null, usage(85, 20), undefined, {}, NOW);
  assert.deepStrictEqual(keys(a), ['5h:80']);
  const sent = Object.fromEntries(a.map((x) => [x.key, NOW]));
  assert.deepStrictEqual(evaluate(null, usage(86, 20), undefined, sent, NOW), []);
  assert.deepStrictEqual(keys(evaluate(null, usage(92, 91), undefined, sent, NOW)), ['5h:90', 'wk:80', 'wk:90']);
});

test('tempo: waarschuwen als de week te snel opraakt', () => {
  // 6 van de 7 dagen voorbij en 95%: haalt het net niet, maar >= 90% -> geen tempo-melding meer
  assert.deepStrictEqual(keys(evaluate(null, usage(0, 95), { week: false }, {}, NOW)), []);
  // halverwege de week al op 70% -> 140% verwacht
  const mid = { fiveHour: null, sevenDay: { percent: 70, resetsAt: new Date(NOW + 3.5 * 86400e3).toISOString() } };
  assert.deepStrictEqual(keys(evaluate(null, mid, undefined, {}, NOW)), ['pace:2026-10-28T00']);
});

test('resets, nieuwe velden en verlopend tegoed', () => {
  const prev = { fiveHour: { percent: 95, resetsAt: 'oud' }, sevenDay: { percent: 60, resetsAt: 'oudw' } };
  const curr = usage(3, 2, {
    newFields: [{ key: 'amber_cistern_offer' }],
    other: [{ key: 'iguana_necktie', label: 'Cloudsessietegoed', expires: true, remainingDollars: 91.25, resetsAt: new Date(NOW + 2 * 86400e3).toISOString() }],
  });
  assert.deepStrictEqual(keys(evaluate(prev, curr, undefined, {}, NOW)), ['reset5h:2026-10-24T14', 'resetwk:2026-10-25T12', 'news:amber_cistern_offer', 'credit:iguana_necktie']);
  assert.deepStrictEqual(evaluate(prev, curr, { reset: false, news: false, credit: false }, {}, NOW), []);
});

test('oude sleutels verdwijnen', () => {
  assert.deepStrictEqual(pruneSent({ a: NOW - 20 * 86400e3, b: NOW - 86400e3 }, NOW), { b: NOW - 86400e3 });
});

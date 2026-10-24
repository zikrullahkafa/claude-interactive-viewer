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

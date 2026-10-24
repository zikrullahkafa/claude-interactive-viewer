'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { ringsFor, drawRings, ringPng, trayTitle, statusKey, crc32 } = require('../lib/trayicon');

const usage = { fiveHour: { percent: 77.4 }, sevenDay: { percent: 61 } };

test('tekst voor de menubalk', () => {
  assert.strictEqual(trayTitle(usage, 'both'), '5u 77% · wk 61%');
  assert.strictEqual(trayTitle(usage, 'fiveHour'), '5u 77%');
  assert.strictEqual(trayTitle(usage, 'sevenDay'), 'wk 61%');
  assert.strictEqual(trayTitle(usage, 'off'), '');
  assert.strictEqual(trayTitle(null, 'both'), '');
  assert.strictEqual(trayTitle({ fiveHour: null, sevenDay: { percent: 5 } }, 'both'), 'wk 5%');
});

test('ringen: buiten de week, binnen de 5 uur; niets zonder gegevens', () => {
  const both = ringsFor(usage, 'both');
  assert.deepStrictEqual(both.map((r) => r.percent), [61, 77]);
  assert.ok(both[0].r > both[1].r);
  assert.strictEqual(ringsFor(usage, 'fiveHour').length, 1);
  assert.strictEqual(ringsFor(usage, 'off'), null);
  assert.strictEqual(ringsFor(null, 'both'), null);
  assert.strictEqual(ringsFor({ fiveHour: null, sevenDay: null }, 'both'), null);
});

test('ring vult met de klok mee vanaf 12 uur, in de kleur van het niveau', () => {
  const size = 32;
  const px = drawRings(size, [{ percent: 61, r: 0.34, w: 0.26 }]);
  const at = (x, y) => Array.from(px.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
  const mid = Math.round(size / 2 + 0.34 * size); // op de ring
  const right = at(mid, 16); // 3 uur: gevuld (25% < 61%)
  const left = at(size - 1 - mid, 16); // 9 uur: leeg (75% > 61%)
  assert.deepStrictEqual(right, [245, 158, 11, 255]); // oranje: 50–80%
  assert.ok(left[3] > 0 && left[3] < 255, 'grijze, half doorzichtige baan');
  assert.strictEqual(at(16, 16)[3], 0, 'midden blijft doorzichtig');
  assert.strictEqual(at(0, 0)[3], 0, 'hoek blijft doorzichtig');
});

test('geldige PNG op de gevraagde grootte', () => {
  assert.strictEqual(crc32(Buffer.from('IEND')), 0xae426082);
  for (const size of [16, 20, 24, 32]) {
    const png = ringPng(usage, 'both', size);
    assert.deepStrictEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.strictEqual(png.readUInt32BE(16), size);
    assert.strictEqual(png.readUInt32BE(20), size);
    const idatLen = png.readUInt32BE(33);
    assert.strictEqual(png.toString('ascii', 37, 41), 'IDAT');
    const rows = zlib.inflateSync(png.subarray(41, 41 + idatLen));
    assert.strictEqual(rows.length, (size * 4 + 1) * size);
  }
  assert.strictEqual(ringPng(usage, 'off', 16), null);
});

test('sleutel verandert alleen bij een andere stand', () => {
  assert.strictEqual(statusKey(usage, 'both'), statusKey({ fiveHour: { percent: 77.2 }, sevenDay: { percent: 61 } }, 'both'));
  assert.notStrictEqual(statusKey(usage, 'both'), statusKey(usage, 'fiveHour'));
  assert.notStrictEqual(statusKey(usage, 'both'), statusKey(null, 'both'));
});

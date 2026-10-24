'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toAccelerator, displayAccelerator } = require('../lib/shortcut');
const { inQuietHours } = require('../lib/alerts');

const k = (code, mods = {}) => ({ code, ctrl: false, alt: false, shift: false, meta: false, ...mods });

test('toetscombinatie naar sneltoets', () => {
  assert.deepStrictEqual(toAccelerator(k('KeyM', { ctrl: true, shift: true }), 'win32'), { accelerator: 'Control+Shift+M' });
  assert.deepStrictEqual(toAccelerator(k('Digit1', { meta: true, alt: true }), 'darwin'), { accelerator: 'Command+Alt+1' });
  assert.deepStrictEqual(toAccelerator(k('F9'), 'win32'), { accelerator: 'F9' }); // functietoets mag alleen
  assert.ok(toAccelerator(k('KeyU', { shift: true }), 'win32').error); // alleen Shift: te riskant
  assert.ok(toAccelerator(k('ControlLeft', { ctrl: true }), 'win32').error); // alleen een modifier
});

test('sneltoets leesbaar maken', () => {
  assert.strictEqual(displayAccelerator('CommandOrControl+Alt+U', 'win32'), 'Ctrl + Alt + U');
  assert.strictEqual(displayAccelerator('CommandOrControl+Alt+U', 'darwin'), '⌘⌥U');
  assert.strictEqual(displayAccelerator('none', 'win32'), 'Geen');
});

test('stille uren, ook over middernacht', () => {
  const at = (h, m = 0) => new Date(2026, 9, 24, h, m);
  const night = { enabled: true, from: '22:00', to: '08:00' };
  assert.strictEqual(inQuietHours(night, at(23)), true);
  assert.strictEqual(inQuietHours(night, at(7, 59)), true);
  assert.strictEqual(inQuietHours(night, at(8)), false);
  assert.strictEqual(inQuietHours(night, at(12)), false);
  assert.strictEqual(inQuietHours({ enabled: true, from: '12:00', to: '13:00' }, at(12, 30)), true);
  assert.strictEqual(inQuietHours({ ...night, enabled: false }, at(23)), false);
  assert.strictEqual(inQuietHours({ enabled: true, from: 'x', to: '08:00' }, at(23)), false);
});

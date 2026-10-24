'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { install, removeOurs, MARKER } = require('../scripts/hook');

const other = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo hallo' }] };

test('install is idempotent en laat andere hooks staan', () => {
  const s = install(install({ model: 'opus', hooks: { SessionStart: [structuredClone(other)] } }));
  assert.strictEqual(s.model, 'opus');
  assert.strictEqual(s.hooks.SessionStart.length, 2);
  const ours = s.hooks.SessionStart.filter((g) => g.hooks.some((h) => h.command.includes(MARKER)));
  assert.strictEqual(ours.length, 1);
  assert.strictEqual(ours[0].matcher, 'startup|resume');
});

test('uninstall verwijdert alleen onze hook', () => {
  const s = removeOurs(install({ hooks: { SessionStart: [structuredClone(other)] } }));
  assert.deepStrictEqual(s.hooks.SessionStart, [other]);
  assert.deepStrictEqual(removeOurs(install({})), {});
});

test('eigen commando en status', () => {
  const { isInstalled } = require('../scripts/hook');
  const s = install({}, '"C:/Program Files/Claude Meter/Claude Meter.exe" --launch --claude-usage-widget');
  assert.strictEqual(isInstalled(s), true);
  assert.match(s.hooks.SessionStart[0].hooks[0].command, /--launch/);
  assert.strictEqual(isInstalled(removeOurs(s)), false);
});

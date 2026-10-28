'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { startWatcher, watcherScript } = require('../lib/fullscreen');

// Nagemaakt PowerShell-proces: wat het "schrijft", komt via stdout binnen.
function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => (child.killed = true);
  return { spawnFn: (cmd, args, opts) => Object.assign(child, { cmd, args, opts }), child };
}

test('meldt alleen wisselingen tussen volledig scherm en niet', () => {
  const { spawnFn, child } = fakeSpawn();
  const seen = [];
  const w = startWatcher((full, state) => seen.push([full, state]), { pid: 1234, spawnFn });
  assert.strictEqual(child.cmd, 'powershell.exe');
  assert.ok(child.opts.windowsHide);
  for (const chunk of ['5\r\n', '2\r', '\n3\r\n', '4\r\n', '5\r\n', '7\r\n', '6\r\n', 'onzin\r\n', '3\r\n']) child.stdout.emit('data', chunk);
  // 7 (Store-app op de voorgrond, zoals de Claude-app) en 6 (stille uren) tellen niet als volledig scherm.
  assert.deepStrictEqual(seen, [[false, 5], [true, 2], [false, 5], [true, 3]]);
  w.stop();
  assert.ok(child.killed);
});

test('script controleert de app en de status', () => {
  const script = watcherScript(4321, 1500);
  assert.match(script, /Get-Process -Id 4321/);
  assert.match(script, /SHQueryUserNotificationState/);
  assert.match(script, /Start-Sleep -Milliseconds 1500/);
});

// Op Windows (ook op de GitHub-buildmachine): het echte PowerShell-lusje draaien.
test('Windows: echte controle geeft een status en stopt als de app stopt', { skip: process.platform !== 'win32' && 'alleen op Windows', timeout: 60000 }, async () => {
  const app = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)']); // "Claude Meter"
  const states = [];
  const w = startWatcher((full, state) => states.push(state), { pid: app.pid, intervalMs: 300 });
  const exited = new Promise((resolve) => w.child.on('exit', resolve));
  const deadline = Date.now() + 40000;
  while (!states.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  assert.ok(states.length >= 1, 'geen status ontvangen');
  assert.ok(Number.isInteger(states[0]), String(states[0]));
  app.kill();
  const t = Date.now();
  await exited;
  assert.ok(Date.now() - t < 15000, 'lusje stopt na de app');
});

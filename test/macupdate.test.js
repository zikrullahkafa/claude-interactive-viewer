'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const mac = require('../lib/macupdate');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-update-'));
const noShell = process.platform === 'win32' ? 'geen /bin/sh op Windows' : false;

// Nep-commando's vooraan in PATH (open, xattr; op Linux ook hdiutil, ditto en defaults).
function stubs(dir, scripts) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  return `${dir}${path.delimiter}${process.env.PATH}`;
}

test('latest-mac.yml lezen', () => {
  const yml = `version: 1.5.0
files:
  - url: Claude-Meter-1.5.0.dmg
    sha512: lV8WUg/DKnqv8kCbILiwkF8CU6l4H3dM0gsQmEbEJYgvYm39ys+JyeboXhEi6wQQCm0rYqsCBOwKFBJES0IkXQ==
    size: 232167119
path: Claude-Meter-1.5.0.dmg
sha512: lV8WUg/DKnqv8kCbILiwkF8CU6l4H3dM0gsQmEbEJYgvYm39ys+JyeboXhEi6wQQCm0rYqsCBOwKFBJES0IkXQ==
releaseDate: '2026-10-24T19:43:19.662Z'
`;
  assert.deepStrictEqual(mac.parseLatestYml(yml), {
    version: '1.5.0',
    path: 'Claude-Meter-1.5.0.dmg',
    sha512: 'lV8WUg/DKnqv8kCbILiwkF8CU6l4H3dM0gsQmEbEJYgvYm39ys+JyeboXhEi6wQQCm0rYqsCBOwKFBJES0IkXQ==',
  });
  assert.deepStrictEqual(mac.parseLatestYml(''), { version: null, path: null, sha512: null });
});

test('pad van de app en of hij zichzelf mag vervangen', () => {
  assert.strictEqual(mac.bundlePath('/Applications/Claude Meter.app/Contents/MacOS/Claude Meter'), '/Applications/Claude Meter.app');
  assert.strictEqual(mac.bundlePath('C:/Program Files/Claude Meter/Claude Meter.exe'), null);
  const dir = tmp();
  const app = path.join(dir, 'Claude Meter.app');
  fs.mkdirSync(app);
  assert.strictEqual(mac.canReplace(app), true);
  assert.strictEqual(mac.canReplace(path.join(dir, 'bestaat-niet.app')), false);
  assert.strictEqual(mac.canReplace('/private/var/folders/x/AppTranslocation/y/Claude Meter.app'), false);
  assert.strictEqual(mac.canReplace('/Volumes/Claude Meter/Claude Meter.app'), false);
  assert.strictEqual(mac.canReplace(null), false);
});

test('download met controlesom en voortgang', async () => {
  const body = crypto.randomBytes(300 * 1024);
  const sha = crypto.createHash('sha512').update(body).digest('base64');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/app.dmg`;
  const dir = tmp();
  try {
    const progress = [];
    await mac.download(url, path.join(dir, 'a.dmg'), sha, (f) => progress.push(f));
    assert.ok(fs.readFileSync(path.join(dir, 'a.dmg')).equals(body));
    assert.strictEqual(progress.at(-1), 1);
    await assert.rejects(mac.download(url, path.join(dir, 'b.dmg'), 'fout', null), /controlesom/);
    assert.strictEqual(fs.existsSync(path.join(dir, 'b.dmg')), false, 'kapotte download wordt verwijderd');
    await assert.rejects(mac.download(url, path.join(dir, 'c.dmg'), null, null), /controlesom/);
  } finally {
    server.close();
  }
});

// Maakt een nep-app met een Info.plist voor `version`.
function fakeApp(dir, version, marker) {
  const app = path.join(dir, 'Claude Meter.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>
`);
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Claude Meter'), marker);
  return app;
}

test('app uit de dmg halen (nagebootst)', { skip: noShell || (process.platform === 'darwin' && 'op de Mac draait de echte test') }, async () => {
  const dir = tmp();
  const src = path.join(dir, 'bron');
  fakeApp(src, '9.9.9', 'nieuw');
  const log = path.join(dir, 'log');
  const oldPath = process.env.PATH;
  process.env.PATH = stubs(path.join(dir, 'bin'), {
    hdiutil: `echo "hdiutil $1" >> "${log}"
if [ "$1" = attach ]; then for a; do M="$P"; P="$a"; done; mkdir -p "$M"; cp -R "${src}/." "$M/"; fi`,
    ditto: 'cp -R "$1" "$2"',
    defaults: `sed -n 's:.*<string>\\(.*\\)</string>.*:\\1:p' "$2.plist"`,
  });
  try {
    const work = mac.freshWorkDir(dir);
    fs.writeFileSync(path.join(work, 'x.dmg'), '');
    const target = await mac.stageFromDmg(path.join(work, 'x.dmg'), work, '9.9.9');
    assert.strictEqual(fs.readFileSync(path.join(target, 'Contents', 'MacOS', 'Claude Meter'), 'utf8'), 'nieuw');
    await assert.rejects(mac.stageFromDmg(path.join(work, 'x.dmg'), mac.freshWorkDir(dir), '1.0.0'), /versie 9\.9\.9/);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.deepStrictEqual(calls, ['hdiutil attach', 'hdiutil detach', 'hdiutil attach', 'hdiutil detach'], 'dmg wordt altijd weer losgekoppeld');
  } finally {
    process.env.PATH = oldPath;
  }
});

test('app uit een echte dmg halen', { skip: process.platform !== 'darwin' && 'alleen op de Mac' }, async () => {
  const dir = tmp();
  const src = path.join(dir, 'bron');
  fakeApp(src, '9.9.9', 'nieuw');
  const dmg = path.join(dir, 'test.dmg');
  execFileSync('hdiutil', ['create', '-quiet', '-srcfolder', src, '-volname', 'Claude Meter', '-format', 'UDZO', dmg]);
  const work = mac.freshWorkDir(dir);
  const target = await mac.stageFromDmg(dmg, work, '9.9.9');
  assert.strictEqual(fs.readFileSync(path.join(target, 'Contents', 'MacOS', 'Claude Meter'), 'utf8'), 'nieuw');
  assert.strictEqual(fs.readdirSync(path.join(work, 'dmg')).length, 0, 'dmg is losgekoppeld');
});

function runInstall(dir, { removeNew = false } = {}) {
  const apps = path.join(dir, 'Applications');
  fs.mkdirSync(apps);
  const appPath = fakeApp(apps, '1.0.0', 'oud');
  const work = path.join(dir, 'werk');
  const newApp = removeNew ? path.join(work, 'weg.app') : fakeApp(work, '2.0.0', 'nieuw');
  fs.mkdirSync(work, { recursive: true });
  const script = path.join(work, 'installeren.sh');
  fs.writeFileSync(script, mac.INSTALL_SCRIPT, { mode: 0o755 });
  const log = path.join(dir, 'open.log');
  const env = { ...process.env, PATH: stubs(path.join(dir, 'bin'), { open: `echo "$1" >> "${log}"`, xattr: 'exit 0' }) };
  // "De app" die eerst moet stoppen; los van dit proces gestart, zodat hij na afloop echt weg is.
  const pid = execFileSync('/bin/sh', ['-c', 'sleep 0.4 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).trim();
  const t0 = Date.now();
  execFileSync('/bin/sh', [script, pid, appPath, newApp, work], { env });
  return { apps, appPath, work, log, waited: Date.now() - t0 };
}

test('installatiescript: wacht, wisselt om en start opnieuw', { skip: noShell }, () => {
  const r = runInstall(tmp());
  assert.ok(r.waited >= 300 && r.waited < 10000, `wacht tot de app gestopt is (${r.waited} ms)`);
  assert.strictEqual(fs.readFileSync(path.join(r.appPath, 'Contents', 'MacOS', 'Claude Meter'), 'utf8'), 'nieuw');
  assert.deepStrictEqual(fs.readdirSync(r.apps), ['Claude Meter.app'], 'oude versie opgeruimd');
  assert.strictEqual(fs.readFileSync(r.log, 'utf8').trim(), r.appPath, 'nieuwe app gestart');
  assert.strictEqual(fs.existsSync(r.work), false, 'werkmap opgeruimd');
});

test('installatiescript: bij een fout blijft de oude app staan', { skip: noShell }, () => {
  const r = runInstall(tmp(), { removeNew: true });
  assert.strictEqual(fs.readFileSync(path.join(r.appPath, 'Contents', 'MacOS', 'Claude Meter'), 'utf8'), 'oud');
  assert.deepStrictEqual(fs.readdirSync(r.apps), ['Claude Meter.app']);
  assert.strictEqual(fs.readFileSync(r.log, 'utf8').trim(), r.appPath, 'oude app weer gestart');
});

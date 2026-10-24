'use strict';
// Zelf bijwerken op de Mac, zonder betaald Apple-certificaat.
// electron-updater (Squirrel.Mac) eist een echte ondertekening; daarom doen we het hier zelf:
// 1. de .dmg van de nieuwste release downloaden en de sha512 uit latest-mac.yml controleren;
// 2. de dmg koppelen (hdiutil), de app eruit kopiëren (ditto) en de versie nakijken;
// 3. na klikken: een los shellscript wacht tot de app gestopt is, zet de nieuwe app op de plek
//    van de oude (bij een fout komt de oude terug) en start hem.
// Geen Electron hier, zodat het te testen is.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

// Bovenste velden van latest-mac.yml (electron-builder): version, path, sha512.
function parseLatestYml(text) {
  const get = (key) => {
    const m = new RegExp(`^${key}:[ \\t]*'?([^'\\r\\n]+?)'?[ \\t]*$`, 'm').exec(String(text));
    return m ? m[1] : null;
  };
  return { version: get('version'), path: get('path'), sha512: get('sha512') };
}

// ".../Claude Meter.app/Contents/MacOS/Claude Meter" → ".../Claude Meter.app"
function bundlePath(exePath) {
  const m = /^(.+?\.app)\/Contents\/MacOS\/[^/]+$/.exec(String(exePath || ''));
  return m ? m[1] : null;
}

// Alleen een app die je zelf ergens neerzette (zoals Apps) kan zichzelf vervangen; niet vanuit
// de dmg zelf of vanuit de tijdelijke kopie die macOS maakt voor niet-verplaatste apps.
function canReplace(appPath) {
  if (!appPath || appPath.includes('/AppTranslocation/') || appPath.startsWith('/Volumes/')) return false;
  try {
    fs.accessSync(appPath, fs.constants.W_OK);
    fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const workDirPath = (tempDir) => path.join(tempDir, 'claude-meter-update');

// Lege werkmap voor deze update (een oude wordt eerst opgeruimd).
function freshWorkDir(tempDir) {
  const dir = workDirPath(tempDir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Bij het opstarten: een klaargezette update van een vorige keer (niet geïnstalleerd) opruimen.
function cleanup(tempDir) {
  return fs.promises.rm(workDirPath(tempDir), { recursive: true, force: true }).catch(() => {});
}

// Downloaden naar `file`; de sha512 (base64, zoals in latest-mac.yml) moet kloppen.
async function download(url, file, sha512, onProgress) {
  if (!sha512) throw new Error('geen controlesom');
  const res = await fetch(url, { headers: { 'User-Agent': 'claude-meter' }, signal: AbortSignal.timeout(20 * 60e3) });
  if (!res.ok || !res.body) throw new Error(`download mislukt (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha512');
  let done = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      done += chunk.length;
      if (total && onProgress) onProgress(done / total);
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(file));
  if (hash.digest('base64') !== sha512) {
    fs.rmSync(file, { force: true });
    throw new Error('controlesom klopt niet');
  }
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 5 * 60e3 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

// De app uit de dmg kopiëren naar `workDir` en nakijken dat het de verwachte versie is.
async function stageFromDmg(dmg, workDir, version) {
  const mount = path.join(workDir, 'dmg');
  fs.mkdirSync(mount, { recursive: true });
  await run('hdiutil', ['attach', '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mount, dmg]);
  try {
    const name = fs.readdirSync(mount).find((f) => f.endsWith('.app'));
    if (!name) throw new Error('geen app in de dmg');
    const target = path.join(workDir, name);
    await run('ditto', [path.join(mount, name), target]);
    const found = (await run('defaults', ['read', path.join(target, 'Contents', 'Info'), 'CFBundleShortVersionString'])).trim();
    if (found !== version) throw new Error(`dmg bevat versie ${found}, verwacht ${version}`);
    return target;
  } finally {
    await run('hdiutil', ['detach', mount, '-force']).catch(() => {});
  }
}

// Draait los van de app (die dan al afsluit): $1 pid, $2 huidige app, $3 nieuwe app, $4 werkmap.
const INSTALL_SCRIPT = `#!/bin/sh
PID="$1"; APP="$2"; NEW="$3"; WORK="$4"
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 300 ]; do sleep 0.2; i=$((i+1)); done
OLD="$APP.oud-$$"
if mv "$APP" "$OLD"; then
  if mv "$NEW" "$APP"; then
    rm -rf "$OLD"
  else
    rm -rf "$APP"; mv "$OLD" "$APP"
  fi
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"
rm -rf "$WORK"
`;

function launchInstall({ pid, appPath, newApp, workDir }) {
  const script = path.join(workDir, 'installeren.sh');
  fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 });
  spawn('/bin/sh', [script, String(pid), appPath, newApp, workDir], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { parseLatestYml, bundlePath, canReplace, freshWorkDir, cleanup, download, stageFromDmg, launchInstall, INSTALL_SCRIPT };

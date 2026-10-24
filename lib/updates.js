'use strict';
// Nieuwe versies via GitHub Releases.
// Windows: electron-updater downloadt op de achtergrond en installeert bij herstarten.
// macOS: lib/macupdate.js downloadt de dmg en zet de nieuwe app klaar; na klikken wisselt hij om
// en start opnieuw. Lukt dat niet (bijv. app niet in een map waar je mag schrijven), dan melden
// we de nieuwe versie en openen we de downloadpagina.
// Alleen kijken bij het opstarten en als je in de instellingen op Controleren klikt.

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

const REPO = 'zikrullahkafa/claude-interactive-viewer';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

// "1.10.0" > "1.9.2"
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function createUpdater(onChange) {
  let state = null; // { version, status: 'downloading'|'ready'|'available', url, progress }
  const set = (s) => {
    state = s;
    onChange(state);
  };
  // Voortgang alleen doorgeven per 5%, anders wordt de interface te vaak bijgewerkt.
  const setProgress = (fraction) => {
    const p = Math.min(100, Math.floor(fraction * 20) * 5);
    if (state && state.status === 'downloading' && p !== state.progress) set({ ...state, progress: p });
  };
  if (!app.isPackaged) return { get: () => null, install: () => {}, check: () => {} };

  let autoUpdater = null;
  if (process.platform === 'win32') {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (i) => set({ version: i.version, status: 'downloading', progress: 0 }));
    autoUpdater.on('download-progress', (p) => setProgress((p.percent || 0) / 100));
    autoUpdater.on('update-downloaded', (i) => set({ version: i.version, status: 'ready' }));
    // Geen internet of GitHub plat: een lopende download wordt dan de downloadpagina.
    autoUpdater.on('error', () => {
      if (state && state.status === 'downloading') set({ version: state.version, status: 'available', url: RELEASES_URL });
    });
  }

  const mac = process.platform === 'darwin' ? require('./macupdate') : null;
  let staged = null; // klaargezette nieuwe Mac-app
  const cleaned = mac ? mac.cleanup(app.getPath('temp')) : null;

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-meter' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  }

  // Mac: dmg downloaden, controleren en de nieuwe app klaarzetten.
  async function prepareMac(rel, version) {
    const asset = (name) => (rel.assets || []).find((a) => a.name === name);
    const appPath = mac.bundlePath(process.execPath);
    const yml = asset('latest-mac.yml');
    if (!mac.canReplace(appPath) || !yml) return set({ version, status: 'available', url: rel.html_url });
    set({ version, status: 'downloading', progress: 0, url: rel.html_url });
    try {
      const res = await fetch(yml.browser_download_url, { headers: { 'User-Agent': 'claude-meter' }, signal: AbortSignal.timeout(15000) });
      const info = mac.parseLatestYml(await res.text());
      const dmgAsset = info.path && asset(info.path);
      if (!dmgAsset || info.version !== version) throw new Error('release onvolledig');
      await cleaned;
      const workDir = mac.freshWorkDir(app.getPath('temp'));
      const dmg = path.join(workDir, info.path);
      await mac.download(dmgAsset.browser_download_url, dmg, info.sha512, setProgress);
      const newApp = await mac.stageFromDmg(dmg, workDir, version);
      fs.rmSync(dmg, { force: true });
      staged = { appPath, newApp, workDir };
      set({ version, status: 'ready', url: rel.html_url });
    } catch {
      staged = null;
      set({ version, status: 'available', url: rel.html_url }); // dan via de downloadpagina
    }
  }

  async function check() {
    try {
      if (autoUpdater) {
        await autoUpdater.checkForUpdates();
        return;
      }
      if (state && state.status !== 'available') return; // al bezig of klaargezet
      const rel = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
      if (!rel.tag_name || !newer(rel.tag_name, app.getVersion())) return;
      const version = rel.tag_name.replace(/^v/, '');
      if (mac) await prepareMac(rel, version);
      else set({ version, status: 'available', url: rel.html_url });
    } catch {
      // volgende keer opnieuw
    }
  }

  function install() {
    if (!state) return;
    if (state.status === 'ready' && autoUpdater) autoUpdater.quitAndInstall(true, true);
    else if (state.status === 'ready' && staged) {
      mac.launchInstall({ pid: process.pid, ...staged });
      app.quit();
    } else if (state.url) shell.openExternal(state.url);
  }

  setTimeout(check, 15 * 1000);
  return { get: () => state, install, check };
}

module.exports = { createUpdater, newer };

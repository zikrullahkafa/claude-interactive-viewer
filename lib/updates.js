'use strict';
// Nieuwe versies via GitHub Releases.
// Windows: electron-updater downloadt op de achtergrond en installeert bij herstarten.
// macOS: zonder Apple-ondertekening kan de app zichzelf niet vervangen; we melden de nieuwe
// versie en openen de downloadpagina.

const { app, shell } = require('electron');

const REPO = 'zikrullahkafa/claude-interactive-viewer';
const CHECK_MS = 6 * 3600e3;

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
  let state = null; // { version, status: 'downloading'|'ready'|'available', url }
  const set = (s) => {
    state = s;
    onChange(state);
  };
  if (!app.isPackaged) return { get: () => null, install: () => {}, check: () => {} };

  let autoUpdater = null;
  if (process.platform === 'win32') {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (i) => set({ version: i.version, status: 'downloading' }));
    autoUpdater.on('update-downloaded', (i) => set({ version: i.version, status: 'ready' }));
    autoUpdater.on('error', () => {}); // geen internet of GitHub plat: later opnieuw
  }

  async function check() {
    try {
      if (autoUpdater) {
        await autoUpdater.checkForUpdates();
        return;
      }
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-meter' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const rel = await res.json();
      if (rel.tag_name && newer(rel.tag_name, app.getVersion())) {
        set({ version: rel.tag_name.replace(/^v/, ''), status: 'available', url: rel.html_url });
      }
    } catch {
      // volgende keer opnieuw
    }
  }

  function install() {
    if (!state) return;
    if (state.status === 'ready' && autoUpdater) autoUpdater.quitAndInstall(true, true);
    else if (state.url) shell.openExternal(state.url);
  }

  setTimeout(check, 15 * 1000);
  setInterval(check, CHECK_MS);
  return { get: () => state, install, check };
}

module.exports = { createUpdater, newer };

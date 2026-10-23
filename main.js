'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const { fetchUsage } = require('./lib/usage');

const DEMO = process.argv.includes('--demo');
const POLL_MS = 3 * 60 * 1000; // het endpoint is streng met rate limits
const BACKOFF_MS = 10 * 60 * 1000;
const MIN_MANUAL_MS = 15 * 1000;
const PILL = { width: 168, height: 60 };
const PANEL_WIDTH = 340;
const MARGIN = 16;
const SHORTCUT = 'CommandOrControl+Alt+U';

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

if (!app.requestSingleInstanceLock()) {
  // Draait al: het eerste proces krijgt 'second-instance' en toont de widget.
  app.quit();
}

let win = null;
let tray = null;
let expanded = false;
let anchor = { right: false, bottom: false };
let pillPos = null;
let dragOrigin = null;
let lastUsage = null;
let lastError = null;
let lastFetch = 0;
let pollTimer = null;

// ---------- instellingen ----------

const configFile = () => path.join(app.getPath('userData'), 'widget.json');
let config = { position: null, alwaysOnTop: true, openAtLogin: true, lastUsage: null };

// Linux kent geen login-items in Electron; daar blijft alleen de Claude-hook over.
const LOGIN_ITEM_SUPPORTED = process.platform === 'win32' || process.platform === 'darwin';

function applyLoginItem() {
  if (!LOGIN_ITEM_SUPPORTED || DEMO) return;
  // Gestart via `electron .`: Electron moet de appmap als argument meekrijgen.
  app.setLoginItemSettings({
    openAtLogin: config.openAtLogin,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  });
}

function loadConfig() {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) };
  } catch {
    // eerste start
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch {
    // niet kritiek
  }
}

// ---------- venster ----------

function workArea(point) {
  return screen.getDisplayNearestPoint(point).workArea;
}

function clamp(bounds) {
  const wa = workArea({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  return {
    ...bounds,
    x: Math.round(Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - bounds.width)),
    y: Math.round(Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - bounds.height)),
  };
}

function defaultPillPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - PILL.width - MARGIN, y: wa.y + MARGIN };
}

function createWindow() {
  pillPos = config.position || defaultPillPos();
  const b = clamp({ ...pillPos, ...PILL });
  pillPos = { x: b.x, y: b.y };

  win = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    show: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => (win = null));
}

function showWidget() {
  if (!win) createWindow();
  else win.showInactive();
  refresh(false);
  updateTrayMenu();
}

function hideWidget() {
  if (win) {
    if (expanded) setExpanded(false);
    win.hide();
  }
  updateTrayMenu();
}

function toggleWidget() {
  if (win && win.isVisible()) hideWidget();
  else showWidget();
}

function setExpanded(value, height) {
  if (!win) return;
  if (value) {
    const wa = workArea({ x: pillPos.x, y: pillPos.y });
    anchor = {
      right: pillPos.x + PILL.width / 2 > wa.x + wa.width / 2,
      bottom: pillPos.y + PILL.height / 2 > wa.y + wa.height / 2,
    };
    const h = Math.max(PILL.height, Math.round(height || 320));
    const x = anchor.right ? pillPos.x + PILL.width - PANEL_WIDTH : pillPos.x;
    const y = anchor.bottom ? pillPos.y + PILL.height - h : pillPos.y;
    win.setBounds(clamp({ x, y, width: PANEL_WIDTH, height: h }));
  } else {
    // Pil terug op de hoek waar het paneel aan vastzat (het paneel kan versleept zijn).
    const b = win.getBounds();
    const x = anchor.right ? b.x + b.width - PILL.width : b.x;
    const y = anchor.bottom ? b.y + b.height - PILL.height : b.y;
    const nb = clamp({ x, y, ...PILL });
    pillPos = { x: nb.x, y: nb.y };
    win.setBounds(nb);
    config.position = pillPos;
    saveConfig();
  }
  expanded = value;
}

function resizePanel(height) {
  if (!win || !expanded) return;
  const b = win.getBounds();
  const h = Math.round(height);
  if (h === b.height) return;
  const y = anchor.bottom ? b.y + b.height - h : b.y;
  win.setBounds(clamp({ x: b.x, y, width: PANEL_WIDTH, height: h }));
}

// ---------- gegevens ----------

function demoUsage() {
  const now = Date.now();
  const t = (now / 60000) % 100;
  return {
    fiveHour: { percent: 20 + (t % 60), resetsAt: new Date(now + 2.3 * 3600e3).toISOString() },
    sevenDay: { percent: 61, resetsAt: new Date(now + 3.6 * 86400e3).toISOString() },
    sevenDayOpus: { percent: 42, resetsAt: new Date(now + 3.6 * 86400e3).toISOString() },
    sevenDaySonnet: null,
    extra: null,
    plan: 'max',
    fetchedAt: new Date().toISOString(),
  };
}

function broadcast() {
  if (win) win.webContents.send('usage', { usage: lastUsage, error: lastError });
  updateTrayMenu();
}

async function refresh(manual) {
  if (manual && Date.now() - lastFetch < MIN_MANUAL_MS) return broadcast();
  lastFetch = Date.now();
  clearTimeout(pollTimer);
  let next = POLL_MS;
  try {
    lastUsage = DEMO ? demoUsage() : await fetchUsage();
    lastError = null;
    config.lastUsage = lastUsage;
    saveConfig();
  } catch (err) {
    lastError = { code: err.code || 'unknown', message: err.message };
    if (err.code === 'rate-limited') next = BACKOFF_MS;
    if (['expired', 'forbidden', 'no-credentials'].includes(err.code)) next = 60 * 1000; // wachten tot Claude Code het token ververst
  }
  broadcast();
  pollTimer = setTimeout(() => refresh(false), next);
}

// ---------- systeemvak ----------

function trayLabel() {
  if (!lastUsage) return 'Claude-gebruik';
  const p = (w) => (w ? `${Math.round(w.percent)}%` : '–');
  return `Claude · 5 uur ${p(lastUsage.fiveHour)} · week ${p(lastUsage.sevenDay)}`;
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!(win && win.isVisible());
  tray.setToolTip(trayLabel());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayLabel(), enabled: false },
      { type: 'separator' },
      { label: visible ? 'Widget verbergen' : 'Widget tonen', accelerator: SHORTCUT, click: toggleWidget },
      { label: 'Nu verversen', click: () => refresh(true) },
      {
        label: 'Altijd bovenop',
        type: 'checkbox',
        checked: config.alwaysOnTop,
        click: (item) => {
          config.alwaysOnTop = item.checked;
          if (win) win.setAlwaysOnTop(item.checked, 'floating');
          saveConfig();
        },
      },
      {
        label: process.platform === 'darwin' ? 'Starten bij inloggen' : 'Starten met Windows',
        type: 'checkbox',
        visible: LOGIN_ITEM_SUPPORTED,
        checked: config.openAtLogin,
        click: (item) => {
          config.openAtLogin = item.checked;
          applyLoginItem();
          saveConfig();
        },
      },
      { type: 'separator' },
      { label: 'Afsluiten', click: () => app.quit() },
    ])
  );
}

function createTray() {
  try {
    // macOS kleurt template-iconen zelf mee met de menubalk
    const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
    tray = new Tray(icon);
    tray.on('click', toggleWidget);
    updateTrayMenu();
  } catch {
    tray = null; // sommige Linux-bureaubladen hebben geen systeemvak; sneltoets werkt dan nog
  }
}

// ---------- IPC ----------

ipcMain.handle('get-state', () => ({ usage: lastUsage, error: lastError, demo: DEMO, shortcut: SHORTCUT }));
ipcMain.on('refresh', () => refresh(true));
ipcMain.on('expand', (_e, height) => setExpanded(true, height));
ipcMain.on('collapse', () => setExpanded(false));
ipcMain.on('resize', (_e, height) => resizePanel(height));
ipcMain.on('hide', hideWidget);
ipcMain.on('quit', () => app.quit());
ipcMain.on('drag-start', () => {
  if (!win) return;
  const [x, y] = win.getPosition();
  dragOrigin = { cursor: screen.getCursorScreenPoint(), x, y };
});
ipcMain.on('drag-move', () => {
  if (!win || !dragOrigin) return;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  win.setBounds({ ...b, x: dragOrigin.x + c.x - dragOrigin.cursor.x, y: dragOrigin.y + c.y - dragOrigin.cursor.y });
});
ipcMain.on('drag-end', () => {
  if (!win || !dragOrigin) return;
  dragOrigin = null;
  const b = clamp(win.getBounds());
  win.setBounds(b);
  if (!expanded) {
    pillPos = { x: b.x, y: b.y };
    config.position = pillPos;
    saveConfig();
  }
});
ipcMain.on('context-menu', () => {
  Menu.buildFromTemplate([
    { label: 'Nu verversen', click: () => refresh(true) },
    { label: 'Verbergen', click: hideWidget },
    { type: 'separator' },
    { label: 'Afsluiten', click: () => app.quit() },
  ]).popup({ window: win });
});

// ---------- start ----------

app.on('second-instance', showWidget); // opnieuw starten (bijv. door de Claude-hook) = weer tonen
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  loadConfig();
  lastUsage = config.lastUsage; // direct iets tonen; verversen volgt
  applyLoginItem();
  createTray();
  createWindow();
  globalShortcut.register(SHORTCUT, toggleWidget);
  refresh(false);
});

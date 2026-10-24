'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fetchUsage } = require('./lib/usage');
const { projectUsage, describeLogs } = require('./lib/projects');
const { createHistory } = require('./lib/history');
const { createUpdater } = require('./lib/updates');
const hook = require('./scripts/hook');

const DEMO = process.argv.includes('--demo');
const POLL_MS = 3 * 60 * 1000; // het endpoint is streng met rate limits
const BACKOFF_MS = 10 * 60 * 1000;
const MIN_MANUAL_MS = 15 * 1000;
const PILL = { width: 176, height: 64 };
const PANEL_WIDTH = 340;
const MARGIN = 16;
const SHORTCUT = 'CommandOrControl+Alt+U';

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

// Zelfde gegevensmap voor de geïnstalleerde app en de ontwikkelversie (instellingen, metingen).
app.setPath('userData', path.join(app.getPath('appData'), 'claude-usage-widget'));

// Vanuit de Claude Code-hook: start mezelf los van de hook en stop meteen, zodat de hook niet wacht.
if (process.argv.includes('--launch')) {
  const child = spawn(process.execPath, process.argv.slice(1).filter((a) => a !== '--launch'), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.exit(0);
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
const rawFile = () => path.join(app.getPath('userData'), 'laatste-antwoord.json');
let config = { position: null, alwaysOnTop: true, theme: 'dark', openClaude: false, hookOffered: false, claudeAppId: null, lastUsage: null };
let updater = null;
let updateState = null;

// Commando voor de Claude Code-hook: de geïnstalleerde app, of in de ontwikkelversie bin/launch.js.
function hookCommand() {
  if (!app.isPackaged) return undefined; // standaardcommando van scripts/hook.js
  return `"${process.execPath.replace(/\\/g, '/')}" --launch --${hook.MARKER}`;
}

function setHookEnabled(enable) {
  try {
    hook.setHook(enable, hookCommand());
  } catch {
    // settings.json onleesbaar: niets veranderen
  }
  updateTrayMenu();
}

// Windows: de AppID van de Claude-app opzoeken (eenmalig, daarna bewaard).
function findClaudeAppId() {
  if (config.claudeAppId || process.platform !== 'win32') return Promise.resolve(config.claudeAppId);
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', "(Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1).AppID"], {
      windowsHide: true,
    });
    let out = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.on('error', () => resolve(null));
    ps.on('exit', () => {
      config.claudeAppId = out.trim() || null;
      saveConfig();
      resolve(config.claudeAppId);
    });
  });
}

// Thema: 'dark', 'light' of 'system' (volgt Windows). De widget zet het zelf in de CSS.
function applyTheme(theme) {
  config.theme = ['dark', 'light', 'system'].includes(theme) ? theme : 'dark';
  if (win) win.webContents.send('theme', config.theme);
  saveConfig();
  updateTrayMenu();
}

async function openLogCheck() {
  const file = path.join(app.getPath('userData'), 'logboek-controle.txt');
  try {
    fs.writeFileSync(file, await describeLogs());
    shell.openPath(file);
  } catch {
    // niet kritiek
  }
}

// Een eerdere versie zette de widget bij het inloggen aan; dat ruimen we op.
function removeLegacyLoginItem() {
  if (DEMO || !(process.platform === 'win32' || process.platform === 'darwin')) return;
  app.setLoginItemSettings({
    openAtLogin: false,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  });
}

// Snelkoppeling "Claude + Meter" geeft --with-claude=<AppID> mee: dan opent de widget ook de Claude-app.
// Claude-app meeopenen: via de oude snelkoppeling (--with-claude) of de instelling, maar niet
// als Claude Code ons start (dan draait Claude al).
async function openClaudeApp(argv) {
  const arg = argv.find((a) => a.startsWith('--with-claude'));
  const fromHook = argv.includes(`--${hook.MARKER}`);
  if (!arg && (!config.openClaude || fromHook)) return;
  const appId = (arg && arg.split('=')[1]) || (await findClaudeAppId());
  const cmd =
    process.platform === 'win32' && appId
      ? ['explorer.exe', [`shell:AppsFolder\\${appId}`]]
      : process.platform === 'darwin'
        ? ['open', ['-a', 'Claude']]
        : null;
  if (!cmd) return;
  const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
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
  if (Date.now() - lastFetch > MIN_MANUAL_MS) refresh(false);
  else broadcast();
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

let historyStore = null;
const history = () => (historyStore ||= createHistory(path.join(app.getPath('userData'), 'limietverloop.jsonl')));

// Nepverloop voor de demomodus: weekpercentage dat oploopt en zondag terugvalt, 5 uur met pieken.
function demoHistory(sinceMs) {
  const out = [];
  const now = Date.now();
  for (let t = Math.max(sinceMs, now - 30 * 86400e3); t <= now; t += 20 * 60e3) {
    const hourOfDay = new Date(t).getHours();
    const awake = hourOfDay >= 8 && hourOfDay <= 23;
    const week = ((t / 86400e3 + 3) % 7) / 7;
    const f = awake ? Math.round(Math.abs(Math.sin(t / 5400e3)) * 70) : 0;
    out.push({ t, f, w: Math.round(week * 85) });
  }
  return out;
}

function demoUsage() {
  const now = Date.now();
  const t = (now / 60000) % 100;
  return {
    fiveHour: { percent: 20 + (t % 60), resetsAt: new Date(now + 2.3 * 3600e3).toISOString() },
    sevenDay: { percent: 61, resetsAt: new Date(now + 3.6 * 86400e3).toISOString() },
    sevenDayOpus: { percent: 42, resetsAt: new Date(now + 3.6 * 86400e3).toISOString() },
    sevenDaySonnet: null,
    extra: null,
    other: [{ key: 'iguana_necktie', label: 'Cloudsessietegoed', expires: true, percent: 8.75, resetsAt: new Date(now + 13 * 86400e3).toISOString(), limitDollars: 100, usedDollars: 8.75, remainingDollars: 91.25 }],
    products: { since: null, rows: [{ key: 'claude_code', name: 'Claude Code', percent: 0 }, { key: 'chat', name: 'Chats', percent: 10 }, { key: 'cowork', name: 'Cowork', percent: 90 }] },
    newFields: [],
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
    const { raw, ...usage } = DEMO ? demoUsage() : await fetchUsage();
    lastUsage = usage;
    lastError = null;
    // Ruw antwoord bewaren (bevat geen token): zo is te zien welke velden Anthropic meestuurt.
    if (raw) fs.writeFile(rawFile(), JSON.stringify(raw, null, 2), () => {});
    config.lastUsage = lastUsage;
    saveConfig();
    if (!DEMO) history().append(lastUsage);
  } catch (err) {
    lastError = { code: err.code || 'unknown', message: err.message };
    if (err.code === 'rate-limited') next = BACKOFF_MS;
    if (['expired', 'login-needed', 'forbidden', 'no-credentials'].includes(err.code)) next = 60 * 1000; // wachten op opnieuw inloggen
  }
  broadcast();
  // Alleen ophalen zolang de widget zichtbaar is; bij weer tonen wordt meteen ververst.
  pollTimer = setTimeout(() => {
    if (win && win.isVisible()) refresh(false);
  }, next);
}

// ---------- systeemvak ----------

function trayLabel() {
  if (!lastUsage) return 'Claude Meter';
  const p = (w) => (w ? `${Math.round(w.percent)}%` : '–');
  return `Claude Meter · 5 uur ${p(lastUsage.fiveHour)} · week ${p(lastUsage.sevenDay)}`;
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
      ...(updateState
        ? [{
          label: updateState.status === 'ready' ? `Herstarten en bijwerken naar ${updateState.version}`
            : updateState.status === 'downloading' ? `Versie ${updateState.version} wordt gedownload…`
              : `Versie ${updateState.version} downloaden`,
          enabled: updateState.status !== 'downloading',
          click: () => updater && updater.install(),
        }]
        : []),
      { type: 'separator' },
      {
        label: 'Meestarten met Claude Code',
        type: 'checkbox',
        visible: hook.claudeCodeInstalled(),
        checked: hook.hookStatus(),
        click: (item) => setHookEnabled(item.checked),
      },
      {
        label: 'Claude-app meeopenen',
        type: 'checkbox',
        visible: process.platform === 'win32' || process.platform === 'darwin',
        checked: config.openClaude,
        click: (item) => {
          config.openClaude = item.checked;
          saveConfig();
        },
      },
      { type: 'separator' },
      { label: 'Ruwe gegevens bekijken', enabled: !DEMO, click: () => shell.openPath(rawFile()) },
      { label: 'Logboeken controleren', click: openLogCheck },
      { label: `Versie ${app.getVersion()}`, enabled: false },
      {
        label: 'Thema',
        submenu: [
          ['dark', 'Donker'],
          ['light', 'Licht'],
          ['system', 'Zoals Windows'],
        ].map(([id, label]) => ({ label, type: 'radio', checked: config.theme === id, click: () => applyTheme(id) })),
      },
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

ipcMain.handle('get-state', () => ({
  usage: lastUsage, error: lastError, demo: DEMO, shortcut: SHORTCUT, theme: config.theme,
  update: updateState, version: app.getVersion(),
}));
ipcMain.on('install-update', () => updater && updater.install());
ipcMain.on('refresh', () => refresh(true));
ipcMain.on('set-theme', (_e, theme) => applyTheme(theme));
ipcMain.handle('projects', (_e, sinceMs, bucket) => {
  const min = Date.now() - 62 * 86400e3;
  return projectUsage(Number.isFinite(sinceMs) && sinceMs > min ? sinceMs : Date.now() - 7 * 86400e3, { bucket });
});
ipcMain.handle('history', (_e, sinceMs) => {
  const since = Number.isFinite(sinceMs) ? sinceMs : Date.now() - 7 * 86400e3;
  return DEMO ? demoHistory(since) : history().read(since);
});
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
    { label: 'Ruwe gegevens bekijken', enabled: !DEMO, click: () => shell.openPath(rawFile()) },
    { label: 'Logboeken controleren', click: openLogCheck },
    { label: 'Verbergen', click: hideWidget },
    { type: 'separator' },
    { label: 'Afsluiten', click: () => app.quit() },
  ]).popup({ window: win });
});

// ---------- start ----------

// Opnieuw starten (bureaubladicoon, Claude-hook) = weer tonen
app.on('second-instance', (_e, argv) => {
  showWidget();
  openClaudeApp(argv);
});
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  loadConfig();
  lastUsage = config.lastUsage; // direct iets tonen; verversen volgt
  removeLegacyLoginItem();
  // Geïnstalleerde app, eerste keer: meteen meestarten met Claude Code (uit te zetten in het menu).
  if (app.isPackaged && !config.hookOffered && hook.claudeCodeInstalled()) {
    config.hookOffered = true;
    saveConfig();
    setHookEnabled(true);
  }
  updater = createUpdater((s) => {
    updateState = s;
    updateTrayMenu();
    if (win) win.webContents.send('update', s);
  });
  openClaudeApp(process.argv);
  createTray();
  createWindow();
  globalShortcut.register(SHORTCUT, toggleWidget);
  refresh(false);
});

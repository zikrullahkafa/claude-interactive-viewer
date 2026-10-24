'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell, Notification, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { fetchUsage } = require('./lib/usage');
const { projectUsage, describeLogs, bucketStarts } = require('./lib/projects');
const { createHistory, productUsage, patterns } = require('./lib/history');
const { createUpdater } = require('./lib/updates');
const alerts = require('./lib/alerts');
const hook = require('./scripts/hook');
const { toAccelerator, displayAccelerator, DEFAULT_SHORTCUT } = require('./lib/shortcut');
const report = require('./lib/report');

const DEMO = process.argv.includes('--demo');
const POLL_MS = 3 * 60 * 1000; // het endpoint is streng met rate limits
const BACKOFF_MS = 10 * 60 * 1000;
const MIN_MANUAL_MS = 15 * 1000;
// Pilgrootte: CSS-afmeting 200x48 maal de schaal, plus 2x8px rand voor de schaduw.
// Pil en paneel hebben elk een eigen schaal (hoeken slepen of de voorkeuzes in de instellingen).
// De hele pagina wordt dan met setZoomFactor vergroot: alles blijft in verhouding en scherp.
const PILL_SCALES = { small: 0.85, normal: 1, large: 1.2 };
const PILL_RANGE = [0.7, 2];
const PANEL_RANGE = [0.8, 1.6];
const clampNum = (v, [min, max]) => Math.min(max, Math.max(min, v));
const pillScale = () => clampNum(Number(config.pillScale) || 1, PILL_RANGE);
const panelScale = () => clampNum(Number(config.panelScale) || 1, PANEL_RANGE);
const PILL_BASE = { width: 216, height: 64 }; // 200x48 pil + 2x8px rand
const PANEL_BASE_WIDTH = 340; // 324px paneel + 2x8px rand
const pill = () => ({ width: Math.round(PILL_BASE.width * pillScale()), height: Math.round(PILL_BASE.height * pillScale()) });
const SNAP_PX = 40; // dichter bij de rand dan dit: vastklikken
const panelWidth = () => Math.round(PANEL_BASE_WIDTH * panelScale());
// Paneelhoogte in CSS-pixels (inclusief rand), door de gebruiker gekozen; langere inhoud scrolt.
const PANEL_HEIGHT = { default: 560, min: 240 };
const panelCssHeight = () => Math.max(PANEL_HEIGHT.min, Number(config.panelHeight) || PANEL_HEIGHT.default);
const MARGIN = 16;

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

// Vanuit het Windows-verwijderprogramma: de Claude Code-hook weghalen en stoppen.
if (process.argv.includes('--remove-hook')) {
  try {
    hook.setHook(false);
  } catch {
    // settings.json onleesbaar: niets aan te doen
  }
  process.exit(0);
}

// Draait al: het eerste proces krijgt 'second-instance' en toont de widget; dit proces stopt.
const IS_PRIMARY = app.requestSingleInstanceLock();
if (!IS_PRIMARY) app.exit(0);

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
let inFlight = null; // lopend verzoek: nooit twee tegelijk (anders vernieuwen ze allebei het token)

// ---------- instellingen ----------

const configFile = () => path.join(app.getPath('userData'), 'widget.json');
const rawFile = () => path.join(app.getPath('userData'), 'laatste-antwoord.json');
let config = {
  position: null, alwaysOnTop: true, theme: 'dark', openClaude: false, hookOffered: false, claudeAppId: null,
  notify: { ...alerts.DEFAULTS }, notified: {}, pillScale: 1, panelScale: 1, panelHeight: PANEL_HEIGHT.default, ackNews: [],
  shortcut: DEFAULT_SHORTCUT, quietHours: { enabled: false, from: '22:00', to: '08:00' }, lastUsage: null,
};
const HIDDEN_POLL_MS = 5 * 60 * 1000; // verborgen maar met meldingen aan: rustiger doorkijken

const notificationsOn = () => Object.values({ ...alerts.DEFAULTS, ...config.notify }).some(Boolean);

function runAlerts(prev, curr) {
  if (DEMO || !Notification.isSupported()) return;
  // Stille uren: niets tonen en niets als gemeld onthouden, zodat drempelmeldingen daarna alsnog komen.
  if (alerts.inQuietHours(config.quietHours)) return;
  // Een bewaarde stand van uren geleden zegt niets over een reset van nu.
  const recent = prev && prev.fetchedAt && Date.now() - new Date(prev.fetchedAt).getTime() < 20 * 60 * 1000;
  const list = alerts.evaluate(recent ? prev : null, curr, config.notify, config.notified);
  if (!list.length) return;
  for (const a of list) {
    config.notified[a.key] = Date.now();
    showNotification(a.title, a.body);
  }
  config.notified = alerts.pruneSent(config.notified);
  saveConfig();
}

function showNotification(title, body) {
  const n = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png'), silent: false });
  n.on('click', () => {
    showWidget();
    if (win) win.webContents.send('open-panel');
  });
  n.show();
}

// ---------- sneltoets ----------

const shortcutLabel = () => displayAccelerator(config.shortcut, process.platform);

// Registreert de sneltoets; lukt het niet (bezet door een ander programma), dan false.
function registerShortcut(acc) {
  globalShortcut.unregisterAll();
  if (!acc || acc === 'none') return true;
  try {
    return globalShortcut.register(acc, toggleWidget);
  } catch {
    return false;
  }
}

function setShortcut(acc) {
  const old = config.shortcut;
  if (!registerShortcut(acc)) {
    registerShortcut(old);
    return { error: 'Deze combinatie is al in gebruik door een ander programma. Kies een andere.' };
  }
  config.shortcut = acc;
  saveConfig();
  updateTrayMenu();
  return { ok: true };
}

// ---------- exporteren ----------

async function exportReport(kind) {
  const now = Date.now();
  const since = (() => {
    const d = new Date(now - 27 * 86400e3);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const points = DEMO ? demoHistory(since - 86400e3) : history().read(since - 86400e3);
  const local = await projectUsage(since, { bucket: 'day' });
  const folders = (await projectUsage(now - 30 * 86400e3)).projects;
  const days = report.buildDays(points, since, now, local.timeline);
  const weeks = report.buildWeeks(points, days, lastUsage && lastUsage.sevenDay ? lastUsage.sevenDay.resetsAt : null, now, 4);
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: kind === 'pdf' ? 'Overzicht opslaan als PDF' : 'Gegevens opslaan als CSV',
    defaultPath: path.join(app.getPath('documents'), `Claude-Meter-${kind === 'pdf' ? 'overzicht' : 'gegevens'}-${stamp}.${kind}`),
    filters: kind === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'CSV (Excel)', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  if (kind === 'csv') {
    fs.writeFileSync(filePath, report.toCsv(days), 'utf8');
  } else {
    const html = report.toHtml({
      days, weeks, folders, plan: lastUsage && lastUsage.plan, generatedAt: new Date(),
      firstMeasurement: points.length ? points[0].t : null,
    });
    const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      fs.writeFileSync(filePath, pdf);
    } finally {
      pdfWin.destroy();
    }
  }
  shell.showItemInFolder(filePath);
  return { ok: true, path: filePath };
}

const NOTIFY_LABELS = [
  ['fiveHour', '5-uurslimiet bij 80% en 90%'],
  ['week', 'Weeklimiet bij 80% en 90%'],
  ['pace', 'Weeklimiet raakt te snel op'],
  ['reset', 'Limiet is gereset'],
  ['news', 'Iets nieuws (bijv. gratis reset)'],
  ['credit', 'Cloudtegoed verloopt bijna'],
];
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

// Een vroege ontwikkelversie (okt. 2026) zette de widget in de Windows-autostart. Die regel
// wees naar de broncodemap; we halen alleen Run-waarden weg die daarnaar verwijzen.
function removeLegacyLoginItem() {
  if (DEMO || process.platform !== 'win32') return;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  execFile('reg', ['query', key], { windowsHide: true }, (err, stdout) => {
    if (err) return;
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
      if (m && /claude-interactive-viewer/i.test(m[2])) {
        execFile('reg', ['delete', key, '/v', m[1], '/f'], { windowsHide: true }, () => {});
      }
    }
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
  // Tot versie 1.3.2 was de pilgrootte 'small'/'normal'/'large'.
  if (PILL_SCALES[config.pillSize]) config.pillScale = PILL_SCALES[config.pillSize];
  delete config.pillSize;
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
  return { x: wa.x + wa.width - pill().width - MARGIN, y: wa.y + MARGIN };
}

function createWindow() {
  pillPos = config.position || defaultPillPos();
  const b = clamp({ ...pillPos, ...pill() });
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
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(expanded ? panelScale() : pillScale()));
  // Ctrl/⌘ + plus/min/0 en Ctrl+scrollen zouden de inhoud los van het venster zoomen.
  win.webContents.on('before-input-event', (e, input) => {
    if ((input.control || input.meta) && !input.alt && ['+', '-', '=', '0'].includes(input.key)) e.preventDefault();
  });
  win.webContents.setVisualZoomLevelLimits(1, 1);
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
    if (expanded) {
      setExpanded(false);
      // Verbergen via sneltoets, systeemvak of menu: de interface moet ook terug naar de pil,
      // anders staat bij het weer tonen een afgekapt paneel in een pilgroot venster.
      win.webContents.send('force-collapse');
    }
    win.hide();
  }
  updateTrayMenu();
}

function toggleWidget() {
  if (win && win.isVisible()) hideWidget();
  else showWidget();
}

// Vensterhoogte van het paneel: gekozen hoogte maal de schaal, nooit hoger dan het scherm.
const panelWindowHeight = (wa) => Math.min(Math.round(panelCssHeight() * panelScale()), wa.height - 2 * MARGIN);

function setExpanded(value) {
  if (!win) return;
  if (value) {
    const wa = workArea({ x: pillPos.x, y: pillPos.y });
    anchor = {
      right: pillPos.x + pill().width / 2 > wa.x + wa.width / 2,
      bottom: pillPos.y + pill().height / 2 > wa.y + wa.height / 2,
    };
    win.webContents.setZoomFactor(panelScale());
    const h = panelWindowHeight(wa);
    const x = anchor.right ? pillPos.x + pill().width - panelWidth() : pillPos.x;
    const y = anchor.bottom ? pillPos.y + pill().height - h : pillPos.y;
    win.setBounds(clamp({ x, y, width: panelWidth(), height: h }));
  } else {
    // Pil terug op de hoek waar het paneel aan vastzat (het paneel kan versleept zijn).
    const b = win.getBounds();
    const x = anchor.right ? b.x + b.width - pill().width : b.x;
    const y = anchor.bottom ? b.y + b.height - pill().height : b.y;
    const nb = clamp({ x, y, ...pill() });
    pillPos = { x: nb.x, y: nb.y };
    win.webContents.setZoomFactor(pillScale());
    win.setBounds(nb);
    config.position = pillPos;
    saveConfig();
  }
  expanded = value;
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
    const chat = 10 + Math.round(Math.abs(Math.sin(t / 2e8)) * 20);
    out.push({ t, f, w: Math.round(week * 85), p: { claude_code: 5, chat, cowork: 95 - chat, other: 0 } });
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
  if (win) win.webContents.send('usage', { usage: lastUsage, error: lastError, ackNews: config.ackNews });
  updateTrayMenu();
}

function refresh(manual) {
  if (inFlight) return inFlight;
  if (manual && Date.now() - lastFetch < MIN_MANUAL_MS) return broadcast();
  inFlight = doRefresh().finally(() => (inFlight = null));
  return inFlight;
}

async function doRefresh() {
  lastFetch = Date.now();
  clearTimeout(pollTimer);
  let next = POLL_MS;
  try {
    const { raw, ...usage } = DEMO ? demoUsage() : await fetchUsage();
    const prevUsage = lastUsage;
    lastUsage = usage;
    runAlerts(prevUsage, usage);
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
  // Zichtbaar: elke 3 minuten. Verborgen: alleen voor meldingen, elke 5 minuten.
  const visible = !!(win && win.isVisible());
  if (visible || notificationsOn()) {
    pollTimer = setTimeout(() => refresh(false), visible ? next : Math.max(next, HIDDEN_POLL_MS));
  }
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
      {
        label: visible ? 'Widget verbergen' : 'Widget tonen',
        ...(config.shortcut && config.shortcut !== 'none' ? { accelerator: config.shortcut, registerAccelerator: false } : {}),
        click: toggleWidget,
      },
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
        label: 'Grootte van de pil',
        submenu: [['small', 'Klein'], ['normal', 'Normaal'], ['large', 'Groot']].map(([id, label]) => ({
          label, type: 'radio', checked: pillPreset() === id, click: () => setPillSize(id),
        })),
      },
      {
        label: 'Meldingen',
        submenu: NOTIFY_LABELS.map(([key, label]) => ({
          label,
          type: 'checkbox',
          checked: { ...alerts.DEFAULTS, ...config.notify }[key],
          click: (item) => {
            config.notify = { ...alerts.DEFAULTS, ...config.notify, [key]: item.checked };
            saveConfig();
          },
        })),
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
          ['system', process.platform === 'darwin' ? 'Zoals macOS' : 'Zoals Windows'],
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

ipcMain.on('ack-news', (_e, keys) => {
  if (!Array.isArray(keys)) return;
  config.ackNews = [...new Set([...(config.ackNews || []), ...keys.map(String)])];
  saveConfig();
  broadcast();
});
ipcMain.handle('get-state', () => ({
  usage: lastUsage, error: lastError, demo: DEMO, shortcut: shortcutLabel(), theme: config.theme, ackNews: config.ackNews,
  update: updateState, version: app.getVersion(),
}));
ipcMain.on('install-update', () => updater && updater.install());
ipcMain.on('refresh', () => refresh(true));
ipcMain.on('set-theme', (_e, theme) => applyTheme(theme));

// ---------- instellingenscherm ----------

function settingsSnapshot() {
  return {
    theme: config.theme,
    pillSize: pillPreset(),
    sizeDefault: Math.abs(pillScale() - 1) < 0.01 && Math.abs(panelScale() - 1) < 0.01
      && panelCssHeight() === PANEL_HEIGHT.default,
    alwaysOnTop: config.alwaysOnTop,
    hookAvailable: hook.claudeCodeInstalled(),
    hook: hook.hookStatus(),
    openClaude: config.openClaude,
    openClaudeAvailable: process.platform === 'win32' || process.platform === 'darwin',
    notify: { ...alerts.DEFAULTS, ...config.notify },
    notifyLabels: NOTIFY_LABELS,
    version: app.getVersion(),
    packaged: app.isPackaged,
    update: updateState,
    shortcut: config.shortcut,
    shortcutLabel: shortcutLabel(),
    quietHours: { enabled: false, from: '22:00', to: '08:00', ...config.quietHours },
    notificationsSupported: Notification.isSupported(),
  };
}

const SETTERS = {
  theme: (v) => applyTheme(v),
  pillSize: (v) => setPillSize(v),
  resetSize: () => {
    config.panelHeight = PANEL_HEIGHT.default;
    setScales(1, 1);
  },
  alwaysOnTop: (v) => {
    config.alwaysOnTop = !!v;
    if (win) win.setAlwaysOnTop(config.alwaysOnTop, 'floating');
    saveConfig();
  },
  hook: (v) => setHookEnabled(!!v),
  openClaude: (v) => {
    config.openClaude = !!v;
    saveConfig();
  },
  quietHours: (v) => {
    if (!v || typeof v !== 'object') return;
    const time = (s, def) => (/^\d{1,2}:\d{2}$/.test(String(s)) ? String(s) : def);
    const cur = { enabled: false, from: '22:00', to: '08:00', ...config.quietHours };
    config.quietHours = {
      enabled: 'enabled' in v ? !!v.enabled : cur.enabled,
      from: 'from' in v ? time(v.from, cur.from) : cur.from,
      to: 'to' in v ? time(v.to, cur.to) : cur.to,
    };
    saveConfig();
  },
  notify: (v) => {
    if (!v || typeof v !== 'object') return;
    config.notify = { ...alerts.DEFAULTS, ...config.notify };
    for (const k of Object.keys(alerts.DEFAULTS)) if (k in v) config.notify[k] = !!v[k];
    saveConfig();
  },
};

ipcMain.handle('get-settings', () => settingsSnapshot());
ipcMain.handle('set-setting', (_e, key, value) => {
  if (SETTERS[key]) SETTERS[key](value);
  updateTrayMenu();
  return settingsSnapshot();
});
ipcMain.on('check-update', () => updater && updater.check());
ipcMain.handle('test-notification', () => {
  if (!Notification.isSupported()) return { supported: false };
  showNotification('Testmelding van Claude Meter', 'Zo zien meldingen eruit. Klik erop om de widget te openen.');
  return { supported: true };
});
ipcMain.handle('set-shortcut', (_e, keyInfo) => {
  if (keyInfo === 'none' || keyInfo === 'default') {
    return { ...setShortcut(keyInfo === 'none' ? 'none' : DEFAULT_SHORTCUT), settings: settingsSnapshot() };
  }
  const { accelerator, error } = toAccelerator(keyInfo, process.platform);
  if (error) return { error, settings: settingsSnapshot() };
  return { ...setShortcut(accelerator), settings: settingsSnapshot() };
});
// Tijdens het opnemen van een nieuwe combinatie de huidige even uitzetten, anders vangt die de toetsen.
ipcMain.on('pause-shortcut', (_e, paused) => registerShortcut(paused ? 'none' : config.shortcut));
ipcMain.handle('export', async (_e, kind) => {
  try {
    return await exportReport(kind === 'pdf' ? 'pdf' : 'csv');
  } catch (err) {
    return { error: `Exporteren mislukt: ${err.message}` };
  }
});
ipcMain.on('open-raw', () => !DEMO && shell.openPath(rawFile()));
ipcMain.on('open-logcheck', () => openLogCheck());
ipcMain.handle('projects', (_e, sinceMs, bucket) => {
  const min = Date.now() - 62 * 86400e3;
  return projectUsage(Number.isFinite(sinceMs) && sinceMs > min ? sinceMs : Date.now() - 7 * 86400e3, { bucket });
});
ipcMain.handle('product-usage', (_e, sinceMs, bucket) => {
  const since = Number.isFinite(sinceMs) ? sinceMs : Date.now() - 7 * 86400e3;
  const b = bucket === 'hour' ? 'hour' : 'day';
  const starts = bucketStarts(since, b);
  // Eén meting van vóór de periode erbij, zodat het eerste verschil klopt.
  const points = DEMO ? demoHistory(since - 86400e3) : history().read(since - 86400e3);
  return { starts, bucket: b, series: productUsage(points, starts, b === 'hour' ? 3600e3 : 86400e3) };
});
ipcMain.handle('patterns', () => {
  const since = Date.now() - 28 * 86400e3;
  const points = DEMO ? demoHistory(since) : history().read(since);
  return patterns(points, lastUsage && lastUsage.sevenDay ? lastUsage.sevenDay.resetsAt : null);
});
ipcMain.handle('history', (_e, sinceMs) => {
  const since = Number.isFinite(sinceMs) ? sinceMs : Date.now() - 7 * 86400e3;
  return DEMO ? demoHistory(since) : history().read(since);
});
ipcMain.on('expand', () => setExpanded(true));
ipcMain.on('collapse', () => setExpanded(false));
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
// Na slepen: dicht bij een schermrand? Dan netjes op vaste afstand van die rand.
function snap(b) {
  const wa = workArea({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const out = { ...b };
  if (b.x - wa.x < SNAP_PX) out.x = wa.x + MARGIN;
  if (wa.x + wa.width - (b.x + b.width) < SNAP_PX) out.x = wa.x + wa.width - b.width - MARGIN;
  if (b.y - wa.y < SNAP_PX) out.y = wa.y + MARGIN;
  if (wa.y + wa.height - (b.y + b.height) < SNAP_PX) out.y = wa.y + wa.height - b.height - MARGIN;
  return out;
}

// Welke voorkeuze hoort bij de huidige pilschaal (of 'custom' na hoek-slepen).
function pillPreset() {
  const s = pillScale();
  const hit = Object.entries(PILL_SCALES).find(([, v]) => Math.abs(v - s) < 0.01);
  return hit ? hit[0] : 'custom';
}

// Nieuwe schalen toepassen en het venster aanpassen; de rechter- en onderrand blijven vast als
// de widget in die helft van het scherm staat.
function setScales(pillK, panelK) {
  config.pillScale = clampNum(pillK, PILL_RANGE);
  config.panelScale = clampNum(panelK, PANEL_RANGE);
  saveConfig();
  if (win) {
    const b = win.getBounds();
    const wa = workArea({ x: b.x, y: b.y });
    const right = b.x + b.width / 2 > wa.x + wa.width / 2;
    const bottom = b.y + b.height / 2 > wa.y + wa.height / 2;
    win.webContents.setZoomFactor(expanded ? panelScale() : pillScale());
    if (!expanded) {
      const p = pill();
      const nb = clamp({ x: right ? b.x + b.width - p.width : b.x, y: bottom ? b.y + b.height - p.height : b.y, ...p });
      win.setBounds(nb);
      pillPos = { x: nb.x, y: nb.y };
      config.position = pillPos;
      saveConfig();
    } else {
      const w = panelWidth();
      const h = panelWindowHeight(wa);
      win.setBounds(clamp({
        x: anchor.right ? b.x + b.width - w : b.x, y: anchor.bottom ? b.y + b.height - h : b.y, width: w, height: h,
      }));
    }
  }
  updateTrayMenu();
}

function setPillSize(size) {
  setScales(PILL_SCALES[size] || 1, panelScale());
}

// ---------- formaat aanpassen door aan een hoek te slepen ----------

let resizeOrigin = null;

ipcMain.on('resize-start', (_e, corner) => {
  if (!win || !/^(n|s)(e|w)$/.test(corner)) return;
  resizeOrigin = { corner, cursor: screen.getCursorScreenPoint(), b: win.getBounds(), scale: expanded ? panelScale() : pillScale() };
});

ipcMain.on('resize-move', () => {
  if (!win || !resizeOrigin) return;
  const { corner, cursor, b, scale } = resizeOrigin;
  const c = screen.getCursorScreenPoint();
  const sx = corner[1] === 'e' ? 1 : -1;
  const sy = corner[0] === 's' ? 1 : -1;
  const dx = sx * (c.x - cursor.x); // positief = groter
  const dy = sy * (c.y - cursor.y);
  // Niet verder groeien dan de schermrand aan de kant waarheen je sleept.
  const wa = workArea({ x: b.x, y: b.y });
  const roomW = sx > 0 ? wa.x + wa.width - b.x : b.x + b.width - wa.x;
  const roomH = sy > 0 ? wa.y + wa.height - b.y : b.y + b.height - wa.y;
  let next;
  let height;
  if (expanded) {
    // Paneel: de hoek volgt de muis. De breedte bepaalt de schaal (alles blijft in verhouding),
    // de hoogte hoeveel je ziet; de rest scrolt.
    const [min, max] = PANEL_RANGE;
    next = clampNum((b.width + dx) / PANEL_BASE_WIDTH, [min, Math.max(min, Math.min(max, roomW / PANEL_BASE_WIDTH))]);
    const minH = PANEL_HEIGHT.min * next;
    height = Math.round(clampNum(b.height + dy, [minH, Math.max(minH, Math.min(roomH, wa.height - 2 * MARGIN))]));
    config.panelScale = next;
    config.panelHeight = Math.round(height / next);
  } else {
    // Pil: horizontaal en verticaal slepen tellen allebei; de verhouding blijft gelijk.
    const r = ((b.width + dx) / b.width + (b.height + dy) / b.height) / 2;
    const [min, max] = PILL_RANGE;
    const fit = Math.min(roomW / PILL_BASE.width, roomH / PILL_BASE.height);
    next = clampNum(scale * r, [min, Math.max(min, Math.min(max, fit))]);
    config.pillScale = next;
    height = pill().height;
  }
  const width = expanded ? panelWidth() : pill().width;
  win.webContents.setZoomFactor(next);
  // De hoek tegenover de hoek waaraan je sleept, blijft op zijn plek.
  win.setBounds({
    x: sx < 0 ? b.x + b.width - width : b.x,
    y: sy < 0 ? b.y + b.height - height : b.y,
    width,
    height,
  });
});

ipcMain.on('resize-end', () => {
  if (!win || !resizeOrigin) return;
  resizeOrigin = null;
  const b = clamp(win.getBounds());
  win.setBounds(b);
  if (!expanded) {
    pillPos = { x: b.x, y: b.y };
    config.position = pillPos;
  }
  saveConfig();
  updateTrayMenu();
});

ipcMain.on('drag-end', () => {
  if (!win || !dragOrigin) return;
  dragOrigin = null;
  const b = clamp(expanded ? win.getBounds() : snap(win.getBounds()));
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
// macOS start geen tweede proces als je het icoon aanklikt, maar stuurt 'activate'.
app.on('activate', () => {
  if (app.isReady()) showWidget();
});
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

if (IS_PRIMARY) app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  // Windows toont meldingen alleen met een AppUserModelId (gelijk aan de appId van de installatie).
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'nl.zikrullahkafa.claudemeter' : process.execPath);
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
  if (!registerShortcut(config.shortcut)) registerShortcut(DEFAULT_SHORTCUT);
  refresh(false);
});

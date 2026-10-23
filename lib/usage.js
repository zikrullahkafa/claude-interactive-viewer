'use strict';
// Leest het OAuth-token van Claude Code en haalt de gebruikslimieten op.
// Dit is hetzelfde endpoint dat `/usage` in Claude Code gebruikt.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// OAuth-gegevens van Claude Code zelf; nodig om het token te vernieuwen.
const TOKEN_URLS = ['https://platform.claude.com/v1/oauth/token', 'https://console.anthropic.com/v1/oauth/token'];
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const SHELL_NAME = process.platform === 'darwin' ? 'Terminal' : 'PowerShell';
const LOGIN_HINT = `Open ${SHELL_NAME}, typ \`claude\` en daarna \`/login\`. Daarna werkt de widget weer.`;

class UsageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const credentialsFile = () => path.join(configDir(), '.credentials.json');

function readKeychain() {
  // macOS bewaart de inloggegevens in de sleutelhanger, niet in een bestand.
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { timeout: 5000 },
      (err, stdout) => resolve(err ? null : stdout.trim())
    );
  });
}

// Accountnaam van het sleutelhanger-item, zodat we hetzelfde item bijwerken in plaats van een tweede aan te maken.
function keychainAccount() {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { timeout: 5000 }, (err, stdout) => {
      const m = !err && /"acct"<blob>="([^"]*)"/.exec(stdout);
      resolve(m ? m[1] : os.userInfo().username);
    });
  });
}

// Schrijft via `security -i` (opdracht via stdin), zodat het token niet in de proceslijst verschijnt.
async function writeKeychain(text) {
  const acct = (await keychainAccount()).replace(/["\\]/g, '');
  const hex = Buffer.from(text, 'utf8').toString('hex');
  await new Promise((resolve, reject) => {
    const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 && !/error/i.test(stderr) ? resolve() : reject(new Error(stderr.trim() || `security ${code}`))));
    child.stdin.end(`add-generic-password -U -a "${acct}" -s "${KEYCHAIN_SERVICE}" -X ${hex}\n`);
  });
}

function parseCredentials(raw) {
  if (!raw) return null;
  try {
    const oauth = JSON.parse(raw).claudeAiOauth;
    if (!oauth || !oauth.accessToken) return null;
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken || null,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
      subscriptionType: oauth.subscriptionType || null,
    };
  } catch {
    return null;
  }
}

async function readCredentials() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, expiresAt: null, subscriptionType: null, source: 'env' };
  }
  let creds = null;
  try {
    creds = parseCredentials(fs.readFileSync(credentialsFile(), 'utf8'));
    if (creds) creds.source = 'file';
  } catch {
    // bestand bestaat niet; op macOS volgt de sleutelhanger
  }
  if (!creds && process.platform === 'darwin') {
    creds = parseCredentials(await readKeychain());
    if (creds) creds.source = 'keychain';
  }
  if (!creds) {
    throw new UsageError('no-credentials', `Geen Claude-login gevonden. ${LOGIN_HINT}`);
  }
  return creds;
}

// Schrijft nieuwe tokens terug in hetzelfde bestand en laat alle andere velden staan.
// Claude Code leest dit bestand opnieuw in, net als wanneer een tweede Claude Code-venster ververst.
async function writeTokens(tokens, source) {
  if (source === 'keychain') {
    const data = JSON.parse(await readKeychain());
    Object.assign(data.claudeAiOauth, tokens);
    await writeKeychain(JSON.stringify(data));
    return;
  }
  const file = credentialsFile();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(data.claudeAiOauth, tokens);
  const text = JSON.stringify(data);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* al weg */ }
    fs.writeFileSync(file, text, { mode: 0o600 });
  }
}

const stillValid = (c) => c.expiresAt && c.expiresAt - Date.now() > REFRESH_MARGIN_MS;

async function refreshTokens(creds, fetchImpl) {
  // Vlak ervoor opnieuw lezen: misschien heeft Claude Code net zelf ververst.
  const fresh = await readCredentials();
  if (fresh.accessToken !== creds.accessToken && stillValid(fresh)) return fresh;
  if (!['file', 'keychain'].includes(fresh.source) || !fresh.refreshToken) {
    throw new UsageError('expired', `Token verlopen. Open Claude Code even (\`claude\` in ${SHELL_NAME}) om het te vernieuwen.`);
  }
  let lastStatus = null;
  for (const url of TOKEN_URLS) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'claude-usage-widget/1.0' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: fresh.refreshToken, client_id: CLIENT_ID }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      continue; // volgende adres proberen
    }
    lastStatus = res.status;
    if (res.status === 400 || res.status === 401) {
      // Refresh-token geweigerd; misschien heeft Claude Code op hetzelfde moment ververst.
      const again = await readCredentials();
      if (again.accessToken !== fresh.accessToken && stillValid(again)) return again;
      throw new UsageError('login-needed', `Inlog verlopen. ${LOGIN_HINT}`);
    }
    if (!res.ok) continue;
    const body = await res.json().catch(() => ({}));
    if (!body.access_token) continue;
    const tokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token || fresh.refreshToken,
      expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    };
    if (body.scope) tokens.scopes = String(body.scope).split(' ');
    try {
      await writeTokens(tokens, fresh.source);
    } catch (err) {
      throw new UsageError('write-failed', `Token vernieuwd maar niet op te slaan (${err.message}). ${LOGIN_HINT}`);
    }
    return { ...fresh, ...tokens };
  }
  throw lastStatus
    ? new UsageError('http', `Token vernieuwen mislukt (${lastStatus}). Probeer het later opnieuw.`)
    : new UsageError('network', 'Geen verbinding met Anthropic.');
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function normalizeWindow(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  const out = {
    percent: Math.max(0, Math.min(100, w.utilization)),
    resetsAt: w.resets_at || null,
  };
  // Sommige limieten (zoals het cloudtegoed) zijn een bedrag in dollars.
  if (num(w.limit_dollars) != null) {
    out.limitDollars = num(w.limit_dollars);
    out.usedDollars = num(w.used_dollars);
    out.remainingDollars = num(w.remaining_dollars);
  }
  return out;
}

const KNOWN = new Set(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'extra_usage']);

// Velden die in oktober 2026 in het antwoord zaten (de meeste leeg). Wordt een ander veld gevuld,
// dan is er iets nieuws, bijvoorbeeld een gratis limiet-reset; dat melden we in de widget.
const SEEN_KEYS = new Set([
  'five_hour', 'seven_day', 'seven_day_oauth_apps', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_cowork',
  'seven_day_omelette', 'tangelo', 'iguana_necktie', 'omelette_promotional', 'nimbus_quill', 'cinder_cove',
  'copper_kite', 'brass_thimble', 'harbor_lantern', 'wattle_ember', 'amber_ladder', 'granite_teacup',
  'amber_cistern', 'amber_cistern_offer', 'juniper_tide', 'cedar_ember', 'starry_waterfall', 'amber_gauge',
  'pace', 'extra_usage', 'limits', 'spend', 'member_dashboard_available', 'seven_day_breakdown',
  'weekly_scoped_shares',
]);
// Velden die bij de eerste meting al gevuld waren en die we zelf verwerken of bewust overslaan.
const QUIET_KEYS = new Set([...KNOWN, 'iguana_necktie', 'limits', 'spend', 'seven_day_breakdown', 'member_dashboard_available']);

// Interne codenamen die Anthropic gebruikt, met wat ze betekenen. "iguana_necktie" komt overeen met
// het cloudsessietegoed op claude.ai (zelfde percentage, resets_at = vervaldatum van het tegoed).
const LABELS = {
  iguana_necktie: { label: 'Cloudsessietegoed', expires: true },
};

// "seven_day_oauth_apps" -> "Seven day oauth apps"
const labelFor = (key) =>
  (LABELS[key] && LABELS[key].label) || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Zet het API-antwoord om naar een vaste vorm voor de interface.
// Onbekende limieten (nieuwe velden van Anthropic) worden ook getoond, onder hun eigen naam.
// Verdeling van het weekverbruik over producten (Claude Code, Chats, Cowork, ...).
function normalizeProducts(b) {
  if (!b || !Array.isArray(b.rows)) return null;
  const rows = b.rows
    .filter((r) => r && typeof r.percent === 'number')
    .map((r) => ({ key: r.key, name: PRODUCT_NAMES[r.key] || r.display_name || r.key, percent: r.percent }));
  return rows.length ? { since: b.window_started_at || null, rows } : null;
}

const PRODUCT_NAMES = { claude_code: 'Claude Code', chat: 'Chats', cowork: 'Cowork', other: 'Overig' };

// Gevulde velden die we niet kennen of die tot nu toe leeg waren.
function newFields(data) {
  return Object.entries(data)
    .filter(([key, v]) => v != null && v !== false && !QUIET_KEYS.has(key) && !(typeof v === 'object' && typeof v.utilization === 'number'))
    .map(([key]) => ({ key, isNew: !SEEN_KEYS.has(key) }));
}

function normalize(data, subscriptionType) {
  const extra = data.extra_usage;
  const other = Object.entries(data)
    .filter(([key, w]) => !KNOWN.has(key) && w && typeof w === 'object' && typeof w.utilization === 'number')
    .map(([key, w]) => ({ key, label: labelFor(key), expires: !!(LABELS[key] && LABELS[key].expires), ...normalizeWindow(w) }));
  return {
    fiveHour: normalizeWindow(data.five_hour),
    sevenDay: normalizeWindow(data.seven_day),
    sevenDayOpus: normalizeWindow(data.seven_day_opus),
    sevenDaySonnet: normalizeWindow(data.seven_day_sonnet),
    extra:
      extra && extra.is_enabled && typeof extra.utilization === 'number'
        ? { percent: Math.max(0, Math.min(100, extra.utilization)) }
        : null,
    other,
    products: normalizeProducts(data.seven_day_breakdown),
    newFields: newFields(data),
    plan: subscriptionType,
    fetchedAt: new Date().toISOString(),
  };
}

function requestUsage(creds, fetchImpl) {
  return Promise.resolve()
    .then(() =>
      fetchImpl(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json',
          'User-Agent': 'claude-usage-widget/1.0',
        },
        signal: AbortSignal.timeout(15000),
      })
    )
    .catch(() => {
      throw new UsageError('network', 'Geen verbinding met Anthropic.');
    });
}

async function fetchUsage({ fetchImpl = fetch } = {}) {
  let creds = await readCredentials();
  if (creds.expiresAt && !stillValid(creds)) {
    creds = await refreshTokens(creds, fetchImpl);
  }
  let res = await requestUsage(creds, fetchImpl);
  if (res.status === 401 && (creds.source === 'file' || creds.source === 'keychain')) {
    // Token ingetrokken voor de verlooptijd: één keer vernieuwen en opnieuw proberen.
    creds = await refreshTokens(creds, fetchImpl);
    res = await requestUsage(creds, fetchImpl);
  }
  if (res.status === 401) {
    throw new UsageError('login-needed', `Token geweigerd (401). ${LOGIN_HINT}`);
  }
  if (res.status === 403) {
    throw new UsageError(
      'forbidden',
      'Geen toegang tot gebruiksgegevens (403). Log in Claude Code opnieuw in met /login via je Claude-abonnement (niet met een API-sleutel of setup-token).'
    );
  }
  if (res.status === 429) {
    throw new UsageError('rate-limited', 'Te veel verzoeken; even wachten.');
  }
  if (!res.ok) {
    throw new UsageError('http', `Onverwacht antwoord van de server (${res.status}).`);
  }
  const data = await res.json();
  return { ...normalize(data, creds.subscriptionType), raw: data };
}

module.exports = { fetchUsage, normalize, parseCredentials, UsageError, USAGE_URL, TOKEN_URLS, CLIENT_ID };

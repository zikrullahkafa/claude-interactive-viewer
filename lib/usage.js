'use strict';
// Leest het OAuth-token van Claude Code en haalt de gebruikslimieten op.
// Dit is hetzelfde endpoint dat `/usage` in Claude Code gebruikt.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// OAuth-gegevens van Claude Code zelf; nodig om het token te vernieuwen.
const TOKEN_URLS = ['https://platform.claude.com/v1/oauth/token', 'https://console.anthropic.com/v1/oauth/token'];
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const LOGIN_HINT = 'Open PowerShell, typ `claude` en daarna `/login`. Daarna werkt de widget weer.';

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
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 5000 },
      (err, stdout) => resolve(err ? null : stdout.trim())
    );
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
function writeTokens(tokens) {
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
  if (fresh.source !== 'file' || !fresh.refreshToken) {
    throw new UsageError('expired', 'Token verlopen. Open Claude Code even (`claude` in PowerShell) om het te vernieuwen.');
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
      writeTokens(tokens);
    } catch (err) {
      throw new UsageError('write-failed', `Token vernieuwd maar niet op te slaan (${err.message}). ${LOGIN_HINT}`);
    }
    return { ...fresh, ...tokens };
  }
  throw lastStatus
    ? new UsageError('http', `Token vernieuwen mislukt (${lastStatus}). Probeer het later opnieuw.`)
    : new UsageError('network', 'Geen verbinding met Anthropic.');
}

function normalizeWindow(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  return {
    percent: Math.max(0, Math.min(100, w.utilization)),
    resetsAt: w.resets_at || null,
  };
}

const KNOWN = new Set(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'extra_usage']);

// "seven_day_oauth_apps" -> "Seven day oauth apps"
const labelFor = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Zet het API-antwoord om naar een vaste vorm voor de interface.
// Onbekende limieten (nieuwe velden van Anthropic) worden ook getoond, onder hun eigen naam.
function normalize(data, subscriptionType) {
  const extra = data.extra_usage;
  const other = Object.entries(data)
    .filter(([key, w]) => !KNOWN.has(key) && w && typeof w === 'object' && typeof w.utilization === 'number')
    .map(([key, w]) => ({ key, label: labelFor(key), ...normalizeWindow(w) }));
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
  if (res.status === 401 && creds.source === 'file') {
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

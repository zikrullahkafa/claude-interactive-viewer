'use strict';
// Leest het OAuth-token van Claude Code en haalt de gebruikslimieten op.
// Dit is hetzelfde endpoint dat `/usage` in Claude Code gebruikt.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

class UsageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

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
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
      subscriptionType: oauth.subscriptionType || null,
    };
  } catch {
    return null;
  }
}

async function readCredentials() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, expiresAt: null, subscriptionType: null };
  }
  const file = path.join(configDir(), '.credentials.json');
  let creds = null;
  try {
    creds = parseCredentials(fs.readFileSync(file, 'utf8'));
  } catch {
    // bestand bestaat niet; op macOS volgt de sleutelhanger
  }
  if (!creds && process.platform === 'darwin') {
    creds = parseCredentials(await readKeychain());
  }
  if (!creds) {
    throw new UsageError('no-credentials', 'Geen Claude-login gevonden. Log in met `claude` en probeer opnieuw.');
  }
  return creds;
}

function normalizeWindow(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  return {
    percent: Math.max(0, Math.min(100, w.utilization)),
    resetsAt: w.resets_at || null,
  };
}

// Zet het API-antwoord om naar een vaste vorm voor de interface.
function normalize(data, subscriptionType) {
  const extra = data.extra_usage;
  return {
    fiveHour: normalizeWindow(data.five_hour),
    sevenDay: normalizeWindow(data.seven_day),
    sevenDayOpus: normalizeWindow(data.seven_day_opus),
    sevenDaySonnet: normalizeWindow(data.seven_day_sonnet),
    extra:
      extra && extra.is_enabled && typeof extra.utilization === 'number'
        ? { percent: Math.max(0, Math.min(100, extra.utilization)) }
        : null,
    plan: subscriptionType,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchUsage({ fetchImpl = fetch } = {}) {
  const creds = await readCredentials();
  if (creds.expiresAt && creds.expiresAt < Date.now()) {
    // Niet zelf verversen: dat roteert het refresh-token en logt Claude Code uit.
    const at = new Date(creds.expiresAt).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });
    throw new UsageError(
      'expired',
      `Token verlopen sinds ${at}. Start Claude Code en stuur één bericht; dan ververst het token en werkt dit binnen een minuut weer.`
    );
  }
  let res;
  try {
    res = await fetchImpl(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-usage-widget/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new UsageError('network', 'Geen verbinding met Anthropic.');
  }
  if (res.status === 401) {
    throw new UsageError('expired', 'Token geweigerd (401). Start Claude Code en stuur één bericht, of log opnieuw in met /login.');
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
  return normalize(await res.json(), creds.subscriptionType);
}

module.exports = { fetchUsage, normalize, parseCredentials, UsageError, USAGE_URL };

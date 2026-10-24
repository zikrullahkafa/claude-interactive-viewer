'use strict';
// Telt tokens per projectmap uit de sessielogboeken op deze computer:
//   Claude Code: ~/.claude/projects/**.jsonl
//   Cowork:      sessiemappen van de desktop-app (local-agent-mode-sessions), zelfde formaat
// Gewone chats in de app of browser staan alleen bij Anthropic, niet op de computer.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { costOf } = require('./pricing');

const HOUR_MS = 3600e3;
const cache = new Map(); // bestand -> { mtimeMs, size, project, buckets }

function projectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

// Waar de desktop-app Cowork-sessies bewaart. De Windows Store-versie schrijft "Roaming" om naar
// %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\; oudere versies gebruikten
// %LOCALAPPDATA%\Claude-Data\<pakket>\ en de gewone installatie %APPDATA%\Claude\.
// Te overschrijven met CLAUDE_METER_COWORK_DIRS (voor tests).
function coworkDirs() {
  if (process.env.CLAUDE_METER_COWORK_DIRS != null) {
    return process.env.CLAUDE_METER_COWORK_DIRS.split(path.delimiter).filter(Boolean);
  }
  const dirs = [];
  const sub = 'local-agent-mode-sessions';
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const subdirs = (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    };
    for (const pkg of subdirs(path.join(local, 'Packages')).filter((n) => /^claude/i.test(n))) {
      dirs.push(path.join(local, 'Packages', pkg, 'LocalCache', 'Roaming', 'Claude', sub));
    }
    for (const pkg of subdirs(path.join(local, 'Claude-Data'))) dirs.push(path.join(local, 'Claude-Data', pkg, sub));
    dirs.push(path.join(roaming, 'Claude', sub));
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(os.homedir(), 'Library', 'Application Support', 'Claude', sub));
  }
  return dirs;
}

function sources() {
  return [{ name: 'Code', dir: projectsDir() }, ...coworkDirs().map((dir) => ({ name: 'Cowork', dir }))];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'mcp-logs']);

function listJsonl(dir, out = [], depth = 0) {
  if (depth > 10) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('mcp-logs')) listJsonl(p, out, depth + 1);
    } else if (e.name.endsWith('.jsonl') && e.name !== 'audit.jsonl') out.push(p); // audit = kopie van het transcript
  }
  return out;
}

// Per uur bijhouden, zodat "sinds de weekreset" op het uur nauwkeurig kan.
const hourKey = (ts) => Math.floor(new Date(ts).getTime() / HOUR_MS) * HOUR_MS;

// Claude Code: de map onder ~/.claude/projects waarin het bestand staat (subagent-logboeken staan
// een niveau dieper maar horen bij hetzelfde project). Cowork: de werkmap van de sessie.
// Cowork bewaart per sessie een map local_<id> met daarnaast local_<id>.json (titel, gekozen mappen).
const sessionMeta = new Map();

function readSessionMeta(sessionDir) {
  if (sessionMeta.has(sessionDir)) return sessionMeta.get(sessionDir);
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(`${sessionDir}.json`, 'utf8'));
  } catch { /* geen metadata */ }
  sessionMeta.set(sessionDir, meta);
  return meta;
}

const firstString = (...vals) => vals.find((v) => typeof v === 'string' && v.trim());

function coworkFolder(meta) {
  if (!meta) return null;
  for (const k of ['userSelectedFolders', 'selectedFolders', 'mountedFolders', 'folders', 'workspaceFolders']) {
    const list = meta[k];
    if (Array.isArray(list) && list.length) {
      const f = list[0];
      const p = typeof f === 'string' ? f : f && firstString(f.path, f.hostPath, f.localPath);
      if (p) return p;
    }
  }
  return null;
}

// Waar hoort dit logboek bij? Code: de projectmap onder ~/.claude/projects (subagent-logboeken staan
// een niveau dieper). Cowork: de map die je in de sessie koos, anders de sessie zelf.
function group(source, file, cwd) {
  const parts = path.relative(source.dir, file).split(path.sep);
  if (source.name === 'Code') return { key: `Code:${parts[0]}`, cwd };
  const idx = parts.findIndex((p) => p.startsWith('local_'));
  if (idx === -1) return { key: `Cowork:${cwd || parts[0]}`, cwd };
  const sessionDir = path.join(source.dir, ...parts.slice(0, idx + 1));
  const meta = readSessionMeta(sessionDir);
  const folder = coworkFolder(meta);
  if (folder) return { key: `Cowork:map:${folder.toLowerCase()}`, cwd: folder };
  const title = meta && firstString(meta.title, meta.name, meta.sessionTitle, meta.summary);
  return { key: `Cowork:sessie:${sessionDir}`, name: title || 'Cowork-sessie', path: title ? `Cowork: ${title}` : sessionDir };
}

async function parseFile(file, mtimeMs) {
  const buckets = new Map(); // `${uur}|${model}|${effort}` -> tellers
  const seen = new Set();
  let cwd = null;
  const sessions = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!cwd && line.includes('"cwd"')) {
      try {
        cwd = JSON.parse(line).cwd || null;
      } catch { /* kapotte regel */ }
    }
    if (!line.includes('"usage"')) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = rec.message;
    if (rec.type !== 'assistant' || !msg || !msg.usage) continue;
    // Eén antwoord kan als meerdere regels gelogd zijn met dezelfde telling.
    const id = `${msg.id || ''}|${rec.requestId || ''}`;
    if (id !== '|' && seen.has(id)) continue;
    seen.add(id);
    // Zonder tijdstempel (zoals in sommige Cowork-logboeken) telt de laatste wijziging van het bestand.
    let hour = hourKey(rec.timestamp || mtimeMs);
    if (Number.isNaN(hour)) hour = hourKey(mtimeMs);
    const session = rec.sessionId || rec.session_id;
    if (session) sessions.add(session);
    const u = msg.usage;
    // Claude Code logt per antwoord het effort-level; oudere versies niet.
    const effort = rec.perTurnEffort || rec.effort || 'onbekend';
    const key = `${hour}|${msg.model || 'onbekend'}|${effort}`;
    const b = buckets.get(key) || emptyTotals();
    b.input += u.input_tokens || 0;
    b.output += u.output_tokens || 0;
    b.cacheWrite += u.cache_creation_input_tokens || 0;
    b.cacheRead += u.cache_read_input_tokens || 0;
    b.thinking += (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
    b.cost += costOf(u, msg.model);
    b.messages += 1;
    buckets.set(key, b);
  }
  return { cwd, buckets, sessions };
}

// Model-ID inkorten tot een leesbare familienaam, bijv. "claude-sonnet-4-5-2025..." -> "Sonnet".
function modelFamily(model) {
  const m = /(opus|sonnet|haiku|fable|mythos)/i.exec(model || '');
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Overig';
}

function emptyTotals() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, thinking: 0, cost: 0, messages: 0 };
}
const add = (a, b) => {
  for (const k of Object.keys(a)) a[k] += b[k] || 0;
};
const total = (t) => t.input + t.output + t.cacheWrite + t.cacheRead;

// Map met { tokens, cost } per sleutel bijwerken.
function tally(map, key, b) {
  const t = map.get(key) || { tokens: 0, cost: 0 };
  t.tokens += total(b);
  t.cost += b.cost;
  map.set(key, t);
}

const sortedShares = (map) =>
  [...map]
    .map(([name, t]) => ({ name, ...t }))
    .filter((t) => t.tokens > 0)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

function displayName(cwd, key) {
  if (!cwd) return key;
  if (path.resolve(cwd) === path.resolve(os.homedir())) return `Thuismap (${path.basename(cwd)})`;
  return path.basename(cwd) || cwd;
}

/**
 * @param {number} sinceMs  begin van de periode (ms sinds 1970)
 */
// Begin van het uur of van de (lokale) dag waarin een tijdstip valt.
function bucketStart(ms, bucket) {
  if (bucket === 'hour') return hourKey(ms);
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Alle bakjes van `since` tot nu, ook de lege, zodat de grafiek een doorlopende tijdas heeft.
function bucketStarts(sinceMs, bucket) {
  const out = [];
  let t = bucketStart(sinceMs, bucket);
  const now = Date.now();
  while (t <= now) {
    out.push(t);
    if (bucket === 'hour') t += HOUR_MS;
    else {
      const d = new Date(t);
      d.setDate(d.getDate() + 1); // via de kalender, zodat zomer-/wintertijd klopt
      t = d.getTime();
    }
  }
  return out;
}

const TIMELINE_SERIES = 4; // daarna "Overig": meer kleuren zijn niet goed uit elkaar te houden

/**
 * @param {number} sinceMs  begin van de periode (ms sinds 1970)
 * @param {{bucket?: 'hour'|'day'}} [opts]  bakjesgrootte voor de tijdlijn
 */
async function projectUsage(sinceMs, opts = {}) {
  const bucket = opts.bucket === 'hour' ? 'hour' : 'day';
  const since = new Date(sinceMs);
  const sinceKey = hourKey(sinceMs);

  const files = sources().flatMap((source) => listJsonl(source.dir).map((file) => ({ source, file })));
  const projects = new Map();
  const summary = { totals: emptyTotals(), models: new Map(), efforts: new Map() };
  for (const { source, file } of files) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (st.mtimeMs < since.getTime()) continue; // niets nieuws in de gekozen periode
    let entry = cache.get(file);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      try {
        entry = { mtimeMs: st.mtimeMs, size: st.size, ...(await parseFile(file, st.mtimeMs)) };
      } catch {
        continue;
      }
      cache.set(file, entry);
    }
    const g = group(source, file, entry.cwd);
    const key = g.key;
    const proj = projects.get(key) || {
      key, source: source.name, cwd: g.cwd || null, name: g.name, path: g.path, totals: emptyTotals(), models: new Map(), efforts: new Map(), sessions: new Set(),
      timeline: new Map(),
    };
    if (source.name === 'Code' && (!proj.cwd || (entry.cwd && entry.cwd.length < proj.cwd.length))) proj.cwd = entry.cwd || proj.cwd;
    let any = false;
    for (const [bk, b] of entry.buckets) {
      const [hour, model, effort] = bk.split('|');
      if (Number(hour) < sinceKey) continue;
      any = true;
      add(proj.totals, b);
      add(summary.totals, b);
      tally(proj.models, modelFamily(model), b);
      tally(summary.models, modelFamily(model), b);
      tally(proj.efforts, effort, b);
      tally(summary.efforts, effort, b);
      tally(proj.timeline, bucketStart(Number(hour), bucket), b);
    }
    if (!any) continue;
    for (const s of entry.sessions) proj.sessions.add(s);
    projects.set(key, proj);
  }

  const list = [...projects.values()]
    .map((p) => ({
      name: p.name || displayName(p.cwd, p.key.slice(p.source.length + 1)),
      source: p.source,
      path: p.path || p.cwd || p.key,
      tokens: total(p.totals),
      ...p.totals,
      sessions: p.sessions.size,
      models: sortedShares(p.models),
      efforts: sortedShares(p.efforts),
      timeline: p.timeline,
    }))
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

  // Tijdlijn: grootste mappen apart, de rest samen als "Overig".
  const starts = bucketStarts(sinceMs, bucket);
  const valuesOf = (maps) =>
    starts.map((t) => maps.reduce((acc, m) => {
      const v = m.get(t);
      if (v) {
        acc.cost += v.cost;
        acc.tokens += v.tokens;
      }
      return acc;
    }, { cost: 0, tokens: 0 }));
  const top = list.slice(0, TIMELINE_SERIES);
  const rest = list.slice(TIMELINE_SERIES);
  const series = top.map((p) => ({ name: p.name, source: p.source, path: p.path, values: valuesOf([p.timeline]) }));
  if (rest.length) series.push({ name: `Overig (${rest.length})`, source: null, path: null, other: true, values: valuesOf(rest.map((p) => p.timeline)) });
  for (const p of list) delete p.timeline; // Maps gaan niet goed over IPC en zijn niet meer nodig
  return {
    since: since.toISOString(),
    total: list.reduce((s, p) => s + p.tokens, 0),
    cost: summary.totals.cost,
    summary: {
      ...summary.totals,
      tokens: total(summary.totals),
      sessions: list.reduce((s, p) => s + p.sessions, 0),
      models: sortedShares(summary.models),
      efforts: sortedShares(summary.efforts),
    },
    projects: list,
    timeline: { bucket, starts, series },
    scannedAt: new Date().toISOString(),
  };
}

// Beschrijft de opbouw van de logboeken (aantallen, veldnamen), zonder inhoud.
// Bedoeld om te zien waarom een bron niets oplevert.
async function describeLogs() {
  const home = os.homedir();
  const hide = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const lines = [`Claude Meter - logboekcontrole ${new Date().toISOString()}`, ''];
  for (const source of sources()) {
    const files = listJsonl(source.dir)
      .map((file) => {
        try {
          return { file, st: fs.statSync(file) };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    lines.push(`[${source.name}] ${hide(source.dir)}: ${fs.existsSync(source.dir) ? `${files.length} .jsonl-bestanden` : 'map bestaat niet'}`);
    for (const { file, st } of files.slice(0, 4)) {
      const types = new Map();
      const keys = new Set();
      const msgKeys = new Set();
      let total = 0;
      let withUsage = 0;
      let withTs = 0;
      const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
      for await (const line of rl) {
        if (++total > 5000) break;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          types.set('(geen json)', (types.get('(geen json)') || 0) + 1);
          continue;
        }
        if (!rec || typeof rec !== 'object') continue;
        const t = String(rec.type ?? '(geen type)');
        types.set(t, (types.get(t) || 0) + 1);
        Object.keys(rec).forEach((k) => keys.add(k));
        if (rec.message && typeof rec.message === 'object') Object.keys(rec.message).forEach((k) => msgKeys.add(k));
        if (rec.timestamp) withTs++;
        if (JSON.stringify(rec).includes('"output_tokens"')) withUsage++;
      }
      lines.push(`  ${hide(file)}  (${Math.round(st.size / 1024)} kB, ${new Date(st.mtimeMs).toISOString()})`);
      lines.push(`    regels: ${total}, met tokentelling: ${withUsage}, met tijdstempel: ${withTs}`);
      lines.push(`    types: ${[...types].map(([k, v]) => `${k}=${v}`).join(', ')}`);
      lines.push(`    velden: ${[...keys].slice(0, 40).join(', ')}`);
      if (msgKeys.size) lines.push(`    message-velden: ${[...msgKeys].slice(0, 30).join(', ')}`);
      const parts = path.relative(source.dir, file).split(path.sep);
      const idx = parts.findIndex((p) => p.startsWith('local_'));
      if (idx !== -1) {
        const meta = readSessionMeta(path.join(source.dir, ...parts.slice(0, idx + 1)));
        lines.push(`    sessie-metadata: ${meta ? Object.keys(meta).join(', ') : 'geen'}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { projectUsage, modelFamily, describeLogs, bucketStarts };

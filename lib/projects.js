'use strict';
// Telt tokens per projectmap uit de sessielogboeken van Claude Code (~/.claude/projects/**.jsonl).
// Alleen lokaal gedraaide Claude Code-sessies staan hier; chats in de desktop-app of browser niet.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const HOUR_MS = 3600e3;
const cache = new Map(); // bestand -> { mtimeMs, size, project, buckets }

function projectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function listJsonl(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJsonl(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// Per uur bijhouden, zodat "sinds de weekreset" op het uur nauwkeurig kan.
const hourKey = (ts) => Math.floor(new Date(ts).getTime() / HOUR_MS) * HOUR_MS;

// Hoofdmap van het project: de map onder ~/.claude/projects waarin het bestand staat
// (subagent-logboeken staan een niveau dieper maar horen bij hetzelfde project).
const projectKey = (file) => path.relative(projectsDir(), file).split(path.sep)[0];

async function parseFile(file) {
  const buckets = new Map(); // `${uur}|${model}` -> tellers
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
    if (rec.type !== 'assistant' || !msg || !msg.usage || !rec.timestamp) continue;
    // Eén antwoord kan als meerdere regels gelogd zijn met dezelfde telling.
    const id = `${msg.id || ''}|${rec.requestId || ''}`;
    if (id !== '|' && seen.has(id)) continue;
    seen.add(id);
    if (rec.sessionId) sessions.add(rec.sessionId);
    const u = msg.usage;
    const hour = hourKey(rec.timestamp);
    if (Number.isNaN(hour)) continue;
    const key = `${hour}|${msg.model || 'onbekend'}`;
    const b = buckets.get(key) || { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 };
    b.input += u.input_tokens || 0;
    b.output += u.output_tokens || 0;
    b.cacheWrite += u.cache_creation_input_tokens || 0;
    b.cacheRead += u.cache_read_input_tokens || 0;
    b.messages += 1;
    buckets.set(key, b);
  }
  return { cwd, buckets, sessions };
}

// Model-ID inkorten tot een leesbare familienaam, bijv. "claude-sonnet-4-5-2025..." -> "Sonnet".
function modelFamily(model) {
  const m = /(opus|sonnet|haiku|fable)/i.exec(model || '');
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Overig';
}

const emptyTotals = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 });
const add = (a, b) => {
  for (const k of Object.keys(a)) a[k] += b[k] || 0;
};
const total = (t) => t.input + t.output + t.cacheWrite + t.cacheRead;

/**
 * @param {number} sinceMs  begin van de periode (ms sinds 1970)
 */
async function projectUsage(sinceMs) {
  const since = new Date(sinceMs);
  const sinceKey = hourKey(sinceMs);

  const files = listJsonl(projectsDir());
  const projects = new Map();
  for (const file of files) {
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
        entry = { mtimeMs: st.mtimeMs, size: st.size, ...(await parseFile(file)) };
      } catch {
        continue;
      }
      cache.set(file, entry);
    }
    const key = projectKey(file);
    const proj = projects.get(key) || { key, cwd: null, totals: emptyTotals(), models: new Map(), sessions: new Set() };
    if (!proj.cwd || (entry.cwd && entry.cwd.length < proj.cwd.length)) proj.cwd = entry.cwd || proj.cwd;
    let any = false;
    for (const [bk, b] of entry.buckets) {
      const [hour, model] = bk.split('|');
      if (Number(hour) < sinceKey) continue;
      any = true;
      add(proj.totals, b);
      const fam = modelFamily(model);
      proj.models.set(fam, (proj.models.get(fam) || 0) + total(b));
    }
    if (!any) continue;
    for (const s of entry.sessions) proj.sessions.add(s);
    projects.set(key, proj);
  }

  const list = [...projects.values()]
    .map((p) => ({
      name: p.cwd ? path.basename(p.cwd) || p.cwd : p.key,
      path: p.cwd || p.key,
      tokens: total(p.totals),
      ...p.totals,
      sessions: p.sessions.size,
      models: [...p.models].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens),
    }))
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const sum = list.reduce((s, p) => s + p.tokens, 0);
  return { since: since.toISOString(), total: sum, projects: list, scannedAt: new Date().toISOString() };
}

module.exports = { projectUsage, modelFamily };

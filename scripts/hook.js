#!/usr/bin/env node
'use strict';
// Zet de SessionStart-hook in ~/.claude/settings.json aan of uit, zodat de widget
// meestart met Claude Code. Laat alle andere instellingen en hooks ongemoeid.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = 'claude-usage-widget';
const launcher = path.resolve(__dirname, '..', 'bin', 'launch.js').replace(/\\/g, '/');
const command = `node "${launcher}" --${MARKER}`;

function settingsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

function read(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').trim();
  return text ? JSON.parse(text) : {};
}

const isOurs = (h) => typeof h.command === 'string' && h.command.includes(MARKER);

function removeOurs(settings) {
  const groups = (settings.hooks && settings.hooks.SessionStart) || [];
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length > 0);
  if (!settings.hooks) return settings;
  if (kept.length) settings.hooks.SessionStart = kept;
  else delete settings.hooks.SessionStart;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

function install(settings) {
  removeOurs(settings);
  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];
  settings.hooks.SessionStart.push({
    matcher: 'startup|resume',
    hooks: [{ type: 'command', command, timeout: 10 }],
  });
  return settings;
}

function main() {
  const action = process.argv[2];
  if (!['install', 'uninstall'].includes(action)) {
    console.error('Gebruik: node scripts/hook.js install|uninstall');
    process.exit(1);
  }
  const file = settingsPath();
  let settings;
  try {
    settings = read(file);
  } catch (err) {
    console.error(`Kan ${file} niet lezen: ${err.message}. Er is niets gewijzigd.`);
    process.exit(1);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  const next = action === 'install' ? install(settings) : removeOurs(settings);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  console.log(
    action === 'install'
      ? `Hook geïnstalleerd in ${file}. De widget start nu mee met Claude Code.`
      : `Hook verwijderd uit ${file}.`
  );
}

if (require.main === module) main();
module.exports = { install, removeOurs, MARKER };

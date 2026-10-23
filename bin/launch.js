#!/usr/bin/env node
'use strict';
// Start de widget los van de aanroeper (bijv. de SessionStart-hook van Claude Code).
// Draait hij al, dan toont het bestaande venster zich weer. Schrijft niets naar stdout,
// want hook-uitvoer belandt anders in de context van Claude.

const { spawn } = require('child_process');
const path = require('path');

try {
  const electron = require('electron'); // vanuit Node: pad naar het Electron-programma
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2).filter((a) => a !== '--claude-usage-widget')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  });
  child.on('error', () => {});
  child.unref();
} catch (err) {
  process.stderr.write(`claude-usage-widget: kon niet starten (${err.message}). Draai eerst 'npm install'.\n`);
}
process.exit(0);

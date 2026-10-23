#!/usr/bin/env node
'use strict';
// Zet twee snelkoppelingen op het Windows-bureaublad:
//   "Claude-gebruik"   — alleen de widget
//   "Claude + gebruik" — de Claude desktop-app én de widget tegelijk
// Dubbelklikken als de widget al draait (maar verborgen is) = weer tonen.

const { execFileSync } = require('child_process');
const path = require('path');

if (process.platform !== 'win32') {
  console.log('Snelkoppelingen maken kan alleen op Windows. Start de widget hier met `npm start`.');
  process.exit(0);
}

const appDir = path.resolve(__dirname, '..');
const electronExe = require('electron');

// Waarden gaan via omgevingsvariabelen naar PowerShell; zo hoeft niets ge-escaped te worden.
const PS = `
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
function Make($name, $arguments) {
  $lnk = $shell.CreateShortcut((Join-Path $desktop "$name.lnk"))
  $lnk.TargetPath = $env:CUW_EXE
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $env:CUW_DIR
  $lnk.IconLocation = (Join-Path $env:CUW_DIR 'assets\\icon.ico')
  $lnk.Description = 'Claude-gebruikslimieten'
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Output "Gemaakt: $name"
}
Make 'Claude-gebruik' ('"' + $env:CUW_DIR + '"')
$claude = Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1
if ($claude) {
  Make 'Claude + gebruik' ('"' + $env:CUW_DIR + '" --with-claude=' + $claude.AppID)
} else {
  Write-Output 'Claude desktop-app niet gevonden in het startmenu; alleen "Claude-gebruik" is gemaakt.'
}`;

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS], {
    env: { ...process.env, CUW_EXE: electronExe, CUW_DIR: appDir },
    encoding: 'utf8',
  });
  process.stdout.write(out);
  console.log('Klaar. Je vindt de snelkoppelingen op je bureaublad.');
} catch (err) {
  console.error(`Snelkoppelingen maken mislukt: ${err.stderr || err.message}`);
  process.exit(1);
}

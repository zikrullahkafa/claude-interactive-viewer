#!/usr/bin/env node
'use strict';
// Zet twee snelkoppelingen op het Windows-bureaublad:
//   "Claude Meter"     — alleen de widget
//   "Claude + Meter"   — de Claude desktop-app én de widget tegelijk
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
# Snelkoppelingen van een eerdere versie opruimen
foreach ($old in 'Claude-gebruik', 'Claude + gebruik') {
  $p = Join-Path $desktop "$old.lnk"
  if (Test-Path $p) { Remove-Item $p }
}
function Make($name, $arguments) {
  $lnk = $shell.CreateShortcut((Join-Path $desktop "$name.lnk"))
  $lnk.TargetPath = $env:CUW_EXE
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $env:CUW_DIR
  $lnk.IconLocation = (Join-Path $env:CUW_DIR 'assets\\icon.ico')
  $lnk.Description = 'Claude Meter: je 5-uurs- en weeklimiet in één oogopslag'
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Output "Gemaakt: $name"
}
Make 'Claude Meter' ('"' + $env:CUW_DIR + '"')
$claude = Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1
if ($claude) {
  Make 'Claude + Meter' ('"' + $env:CUW_DIR + '" --with-claude=' + $claude.AppID)
} else {
  Write-Output 'Claude desktop-app niet gevonden in het startmenu; alleen "Claude Meter" is gemaakt.'
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

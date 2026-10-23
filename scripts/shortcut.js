#!/usr/bin/env node
'use strict';
// Zet twee snelkoppelingen op het bureaublad:
//   "Claude Meter"     — alleen de widget
//   "Claude + Meter"   — de Claude desktop-app én de widget tegelijk
// Dubbelklikken als de widget al draait (maar verborgen is) = weer tonen.
// Windows: .lnk-bestanden. macOS: kleine programma's (.app) via osacompile.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.resolve(__dirname, '..');
const electronExe = require('electron');

function windows() {
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
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS], {
    env: { ...process.env, CUW_EXE: electronExe, CUW_DIR: appDir },
    encoding: 'utf8',
  });
  process.stdout.write(out);
}

function mac() {
  const desktop = path.join(os.homedir(), 'Desktop');
  // AppleScript-tekst: aanhalingstekens en backslashes escapen, daarna door de shell laten quoten.
  const q = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const make = (name, extraArgs) => {
    const target = path.join(desktop, `${name}.app`);
    fs.rmSync(target, { recursive: true, force: true });
    const cmd = `"${q(electronExe)}" "${q(appDir)}"${extraArgs} > /dev/null 2>&1 &`;
    const script = `do shell script "${q(cmd)}"`;
    execFileSync('osacompile', ['-o', target, '-e', script]);
    // Eigen icoon in plaats van het standaard AppleScript-icoon
    fs.copyFileSync(path.join(appDir, 'assets', 'icon.icns'), path.join(target, 'Contents', 'Resources', 'applet.icns'));
    try {
      execFileSync('touch', [target]); // Finder het nieuwe icoon laten oppikken
    } catch { /* niet kritiek */ }
    console.log(`Gemaakt: ${name}`);
  };
  make('Claude Meter', '');
  make('Claude + Meter', ' --with-claude');
}

try {
  if (process.platform === 'win32') windows();
  else if (process.platform === 'darwin') mac();
  else {
    console.log('Snelkoppelingen maken kan op Windows en macOS. Start de widget hier met `npm start`.');
    process.exit(0);
  }
  console.log('Klaar. Je vindt de snelkoppelingen op je bureaublad.');
} catch (err) {
  console.error(`Snelkoppelingen maken mislukt: ${err.stderr || err.message}`);
  process.exit(1);
}

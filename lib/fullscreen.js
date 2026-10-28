'use strict';
// Verbergen tijdens volledig scherm (games, presentaties, video's).
// Windows: SHQueryUserNotificationState zegt of er een programma op volledig scherm draait; dezelfde
// controle waarmee Windows zelf meldingen tegenhoudt. Zonder native modules: een klein PowerShell-lusje
// dat elke 2 seconden kijkt en alleen bij een wijziging iets schrijft. Het stopt vanzelf als Claude
// Meter niet meer draait (ook na een crash). macOS regelt het zelf: zie visibleOnFullScreen in main.js.

const { spawn } = require('child_process');

// QUNS_BUSY (2): programma op volledig scherm, QUNS_RUNNING_D3D_FULL_SCREEN (3): game in exclusief
// volledig scherm, QUNS_PRESENTATION_MODE (4): presentatiemodus. Bewust niet QUNS_APP (7): dat is
// elke Store-app op de voorgrond, en de Claude-app is er een.
const FULLSCREEN_STATES = new Set([2, 3, 4]);

function watcherScript(parentPid, intervalMs) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace ClaudeMeter -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'
$last = -1
while ($true) {
  if (-not (Get-Process -Id ${Number(parentPid)} -ErrorAction SilentlyContinue)) { exit }
  $state = 0
  [void][ClaudeMeter.Shell]::SHQueryUserNotificationState([ref]$state)
  if ($state -ne $last) { [Console]::Out.WriteLine($state); [Console]::Out.Flush(); $last = $state }
  Start-Sleep -Milliseconds ${Number(intervalMs)}
}
`;
}

// Roept onChange(opVolledigScherm, windowsStatus) aan bij de eerste meting en bij elke wisseling.
function startWatcher(onChange, { pid = process.pid, intervalMs = 2000, spawnFn = spawn } = {}) {
  const encoded = Buffer.from(watcherScript(pid, intervalMs), 'utf16le').toString('base64');
  const child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buf = '';
  let full = null;
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const state = parseInt(buf.slice(0, i), 10);
      buf = buf.slice(i + 1);
      if (!Number.isFinite(state)) continue;
      const now = FULLSCREEN_STATES.has(state);
      if (now !== full) {
        full = now;
        onChange(now, state);
      }
    }
  });
  child.on('error', () => {}); // geen PowerShell: dan gewoon niet automatisch verbergen
  return {
    child,
    stop() {
      try {
        child.kill();
      } catch {
        // al gestopt
      }
    },
  };
}

module.exports = { startWatcher, watcherScript, FULLSCREEN_STATES };

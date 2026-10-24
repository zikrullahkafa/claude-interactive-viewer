'use strict';
// Zet een ingedrukte toetscombinatie om naar een Electron-sneltoets ("accelerator") en terug
// naar leesbare tekst. Pure functies, zodat ze zonder Electron te testen zijn.

const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+U';

const CODE_KEYS = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
};

/**
 * @param {{code: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean}} k
 * @param {string} platform  process.platform
 * @returns {{accelerator?: string, error?: string}}
 */
function toAccelerator(k, platform) {
  if (!k || typeof k.code !== 'string') return { error: 'Geen toets ontvangen.' };
  let key = null;
  if (/^Key[A-Z]$/.test(k.code)) key = k.code.slice(3);
  else if (/^Digit[0-9]$/.test(k.code)) key = k.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k.code)) key = k.code;
  else if (CODE_KEYS[k.code]) key = CODE_KEYS[k.code];
  if (!key) return { error: 'Kies een letter, cijfer of functietoets.' };
  const mods = [];
  if (k.ctrl) mods.push('Control');
  if (k.meta) mods.push(platform === 'darwin' ? 'Command' : 'Super');
  if (k.alt) mods.push('Alt');
  if (k.shift) mods.push('Shift');
  // Zonder Ctrl/Alt/Cmd zou de sneltoets gewone tekstinvoer in andere programma's onderscheppen.
  if (!k.ctrl && !k.alt && !k.meta && !/^F\d+$/.test(key)) {
    return { error: 'Gebruik Ctrl, Alt of ⌘ samen met een toets.' };
  }
  return { accelerator: [...mods, key].join('+') };
}

function displayAccelerator(acc, platform) {
  if (!acc || acc === 'none') return 'Geen';
  const mac = platform === 'darwin';
  const names = {
    CommandOrControl: mac ? '⌘' : 'Ctrl', CmdOrCtrl: mac ? '⌘' : 'Ctrl', Command: '⌘', Control: mac ? '⌃' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt', Option: '⌥', Shift: mac ? '⇧' : 'Shift', Super: 'Win',
  };
  return acc.split('+').map((p) => names[p] || p).join(mac ? '' : ' + ');
}

module.exports = { toAccelerator, displayAccelerator, DEFAULT_SHORTCUT };

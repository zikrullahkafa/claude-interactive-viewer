'use strict';
// Bepaalt welke meldingen de widget moet tonen, op basis van de vorige en de nieuwe meting.
// Elke melding heeft een sleutel; wat al gemeld is (in `sent`) komt niet nog eens.

const WEEK_MS = 7 * 86400e3;

const DEFAULTS = { fiveHour: true, week: true, pace: true, reset: true, news: true, credit: true };
const THRESHOLDS = [80, 90];

const weekdayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long' });
const timeFmt = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

// Verwacht weekpercentage bij de reset, uit het tempo tot nu toe (zelfde rekensom als in het paneel).
function projectedWeek(w, now) {
  if (!w || !w.resetsAt) return null;
  const elapsed = 1 - (new Date(w.resetsAt).getTime() - now) / WEEK_MS;
  if (elapsed < 0.15 || elapsed > 1) return null; // te vroeg in de week om iets te zeggen
  return w.percent / elapsed;
}

/**
 * @param {object|null} prev  vorige usage (genormaliseerd)
 * @param {object} curr       nieuwe usage
 * @param {object} prefs      welke soorten meldingen aan staan
 * @param {object} sent       sleutel -> tijdstip van eerder gemelde meldingen
 * @returns {{key: string, title: string, body: string}[]}
 */
function evaluate(prev, curr, prefs = DEFAULTS, sent = {}, now = Date.now()) {
  const out = [];
  const push = (key, title, body) => {
    if (!sent[key]) out.push({ key, title, body });
  };
  const p = { ...DEFAULTS, ...prefs };
  const f = curr.fiveHour;
  const w = curr.sevenDay;

  if (p.fiveHour && f) {
    for (const t of THRESHOLDS) {
      if (f.percent >= t) {
        const at = f.resetsAt ? ` Reset om ${timeFmt.format(new Date(f.resetsAt))}.` : '';
        push(`5h:${t}:${f.resetsAt}`, `5-uurslimiet op ${Math.round(f.percent)}%`, `Je hebt ${t}% van je 5-uurslimiet gebruikt.${at}`);
      }
    }
  }
  if (p.week && w) {
    for (const t of THRESHOLDS) {
      if (w.percent >= t) {
        push(`wk:${t}:${w.resetsAt}`, `Weeklimiet op ${Math.round(w.percent)}%`, `Reset op ${w.resetsAt ? weekdayFmt.format(new Date(w.resetsAt)) : 'de resetdag'}.`);
      }
    }
  }
  if (p.pace && w) {
    const proj = projectedWeek(w, now);
    if (proj != null && proj > 100 && w.percent < 90) {
      push(`pace:${w.resetsAt}`, 'Je weeklimiet raakt te snel op', `In dit tempo is je week op vóór de reset van ${weekdayFmt.format(new Date(w.resetsAt))}. Overweeg een lagere effort of Sonnet voor routinewerk.`);
    }
  }
  if (p.reset && prev) {
    const pf = prev.fiveHour;
    if (pf && f && pf.percent >= 80 && f.percent < pf.percent && f.resetsAt !== pf.resetsAt) {
      push(`reset5h:${f.resetsAt}`, '5-uurslimiet is gereset', 'Je kunt weer verder.');
    }
    const pw = prev.sevenDay;
    if (pw && w && w.percent < pw.percent && w.resetsAt !== pw.resetsAt) {
      push(`resetwk:${w.resetsAt}`, 'Weeklimiet is gereset', 'Een nieuwe week, weer helemaal vol.');
    }
  }
  if (p.news) {
    for (const nf of curr.newFields || []) {
      push(`news:${nf.key}`, 'Iets nieuws in je Claude-account', 'Mogelijk een gratis limiet-reset of aanbieding. Kijk op claude.ai bij Instellingen → Gebruik.');
    }
  }
  if (p.credit) {
    for (const o of curr.other || []) {
      if (!o.expires || !o.resetsAt || !(o.remainingDollars > 0)) continue;
      const left = new Date(o.resetsAt).getTime() - now;
      if (left > 0 && left < 3 * 86400e3) {
        push(`credit:${o.key}:${o.resetsAt}`, `${o.label} verloopt bijna`, `Nog $${o.remainingDollars.toFixed(2)} over, verloopt ${dayFmt.format(new Date(o.resetsAt))}.`);
      }
    }
  }
  return out;
}

// Stille uren, bijv. van "22:00" tot "08:00" (over middernacht heen) of "12:00" tot "13:00".
function inQuietHours(quiet, now = new Date()) {
  if (!quiet || !quiet.enabled) return false;
  const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const from = toMin(quiet.from);
  const to = toMin(quiet.to);
  if (from == null || to == null || from === to) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

// Oude sleutels opruimen (ouder dan 14 dagen).
function pruneSent(sent, now = Date.now()) {
  return Object.fromEntries(Object.entries(sent).filter(([, t]) => now - t < 14 * 86400e3));
}

module.exports = { evaluate, pruneSent, inQuietHours, DEFAULTS };

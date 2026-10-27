'use strict';
// Bepaalt welke meldingen de widget moet tonen, op basis van de vorige en de nieuwe meting.
// Elke melding heeft een sleutel; wat al gemeld is (in `sent`) komt niet nog eens, ook niet
// als de resettijd van hetzelfde venster een fractie verschoven is.

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

// Anthropic rekent de resettijd bij elke meting opnieuw uit, tot op de microseconde
// ("…T14:59:59.943648+00:00"); hij verschuift dus steeds een fractie. Meldingen horen bij een
// limietvenster, niet bij die exacte tekst: twee resettijden binnen deze marge zijn hetzelfde venster.
// (Een nieuw 5-uursvenster reset minstens 5 uur later, een nieuwe week 7 dagen.)
const SAME_WINDOW = { fiveHour: 3600e3, week: 86400e3 };

const toMs = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

// Tijd van een eerder gemelde sleutel voor deze soort: "soort@ms" (nu) of "soort:ISO" (tot 1.7.0).
function sentTime(key, kind) {
  if (key.startsWith(`${kind}@`)) return Number(key.slice(kind.length + 1));
  if (key.startsWith(`${kind}:`)) return toMs(key.slice(kind.length + 1));
  return null;
}

// Hoort de resettijd bij een ander venster dan de vorige? (Ontbreekt er één, dan ook.)
function otherWindow(a, b, margin) {
  const ta = toMs(a);
  const tb = toMs(b);
  if (ta == null || tb == null) return (ta == null) !== (tb == null);
  return Math.abs(ta - tb) > margin;
}

/**
 * @param {object|null} prev  vorige usage (genormaliseerd)
 * @param {object} curr       nieuwe usage
 * @param {object} prefs      welke soorten meldingen aan staan
 * @param {object} sent       sleutel -> tijdstip van eerder gemelde meldingen
 * @returns {{key: string, kind: string, title: string, body: string}[]}
 */
function evaluate(prev, curr, prefs = DEFAULTS, sent = {}, now = Date.now()) {
  const out = [];
  // `resetsAt` en `margin`: bij welk venster de melding hoort (zonder tijd: één keer per marge).
  const push = (kind, resetsAt, margin, title, body) => {
    if (margin == null) {
      if (!sent[kind]) out.push({ key: kind, kind, title, body });
      return;
    }
    const at = toMs(resetsAt) ?? now;
    const seen = Object.keys(sent).some((k) => {
      const t = sentTime(k, kind);
      return t != null && Math.abs(t - at) <= margin;
    });
    if (!seen) out.push({ key: `${kind}@${at}`, kind, title, body });
  };
  const p = { ...DEFAULTS, ...prefs };
  const f = curr.fiveHour;
  const w = curr.sevenDay;

  if (p.fiveHour && f) {
    for (const t of THRESHOLDS) {
      if (f.percent >= t) {
        const at = f.resetsAt ? ` Reset om ${timeFmt.format(new Date(f.resetsAt))}.` : '';
        push(`5h:${t}`, f.resetsAt, f.resetsAt ? SAME_WINDOW.fiveHour : 5 * 3600e3,
          `5-uurslimiet op ${Math.round(f.percent)}%`, `Je hebt ${t}% van je 5-uurslimiet gebruikt.${at}`);
      }
    }
  }
  if (p.week && w) {
    for (const t of THRESHOLDS) {
      if (w.percent >= t) {
        push(`wk:${t}`, w.resetsAt, w.resetsAt ? SAME_WINDOW.week : 7 * 86400e3,
          `Weeklimiet op ${Math.round(w.percent)}%`, `Reset op ${w.resetsAt ? weekdayFmt.format(new Date(w.resetsAt)) : 'de resetdag'}.`);
      }
    }
  }
  if (p.pace && w) {
    const proj = projectedWeek(w, now);
    if (proj != null && proj > 100 && w.percent < 90) {
      push('pace', w.resetsAt, SAME_WINDOW.week, 'Je weeklimiet raakt te snel op', `In dit tempo is je week op vóór de reset van ${weekdayFmt.format(new Date(w.resetsAt))}. Overweeg een lagere effort of Sonnet voor routinewerk.`);
    }
  }
  if (p.reset && prev) {
    // Een reset hoort bij het venster dat afliep (de vorige resettijd).
    const pf = prev.fiveHour;
    if (pf && f && pf.percent >= 80 && f.percent < pf.percent && otherWindow(f.resetsAt, pf.resetsAt, SAME_WINDOW.fiveHour)) {
      push('reset5h', pf.resetsAt, SAME_WINDOW.fiveHour, '5-uurslimiet is gereset', 'Je kunt weer verder.');
    }
    const pw = prev.sevenDay;
    if (pw && w && w.percent < pw.percent && otherWindow(w.resetsAt, pw.resetsAt, SAME_WINDOW.week)) {
      push('resetwk', pw.resetsAt, SAME_WINDOW.week, 'Weeklimiet is gereset', 'Een nieuwe week, weer helemaal vol.');
    }
  }
  if (p.news) {
    for (const nf of curr.newFields || []) {
      push(`news:${nf.key}`, null, null, 'Iets nieuws in je Claude-account', 'Mogelijk een gratis limiet-reset of aanbieding. Kijk op claude.ai bij Instellingen → Gebruik.');
    }
  }
  if (p.credit) {
    for (const o of curr.other || []) {
      if (!o.expires || !o.resetsAt || !(o.remainingDollars > 0)) continue;
      const left = new Date(o.resetsAt).getTime() - now;
      if (left > 0 && left < 3 * 86400e3) {
        push(`credit:${o.key}`, o.resetsAt, SAME_WINDOW.week, `${o.label} verloopt bijna`, `Nog $${o.remainingDollars.toFixed(2)} over, verloopt ${dayFmt.format(new Date(o.resetsAt))}.`);
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

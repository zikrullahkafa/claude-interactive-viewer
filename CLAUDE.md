# Claude Meter — werkafspraken

Zwevende Electron-widget (Windows en macOS) die de Claude-limieten van de gebruiker toont.
Gebruiker: apotheker, werkt vooral in de Claude desktop-app (Cowork en chats), af en toe in de browser.
Alles wat de gebruiker ziet is Nederlands; code-identifiers Engels; commentaar Nederlands.

## Hoe het werkt

- `lib/usage.js` haalt `api.anthropic.com/api/oauth/usage` op met het OAuth-token van Claude Code
  (Windows/Linux: `~/.claude/.credentials.json`, macOS: sleutelhanger "Claude Code-credentials").
  Verlopen token wordt zelf vernieuwd en teruggeschreven (bestand of sleutelhanger via `security -i`).
  Vlak voor vernieuwen opnieuw lezen: Claude Code kan net zelf ververst hebben.
- `lib/projects.js` leest lokale sessielogboeken (Claude Code `~/.claude/projects`, Cowork
  `local-agent-mode-sessions`) en telt per map, gewogen met `lib/pricing.js` (API-prijzen per model).
- `main.js`: venster (pil ↔ paneel), systeemvak/menubalk, sneltoets Ctrl/⌘+Alt+U, thema, polling
  (zichtbaar elke 3 min, verborgen elke 5 min als meldingen aan staan; 10 min na een 429). Nooit twee
  verzoeken tegelijk (`inFlight`), anders vernieuwen ze allebei het token. Startvlaggen:
  `--launch` (hook: los starten), `--remove-hook` (Windows-verwijderprogramma, `build/installer.nsh`),
  `--demo`. macOS stuurt bij opnieuw aanklikken `activate` in plaats van `second-instance`.
  Formaat: `config.pillScale` (0,7–2) en `config.panelScale` (0,8–1,6), toegepast met
  `webContents.setZoomFactor`; venster = CSS-maat (pil 216x64, paneel 340 breed) × schaal. Hoeken
  slepen via IPC `resize-start/move/end` (cursor uit `screen`, tegenoverliggende hoek blijft vast,
  niet voorbij de schermrand); daarna `remeasure` naar de renderer voor de paneelhoogte.
- `renderer/`: interface. Tabbladen Limieten, Verloop (SVG-grafieken, zonder bibliotheek), Mappen
  (alleen als er 30 dagen lokale data is), Tips. Grafiekkleuren: `--s1`..`--s4` + `--s-other`,
  gevalideerd palet (dataviz-skill), aparte stappen voor licht en donker.
- `lib/history.js`: het usage-endpoint geeft alleen de huidige stand; de widget slaat zelf metingen
  op (`limietverloop.jsonl` in userData: tijd, 5 uur, week, aandelen per product) voor de grafieken,
  het verbruik per product en de patronen. Geschiedenis begint dus pas bij installatie.
- `lib/alerts.js`: regels voor meldingen (pure functie, getest); `main.js` toont ze en onthoudt wat
  al gemeld is (`config.notified`). Verborgen wordt elke 5 min opgehaald als meldingen aan staan.
- `lib/updates.js`: Windows via electron-updater, Mac via de GitHub-API (melding + downloadpagina).
  Alleen bij opstarten (na 15 s) en via *Controleren* in de instellingen; geen periodieke controle.
- Instellingen: `SETTERS` in `main.js` + scherm `data-view="settings"` in de renderer; het
  systeemvakmenu biedt dezelfde opties. Sneltoets: `config.shortcut` (Electron-accelerator of
  `'none'`), opnemen in de renderer, omzetten in `lib/shortcut.js`. Stille uren: `config.quietHours`
  (`lib/alerts.js` `inQuietHours`); tijdens stille uren wordt niets als gemeld onthouden.
- `lib/report.js`: export van de laatste 4 weken; CSV met `;` en decimale komma (Nederlandse Excel),
  PDF via een verborgen venster en `printToPDF`.
- `scripts/hook.js` (SessionStart-hook), `scripts/shortcut.js` (bureaubladiconen .lnk / .app).

## Wat we hebben ontdekt (oktober 2026)

- Het usage-endpoint is ongedocumenteerd. Velden met codenamen; de meeste zijn `null`.
  `iguana_necktie` = cloudsessietegoed (met `limit_dollars`, `remaining_dollars`, `resets_at` = vervaldatum).
  `seven_day_breakdown.rows` = verdeling per product (claude_code, chat, cowork, other).
  `SEEN_KEYS` in `lib/usage.js` is de lijst van bekende velden; wordt een ander veld gevuld, dan meldt
  de widget dat (bedoeld om gratis "limit resets" te herkennen — formaat daarvan nog onbekend).
- Cowork van de gebruiker draait in de cloud: daar staan geen logboeken van op de computer.
  Chats (ook claude.ai-projecten) staan alleen bij Anthropic. Per-project-verbruik daarvan is niet
  beschikbaar; het tabblad Mappen meldt welk deel van het weekverbruik niet lokaal staat.
- Claude Code-logboeken bevatten per antwoord `effort`/`perTurnEffort` en
  `usage.output_tokens_details.thinking_tokens`. Cowork schrijft elk gesprek dubbel (transcript +
  `audit.jsonl`); audit wordt overgeslagen. Cowork-sessiemetadata staat in `local_<id>.json`
  (o.a. `title`, `userSelectedFolders`).
- Geen achtergrondproces of autostart met het besturingssysteem: de gebruiker wil dat niet.
  Starten gaat via het bureaubladicoon, "Claude + Meter" (opent ook de app) of de Claude Code-hook.

## Afspraken met de gebruiker

- Geef stappen voor **Windows en Mac altijd apart** (PowerShell vs. Terminal, eigen paden:
  Windows `C:\Users\Dopex\claude-interactive-viewer`, Mac `~/claude-interactive-viewer`).
- Alles op `main` zetten via een PR (de gebruiker heeft daar toestemming voor gegeven).

## Uitbrengen

`package.json` → `version` verhogen, op `main` zetten, dan workflow *Release* (handmatig of tag `v*`).
electron-builder bouwt NSIS (Windows, werkt zichzelf bij via electron-updater) en een universele
dmg (Mac, ad-hoc ondertekend; kan zichzelf niet vervangen, de app meldt nieuwe versies en opent de
releasepagina). Eerste start van de geïnstalleerde app zet de Claude Code-hook aan
(`<exe> --launch --claude-usage-widget`); `--launch` start de app los en stopt meteen.

## Testen

`npm test` (node:test, geen extra pakketten). `npm run demo` toont de widget met nepgegevens.
Prijzen in `lib/pricing.js` bijwerken als Anthropic nieuwe modellen of prijzen uitbrengt.

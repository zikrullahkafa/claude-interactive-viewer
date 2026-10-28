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
  verzoeken tegelijk (`inFlight`), anders vernieuwen ze allebei het token. Verborgen wordt ook
  opgehaald als de stand in systeemvak/menubalk aan staat. Startvlaggen:
  `--launch` (hook: los starten), `--remove-hook` (Windows-verwijderprogramma, `build/installer.nsh`),
  `--demo`. macOS stuurt bij opnieuw aanklikken `activate` in plaats van `second-instance`.
  Formaat: `config.pillScale` (0,7–2), `config.panelScale` (0,8–1,6) en `config.panelHeight`
  (CSS-px, standaard 560), toegepast met `webContents.setZoomFactor`; venster = CSS-maat (pil 216x64,
  paneel 340 × panelHeight) × schaal. Het paneel groeit nooit vanzelf mee met de inhoud (de
  gebruiker wil dat niet): `.panel-body` scrolt. Hoeken slepen via IPC `resize-start/move/end`
  (cursor uit `screen`, tegenoverliggende hoek blijft vast, niet voorbij de schermrand); pil
  schaalt in verhouding, bij het paneel volgt de hoek de muis (breedte → schaal, hoogte → panelHeight).
  `config.idleFade` (off/light/strong): de pil vervaagt zonder muis erop; alleen CSS
  (`body[data-fade]`, `--fade`), main stuurt `fade` naar de renderer.
- `renderer/`: interface. Tabbladen Limieten, Verloop (SVG-grafieken, zonder bibliotheek), Mappen
  (alleen als er 30 dagen lokale data is), Tips. Grafiekkleuren: `--s1`..`--s4` + `--s-other`,
  gevalideerd palet (dataviz-skill), aparte stappen voor licht en donker.
- `lib/history.js`: het usage-endpoint geeft alleen de huidige stand; de widget slaat zelf metingen
  op (`limietverloop.jsonl` in userData: tijd, 5 uur, week, aandelen per product) voor de grafieken,
  het verbruik per product en de patronen. Geschiedenis begint dus pas bij installatie.
- `lib/alerts.js`: regels voor meldingen (pure functie, getest); `main.js` toont ze en onthoudt wat
  al gemeld is (`config.notified`, sleutel `soort@ms`). Let op: `resets_at` van de API verschuift
  per meting een fractie (microseconden, steeds opnieuw berekend); vergelijk resettijden daarom
  nooit als tekst maar met een marge (5 uur: 1 uur, week: 1 dag). Verborgen wordt elke 5 min
  opgehaald als meldingen aan staan.
- Verbergen/tonen: klik op het systeemvakicoon toont altijd (geen wissel); `showWidget` zet het
  venster terug op een zichtbaar scherm, opnieuw bovenop (`moveTop`) en stuurt `shown` (even helder).
  De eerste keer verbergen met × geeft één melding hoe je hem terughaalt (`config.hideHintShown`).
- `lib/updates.js`: Windows via electron-updater. Mac via `lib/macupdate.js` (Squirrel.Mac kan
  niet zonder echte ondertekening): dmg uit de release downloaden, sha512 uit `latest-mac.yml`
  controleren, met `hdiutil`/`ditto` uitpakken en versie nakijken (`defaults read`); na klikken
  wisselt een los shellscript de app om (oude terug bij een fout) en start hem met `open`. Kan de
  app zichzelf niet vervangen (niet schrijfbaar, AppTranslocation), dan downloadpagina.
  Alleen bij opstarten (na 15 s) en via *Controleren* in de instellingen; geen periodieke controle.
- `lib/tips.js`: inhoud van het tabblad Tips (pure functie, getest; ook als `<script>` in de renderer,
  dan `window.Tips`). Per tip: wat, waarom, stappen (tekst, `prompt` of `cmd` met kopieerknop),
  effect 1–3 met uitleg. Knopnamen en commando's komen uit Anthropic's Help Center en Claude
  Code-documentatie (`SOURCES`, stand oktober 2026); controleer ze als Anthropic de app aanpast.
  Effecten zijn schattingen (API-prijzen, eigen logboeken), nooit verzonnen percentages.
- Volledig scherm: `config.hideInFullscreen`. Windows: `lib/fullscreen.js` (PowerShell-lusje met
  `SHQueryUserNotificationState`, status 2/3/4; niet 7, want dat is elke Store-app zoals Claude;
  stopt als de app-PID weg is). macOS: `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen })`.
  Alleen terugzetten wat we zelf verborgen (`hiddenForFullscreen`).
- `lib/trayicon.js`: stand buiten de widget (`config.trayStatus`: both/fiveHour/sevenDay/off).
  macOS: `tray.setTitle` in de menubalk; Windows/Linux: ringicoon als PNG (eigen encoder, geen
  pakketten) op 16–32 px. Staat het aan, dan wordt ook verborgen elke 5 min opgehaald.
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
dmg (Mac, ad-hoc ondertekend; werkt zichzelf bij via `lib/macupdate.js`, dus de dmg-naam en
`latest-mac.yml` moeten in elke release zitten). Eerste start van de geïnstalleerde app zet de Claude Code-hook aan
(`<exe> --launch --claude-usage-widget`); `--launch` start de app los en stopt meteen.

## Testen

`npm test` (node:test, geen extra pakketten). `npm run demo` toont de widget met nepgegevens.
Prijzen in `lib/pricing.js` bijwerken als Anthropic nieuwe modellen of prijzen uitbrengt.

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
  (alleen zolang zichtbaar, elke 3 min; 10 min na een 429).
- `renderer/`: interface. Tabbladen Limieten, Mappen (alleen als er 30 dagen lokale data is), Tips.
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

## Testen

`npm test` (node:test, geen extra pakketten). `npm run demo` toont de widget met nepgegevens.
Prijzen in `lib/pricing.js` bijwerken als Anthropic nieuwe modellen of prijzen uitbrengt.

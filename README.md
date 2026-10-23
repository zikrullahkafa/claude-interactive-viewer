# Claude-gebruik widget

Een kleine zwevende widget die altijd bovenop staat en laat zien hoeveel van je Claude-limieten je
hebt gebruikt. Hij start automatisch mee als je Claude Code opent.

- **Ingeklapt:** een pil met een ring voor de 5-uurslimiet en de percentages van 5 uur en week.
- **Klik erop:** een paneel met de **5-uurslimiet** en de **weeklimiet** in procenten, met balk,
  kleur (groen < 50%, oranje < 80%, rood daarboven) en wanneer elke limiet reset. Als je abonnement
  aparte weeklimieten voor Opus of Sonnet heeft, of extra gebruik aan heeft staan, staan die eronder.
- **Slepen** om hem te verplaatsen; de plek wordt onthouden.

## Installeren

Je hebt [Node.js](https://nodejs.org) 18 of nieuwer nodig, en je moet in Claude Code ingelogd zijn
met je Claude-abonnement (Pro/Max).

```bash
git clone https://github.com/zikrullahkafa/claude-interactive-viewer.git
cd claude-interactive-viewer
npm install
npm run install-hook
```

`install-hook` voegt een `SessionStart`-hook toe aan `~/.claude/settings.json` (er wordt eerst een
`settings.json.bak` gemaakt; andere instellingen en hooks blijven staan). Vanaf dan verschijnt de
widget zodra je `claude` start of een sessie hervat.

Eenmalig handmatig starten kan met `npm start`. `npm run demo` toont de widget met nepgegevens.

## Wegklikken en weer aanzetten

| Wat | Hoe |
|---|---|
| Inklappen | ˄-knop in het paneel, of `Esc` |
| Verbergen | ×-knop in het paneel, of rechtermuisknop → Verbergen |
| Weer tonen | klik op het icoon in het systeemvak, of `Ctrl+Alt+U` (`⌘+Alt+U` op Mac), of start Claude Code opnieuw |
| Helemaal afsluiten | systeemvak → Afsluiten, of rechtermuisknop → Afsluiten |

In het systeemvakmenu kun je ook “Altijd bovenop” uitzetten.

Wil je niet meer dat hij meestart met Claude: `npm run uninstall-hook`.

## Waar de cijfers vandaan komen

De widget gebruikt hetzelfde endpoint als het `/usage`-commando in Claude Code
(`api.anthropic.com/api/oauth/usage`), met het inlogtoken dat Claude Code al op je computer bewaart:

- Windows/Linux: `~/.claude/.credentials.json`
- macOS: de sleutelhanger (item “Claude Code-credentials”); macOS vraagt de eerste keer om toestemming

Het token gaat alleen naar `api.anthropic.com` en wordt nergens anders opgeslagen. De widget
**ververst het token niet zelf** (dat zou Claude Code kunnen uitloggen); is het verlopen, dan zie je
een melding en zodra Claude Code het token vernieuwt, werkt de widget vanzelf weer.

De limieten gelden voor je hele account, dus het gebruik via claude.ai en de desktop-app telt mee.

Het endpoint is niet officieel gedocumenteerd en kan veranderen. Het wordt elke 3 minuten bevraagd
(bij een rate limit 10 minuten); met de ververs-knop kan het eerder.

## Ontwikkelen

```bash
npm test     # unit-tests voor het ophalen en voor de hook-installer
npm run demo
```

| Bestand | Rol |
|---|---|
| `main.js` | venster, systeemvak, sneltoets, periodiek ophalen |
| `lib/usage.js` | token lezen, endpoint aanroepen, antwoord normaliseren |
| `renderer/` | de interface (pil en paneel) |
| `bin/launch.js` | start de widget losgekoppeld; toont hem weer als hij al draait |
| `scripts/hook.js` | hook in `~/.claude/settings.json` zetten of verwijderen |

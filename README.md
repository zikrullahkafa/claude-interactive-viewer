# Claude Meter

Een kleine zwevende widget die altijd bovenop staat en laat zien hoeveel van je Claude-limieten je
hebt gebruikt. Hij start automatisch mee als je Claude Code opent.

- **Ingeklapt:** een pil met een ring voor de 5-uurslimiet en de percentages van 5 uur en week.
- **Klik erop:** een paneel met de **5-uurslimiet** en de **weeklimiet** in procenten, met balk,
  kleur (groen < 50%, oranje < 80%, rood daarboven) en wanneer elke limiet reset. Als je abonnement
  aparte weeklimieten voor Opus of Sonnet heeft, of extra gebruik aan heeft staan, staan die eronder.
- **Tabblad Mappen** (alleen zichtbaar als er de afgelopen 30 dagen lokale sessies waren): hoeveel elke map op je computer heeft gebruikt in Claude Code en Cowork (deze week vanaf je
  weekreset, vandaag of 30 dagen),
  gewogen naar geschatte API-waarde (Anthropic-prijzen per model, `lib/pricing.js`), met aandeel,
  sessies, modellen en (na klikken) invoer, uitvoer, cache, denktokens en effort-level. Dit komt uit de sessielogboeken van Claude Code (`~/.claude/projects`) en van Cowork
  (`local-agent-mode-sessions` van de desktop-app, ook de Windows Store-locatie onder `Packages`), per map die je in Cowork koos. Gewone chats en cloudsessies staan niet op je
  computer en worden daarom niet per project getoond (ze tellen wel mee in de limieten).
- **Tabblad Verloop:** grafieken over 24 uur, 7, 14 of 30 dagen. Bovenaan je weeklimiet door de
  tijd (bij 24 uur ook de 5-uurslimiet), uit metingen die de widget zelf opslaat zolang hij openstaat
  (`limietverloop.jsonl`, maximaal 62 dagen). Daaronder het verbruik per dag of per uur, gestapeld
  per map (in dollars API-waarde of in tokens), met een legenda met totalen. Beweeg over de grafiek
  voor de precieze waarden.
- **Per product:** hoe je weekverbruik verdeeld is over Claude Code, Chats en Cowork, en je
  cloudsessietegoed in dollars met vervaldatum.
- **Thema:** standaard donker; wisselen met de maan/zon-knop, of kies “Zoals Windows” in het
  systeemvakmenu.
- **Tempo:** bovenaan staat of je in dit tempo de weekreset haalt, zoals op claude.ai.
- **Tabblad Tips:** aanwijzingen om zuiniger te werken, afgeleid uit je limieten en je Claude
  Code-sessies van deze week (effort-levels, modelkeuze, lengte van sessies, denkwerk).
- **Slepen** om hem te verplaatsen; de plek wordt onthouden.

## Installeren

Je hebt [Node.js](https://nodejs.org) 18 of nieuwer nodig, en je moet in Claude Code ingelogd zijn
met je Claude-abonnement (Pro/Max).

```bash
git clone https://github.com/zikrullahkafa/claude-interactive-viewer.git
cd claude-interactive-viewer
npm install
npm run setup
```

`setup` doet twee dingen:

1. **Bureaubladiconen** (Windows; op de Mac zie hieronder): *Claude Meter* opent alleen de widget, *Claude + Meter* opent
   de Claude desktop-app én de widget tegelijk. Sleep *Claude + Meter* eventueel naar je taakbalk
   in plaats van het gewone Claude-icoon. Alleen de iconen opnieuw maken: `npm run shortcut`.
2. **Claude Code-hook**: `setup` voegt een `SessionStart`-hook toe aan `~/.claude/settings.json` (er wordt eerst een
`settings.json.bak` gemaakt; andere instellingen en hooks blijven staan). Vanaf dan verschijnt de
widget zodra je `claude` start of een sessie hervat.

### Op een Mac

Werkt hetzelfde, met het account waarmee Claude Code op die Mac is ingelogd:

```bash
git clone https://github.com/zikrullahkafa/claude-interactive-viewer.git
cd claude-interactive-viewer
npm install
npm run setup
```

`setup` zet *Claude Meter.app* en *Claude + Meter.app* op je bureaublad (sleep ze gerust naar het
Dock). De eerste keer vraagt macOS of de widget de sleutelhanger-item “Claude Code-credentials” mag
lezen; kies *Altijd toestaan*. Het systeemvakicoon staat rechtsboven in de menubalk; de sneltoets is
⌘⌥U. Net als op Windows vernieuwt de widget een verlopen token zelf en schrijft het terug in
hetzelfde sleutelhanger-item.

Eenmalig handmatig starten kan met `npm start`. `npm run demo` toont de widget met nepgegevens.

## Wegklikken en weer aanzetten

| Wat | Hoe |
|---|---|
| Inklappen | ˄-knop in het paneel, of `Esc` |
| Verbergen | ×-knop in het paneel, of rechtermuisknop → Verbergen |
| Weer tonen | klik op het icoon in het systeemvak, of `Ctrl+Alt+U` (`⌘+Alt+U` op Mac), of start Claude Code opnieuw |
| Helemaal afsluiten | systeemvak → Afsluiten, of rechtermuisknop → Afsluiten |

In het systeemvakmenu kun je ook “Altijd bovenop” uitzetten.

De widget start nooit vanzelf met Windows; hij draait alleen als jij hem opent (icoon, Claude Code)
en haalt alleen gegevens op zolang hij zichtbaar is.

Wil je niet meer dat hij meestart met Claude: `npm run uninstall-hook`.

## Waar de cijfers vandaan komen

De widget gebruikt hetzelfde endpoint als het `/usage`-commando in Claude Code
(`api.anthropic.com/api/oauth/usage`), met het inlogtoken dat Claude Code al op je computer bewaart:

- Windows/Linux: `~/.claude/.credentials.json`
- macOS: de sleutelhanger (item “Claude Code-credentials”); macOS vraagt de eerste keer om toestemming
  om te lezen en, bij het eerste vernieuwen, om te schrijven

Het token gaat alleen naar Anthropic en wordt nergens anders opgeslagen. Is het verlopen, dan
vernieuwt de widget het zelf, net zoals Claude Code dat doet, en schrijft het nieuwe token terug in
hetzelfde bestand (alle andere velden blijven staan). Daardoor blijft de widget werken als je alleen
de desktop-app gebruikt. Dit mechanisme is niet officieel gedocumenteerd; mislukt het, dan vraagt de
widget je om in Claude Code `/login` te doen.

De limieten gelden voor je hele account, dus het gebruik via claude.ai en de desktop-app telt mee.

Stuurt Anthropic een limiet mee die de widget nog niet kent, dan verschijnt die automatisch als
extra regel onder de ringen. Het laatste ruwe antwoord (zonder token) staat in
`laatste-antwoord.json`; open het via de rechtermuisknop → “Ruwe gegevens bekijken”. Wordt
een veld gevuld dat tot nu toe leeg was (bijvoorbeeld bij een gratis reset), dan toont de widget
een melding. “Logboeken controleren” laat zien welke sessielogboeken gevonden zijn (alleen
aantallen en veldnamen, geen inhoud).

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
| `lib/usage.js` | token lezen en vernieuwen, endpoint aanroepen, antwoord normaliseren |
| `lib/projects.js` | verbruik per map uit de Claude Code- en Cowork-logboeken |
| `lib/pricing.js` | API-prijzen per model, om verbruik te wegen |
| `lib/history.js` | eigen metingen van de limieten opslaan voor de grafiek |
| `renderer/` | de interface (pil en paneel) |
| `bin/launch.js` | start de widget losgekoppeld; toont hem weer als hij al draait |
| `scripts/hook.js` | hook in `~/.claude/settings.json` zetten of verwijderen |
| `scripts/shortcut.js` | bureaubladiconen maken (Windows: .lnk, macOS: .app) |

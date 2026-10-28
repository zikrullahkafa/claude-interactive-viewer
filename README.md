# Claude Meter

Een kleine zwevende widget die altijd bovenop staat en laat zien hoeveel van je Claude-limieten je
hebt gebruikt. Hij start automatisch mee als je Claude Code opent.

- **Ingeklapt:** een pil met twee ringen (5 uur en week), de percentages en hoe lang het nog duurt
  tot elke reset. Na verplaatsen klikt hij vast aan de schermrand.
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
  per map (in dollars API-waarde of in tokens), met een legenda met totalen. Daartussen het verbruik per
  product (Chats, Cowork, Claude Code) in procent van je weeklimiet, ook uit de eigen metingen,
  en **Patronen**: deze week tegenover vorige week en een heatmap van de dagen en tijden waarop je het
  meest verbruikt (laatste 4 weken). Elke staafgrafiek kan ook als tabel.
- **Instellingen** (tandwiel): thema, pilgrootte, doorzichtig in rust, menubalk/systeemvak,
  standaardgrootte, altijd bovenop, eigen sneltoets (klik en druk de
  combinatie), meestarten met Claude Code, Claude-app meeopenen, meldingen per soort, stille uren,
  een testmelding, exporteren en zoeken naar updates.
- **Exporteren:** een overzicht van de laatste 4 weken als PDF (per week, per dag en per map) of de
  cijfers per dag als CSV voor Excel (puntkomma's en decimale komma's, zoals Nederlandse Excel verwacht).
- **Meldingen** (Windows/Mac): één keer per limietvenster bij 80% en één keer bij 90% van je 5-uurs- of weeklimiet, als je week te snel
  opraakt, na een reset, bij iets nieuws in je account (zoals een gratis reset) en als je cloudtegoed
  bijna verloopt. Per soort aan of uit in de instellingen. Verborgen kijkt de widget elke
  5 minuten (anders elke 3).
- **Per product:** hoe je weekverbruik verdeeld is over Claude Code, Chats en Cowork, en je
  cloudsessietegoed in dollars met vervaldatum.
- **Menubalk en systeemvak:** op de Mac staan je percentages naast het icoon in de menubalk
  (bijv. `5u 77% · wk 61%`); op Windows wordt het systeemvakicoon een ring die meekleurt
  (groen, oranje, rood), met de exacte cijfers als je erop wijst. Kies in de instellingen *Beide*,
  *5 uur*, *Week* of *Uit*. Zo zie je je limiet ook als de widget verborgen is; hij blijft dan
  elke 5 minuten bijwerken. Windows 11 verstopt nieuwe icoontjes achter het pijltje `^` in de
  taakbalk: sleep het icoon naar de taakbalk, of zet het aan bij *Instellingen* → *Persoonlijke
  instellingen* → *Taakbalk* → *Andere systeemvakpictogrammen*.
- **Thema:** standaard donker; wisselen met de maan/zon-knop, of kies *Systeem* in de instellingen
  om Windows/macOS te volgen.
- **Tempo:** bovenaan staat of je in dit tempo de weekreset haalt, zoals op claude.ai.
- **Tabblad Tips:** per tip kort wat het is en waarom het helpt, dan stap voor stap hoe (welk
  scherm, welke knop, welk commando of welke prompt, met een kopieerknop) en hoeveel effect het
  heeft. Op volgorde van wat bij jou het meest oplevert: naar je verdeling over Chats, Cowork en
  Claude Code van deze week, en voor Claude Code naar je eigen sessies (modelkeuze, effort,
  denkwerk, lengte van de context). Met links naar de bronnen bij Anthropic.
- **Slepen** om hem te verplaatsen; de plek wordt onthouden.
- **Volledig scherm:** draait er een game, presentatie of video op volledig scherm, dan gaat de
  widget vanzelf weg en komt hij daarna terug. Op Windows kijkt daarvoor, zolang Claude Meter open
  is, een klein PowerShell-lusje elke 2 seconden mee (het stopt met de app); op de Mac doet de widget
  gewoon niet mee op schermen met een app op volledig scherm. Uit te zetten in de instellingen.
- **Doorzichtig in rust:** staat je muis even niet op de pil, dan vervaagt hij (*Iets* of *Veel*);
  wijs hem aan en hij is meteen weer helder. Het paneel vervaagt nooit. Uitzetten in de instellingen.
- **Groter of kleiner:** sleep aan een hoek van de pil of het paneel; de hoek tegenover de hoek
  waaraan je sleept, blijft staan. De pil schaalt in verhouding mee (70–200%). Bij het paneel volgt
  de hoek je muis: de breedte bepaalt hoe groot alles is (80–160%), de hoogte hoeveel je ziet.
  Het paneel houdt die maat op elk tabblad; langere inhoud (Verloop, Instellingen) scrolt, de
  bovenbalk en tabbladen blijven staan. Pil en paneel onthouden elk hun eigen grootte. Terug naar
  normaal: instellingen → *Standaardgrootte*; voor de pil kan ook Klein/Normaal/Groot.

## Installeren

Download de nieuwste versie bij
[Releases](https://github.com/zikrullahkafa/claude-interactive-viewer/releases/latest).
Je moet in Claude Code ingelogd zijn met je Claude-abonnement (één keer per computer: `claude` in
een terminal en inloggen).

### Windows

1. Download `Claude-Meter-Setup-<versie>.exe` en open het.
2. Windows SmartScreen kan waarschuwen omdat de app niet betaald ondertekend is: klik op
   *Meer informatie* → *Toch uitvoeren*.
3. De app installeert zich, zet *Claude Meter* op je bureaublad en in het startmenu, en start.

Bij het opstarten kijkt de app of er een nieuwe versie is en downloadt die zelf; bovenin het paneel
verschijnt dan *klik om te herstarten en bij te werken*. Tussendoor zoeken kan via het tandwiel →
*Controleren*.

### Mac

1. Download `Claude-Meter-<versie>.dmg`, open het en sleep *Claude Meter* naar *Apps*.
2. Open de app. macOS meldt dat het de ontwikkelaar niet kan controleren: kies *Gereed*, ga naar
   *Systeeminstellingen* → *Privacy en beveiliging* en klik onderaan op *Open toch*.
3. Kies bij de vraag om de sleutelhanger-item “Claude Code-credentials” te gebruiken *Altijd toestaan*.

Ook de Mac-app werkt zichzelf bij (vanaf versie 1.6.0): vindt hij bij het opstarten (of via
tandwiel → *Controleren*) een nieuwe versie, dan downloadt hij die en verschijnt bovenin het paneel
*klik om te herstarten en bij te werken*. De app vervangt dan zichzelf in *Apps* en start opnieuw.
Kan dat niet (bijvoorbeeld als de app niet in *Apps* staat), dan staat er *klik om te downloaden*
en installeer je de nieuwe `.dmg` zelf. Omdat de app geen betaald Apple-certificaat heeft, kan
macOS na een update opnieuw vragen of hij de sleutelhanger mag gebruiken: kies *Altijd toestaan*.

### Na installeren

Open de instellingen met het tandwiel rechtsboven in het paneel:

- **Meestarten met Claude Code**: de widget verschijnt als je `claude` start (staat na installatie aan).
- **Claude-app meeopenen**: als je Claude Meter opent, gaat de Claude desktop-app ook open.

### Verwijderen

- **Windows:** *Instellingen* → *Apps* → *Claude Meter* → *Verwijderen*. De koppeling met Claude Code
  wordt daarbij ook weggehaald.
- **Mac:** zet eerst in de instellingen *Meestarten met Claude Code* uit, sluit de app
  (rechtsklik → *Afsluiten*) en sleep *Claude Meter* uit *Apps* naar de prullenbak.

Je metingen en instellingen blijven bewaard in `%APPDATA%\claude-usage-widget` (Windows) of
`~/Library/Application Support/claude-usage-widget` (Mac); verwijder die map als je alles kwijt wilt.

### Vanaf de broncode (voor ontwikkelen)

```bash
git clone https://github.com/zikrullahkafa/claude-interactive-viewer.git
cd claude-interactive-viewer
npm install
npm start            # of: npm run setup voor hook + bureaubladiconen van de ontwikkelversie
```

Een nieuwe release maken: verhoog `version` in `package.json`, zet het op `main` en start op GitHub
*Actions* → *Release* → *Run workflow* (of push een tag `v<versie>`). De workflow bouwt de Windows-
en Mac-versie en publiceert ze.

## Wegklikken en weer aanzetten

| Wat | Hoe |
|---|---|
| Inklappen | klik op de bovenbalk van het paneel (bij „Claude Meter”), of `Esc` |
| Groter of kleiner | sleep aan een hoek (de grepen verschijnen als je muis boven de widget is) |
| Verbergen | ×-knop in het paneel, of rechtermuisknop → Verbergen (de eerste keer legt een melding uit hoe je hem terughaalt) |
| Weer tonen | klik op het icoon in het systeemvak (Mac: menubalk → *Widget tonen*); dat haalt hem altijd tevoorschijn, ook als hij achter een venster of op een losgekoppeld scherm stond. Of de sneltoets (standaard `Ctrl+Alt+U`, op de Mac `⌘⌥U`; te wijzigen in de instellingen), of start Claude Code opnieuw |
| Helemaal afsluiten | systeemvak → Afsluiten, of rechtermuisknop → Afsluiten |

In het systeemvakmenu kun je ook “Altijd bovenop” uitzetten.

De widget start nooit vanzelf met Windows; hij draait alleen als jij hem opent (icoon, Claude Code).
Verborgen haalt hij alleen gegevens op als er meldingen aan staan.

Niet meer meestarten met Claude Code: zet het uit in de instellingen (ontwikkelversie:
`npm run uninstall-hook`).

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
| `lib/report.js` | overzicht voor export (CSV en HTML voor de PDF) |
| `lib/shortcut.js` | toetscombinatie omzetten naar een sneltoets en terug |
| `lib/alerts.js` | regels voor meldingen en stille uren |
| `lib/trayicon.js` | ringicoon (Windows) en tekst (menubalk Mac) met de limieten |
| `lib/tips.js` | de tips: wat, waarom, stappen en effect, gesorteerd voor deze gebruiker |
| `lib/fullscreen.js` | Windows: merken dat een programma op volledig scherm draait |
| `lib/updates.js` | nieuwe versies zoeken en installeren |
| `lib/macupdate.js` | zelf bijwerken op de Mac (dmg downloaden, controleren, omwisselen) |
| `renderer/` | de interface (pil en paneel) |
| `bin/launch.js` | start de widget losgekoppeld; toont hem weer als hij al draait |
| `scripts/hook.js` | hook in `~/.claude/settings.json` zetten of verwijderen |
| `scripts/shortcut.js` | bureaubladiconen maken (Windows: .lnk, macOS: .app) |

'use strict';
// Tips om zuiniger te werken: per tip wat het is, waarom het helpt, stap voor stap hoe, en hoeveel
// effect het heeft. Gesorteerd op wat bij deze gebruiker het meest oplevert (verdeling per product
// van deze week en, voor Claude Code, de eigen sessielogboeken).
// Knoppen en menu's zoals de Claude-app en Claude Code ze in oktober 2026 noemen; bronnen in SOURCES.
// Werkt in Node (tests) én in de renderer (als <script>, dan op window.Tips).

(function (root) {
  const SOURCES = [
    { label: 'Usage limit best practices', url: 'https://support.claude.com/en/articles/9797557-usage-limit-best-practices' },
    { label: 'How do usage and length limits work?', url: 'https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work' },
    { label: 'Change the model, effort, and thinking settings', url: 'https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings' },
    { label: 'Schedule recurring tasks in Claude Cowork', url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork' },
    { label: 'Claude Code: Manage costs effectively', url: 'https://code.claude.com/docs/en/costs' },
    { label: 'Claude Code: Model configuration', url: 'https://code.claude.com/docs/en/model-config' },
  ];

  const AREAS = { app: 'Chat en Cowork', cowork: 'Cowork', code: 'Claude Code' };

  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} mln` : `${Math.round(n / 1000)}k`);
  const sumWhere = (list, names) => (list || []).filter((x) => names.includes(x.name)).reduce((a, x) => a + (x.cost || 0), 0);

  // Stap: tekst, of { text, prompt } met een tekst om te kopiëren, of { text, cmd } met een commando.
  // effect: 3 groot, 2 middel, 1 klein.
  function catalog(ctx) {
    const { s, mod } = ctx;
    const tips = [];

    // ---------- Chat en Cowork (de Claude-app en claude.ai) ----------

    tips.push({
      id: 'app-model', area: 'app', effect: 3,
      title: 'Kies Sonnet voor gewoon werk',
      why: 'Opus is het zwaarste model en gebruikt je limiet het snelst. Voor samenvatten, mails, uitleg, opmaak en de meeste Cowork-taken is Sonnet ruim voldoende.',
      steps: [
        'Klik in het invoerveld op de modelnaam, naast de verzendknop.',
        'Kies **Sonnet**. Staat het er niet bij, klik dan op **More models**.',
        'Voor een lastige analyse zet je hem in hetzelfde menu terug op **Opus**; dat kan midden in een gesprek.',
        'Voor heel eenvoudige klusjes (spelling, kort herformuleren) is **Haiku** nog veel zuiniger.',
      ],
      effectText: 'Ongeveer de helft minder per bericht dan Opus: Sonnet 5.5 kost per token de helft van Opus 5.5 (API-prijzen; Anthropic noemt voor abonnementen geen exacte factor).',
    });

    tips.push({
      id: 'app-effort', area: 'app', effect: 3,
      title: 'Zet de effort lager bij routinewerk',
      why: 'Effort bepaalt hoe lang Claude nadenkt. Dat denkwerk telt als uitvoer, het duurste deel van een bericht. Anthropic raadt Low of Medium aan voor routinetaken en High voor lastige vragen.',
      steps: [
        'Klik in het invoerveld op de modelnaam, naast de verzendknop.',
        'Klik op **Effort**.',
        'Kies **Low** of **Medium** voor routinewerk. **High** alleen voor lastige vragen; **Extra high** en **Max** alleen als het echt moet.',
        'Bij de nieuwste modellen (Sonnet 5.5, Opus 5.5) kan **Thinking** niet uit: daar is effort de knop om denkwerk te beperken.',
      ],
      effectText: 'Groot als je nu op High, Extra high of Max staat; klein als je al op Low of Medium staat.',
    });

    tips.push({
      id: 'app-newchat', area: 'app', effect: 3,
      title: 'Nieuw onderwerp? Begin een nieuw gesprek',
      why: 'Bij elk bericht leest Claude het hele gesprek opnieuw. Dezelfde vraag kost in een lang gesprek dus veel meer dan in een nieuw gesprek. Heel lange gesprekken worden bovendien automatisch ingekort, en dat kost extra.',
      steps: [
        'Klaar met een taak of onderwerp? Begin een nieuw gesprek met **New chat** bovenaan de zijbalk.',
        { text: 'Heb je iets uit het oude gesprek nodig, vraag dan eerst om een samenvatting en plak die in het nieuwe gesprek:', prompt: 'Vat dit gesprek samen in maximaal 10 punten: de beslissingen, de belangrijkste feiten en wat er nog moet gebeuren. Ik plak het in een nieuw gesprek.' },
      ],
      effectText: 'Hoe langer het oude gesprek, hoe groter. Rekenvoorbeeld: na 40 berichten van zo\'n 500 woorden leest elke nieuwe vraag ongeveer 25.000 tokens geschiedenis mee; in een nieuw gesprek bijna niets.',
    });

    tips.push({
      id: 'app-batch', area: 'app', effect: 2,
      title: 'Stel je vragen in één bericht',
      why: 'Elk los bericht leest het hele gesprek opnieuw. Drie vragen in één bericht is één keer lezen in plaats van drie keer. Geef meteen de achtergrond mee, dan hoeft Claude niet door te vragen.',
      steps: [
        'Schrijf eerst op wat je wilt weten en zet alles in één bericht.',
        { text: 'Gebruik dit sjabloon:', prompt: 'Context: [wie, wat en waarvoor]\nVragen:\n1. …\n2. …\n3. …\nVorm: kort, genummerd, maximaal 5 zinnen per vraag.' },
        'Lees je bericht na voor je het verstuurt: een onduidelijke vraag kost een extra rondje.',
      ],
      effectText: 'Middel: bij drie losse vragen in een lopend gesprek scheelt het twee keer het hele gesprek opnieuw lezen.',
    });

    tips.push({
      id: 'app-short', area: 'app', effect: 2,
      title: 'Vraag om korte antwoorden, voor altijd',
      why: 'Uitvoer kost per token vijf keer zoveel als invoer (API-prijzen). Inleidingen, herhalingen en samenvattingen aan het eind tellen dus zwaar mee.',
      steps: [
        'Ga naar **Settings** → **Your Claude** → **Instructions for Claude** (in het oudere scherm: **Settings** → **Account**).',
        { text: 'Plak deze tekst en sla op:', prompt: 'Antwoord beknopt en zakelijk. Geen inleiding, geen herhaling van mijn vraag en geen samenvatting aan het eind. Gebruik opsommingen waar dat kan. Vraag door als iets onduidelijk is in plaats van te gokken.' },
        'Houd die instructies kort: ze gaan met elk bericht mee.',
      ],
      effectText: 'Middel: hoeveel hangt af van hoe lang de antwoorden nu zijn; het telt bij elk antwoord.',
    });

    tips.push({
      id: 'app-project', area: 'app', effect: 2,
      title: 'Zet vaste documenten in een project',
      why: 'Bestanden in een project worden tijdelijk bewaard (cache). Gebruik je ze opnieuw, dan telt dat minder mee dan steeds opnieuw uploaden. Na een lange pauze telt het eerste bericht ze wel weer volledig.',
      steps: [
        'Klik in de zijbalk op **Projects** en maak een nieuw project.',
        'Zet je vaste stukken in de projectkennis, bijvoorbeeld werkinstructies, protocollen of een overzicht dat je vaak raadpleegt.',
        'Begin gesprekken over dat onderwerp voortaan in het project en upload die bestanden niet meer los.',
        'Haal bestanden weg die je niet meer gebruikt en houd de projectinstructies kort.',
        'Werk een reeks vragen het liefst achter elkaar af: na een lange pauze is de cache verlopen.',
      ],
      effectText: 'Groot als je nu vaak dezelfde bestanden uploadt; klein als je dat niet doet.',
    });

    tips.push({
      id: 'app-tools', area: 'app', effect: 2,
      title: 'Laat Claude niet onnodig zoeken of apps gebruiken',
      why: 'Zoeken op internet en gekoppelde apps (connectors) zijn volgens Anthropic tokenintensief. In de nieuwe app beslist Claude zelf wanneer hij zoekt, dus zeg het als het niet hoeft.',
      steps: [
        { text: 'Heb je geen actuele informatie nodig, zet dan in je vraag:', prompt: 'Zoek niet op internet en gebruik geen gekoppelde apps; gebruik alleen wat ik je geef.' },
        'Koppelingen die je zelden gebruikt: ga naar **Customize** → **Connectors** en haal ze weg.',
        'Gebruik **Research** (of /deep-research) alleen voor echt uitzoekwerk: dat is een lange zoektocht.',
      ],
      effectText: 'Middel: scheelt per keer dat Claude anders was gaan zoeken of een app had aangesproken.',
    });

    // ---------- Cowork ----------

    tips.push({
      id: 'cw-scope', area: 'cowork', effect: 3,
      title: 'Geef Cowork een afgebakende opdracht',
      why: 'Taken waarbij Claude zoekt, code draait of bestanden maakt, gebruiken veel meer dan een vraag. Hoe vager de opdracht, hoe meer Claude zelf gaat verkennen.',
      steps: [
        'Noem precies welke bestanden of map, hoeveel, en wat het eindresultaat moet zijn.',
        { text: 'Voorbeeld:', prompt: 'Gebruik alleen de 3 nieuwste bestanden in de map [naam]. Maak één samenvatting van maximaal 1 pagina in Word. Lees geen andere bestanden en zoek niet op internet; vraag het me als je meer nodig hebt.' },
        'Geef Cowork alleen toegang tot de map die nodig is, niet tot je hele Documenten-map.',
      ],
      effectText: 'Groot bij taken waarin Claude nu zelf door veel bestanden of webpagina\'s gaat.',
    });

    tips.push({
      id: 'cw-plan', area: 'cowork', effect: 2,
      title: 'Laat eerst een plan maken bij grote taken',
      why: 'Gaat een grote taak de verkeerde kant op, dan betaal je hem twee keer. Een kort plan kost weinig, en jij stuurt bij voordat het echte werk begint.',
      steps: [
        { text: 'Begin je opdracht met:', prompt: 'Maak eerst een plan van maximaal 5 stappen en wacht op mijn akkoord voordat je begint.' },
        'Pas het plan aan waar nodig en geef dan pas akkoord.',
        'Zie je Claude de verkeerde kant op gaan, stop hem dan meteen met de stopknop bij het invoerveld.',
      ],
      effectText: 'Middel: voorkomt vooral dubbel werk bij grote taken.',
    });

    tips.push({
      id: 'cw-scheduled', area: 'cowork', effect: 2,
      title: 'Kijk je geplande taken na',
      why: 'Elke geplande taak draait als een eigen Cowork-sessie en telt mee voor je limieten, ook als je computer uit staat.',
      steps: [
        'Klik in de zijbalk op **Scheduled**.',
        'Kijk per taak hoe vaak hij draait. Zet uurlijkse taken waar het kan op dagelijks of op werkdagen.',
        'Pauzeer of verwijder taken die je niet meer nodig hebt.',
        'Kies bij eenvoudige taken een lichter model (Sonnet of Haiku) in de taakinstellingen.',
      ],
      effectText: 'Groot als er een taak elk uur draait (24 sessies per dag); klein bij één taak per week.',
    });

    // ---------- Claude Code ----------

    const ctxPerMsg = s && s.messages ? (s.input + s.cacheRead + s.cacheWrite) / s.messages : 0;
    tips.push({
      id: 'code-clear', area: 'code', effect: ctxPerMsg > 60000 || !s ? 3 : 2,
      title: 'Wis de geschiedenis tussen taken met /clear',
      why: 'Claude Code stuurt het hele gesprek mee met elk verzoek, ook bij elke tool-aanroep. Oude geschiedenis van een andere taak kost zo bij elk bericht opnieuw.',
      personal: ctxPerMsg ? `Deze week las elk antwoord op deze computer gemiddeld ${tokens(ctxPerMsg)} tokens context.` : null,
      steps: [
        { text: 'Geef de sessie eerst een naam, zodat je hem terugvindt:', cmd: '/rename [naam]' },
        { text: 'Begin je aan iets anders, wis dan de geschiedenis (kost niets):', cmd: '/clear' },
        { text: 'Zelfde taak maar een lange sessie? Laat samenvatten en zeg wat belangrijk is:', cmd: '/compact houd de wijzigingen aan [onderdeel]' },
        { text: 'Terug naar een eerdere sessie:', cmd: '/resume' },
      ],
      effectText: 'Groot in sessies die lang openstaan. /clear kost niets; /compact is zelf één groot verzoek, dus doe het op een natuurlijk moment.',
    });

    const premium = s ? pct(sumWhere(s.models, ['Opus', 'Fable', 'Mythos']), s.cost) : null;
    tips.push({
      id: 'code-model', area: 'code', effect: premium == null || premium >= 50 ? 3 : 1,
      title: 'Sonnet voor het meeste codewerk',
      why: 'Sonnet kan het meeste programmeerwerk en kost minder dan Opus. Bewaar Opus voor lastige ontwerpkeuzes en moeilijk debugwerk.',
      personal: premium != null && s.cost ? `${premium}% van je verbruik op deze computer was deze week Opus of zwaarder.` : null,
      steps: [
        { text: 'Voor dagelijks werk:', cmd: '/model sonnet' },
        { text: 'Opus voor het plan, Sonnet voor de uitvoering:', cmd: '/model opusplan' },
        'Wissel bij het begin van een taak, niet halverwege: het eerste bericht na een wissel leest het hele gesprek opnieuw zonder cache.',
      ],
      effectText: 'Ongeveer de helft per token (Sonnet 5.5 tegenover Opus 5.5, API-prijzen).',
    });

    const heavy = s ? pct(sumWhere(s.efforts, ['high', 'xhigh', 'max']), s.cost) : null;
    const thinking = s && s.output ? pct(s.thinking, s.output) : null;
    tips.push({
      id: 'code-effort', area: 'code', effect: heavy == null || heavy >= 50 ? 3 : 1,
      title: 'Lagere effort voor routinewerk',
      why: 'Effort bepaalt hoeveel Claude per stap nadenkt; dat denkwerk telt als uitvoer. Medium is de standaard voor Sonnet 5.5 en Opus 5.5 en volstaat voor dagelijks werk met een duidelijke opdracht.',
      personal: heavy != null && s.cost ? `${heavy}% van je verbruik draaide deze week op effort high of hoger${thinking != null ? `; ${thinking}% van de uitvoer was denkwerk` : ''}.` : null,
      steps: [
        { text: 'Dagelijks werk:', cmd: '/effort medium' },
        { text: 'Kleine klussen (hernoemen, een eerste opzet):', cmd: '/effort low' },
        { text: 'Zonder waarde opent een schuifje; in /model kan het ook met de pijltjestoetsen:', cmd: '/effort' },
        'Gebruik max alleen voor een moeilijk probleem; het geldt alleen voor de huidige sessie.',
      ],
      effectText: 'Groot als je vaak op high, xhigh of max werkt; klein als je al op medium of low zit.',
    });

    tips.push({
      id: 'code-usage', area: 'code', effect: 2,
      title: 'Laat /usage aanwijzen wat het meeste kost',
      why: 'Claude Code houdt bij waar je verbruik heen gaat (skills, subagents, MCP-servers, lange context) en geeft per regel een aanbeveling.',
      steps: [
        { text: 'Open het overzicht:', cmd: '/usage' },
        'Lees de aanbevelingen onderaan. Het percentage zegt over hoeveel van je verbruik het gaat, niet hoeveel het bespaart.',
        'Druk op **f** om Claude Code de aanbevelingen te laten uitvoeren die het zelf kan (vanaf versie 2.1.305).',
        'Met **d** en **w** wissel je tussen de laatste 24 uur en 7 dagen.',
      ],
      effectText: 'Middel tot groot: het wijst precies aan wat bij jou het meeste kost.',
    });

    const cacheHeavy = s ? pct(s.cacheWrite * 1.25, s.input + s.cacheRead * 0.1 + s.cacheWrite * 1.25) >= 40 : false;
    tips.push({
      id: 'code-context', area: 'code', effect: cacheHeavy ? 2 : 1,
      title: 'Houd de vaste context klein',
      why: 'CLAUDE.md, MCP-servers en geplakte bestanden zitten bij elk verzoek in de context. Hoe kleiner die basis, hoe goedkoper elk bericht.',
      personal: cacheHeavy ? 'Een groot deel van je verbruik ging deze week op aan nieuwe context in de cache schrijven.' : null,
      steps: [
        'Houd **CLAUDE.md** onder ongeveer 200 regels; zet specifieke werkwijzen in een skill (die laadt alleen als hij nodig is).',
        'Verwijs naar bestanden met hun pad in plaats van ze te plakken, en kort logs in tot de 20 à 30 regels die ertoe doen.',
        { text: 'Zet MCP-servers uit die je niet gebruikt:', cmd: '/mcp' },
        { text: 'Kijk wat er nu in de context zit:', cmd: '/context' },
      ],
      effectText: 'Klein tot middel per bericht, maar het telt bij elk bericht.',
    });

    return tips.map((t) => ({ ...t, areaLabel: AREAS[t.area], weight: mod[t.area] }));
  }

  // Hoeveel elk gebied bij deze gebruiker meetelt (0–1), uit de verdeling per product van deze week.
  function weights(usage, summary) {
    const rows = (usage && usage.products && usage.products.rows) || [];
    const share = (key) => {
      const r = rows.find((x) => x.key === key);
      return r ? r.percent / 100 : 0;
    };
    const hasLogs = !!(summary && summary.messages);
    if (!rows.length) return { app: 1, cowork: 0.6, code: hasLogs ? 0.6 : 0 };
    const chat = share('chat');
    const cowork = share('cowork');
    const code = share('claude_code');
    return { app: Math.max(chat + cowork, 0.05), cowork: cowork, code: code > 0 ? code : hasLogs ? 0.05 : 0 };
  }

  /**
   * @param {object} usage    genormaliseerde usage (fiveHour, sevenDay, products)
   * @param {object|null} projects  uitkomst van projectUsage voor deze week ({ summary }) of null
   * @returns {{ mix: {name: string, percent: number}[], tips: object[] }}
   */
  function buildTips(usage, projects) {
    const s = projects && projects.summary && projects.summary.messages ? projects.summary : null;
    const mod = weights(usage, s);
    const tips = catalog({ s, mod })
      .filter((t) => t.weight > 0)
      .map((t) => ({ ...t, score: t.effect * (0.4 + t.weight) + (t.personal ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score);
    const mix = ((usage && usage.products && usage.products.rows) || [])
      .filter((r) => r.percent > 0)
      .map((r) => ({ name: r.name, percent: Math.round(r.percent) }))
      .sort((a, b) => b.percent - a.percent);
    return { mix, tips };
  }

  const api = { buildTips, weights, SOURCES, AREAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tips = api;
})(typeof window !== 'undefined' ? window : globalThis);

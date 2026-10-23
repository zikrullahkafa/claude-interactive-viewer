'use strict';
// API-prijzen van Anthropic in dollar per miljoen tokens (bron: Anthropic-prijslijst, stand oktober 2026).
// Abonnementen betalen niet per token; we gebruiken dit alleen om verbruik eerlijk te wegen:
// een gelezen cachetoken kost een fractie van een uitvoertoken.
// cacheRead staat er alleen bij als het afwijkt van de standaard 0,1 x invoer.

const PRICES = [
  // [voorvoegsel van model-ID, invoer, uitvoer, cacheRead]
  ['claude-fable-5', 10, 50, 0.25],
  ['claude-mythos-5', 10, 50, 0.25],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-opus-5', 5, 25],
  ['claude-opus-4-8', 5, 25],
  ['claude-opus-4-7', 5, 25],
  ['claude-opus-4-6', 5, 25],
  ['claude-opus-4-5', 5, 25],
  ['claude-opus-4', 15, 75], // Opus 4 en 4.1
  ['claude-sonnet-5', 2, 10, 0.2], // Sonnet 5 en 5.5
  ['claude-sonnet-4', 3, 15],
  ['claude-haiku-5-5', 0.1, 0.5],
  ['claude-haiku-4-5', 1, 5],
  ['claude-haiku', 0.8, 4],
];

// Onbekend model: val terug op de huidige generatie van dezelfde familie.
const FAMILY_FALLBACK = { fable: 'claude-fable-5', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-5-5' };

function priceFor(model) {
  const id = String(model || '').toLowerCase();
  let row = PRICES.find(([prefix]) => id.startsWith(prefix));
  if (!row) {
    const fam = /(fable|mythos|opus|sonnet|haiku)/.exec(id);
    const fallback = fam && FAMILY_FALLBACK[fam[1] === 'mythos' ? 'fable' : fam[1]];
    row = fallback && PRICES.find(([prefix]) => prefix === fallback);
  }
  if (!row) return null;
  const [, input, output, cacheRead] = row;
  return { input, output, cacheRead: cacheRead ?? input * 0.1 };
}

// Kosten in dollar van één antwoord. Cache schrijven: 1,25x invoer (5 minuten) of 2x (1 uur).
function costOf(usage, model) {
  const p = priceFor(model);
  if (!p || !usage) return 0;
  const cc = usage.cache_creation || {};
  const write1h = cc.ephemeral_1h_input_tokens || 0;
  const write5m = cc.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - write1h);
  return (
    ((usage.input_tokens || 0) * p.input +
      (usage.output_tokens || 0) * p.output +
      write5m * p.input * 1.25 +
      write1h * p.input * 2 +
      (usage.cache_read_input_tokens || 0) * p.cacheRead) /
    1e6
  );
}

module.exports = { priceFor, costOf };

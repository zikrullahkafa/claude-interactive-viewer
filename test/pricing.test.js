'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { priceFor, costOf } = require('../lib/pricing');

test('prijzen per model en terugval per familie', () => {
  assert.deepStrictEqual(priceFor('claude-opus-5-5'), { input: 4, output: 20, cacheRead: 0.2 });
  assert.strictEqual(priceFor('claude-opus-4-1-20250805').input, 15);
  assert.strictEqual(priceFor('claude-opus-4-8').input, 5);
  assert.strictEqual(priceFor('claude-sonnet-4-5-20250929').output, 15);
  assert.strictEqual(priceFor('claude-sonnet-9').input, 2); // onbekend: huidige Sonnet
  assert.strictEqual(priceFor('<synthetic>'), null);
});

test('cache schrijven 1 uur kost 2x invoer', () => {
  const usage = { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } };
  assert.strictEqual(costOf(usage, 'claude-sonnet-5-5'), 4);
  assert.strictEqual(costOf({ cache_creation_input_tokens: 1e6 }, 'claude-sonnet-5-5'), 2.5);
});

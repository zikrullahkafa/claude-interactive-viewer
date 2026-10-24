'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// lib/updates.js laadt 'electron'; voor deze test is alleen newer() nodig.
const load = Module._load;
Module._load = (req, ...rest) => (req === 'electron' ? { app: {}, shell: {} } : load(req, ...rest));
const { newer } = require('../lib/updates');
Module._load = load;

test('versies vergelijken', () => {
  assert.strictEqual(newer('v1.10.0', '1.9.2'), true);
  assert.strictEqual(newer('1.1.0', '1.1.0'), false);
  assert.strictEqual(newer('1.0.9', '1.1.0'), false);
  assert.strictEqual(newer('2.0', '1.9.9'), true);
});

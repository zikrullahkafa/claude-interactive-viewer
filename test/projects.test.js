'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectUsage, modelFamily } = require('../lib/projects');

const line = (o) => JSON.stringify(o) + '\n';
const reply = (id, model, usage, ts = new Date().toISOString(), extra = {}) =>
  line({ type: 'assistant', timestamp: ts, sessionId: 's1', requestId: `r${id}`, message: { id: `m${id}`, model, usage }, ...extra });

test('telt tokens per projectmap, ontdubbelt en filtert op periode', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-p-'));
  process.env.CLAUDE_CONFIG_DIR = base;
  const a = path.join(base, 'projects', 'C--werk-PharmaQuest');
  const b = path.join(base, 'projects', 'C--werk-notities');
  fs.mkdirSync(path.join(a, 'sess', 'subagents'), { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  const old = new Date(Date.now() - 40 * 86400e3).toISOString();
  fs.writeFileSync(
    path.join(a, 's1.jsonl'),
    line({ type: 'user', cwd: 'C:\\werk\\PharmaQuest', message: { content: 'hoi' } }) +
      reply(1, 'claude-opus-4-1', { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000 }) +
      reply(1, 'claude-opus-4-1', { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000 }) + // dubbel
      reply(2, 'claude-sonnet-4-5', { input_tokens: 5, output_tokens: 50 }) +
      reply(3, 'claude-sonnet-4-5', { input_tokens: 999, output_tokens: 999 }, old) + // buiten periode
      'kapotte regel met "usage"\n'
  );
  fs.writeFileSync(path.join(a, 'sess', 'subagents', 'x.jsonl'), reply(4, 'claude-haiku-4-5', { input_tokens: 1, output_tokens: 9 }));
  fs.writeFileSync(path.join(b, 's2.jsonl'), line({ cwd: '/home/z/notities' }) + reply(5, 'claude-sonnet-4-5', { input_tokens: 1, output_tokens: 1 }));

  const r = await projectUsage(Date.now() - 7 * 86400e3);
  assert.strictEqual(r.projects.length, 2);
  const pq = r.projects[0];
  assert.strictEqual(pq.name, path.basename('C:\\werk\\PharmaQuest'));
  assert.strictEqual(pq.tokens, 10 + 100 + 1000 + 5 + 50 + 1 + 9);
  assert.strictEqual(pq.output, 159);
  assert.deepStrictEqual(pq.models.map((m) => m.name), ['Opus', 'Sonnet', 'Haiku']);
  assert.strictEqual(r.projects[1].name, 'notities');
  assert.strictEqual(r.total, pq.tokens + 2);

  const r30 = await projectUsage(Date.now() - 60 * 86400e3);
  assert.strictEqual(r30.projects[0].tokens, pq.tokens + 1998);
});

test('periode begint op het uur nauwkeurig', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-p-'));
  process.env.CLAUDE_CONFIG_DIR = base;
  const dir = path.join(base, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  fs.writeFileSync(
    path.join(dir, 's.jsonl'),
    reply(1, 'claude-sonnet-4-5', { output_tokens: 1 }, h(5)) + reply(2, 'claude-sonnet-4-5', { output_tokens: 10 }, h(1))
  );
  const r = await projectUsage(Date.now() - 3 * 3600e3);
  assert.strictEqual(r.total, 10);
});

test('modelFamily', () => {
  assert.strictEqual(modelFamily('claude-sonnet-4-5-20250929'), 'Sonnet');
  assert.strictEqual(modelFamily('<synthetic>'), 'Overig');
});

test('weegt kosten per model en telt effort en denktokens', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-p-'));
  process.env.CLAUDE_CONFIG_DIR = base;
  const dir = path.join(base, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 's.jsonl'),
    reply(1, 'claude-opus-5-5', { input_tokens: 1e6, output_tokens: 0, output_tokens_details: { thinking_tokens: 0 } }, undefined, { perTurnEffort: 'high' }) +
      reply(2, 'claude-sonnet-5-5', { output_tokens: 1e6, output_tokens_details: { thinking_tokens: 4e5 }, cache_read_input_tokens: 1e6 }, undefined, { perTurnEffort: 'medium' })
  );
  const r = await projectUsage(Date.now() - 86400e3);
  const p = r.projects[0];
  assert.strictEqual(Math.round(p.cost * 100) / 100, 4 + 10 + 0.2); // Opus 5.5 invoer, Sonnet 5.5 uitvoer + cache lezen
  assert.strictEqual(p.thinking, 4e5);
  assert.deepStrictEqual(p.efforts.map((e) => e.name), ['medium', 'high']);
  assert.strictEqual(r.summary.models[0].name, 'Sonnet');
});

test('leest ook Cowork-sessies en groepeert die per werkmap', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-p-'));
  process.env.CLAUDE_CONFIG_DIR = base;
  const cowork = path.join(base, 'cowork');
  process.env.CLAUDE_METER_COWORK_DIRS = cowork;
  for (const sess of ['sess-a', 'sess-b']) {
    const dir = path.join(cowork, sess, '.claude', 'projects', 'x');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 's.jsonl'), line({ cwd: '/sessions/werk/Notulen/' }) + reply(sess, 'claude-sonnet-5-5', { output_tokens: 100 }));
  }
  const mcp = path.join(cowork, 'mcp-logs-x');
  fs.mkdirSync(mcp, { recursive: true });
  fs.writeFileSync(path.join(mcp, 'log.jsonl'), reply('mcp', 'claude-sonnet-5-5', { output_tokens: 999 }));
  try {
    const r = await projectUsage(Date.now() - 86400e3);
    assert.strictEqual(r.projects.length, 1);
    assert.strictEqual(r.projects[0].source, 'Cowork');
    assert.strictEqual(r.projects[0].name, 'Notulen');
    assert.strictEqual(r.projects[0].output, 200);
  } finally {
    delete process.env.CLAUDE_METER_COWORK_DIRS;
  }
});

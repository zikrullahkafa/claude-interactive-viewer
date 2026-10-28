'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildTips, SOURCES } = require('../lib/tips');

const usage = (rows) => ({ sevenDay: { percent: 40 }, fiveHour: { percent: 10 }, products: { rows } });
const coworkHeavy = usage([{ key: 'cowork', name: 'Cowork', percent: 85 }, { key: 'chat', name: 'Chats', percent: 15 }, { key: 'claude_code', name: 'Claude Code', percent: 0 }]);
const codeLogs = {
  summary: {
    messages: 400, cost: 100, input: 2e6, output: 3e6, cacheRead: 60e6, cacheWrite: 4e6, thinking: 2.1e6,
    models: [{ name: 'Opus', cost: 80 }, { name: 'Sonnet', cost: 20 }],
    efforts: [{ name: 'high', cost: 55 }, { name: 'xhigh', cost: 15 }, { name: 'medium', cost: 30 }],
  },
};

test('elke tip heeft wat, waarom, stappen en effect', () => {
  const { tips } = buildTips(usage([{ key: 'cowork', name: 'Cowork', percent: 50 }, { key: 'claude_code', name: 'Claude Code', percent: 50 }]), codeLogs);
  assert.ok(tips.length >= 10);
  for (const t of tips) {
    assert.ok(t.title && t.why && t.effectText, t.id);
    assert.ok([1, 2, 3].includes(t.effect), t.id);
    assert.ok(t.steps.length >= 2, t.id);
    for (const step of t.steps) {
      const text = typeof step === 'string' ? step : step.text;
      assert.ok(text && !/undefined|NaN/.test(text), t.id);
      if (typeof step !== 'string') assert.ok(step.prompt || step.cmd, t.id);
    }
    assert.ok(!/undefined|NaN/.test(JSON.stringify(t)), t.id);
  }
});

test('veel Cowork: Chat- en Cowork-tips eerst, geen Claude Code-tips zonder Code-gebruik', () => {
  const { mix, tips } = buildTips(coworkHeavy, null);
  assert.deepStrictEqual(mix, [{ name: 'Cowork', percent: 85 }, { name: 'Chats', percent: 15 }]);
  assert.ok(tips.slice(0, 4).every((t) => t.area !== 'code'));
  assert.ok(tips.every((t) => t.area !== 'code'));
  assert.ok(tips.some((t) => t.id === 'cw-scope'));
});

test('veel Claude Code met Opus en hoge effort: persoonlijke Code-tips bovenaan', () => {
  const rows = [{ key: 'claude_code', name: 'Claude Code', percent: 80 }, { key: 'chat', name: 'Chats', percent: 20 }];
  const { tips } = buildTips(usage(rows), codeLogs);
  const top = tips.slice(0, 3).map((t) => t.id);
  assert.ok(top.includes('code-model') && top.includes('code-effort'), top.join());
  assert.match(tips.find((t) => t.id === 'code-model').personal, /80% van je verbruik/);
  assert.match(tips.find((t) => t.id === 'code-effort').personal, /70% van je verbruik.*70% van de uitvoer/);
  assert.match(tips.find((t) => t.id === 'code-clear').personal, /165k tokens context/);
});

test('zuinig in Claude Code: model- en effort-tip zakken naar effect klein', () => {
  const lean = { summary: { ...codeLogs.summary, models: [{ name: 'Sonnet', cost: 100 }], efforts: [{ name: 'medium', cost: 100 }] } };
  const { tips } = buildTips(usage([{ key: 'claude_code', name: 'Claude Code', percent: 100 }]), lean);
  assert.strictEqual(tips.find((t) => t.id === 'code-model').effect, 1);
  assert.strictEqual(tips.find((t) => t.id === 'code-effort').effect, 1);
});

test('zonder gegevens: algemene tips, geen verdeling', () => {
  const { mix, tips } = buildTips({}, null);
  assert.deepStrictEqual(mix, []);
  assert.ok(tips.length >= 7);
  assert.ok(tips.every((t) => t.area !== 'code'));
});

test('bronnen zijn pagina\'s van Anthropic', () => {
  for (const s of SOURCES) assert.match(s.url, /^https:\/\/(support\.claude\.com|code\.claude\.com)\//);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchUsage, normalize, parseCredentials } = require('../lib/usage');

const SAMPLE = {
  five_hour: { utilization: 34.0, resets_at: '2026-10-23T12:00:00Z' },
  seven_day: { utilization: 61.5, resets_at: '2026-10-27T08:00:00Z' },
  seven_day_opus: { utilization: 0, resets_at: null },
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false },
};

function withCreds(creds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-'));
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: creds }));
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

test('normalize zet API-velden om', () => {
  const u = normalize(SAMPLE, 'max');
  assert.deepStrictEqual(u.fiveHour, { percent: 34, resetsAt: '2026-10-23T12:00:00Z' });
  assert.strictEqual(u.sevenDay.percent, 61.5);
  assert.deepStrictEqual(u.sevenDayOpus, { percent: 0, resetsAt: null });
  assert.strictEqual(u.sevenDaySonnet, null);
  assert.strictEqual(u.extra, null);
  assert.strictEqual(u.plan, 'max');
});

test('parseCredentials accepteert alleen geldige inhoud', () => {
  assert.strictEqual(parseCredentials('geen json'), null);
  assert.strictEqual(parseCredentials('{}'), null);
  assert.strictEqual(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: 'x' } })).accessToken, 'x');
});

test('fetchUsage stuurt token en beta-header mee', async () => {
  withCreds({ accessToken: 'tok', expiresAt: Date.now() + 3600e3, subscriptionType: 'pro' });
  let seen;
  const u = await fetchUsage({
    fetchImpl: async (url, opts) => {
      seen = { url, opts };
      return { ok: true, status: 200, json: async () => SAMPLE };
    },
  });
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer tok');
  assert.strictEqual(seen.opts.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.strictEqual(u.plan, 'pro');
  assert.strictEqual(u.fiveHour.percent, 34);
});

test('verlopen token wordt niet verstuurd', async () => {
  withCreds({ accessToken: 'tok', expiresAt: Date.now() - 1000 });
  await assert.rejects(fetchUsage({ fetchImpl: () => assert.fail('mag niet') }), { code: 'expired' });
});

test('HTTP-fouten worden vertaald', async () => {
  withCreds({ accessToken: 'tok' });
  const respond = (status) => ({ fetchImpl: async () => ({ ok: false, status }) });
  await assert.rejects(fetchUsage(respond(401)), { code: 'expired' });
  await assert.rejects(fetchUsage(respond(429)), { code: 'rate-limited' });
  await assert.rejects(fetchUsage(respond(500)), { code: 'http' });
});

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
  assert.deepStrictEqual(u.other, []);
});

test('onbekende limieten worden ook doorgegeven', () => {
  const u = normalize({ ...SAMPLE, seven_day_oauth_apps: { utilization: 12, resets_at: null }, iets_anders: 5 });
  assert.deepStrictEqual(u.other, [{ key: 'seven_day_oauth_apps', label: 'Seven day oauth apps', expires: false, percent: 12, resetsAt: null }]);
  const c = normalize({ ...SAMPLE, iguana_necktie: { utilization: 6, resets_at: '2026-11-05T07:59:00Z' } });
  assert.strictEqual(c.other[0].label, 'Cloudsessietegoed');
  assert.strictEqual(c.other[0].expires, true);
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

test('verlopen token zonder refresh-token wordt niet verstuurd', async () => {
  withCreds({ accessToken: 'tok', expiresAt: Date.now() - 1000 });
  await assert.rejects(fetchUsage({ fetchImpl: () => assert.fail('mag niet') }), { code: 'expired' });
});

test('HTTP-fouten worden vertaald', async () => {
  withCreds({ accessToken: 'tok' });
  const respond = (status) => ({ fetchImpl: async () => ({ ok: false, status }) });
  await assert.rejects(fetchUsage(respond(401)), { code: 'expired' }); // geen refresh-token om mee te vernieuwen
  await assert.rejects(fetchUsage(respond(403)), { code: 'forbidden' });
  await assert.rejects(fetchUsage(respond(429)), { code: 'rate-limited' });
  await assert.rejects(fetchUsage(respond(500)), { code: 'http' });
});

test('verlopen token wordt vernieuwd en teruggeschreven', async () => {
  withCreds({ accessToken: 'oud', refreshToken: 'r1', expiresAt: Date.now() - 1000, subscriptionType: 'max', scopes: ['a'] });
  const calls = [];
  const u = await fetchUsage({
    fetchImpl: async (url, opts) => {
      calls.push(url);
      if (opts.method === 'POST') {
        assert.deepStrictEqual(JSON.parse(opts.body).refresh_token, 'r1');
        return { ok: true, status: 200, json: async () => ({ access_token: 'nieuw', refresh_token: 'r2', expires_in: 28800 }) };
      }
      assert.strictEqual(opts.headers.Authorization, 'Bearer nieuw');
      return { ok: true, status: 200, json: async () => SAMPLE };
    },
  });
  assert.strictEqual(u.fiveHour.percent, 34);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'), 'utf8')).claudeAiOauth;
  assert.strictEqual(saved.accessToken, 'nieuw');
  assert.strictEqual(saved.refreshToken, 'r2');
  assert.strictEqual(saved.subscriptionType, 'max'); // andere velden blijven staan
  assert.ok(saved.expiresAt > Date.now() + 7 * 3600e3);
  assert.strictEqual(calls.length, 2);
});

test('geweigerd refresh-token vraagt om opnieuw inloggen', async () => {
  withCreds({ accessToken: 'oud', refreshToken: 'r1', expiresAt: Date.now() - 1000 });
  await assert.rejects(
    fetchUsage({ fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }) }),
    { code: 'login-needed' }
  );
});

test('401 op geldig token leidt tot één vernieuwing', async () => {
  withCreds({ accessToken: 'a', refreshToken: 'r1', expiresAt: Date.now() + 3600e3 });
  let gets = 0;
  const u = await fetchUsage({
    fetchImpl: async (url, opts) => {
      if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ access_token: 'b', expires_in: 3600 }) };
      gets++;
      return opts.headers.Authorization === 'Bearer b'
        ? { ok: true, status: 200, json: async () => SAMPLE }
        : { ok: false, status: 401 };
    },
  });
  assert.strictEqual(gets, 2);
  assert.strictEqual(u.sevenDay.percent, 61.5);
});

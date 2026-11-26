import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, fakeSource, weeklyReading } from './app-fixture.ts';
import { call, WEBHOOK } from './helpers.ts';

const UUID = WEBHOOK.split('/').pop()!;

function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  }
  return lines;
}

test('PUT /api/trmnl saves a trmnl.com URL and GET masks it', async (t) => {
  const logs = captureLogs(t);
  const { app, dataDir } = createTestApp();
  const put = await call(app, 'PUT', '/api/trmnl', { webhookUrl: WEBHOOK, pushIntervalMinutes: 5 });
  assert.equal(put.status, 200);
  const putText = await put.text();
  assert.equal(statSync(join(dataDir, 'config.json')).mode & 0o777, 0o600);

  const get = await call(app, 'GET', '/api/trmnl');
  const text = await get.text();
  const body = JSON.parse(text);
  assert.equal(body.pushIntervalMinutes, 5);
  assert.match(body.webhookUrl, /^https:\/\/trmnl\.com\/api\/custom_plugins\/.*e9f0$/);
  for (const out of [putText, text, ...logs]) assert.ok(!out.includes(UUID), 'the stored URL leaked');
});

test('PUT /api/trmnl refuses other hosts, http and short intervals and changes nothing', async () => {
  const { app, dataDir } = createTestApp();
  const bad = [
    { webhookUrl: 'https://usetrmnl.com/api/custom_plugins/' + UUID },
    { webhookUrl: 'http://trmnl.com/api/custom_plugins/' + UUID },
    { webhookUrl: 'https://example.com/api/custom_plugins/' + UUID },
    { webhookUrl: 'https://trmnl.com/api/custom_plugins/not-a-uuid' },
    { pushIntervalMinutes: 4 },
  ];
  for (const body of bad) {
    const res = await call(app, 'PUT', '/api/trmnl', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(existsSync(join(dataDir, 'config.json')), false);
  const body = await (await call(app, 'GET', '/api/trmnl')).json();
  assert.equal(body.webhookUrl, null);
  assert.equal(body.pushIntervalMinutes, 10);
});

test('requests with a foreign Host or Origin get 403', async () => {
  const { app } = createTestApp();
  assert.equal((await call(app, 'GET', '/api/trmnl', undefined, { host: 'evil.example:8787' })).status, 403);
  assert.equal((await call(app, 'GET', '/api/trmnl', undefined, { host: '127.0.0.1:9999' })).status, 403);
  assert.equal((await call(app, 'GET', '/api/trmnl', undefined, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(app, 'GET', '/api/trmnl', undefined, { origin: 'http://localhost.evil.example:5173' })).status, 403);
  assert.equal((await call(app, 'GET', '/api/trmnl', undefined, { host: 'localhost:8787', origin: 'http://localhost:5173' })).status, 200);
  assert.equal((await call(app, 'GET', '/api/trmnl', undefined, { origin: 'http://127.0.0.1:8787' })).status, 200);
});

test('GET /api/trmnl/screen renders the device markup with the last readings', async () => {
  const { app, registry } = createTestApp([fakeSource('codex', { value: [weeklyReading('codex', 42, 'Codex')] })]);
  await registry.refreshEnabled();
  const res = await call(app, 'GET', '/api/trmnl/screen');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
  const html = await res.text();
  assert.match(html, /<span class="title">Codex<\/span>/);
  assert.match(html, /style="width: 42%"/);
  assert.match(html, /<span class="instance">Nov 26 /);
  assert.ok(!html.includes('{{') && !html.includes('{%'), 'Liquid left unrendered');
});

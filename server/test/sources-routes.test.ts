import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, fakeSource, weeklyReading } from './app-fixture.ts';
import type { Reading } from '../src/sources/index.ts';
import { call, WEBHOOK } from './helpers.ts';

test('a reader that throws keeps the previous reading with ok false and the error', async () => {
  const next: { value: Reading[] | Error } = { value: [weeklyReading('codex', 10, 'Codex')] };
  const { app, scheduler } = createTestApp([fakeSource('codex', next)]);
  await scheduler.tick();
  next.value = new Error('codex app-server exited');
  await scheduler.tick();
  const [source] = await (await call(app, 'GET', '/api/sources')).json();
  assert.equal(source.ok, false);
  assert.equal(source.error, 'codex app-server exited');
  assert.equal(source.fixHint, 'fix codex');
  assert.equal(source.readings[0].ok, false);
  assert.equal(source.readings[0].error, 'codex app-server exited');
  assert.equal(source.readings[0].windows.weekly.usedPct, 10);
  const preview = await (await call(app, 'GET', '/api/trmnl/preview')).json();
  assert.equal(JSON.parse(preview.body).merge_variables.providers[0].weekly, 10);
});

test('a reader that returned two readings and then throws keeps both with ok false', async () => {
  const next: { value: Reading[] | Error } = {
    value: [weeklyReading('antigravity:a', 1, 'A'), weeklyReading('antigravity:b', 2, 'B')],
  };
  const { app } = createTestApp([fakeSource('antigravity', next)]);
  await call(app, 'POST', '/api/sources/antigravity/test');
  next.value = new Error('agy failed');
  const res = await call(app, 'POST', '/api/sources/antigravity/test');
  const source = await res.json();
  assert.deepEqual(source.readings.map((r: { ok: boolean; windows: { weekly: { usedPct: number } } }) => [r.ok, r.windows.weekly.usedPct]), [[false, 1], [false, 2]]);
});

test('a disabled source is not read and is left out of the summary', async () => {
  const calls = { count: 0 };
  const { app, scheduler, config } = createTestApp([
    fakeSource('codex', { value: [weeklyReading('codex', 10, 'Codex')] }, calls),
    fakeSource('antigravity', { value: [weeklyReading('antigravity:a', 5, 'A')] }),
  ]);
  const put = await call(app, 'PUT', '/api/sources/codex', { enabled: false });
  assert.equal(put.status, 200);
  assert.equal(config.isSourceEnabled('codex'), false);
  await scheduler.tick();
  assert.equal(calls.count, 0);
  const preview = await (await call(app, 'GET', '/api/trmnl/preview')).json();
  assert.deepEqual(JSON.parse(preview.body).merge_variables.providers.map((p: { name: string }) => p.name), ['A']);
  const sources = await (await call(app, 'GET', '/api/sources')).json();
  assert.equal(sources.find((s: { id: string }) => s.id === 'codex').enabled, false);
});

test('unknown sources and malformed switches get 404 and 400', async () => {
  const { app } = createTestApp([fakeSource('codex', { value: [] })]);
  assert.equal((await call(app, 'PUT', '/api/sources/nope', { enabled: false })).status, 404);
  assert.equal((await call(app, 'POST', '/api/sources/nope/test')).status, 404);
  assert.equal((await call(app, 'PUT', '/api/sources/codex', { enabled: 'no' })).status, 400);
});

test('Push now posts even when unchanged and returns the result', async () => {
  const { app, scheduler, posts, config } = createTestApp([fakeSource('codex', { value: [weeklyReading('codex', 10, 'Codex')] })]);
  config.update({ webhookUrl: WEBHOOK });
  await scheduler.tick();
  const res = await call(app, 'POST', '/api/trmnl/push');
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.ok, true);
  assert.equal(posts.length, 2);
});

test('Push now still respects the size limit and a 429 hold', async () => {
  const next: { value: Reading[] | Error } = { value: [weeklyReading('codex', 10, 'C'.repeat(5200))] };
  const { app, scheduler, posts, config, responses } = createTestApp([fakeSource('codex', next)]);
  config.update({ webhookUrl: WEBHOOK });
  await scheduler.tick();
  const tooBig = await (await call(app, 'POST', '/api/trmnl/push')).json();
  assert.equal(tooBig.ok, false);
  assert.equal(posts.length, 0);

  next.value = [weeklyReading('codex', 10, 'Codex')];
  responses.push(429);
  await scheduler.tick();
  assert.equal(posts.length, 1);
  const held = await (await call(app, 'POST', '/api/trmnl/push')).json();
  assert.equal(held.ok, false);
  assert.match(held.message, /19:00/);
  assert.equal(posts.length, 1);
});

test('Push now without a webhook URL returns 400', async () => {
  const { app } = createTestApp([]);
  assert.equal((await call(app, 'POST', '/api/trmnl/push')).status, 400);
});

test('the preview is the exact string the client posts, with its byte size', async () => {
  const { app, scheduler, posts, config } = createTestApp([fakeSource('codex', { value: [weeklyReading('codex', 10, 'Codex · é')] })]);
  config.update({ webhookUrl: WEBHOOK });
  await scheduler.tick();
  const preview = await (await call(app, 'GET', '/api/trmnl/preview')).json();
  assert.equal(preview.body, posts[0].body);
  assert.equal(preview.bytes, Buffer.byteLength(posts[0].body));
  assert.equal(preview.limit, 5000);
});

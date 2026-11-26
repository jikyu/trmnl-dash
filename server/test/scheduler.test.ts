import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, fakeSource, weeklyReading } from './app-fixture.ts';
import { call, WEBHOOK } from './helpers.ts';

function setup(initial = 10) {
  const next = { value: [weeklyReading('codex', initial, 'Codex')] as ReturnType<typeof weeklyReading>[] | Error };
  const t = createTestApp([fakeSource('codex', next)]);
  t.config.update({ webhookUrl: WEBHOOK });
  return { ...t, next };
}

test('two ticks with identical readings post once, though their updated time differs', async () => {
  const { scheduler, posts, setTime } = setup();
  setTime(18, 0);
  await scheduler.tick();
  setTime(18, 10);
  await scheduler.tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, WEBHOOK);
});

test('after a 429 at 18:20, ticks at 18:30 and 18:40 do not post and 19:00 does', async () => {
  const { scheduler, posts, responses, setTime, next, app } = setup();
  responses.push(429);
  setTime(18, 20);
  await scheduler.tick();
  assert.equal(posts.length, 1);
  next.value = [weeklyReading('codex', 11, 'Codex')];
  setTime(18, 30);
  await scheduler.tick();
  setTime(18, 40);
  await scheduler.tick();
  assert.equal(posts.length, 1);
  const status = await (await call(app, 'GET', '/api/trmnl')).json();
  assert.equal(status.lastResult.status, 429);
  setTime(19, 0);
  await scheduler.tick();
  assert.equal(posts.length, 2);
});

test('a summary over 5 KB is never posted and GET /api/trmnl reports the size', async () => {
  const { scheduler, posts, next, app } = setup();
  next.value = [weeklyReading('codex', 10, 'C'.repeat(5200))];
  await scheduler.tick();
  assert.equal(posts.length, 0);
  const status = await (await call(app, 'GET', '/api/trmnl')).json();
  assert.equal(status.lastResult.ok, false);
  assert.match(status.lastResult.message, /bytes/);
});

test('after a 422 the same rows are not posted again, and changed rows are', async () => {
  const { scheduler, posts, responses, next, setTime } = setup();
  responses.push(422);
  await scheduler.tick();
  setTime(18, 10);
  await scheduler.tick();
  assert.equal(posts.length, 1);
  next.value = [weeklyReading('codex', 12, 'Codex')];
  setTime(18, 20);
  await scheduler.tick();
  assert.equal(posts.length, 2);
});

test('a 403 records the Developer Edition note, and the next tick tries again', async () => {
  const { scheduler, posts, responses, app, setTime } = setup();
  responses.push(403);
  await scheduler.tick();
  const status = await (await call(app, 'GET', '/api/trmnl')).json();
  assert.equal(status.lastResult.status, 403);
  assert.match(status.lastResult.message, /Developer Edition/);
  setTime(18, 10);
  await scheduler.tick();
  assert.equal(posts.length, 2);
});

test('with no webhook URL, ticks still refresh the sources and post nothing', async () => {
  const next = { value: [weeklyReading('codex', 10, 'Codex')] as ReturnType<typeof weeklyReading>[] | Error };
  const { scheduler, posts, app } = createTestApp([fakeSource('codex', next)]);
  await scheduler.tick();
  next.value = [weeklyReading('codex', 20, 'Codex')];
  await scheduler.tick();
  assert.equal(posts.length, 0);
  const sources = await (await call(app, 'GET', '/api/sources')).json();
  assert.equal(sources[0].readings[0].windows.weekly.usedPct, 20);
});

test('a first tick with no readings at all posts nothing, so the device keeps its last image', async () => {
  const { scheduler, posts, next } = setup();
  next.value = new Error('claude timed out');
  await scheduler.tick();
  assert.equal(posts.length, 0);
});

test('with no enabled source, a tick posts empty rows once so the device clears', async () => {
  const { scheduler, posts, config } = setup();
  await scheduler.tick();
  config.update({ sources: { codex: false } });
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(posts.length, 2);
  assert.deepEqual(JSON.parse(posts[1].body).merge_variables.providers, []);
});

test('a new webhook URL gets the current rows on the next tick, even when they are unchanged', async () => {
  const { scheduler, posts, config, setTime } = setup();
  await scheduler.tick();
  const other = WEBHOOK.replace(/e9f0$/, 'abcd');
  config.update({ webhookUrl: other });
  setTime(18, 10);
  await scheduler.tick();
  assert.deepEqual(posts.map((p) => p.url), [WEBHOOK, other]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestApp, fakeSource, weeklyReading } from './app-fixture.ts';
import { call, tempDir } from './helpers.ts';
import { claudeSource } from '../src/sources/claude.ts';
import type { Instances } from '../src/instances.ts';
import type { Source } from '../src/sources/index.ts';

const result = (pct: number) => ({
  code: 0,
  stderr: '',
  stdout: JSON.stringify({ type: 'result', is_error: false, result: `Current week (all models): ${pct}% used · resets Dec 3 at 2am (Pacific/Palau)` }),
});

/** Claude instances read through a fake runner keyed by config dir; Codex and Antigravity read fixed values. */
function setup() {
  const home = tempDir();
  const dirs = { home: join(home, '.claude-home'), work: join(home, '.claude-work'), codex: join(home, '.codex') };
  for (const d of Object.values(dirs)) mkdirSync(d);
  writeFileSync(join(dirs.codex, 'config.toml'), '');
  const pct: Record<string, number> = { [dirs.home]: 11, [dirs.work]: 22 };
  const t = createTestApp((instances: Instances) =>
    instances.list().map((i): Source => {
      if (i.provider === 'claude') return claudeSource(i, { run: async (_c, _a, { env }) => result(pct[env!.CLAUDE_CONFIG_DIR!]) });
      const reading = i.provider === 'codex' ? weeklyReading(i.id, 33, i.label) : weeklyReading('antigravity:gemini', 5, 'Agi Gemini');
      return { ...fakeSource(i.id, { value: [reading] }), label: i.label };
    }),
  );
  return { ...t, dirs, file: join(t.dataDir, 'instances.json') };
}

const ids = async (app: ReturnType<typeof setup>['app']) =>
  (await (await call(app, 'GET', '/api/sources')).json()).map((s: { id: string }) => s.id);

test('with nothing added there are no sources and no rows', async () => {
  const { app, scheduler } = setup();
  await scheduler.tick();
  assert.deepEqual(await ids(app), []);
  const preview = await (await call(app, 'GET', '/api/trmnl/preview')).json();
  assert.deepEqual(JSON.parse(preview.body).merge_variables.providers, []);
});

test('adding a source reads it right away and returns its status', async () => {
  const { app, dirs, file } = setup();
  const res = await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude work', configDir: dirs.work });
  assert.equal(res.status, 201);
  const status = await res.json();
  assert.equal(status.id, 'claude:work');
  assert.equal(status.provider, 'claude');
  assert.equal(status.configDir, dirs.work);
  assert.equal(status.ok, true);
  assert.equal(status.readings[0].windows.weekly.usedPct, 22);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [{ id: 'claude:work', provider: 'claude', label: 'Claude work', configDir: dirs.work }]);
});

test('rows follow provider order, then the order each was added', async () => {
  const { app, dirs } = setup();
  await call(app, 'POST', '/api/sources', { provider: 'antigravity' });
  await call(app, 'POST', '/api/sources', { provider: 'codex', label: 'Codex', configDir: dirs.codex });
  await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude work', configDir: dirs.work });
  await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude home', configDir: dirs.home });
  assert.deepEqual(await ids(app), ['claude:work', 'claude:home', 'codex:default', 'antigravity']);
  const preview = await (await call(app, 'GET', '/api/trmnl/preview')).json();
  assert.deepEqual(JSON.parse(preview.body).merge_variables.providers.map((p: { name: string }) => p.name), [
    'Claude work',
    'Claude home',
    'Codex',
    'Agi Gemini',
  ]);
});

test('only one Antigravity can be added', async () => {
  const { app } = setup();
  assert.equal((await call(app, 'POST', '/api/sources', { provider: 'antigravity' })).status, 201);
  const again = await call(app, 'POST', '/api/sources', { provider: 'antigravity' });
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /only one/i);
  assert.deepEqual(await ids(app), ['antigravity']);
});

test('a label with shell characters gives an id of only a-z, 0-9 and -', async () => {
  const { app, dirs } = setup();
  const res = await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude; rm -rf ~ $(x)', configDir: dirs.work });
  assert.equal((await res.json()).id, 'claude:rm-rf-x');
  const plain = await call(app, 'POST', '/api/sources', { provider: 'codex', label: 'Codex', configDir: dirs.codex });
  assert.equal((await plain.json()).id, 'codex:default');
});

test('bad input gets 400, a listed id or config dir 409, and neither writes', async () => {
  const { app, dirs, file } = setup();
  await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude work', configDir: dirs.work });
  const before = readFileSync(file, 'utf8');
  const post = (body: object) => call(app, 'POST', '/api/sources', body);
  assert.equal((await post({ provider: 'claude', label: 'Work', configDir: dirs.home })).status, 409);
  assert.equal((await post({ provider: 'claude', label: 'Other', configDir: dirs.work + '/' })).status, 409);
  assert.equal((await post({ provider: 'claude', label: 'Gone', configDir: join(dirs.work, 'missing') })).status, 400);
  assert.equal((await post({ provider: 'claude', label: '', configDir: dirs.home })).status, 400);
  assert.equal((await post({ provider: 'codex', label: 'Codex' })).status, 400);
  assert.equal((await post({ provider: 'gemini', label: 'G', configDir: dirs.home })).status, 400);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('a Codex dir without config.toml or auth.json gets 400 and writes nothing', async () => {
  const { app, dirs, file } = setup();
  const res = await call(app, 'POST', '/api/sources', { provider: 'codex', label: 'Codex', configDir: dirs.work });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not a Codex home/);
  assert.equal(existsSync(file), false);
});

test('the same dir can back one Claude and one Codex source', async () => {
  const { app, dirs } = setup();
  assert.equal((await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude', configDir: dirs.codex })).status, 201);
  assert.equal((await call(app, 'POST', '/api/sources', { provider: 'codex', label: 'Codex', configDir: dirs.codex })).status, 201);
});

test('a ~ config dir is stored as an absolute path', async (t) => {
  const { app, dirs } = setup();
  const home = process.env.HOME;
  t.after(() => { process.env.HOME = home; });
  process.env.HOME = join(dirs.work, '..');
  const res = await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude work', configDir: '~/.claude-work' });
  assert.equal((await res.json()).configDir, dirs.work);
});

test('removing a source drops it, its readings and its switch', async () => {
  const { app, dirs, config, file } = setup();
  await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude home', configDir: dirs.home });
  await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude work', configDir: dirs.work });
  await call(app, 'PUT', '/api/sources/claude:home', { enabled: false });
  assert.equal((await call(app, 'DELETE', '/api/sources/claude:home')).status, 204);
  assert.equal((await call(app, 'DELETE', '/api/sources/claude:home')).status, 404);
  assert.deepEqual(await ids(app), ['claude:work']);
  assert.equal('claude:home' in config.get().sources, false);
  const preview = await (await call(app, 'GET', '/api/trmnl/preview')).json();
  assert.deepEqual(JSON.parse(preview.body).merge_variables.providers.map((p: { name: string }) => p.name), ['Claude work']);
  assert.ok(existsSync(file));

  // Added again under the same id, it starts on and with its own reading.
  const again = await (await call(app, 'POST', '/api/sources', { provider: 'claude', label: 'Claude home', configDir: dirs.home })).json();
  assert.equal(again.enabled, true);
  assert.equal(again.readings[0].windows.weekly.usedPct, 11);
});

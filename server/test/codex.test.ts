import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexSource } from '../src/sources/codex.ts';
import { tempDir } from './helpers.ts';

const fixtures = fileURLToPath(new URL('./fixtures/codex/', import.meta.url));
const instance = { id: 'codex:work', provider: 'codex', label: 'Codex work', configDir: '/Users/me/.codex-work' } as const;
const fake = (mode: string, result = join(fixtures, 'rate-limits-weekly.json')) => ['node', join(fixtures, 'fake-app-server.mjs'), mode, result];

function resultWith(primary: object | null, secondary: object | null): string {
  const recorded = JSON.parse(readFileSync(join(fixtures, 'rate-limits-weekly.json'), 'utf8'));
  recorded.rateLimits.primary = primary;
  recorded.rateLimits.secondary = secondary;
  const file = join(tempDir(), 'result.json');
  writeFileSync(file, JSON.stringify(recorded));
  return file;
}

test('the recorded weekly-only response maps to a weekly window', async () => {
  const readings = await codexSource(instance, { command: fake('ok') }).read();
  assert.deepEqual(readings, [
    { provider: 'codex', key: 'codex:work', name: 'Codex work', windows: { weekly: { usedPct: 77, resetsAt: '2026-11-28T00:49:19.000Z' } } },
  ]);
});

test('300- and 10080-minute windows map to session and weekly in either order', async () => {
  const session = { usedPercent: 12, windowDurationMins: 300, resetsAt: 1795700000 };
  const weekly = { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1796000000 };
  for (const [primary, secondary] of [[session, weekly], [weekly, session]]) {
    const [reading] = await codexSource(instance, { command: fake('ok', resultWith(primary, secondary)) }).read();
    assert.deepEqual(reading.windows, {
      session: { usedPct: 12, resetsAt: new Date(1795700000 * 1000).toISOString() },
      weekly: { usedPct: 40, resetsAt: new Date(1796000000 * 1000).toISOString() },
    });
  }
});

test('a -32600 error fails the read with its message, and the source carries the codex login hint', async () => {
  const source = codexSource(instance, { command: fake('error-32600') });
  await assert.rejects(source.read(), /authentication required/);
  assert.match(source.fixHint, /CODEX_HOME=\/Users\/me\/.codex-work codex login/);
});

test('the app-server runs with CODEX_HOME set to the instance config dir', async () => {
  await assert.rejects(codexSource(instance, { command: fake('echo-home') }).read(), /CODEX_HOME=\/Users\/me\/.codex-work$/);
});

test('a process that exits before answering fails the read', async () => {
  await assert.rejects(codexSource(instance, { command: fake('exit-early') }).read(), /exited before answering/);
});

test('a read past the timeout kills the process and fails', async () => {
  const started = Date.now();
  await assert.rejects(codexSource(instance, { command: fake('hang'), timeoutMs: 300 }).read(), /did not answer/);
  assert.ok(Date.now() - started < 2000);
});

test('a missing codex binary fails the read', async () => {
  await assert.rejects(codexSource(instance, { command: ['trmnl-dash-no-such-codex', 'app-server'] }).read(), /not found|ENOENT/);
});

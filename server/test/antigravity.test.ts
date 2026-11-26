import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { antigravitySource } from '../src/sources/antigravity.ts';
import { SourceRegistry } from '../src/sources/index.ts';
import { ConfigStore } from '../src/config.ts';
import type { RunProcess, RunResult } from '../src/process.ts';
import { tempDir } from './helpers.ts';

const recorded = readFileSync(new URL('./fixtures/antigravity/usage.tsv', import.meta.url), 'utf8');

function runner(results: RunResult[], calls: { command: string; args: string[]; timeoutMs: number }[] = []): RunProcess {
  return async (command, args, { timeoutMs }) => {
    calls.push({ command, args, timeoutMs });
    return results.shift()!;
  };
}

test('the recorded report gives one reading per model group', async () => {
  const calls: { command: string; args: string[]; timeoutMs: number }[] = [];
  const readings = await antigravitySource({ run: runner([{ code: 0, stdout: recorded, stderr: '' }], calls) }).read();
  assert.deepEqual(readings, [
    {
      provider: 'antigravity',
      key: 'antigravity:gemini-models',
      name: 'Agi Gemini',
      windows: { weekly: { usedPct: 0 }, session: { usedPct: 0 } },
    },
    {
      provider: 'antigravity',
      key: 'antigravity:claude-and-gpt-models',
      name: 'Agi Other',
      windows: { weekly: { usedPct: 0 }, session: { usedPct: 0 } },
    },
  ]);
  assert.deepEqual(calls, [{ command: 'agy', args: ['-p', '/usage'], timeoutMs: 90_000 }]);
});

test('an untouched window has no reset, because agy reports one that moves with every run', async () => {
  const run = (time: string) => runner([{ code: 0, stdout: `Gemini Models\tFive Hour Limit Remaining\t100%\t${time}\n`, stderr: '' }]);
  const [a] = await antigravitySource({ run: run('2026-11-26T12:59:02Z') }).read();
  const [b] = await antigravitySource({ run: run('2026-11-26T13:16:07Z') }).read();
  assert.deepEqual(a.windows, { session: { usedPct: 0 } });
  assert.deepEqual(a, b);
});

test('used percentage is 100 minus the remaining percentage, and unknown labels are skipped', async () => {
  const stdout = 'Gemini Models\tFive Hour Limit Remaining\t62.5%\t2026-11-26T12:59:02Z\nGemini Models\tDaily Something\t10%\t2026-11-26T12:59:02Z\n';
  const [reading] = await antigravitySource({ run: runner([{ code: 0, stdout, stderr: '' }]) }).read();
  assert.deepEqual(reading.windows, { session: { usedPct: 37.5, resetsAt: '2026-11-26T12:59:02.000Z' } });
});

test('a failed run keeps every group with ok false', async () => {
  const source = antigravitySource({ run: runner([{ code: 0, stdout: recorded, stderr: '' }, { code: 1, stdout: '', stderr: '' }]) });
  const registry = new SourceRegistry(() => [source], new ConfigStore(tempDir()));
  await registry.refreshEnabled();
  await registry.refreshEnabled();
  assert.deepEqual(registry.enabledReadings().map((r) => [r.key, r.ok]), [
    ['antigravity:gemini-models', false],
    ['antigravity:claude-and-gpt-models', false],
  ]);
});

test('a non-zero exit, empty output or an auth error fails the read', async () => {
  const failures: RunResult[] = [
    { code: 2, stdout: recorded, stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: 'Usage report unavailable\n', stderr: '' },
  ];
  for (const result of failures) await assert.rejects(antigravitySource({ run: runner([result]) }).read());
  const auth = antigravitySource({ run: runner([{ code: 1, stdout: '', stderr: 'Error: not authenticated. Please sign in.\nmore' }]) });
  await assert.rejects(auth.read(), /not authenticated/);
  assert.match(auth.fixHint, /Run `agy` once to sign in/);
});

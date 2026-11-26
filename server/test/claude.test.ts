import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeSource } from '../src/sources/claude.ts';
import { SourceRegistry } from '../src/sources/index.ts';
import { ConfigStore } from '../src/config.ts';
import type { RunProcess, RunResult } from '../src/process.ts';
import { tempDir } from './helpers.ts';

const recorded = JSON.parse(readFileSync(new URL('./fixtures/claude/usage.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-26T08:00:00Z');
const install = { id: 'claude:work', provider: 'claude', label: 'Claude work', configDir: '/Users/me/.claude-work' } as const;

type Call = { command: string; args: string[]; env?: NodeJS.ProcessEnv; timeoutMs: number };

function runner(results: RunResult[] | RunResult, calls: Call[] = []): RunProcess {
  return async (command, args, options) => {
    calls.push({ command, args, ...options });
    return Array.isArray(results) ? results.shift()! : results;
  };
}

const ok = (json: object): RunResult => ({ code: 0, stdout: JSON.stringify(json), stderr: '' });
const withResult = (result: string) => ok({ ...recorded, result });

test('the recorded /usage run gives a weekly window and no session window', async () => {
  const calls: Call[] = [];
  const readings = await claudeSource(install, { run: runner(ok(recorded), calls), now: () => NOW }).read();
  assert.deepEqual(readings, [
    { provider: 'claude', key: 'claude:work', name: 'Claude work', windows: { weekly: { usedPct: 98, resetsAt: '2026-11-26T10:00:00.000Z' } } },
  ]);
  assert.equal(calls[0].command, 'claude');
  assert.deepEqual(calls[0].args, ['-p', '/usage', '--output-format', 'json', '--no-session-persistence']);
  assert.equal(calls[0].env?.CLAUDE_CONFIG_DIR, '/Users/me/.claude-work');
});

test('the default ~/.claude dir runs with CLAUDE_CONFIG_DIR unset, because setting it switches to another login', async (t) => {
  const previous = process.env.CLAUDE_CONFIG_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  });
  process.env.CLAUDE_CONFIG_DIR = '/somewhere/else';
  const calls: Call[] = [];
  const defaultInstall = { id: 'claude:default', provider: 'claude', label: 'Claude', configDir: join(homedir(), '.claude') } as const;
  await claudeSource(defaultInstall, { run: runner(ok(recorded), calls), now: () => NOW }).read();
  assert.equal(calls[0].env?.CLAUDE_CONFIG_DIR, undefined);
  assert.ok(calls[0].env && 'PATH' in calls[0].env);
  assert.doesNotMatch(claudeSource(defaultInstall).fixHint, /CLAUDE_CONFIG_DIR/);
  assert.match(claudeSource(install).fixHint, /CLAUDE_CONFIG_DIR=\/Users\/me\/.claude-work claude/);
});

test('reset times without a year land on the instant closest to the read', async () => {
  const cases: [string, string, string][] = [
    ['Nov 26 at 6:59pm (Pacific/Palau)', '2026-11-26T08:00:00Z', '2026-11-26T09:59:00.000Z'],
    ['Dec 3 at 2am (Pacific/Palau)', '2026-11-26T08:00:00Z', '2026-12-02T17:00:00.000Z'],
    ['Jan 2 at 7pm (Pacific/Palau)', '2026-12-30T08:00:00Z', '2027-01-02T10:00:00.000Z'],
    ['Dec 31 at 11pm (Pacific/Palau)', '2027-01-01T08:00:00Z', '2026-12-31T14:00:00.000Z'],
    ['Nov 26 at 7pm (America/New_York)', '2026-11-26T08:00:00Z', '2026-11-27T00:00:00.000Z'],
    ['Nov 26 at 12am (Pacific/Palau)', '2026-11-26T08:00:00Z', '2026-11-25T15:00:00.000Z'],
    ['Nov 26 at 12pm (Pacific/Palau)', '2026-11-26T08:00:00Z', '2026-11-26T03:00:00.000Z'],
  ];
  for (const [when, now, expected] of cases) {
    const run = runner(withResult(`Current week (all models): 5% used · resets ${when}\n`));
    const [reading] = await claudeSource(install, { run, now: () => new Date(now) }).read();
    assert.equal(reading.windows.weekly.resetsAt, expected, when);
  }
});

test('a run without the all-models line, an error result or a non-zero exit fails the read', async () => {
  const failures: RunResult[] = [
    withResult('Current week (Fable): 84% used · resets Nov 26 at 7pm (Pacific/Palau)\n'),
    ok({ ...recorded, is_error: true, result: 'Not logged in · Please run /login' }),
    { code: 1, stdout: '', stderr: 'boom' },
    { code: 0, stdout: 'not json', stderr: '' },
  ];
  for (const result of failures) {
    await assert.rejects(claudeSource(install, { run: runner(result), now: () => NOW }).read());
  }
  await assert.rejects(
    claudeSource(install, { run: runner(ok({ ...recorded, is_error: true, result: 'Not logged in · Please run /login' })), now: () => NOW }).read(),
    /Not logged in/,
  );
});

test('one installation failing keeps its last reading while another updates', async () => {
  const home = { id: 'claude:home', provider: 'claude', label: 'Claude home', configDir: '/h' } as const;
  const runs = {
    home: [withResult('Current week (all models): 10% used · resets Dec 3 at 2am (Pacific/Palau)'), { code: 1, stdout: '', stderr: '' }],
    work: [withResult('Current week (all models): 20% used · resets Dec 3 at 2am (Pacific/Palau)'), withResult('Current week (all models): 25% used · resets Dec 3 at 2am (Pacific/Palau)')],
  };
  const sources = [
    claudeSource(home, { run: runner(runs.home), now: () => NOW }),
    claudeSource(install, { run: runner(runs.work), now: () => NOW }),
  ];
  const registry = new SourceRegistry(() => sources, new ConfigStore(tempDir()), () => NOW);
  await registry.refreshEnabled();
  await registry.refreshEnabled();
  const readings = registry.enabledReadings();
  assert.deepEqual(readings.map((r) => [r.key, r.name, r.ok, r.windows.weekly.usedPct]), [
    ['claude:home', 'Claude home', false, 10],
    ['claude:work', 'Claude work', true, 25],
  ]);
});

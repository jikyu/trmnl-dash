import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DirInstance } from '../instances.ts';
import { MONTHS } from '../summary.ts';
import { runProcess, type RunProcess } from '../process.ts';
import type { Reading, Source } from './index.ts';

// Claude Code 2.1.332 prints, for example: Current week (all models): 98% used · resets Nov 26 at 7pm (Pacific/Palau)
const WEEKLY_LINE = /^Current week \(all models\): (\d+(?:\.\d+)?)% used(?: · resets (.+?) \(([^)]+)\))?\s*$/m;
const WHEN = /^([A-Z][a-z]{2}) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?(am|pm)$/;

function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wall - Math.floor(instant / 1000) * 1000;
}

function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const wall = Date.UTC(year, month, day, hour, minute);
  const guess = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(guess, timeZone);
}

/** "Nov 26 at 7pm" has no year, so pick the year that puts it closest to the read time. */
function parseReset(when: string, timeZone: string, now: Date): string {
  const m = WHEN.exec(when);
  const month = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || month < 0) throw new Error(`Could not read the reset time "${when}" from /usage`);
  const hour = (Number(m[3]) % 12) + (m[5] === 'pm' ? 12 : 0);
  const year = now.getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map((y) => zonedTime(y, month, Number(m[2]), hour, Number(m[4] ?? 0), timeZone));
  const closest = candidates.reduce((a, b) => (Math.abs(b - now.getTime()) < Math.abs(a - now.getTime()) ? b : a));
  return new Date(closest).toISOString();
}

/** Reads only the all-models weekly line; the rest of the JSON holds session ids and credential details. */
function toReading(install: DirInstance, stdout: string, now: Date): Reading {
  let output: { is_error?: boolean; result?: unknown };
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error('claude -p /usage did not print JSON');
  }
  const result = typeof output.result === 'string' ? output.result : '';
  if (output.is_error) throw new Error(result.trim() || 'claude -p /usage reported an error');
  const line = WEEKLY_LINE.exec(result);
  if (!line) throw new Error('claude -p /usage printed no "Current week (all models)" line');
  const resetsAt = line[2] ? parseReset(line[2], line[3], now) : undefined;
  return {
    provider: 'claude',
    key: install.id,
    name: install.label,
    windows: { weekly: { usedPct: Number(line[1]), ...(resetsAt ? { resetsAt } : {}) } },
  };
}

/**
 * Claude Code keeps the login for the default ~/.claude under a different key than for the same dir
 * named in CLAUDE_CONFIG_DIR, so the default dir runs with the variable unset.
 */
const isDefaultDir = (configDir: string) => configDir === join(homedir(), '.claude');

function configDirEnv(configDir: string): NodeJS.ProcessEnv {
  const { CLAUDE_CONFIG_DIR: _inherited, ...env } = process.env;
  return isDefaultDir(configDir) ? env : { ...env, CLAUDE_CONFIG_DIR: configDir };
}

export function claudeSource(
  install: DirInstance,
  { run = runProcess, now = () => new Date() }: { run?: RunProcess; now?: () => Date } = {},
): Source {
  return {
    id: install.id,
    provider: 'claude',
    label: install.label,
    configDir: install.configDir,
    fixHint: `Sign in with \`${isDefaultDir(install.configDir) ? '' : `CLAUDE_CONFIG_DIR=${install.configDir} `}claude\`, then run \`/login\`.`,
    read: async () => {
      // --no-session-persistence keeps each poll from leaving a session transcript in the config dir.
      const { code, stdout } = await run('claude', ['-p', '/usage', '--output-format', 'json', '--no-session-persistence'], {
        env: configDirEnv(install.configDir),
        timeoutMs: 60_000,
      });
      if (code !== 0) throw new Error(`claude -p /usage exited with code ${code}`);
      return [toReading(install, stdout, now())];
    },
  };
}

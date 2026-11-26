import { runProcess, type RunProcess } from '../process.ts';
import type { Reading, Source } from './index.ts';

// agy 1.5.16 prints one tab-separated line per group and window, for example:
// Gemini Models	Five Hour Limit Remaining	100%	2026-11-26T12:59:02Z
const WINDOW_NAMES: Record<string, string> = {
  'Five Hour Limit Remaining': 'session',
  'Weekly Limit Remaining': 'weekly',
};

function parseReport(stdout: string): Reading[] {
  const groups = new Map<string, Reading>();
  for (const line of stdout.split('\n')) {
    const [group, label, remaining, reset] = line.split('\t').map((s) => s.trim());
    const window = WINDOW_NAMES[label];
    const percent = Number.parseFloat(remaining);
    if (!group || !window || !remaining?.endsWith('%') || Number.isNaN(percent)) continue;
    let reading = groups.get(group);
    if (!reading) {
      const slug = group.toLowerCase().match(/[a-z0-9]+/g)?.join('-') ?? 'group';
      // Short names fit two device columns: the Gemini group, and every other group.
      const name = /gemini/i.test(group) ? 'Agi Gemini' : 'Agi Other';
      reading = { provider: 'antigravity', key: `antigravity:${slug}`, name, windows: {} };
      groups.set(group, reading);
    }
    // An untouched window (100% remaining) reports either the Unix epoch or the read time plus the
    // window length as its reset, which moves on every run. It has no real reset yet.
    const resetsAt = percent < 100 && reset && !Number.isNaN(Date.parse(reset)) ? new Date(reset).toISOString() : undefined;
    reading.windows[window] = { usedPct: 100 - percent, ...(resetsAt ? { resetsAt } : {}) };
  }
  return [...groups.values()];
}

export function antigravitySource({ run = runProcess }: { run?: RunProcess } = {}): Source {
  return {
    id: 'antigravity',
    provider: 'antigravity',
    label: 'Antigravity',
    fixHint: 'Run `agy` once to sign in (tested with Antigravity CLI 1.5.16).',
    read: async () => {
      // A running agy session does not refresh its quota, so every read starts a new process.
      const { code, stdout, stderr } = await run('agy', ['-p', '/usage'], { env: process.env, timeoutMs: 90_000 });
      const firstError = stderr.trim().split('\n')[0]?.slice(0, 200);
      if (code !== 0) throw new Error(firstError || `agy -p /usage exited with code ${code}`);
      const readings = parseReport(stdout);
      // Exit 0 with no report happens when agy cannot write to a non-TTY stdout.
      if (readings.length === 0) throw new Error(firstError || 'agy -p /usage printed no usage lines');
      return readings;
    },
  };
}

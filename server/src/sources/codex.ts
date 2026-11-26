import { spawn } from 'node:child_process';
import type { DirInstance } from '../instances.ts';
import type { Window } from '../types.ts';
import type { Reading, Source } from './index.ts';

type RateLimitWindow = { usedPercent: number; windowDurationMins?: number | null; resetsAt?: number | null };
type RateLimitsResult = { rateLimits: { primary?: RateLimitWindow | null; secondary?: RateLimitWindow | null } };

const WINDOW_NAMES: Record<number, string> = { 300: 'session', 10080: 'weekly' };

/** Maps by window length, because the response never says whether primary or secondary is the 5-hour one. */
function toReading(instance: DirInstance, result: RateLimitsResult): Reading {
  const windows: Record<string, Window> = {};
  for (const w of [result.rateLimits.primary, result.rateLimits.secondary]) {
    const name = w?.windowDurationMins ? WINDOW_NAMES[w.windowDurationMins] : undefined;
    if (!w || !name) continue;
    windows[name] = { usedPct: w.usedPercent, ...(w.resetsAt ? { resetsAt: new Date(w.resetsAt * 1000).toISOString() } : {}) };
  }
  return { provider: 'codex', key: instance.id, name: instance.label, windows };
}

/**
 * Messages are newline-delimited JSON without a `jsonrpc` field; anything that is not a response to
 * one of our ids, such as a notification, is skipped.
 */
function readRateLimits(command: string[], codexHome: string, timeoutMs: number): Promise<RateLimitsResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { env: { ...process.env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'ignore'] });
    const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + '\n');
    let settled = false;
    const finish = (err: Error | null, value?: RateLimitsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (err) {
        child.kill();
        reject(err);
      } else {
        resolve(value!);
      }
    };
    const timer = setTimeout(() => finish(new Error(`codex app-server did not answer within ${timeoutMs / 1000}s`)), timeoutMs);

    child.on('error', (err: NodeJS.ErrnoException) =>
      finish(new Error(err.code === 'ENOENT' ? `${command[0]} not found on PATH` : err.message)),
    );
    child.on('exit', (code) => finish(new Error(`codex app-server exited before answering (exit ${code})`)));
    child.stdin.on('error', () => {}); // The exit handler reports a process that went away.

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let msg: { id?: unknown; result?: unknown; error?: { code: number; message: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) return finish(new Error(msg.error.message));
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } });
        } else if (msg.id === 2) {
          if (msg.error) return finish(new Error(msg.error.message));
          return finish(null, msg.result as RateLimitsResult);
        }
      }
    });

    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'trmnl-dash', version: '0.1.0' }, capabilities: null } });
  });
}

/** CODEX_HOME holds the sign-in, so each Codex home is its own account. */
export function codexSource(
  instance: DirInstance,
  { command = ['codex', 'app-server'], timeoutMs = 30_000 }: { command?: string[]; timeoutMs?: number } = {},
): Source {
  return {
    id: instance.id,
    provider: 'codex',
    label: instance.label,
    configDir: instance.configDir,
    fixHint: `Sign in with \`CODEX_HOME=${instance.configDir} codex login\` (tested with codex-cli 0.172.0).`,
    read: async () => [toReading(instance, await readRateLimits(command, instance.configDir, timeoutMs))],
  };
}

import { spawn } from 'node:child_process';

export type RunResult = { code: number | null; stdout: string; stderr: string };
export type RunOptions = { env?: NodeJS.ProcessEnv; timeoutMs: number };
export type RunProcess = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

export const runProcess: RunProcess = (command, args, { env, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} did not finish within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === 'ENOENT' ? `${command} not found on PATH` : err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

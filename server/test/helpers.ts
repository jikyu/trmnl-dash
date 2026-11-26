import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'trmnl-dash-'));
}

export const WEBHOOK = 'https://trmnl.com/api/custom_plugins/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';

type Fetchable = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

/** Sends a request with the local Host header the server expects. */
export function call(app: Fetchable, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method,
    headers: { host: '127.0.0.1:8787', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

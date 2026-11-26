import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Config = {
  webhookUrl?: string;
  pushIntervalMinutes: number;
  /** Each source's on/off switch. A source missing here is on. */
  sources: Record<string, boolean>;
};

export const MIN_PUSH_INTERVAL_MINUTES = 5;
const DEFAULTS: Config = { pushIntervalMinutes: 10, sources: {} };

export function writeJsonAtomic(file: string, data: unknown, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  let fileMode = mode;
  if (fileMode === undefined) {
    try {
      fileMode = statSync(file).mode & 0o777;
    } catch {
      fileMode = 0o644;
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: fileMode });
  renameSync(tmp, file);
}

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export class ConfigStore {
  private readonly file: string;
  private config: Config;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'config.json');
    this.config = { ...DEFAULTS, ...readJson<Partial<Config>>(this.file) };
  }

  get(): Readonly<Config> {
    return this.config;
  }

  isSourceEnabled(id: string): boolean {
    return this.config.sources[id] !== false;
  }

  update(patch: Partial<Config>): void {
    const next = { ...this.config, ...patch };
    writeJsonAtomic(this.file, next, 0o600);
    this.config = next;
  }
}

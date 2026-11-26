import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJson, writeJsonAtomic } from './config.ts';

/** Device row order follows this order, then the order instances were added. */
export const PROVIDERS = ['claude', 'codex', 'antigravity'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A Claude Code config dir (CLAUDE_CONFIG_DIR) or a Codex home (CODEX_HOME). */
export type DirInstance = { id: string; provider: 'claude' | 'codex'; label: string; configDir: string };
/** `agy` has no config dir to choose, so there is at most one. */
export type AntigravityInstance = { id: 'antigravity'; provider: 'antigravity'; label: string };
/** The id is also the source id: 'claude:<slug>', 'codex:<slug>' or 'antigravity'. */
export type Instance = DirInstance | AntigravityInstance;

export type AddInput = { provider?: unknown; label?: unknown; configDir?: unknown };
export type AddResult = { ok: true; instance: Instance } | { ok: false; status: 400 | 409; error: string };

/** Lowercase the label, drop a leading provider name, and join the runs of a-z and 0-9 with '-'. */
export function slugFromLabel(provider: 'claude' | 'codex', label: string): string {
  const runs = label.toLowerCase().replace(new RegExp(`^\\s*${provider}\\b`), '').match(/[a-z0-9]+/g);
  return runs ? runs.join('-') : 'default';
}

function absoluteDir(configDir: string): string {
  const expanded = configDir === '~' || configDir.startsWith('~/') ? join(homedir(), configDir.slice(1)) : configDir;
  return resolve(expanded);
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** The sources the person added. There are none until they add one. The server never writes inside a config dir. */
export class Instances {
  private readonly file: string;
  private instances: Instance[];

  constructor(dataDir: string) {
    this.file = join(dataDir, 'instances.json');
    this.instances = readJson<Instance[]>(this.file) ?? [];
  }

  list(): readonly Instance[] {
    return [...this.instances].sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider));
  }

  add({ provider, label, configDir }: AddInput): AddResult {
    if (provider === 'antigravity') {
      if (this.instances.some((i) => i.provider === 'antigravity')) {
        return { ok: false, status: 409, error: 'Antigravity is already added. Only one is allowed.' };
      }
      return this.save({ id: 'antigravity', provider, label: 'Antigravity' });
    }
    if (provider !== 'claude' && provider !== 'codex') {
      return { ok: false, status: 400, error: `Choose a provider: ${PROVIDERS.join(', ')}.` };
    }
    const trimmed = typeof label === 'string' ? label.trim() : '';
    const dirText = typeof configDir === 'string' ? configDir.trim() : '';
    if (!trimmed || !dirText) return { ok: false, status: 400, error: 'Give a label and a config dir.' };
    const dir = absoluteDir(dirText);
    if (!isDirectory(dir)) return { ok: false, status: 400, error: `${dir} is not a directory.` };
    // codex app-server creates its databases in any CODEX_HOME, so a mistyped dir would fill up on every read.
    if (provider === 'codex' && !['config.toml', 'auth.json'].some((f) => existsSync(join(dir, f)))) {
      return { ok: false, status: 400, error: `${dir} has no config.toml or auth.json, so it is not a Codex home.` };
    }
    const id = `${provider}:${slugFromLabel(provider, trimmed)}`;
    if (this.instances.some((i) => i.id === id)) return { ok: false, status: 409, error: `A source with id "${id}" is already added.` };
    if (this.instances.some((i) => i.provider === provider && i.configDir === dir)) {
      return { ok: false, status: 409, error: `${dir} is already added.` };
    }
    return this.save({ id, provider, label: trimmed, configDir: dir });
  }

  remove(id: string): boolean {
    if (!this.instances.some((i) => i.id === id)) return false;
    this.write(this.instances.filter((i) => i.id !== id));
    return true;
  }

  private save(instance: Instance): AddResult {
    this.write([...this.instances, instance]);
    return { ok: true, instance };
  }

  private write(instances: Instance[]): void {
    writeJsonAtomic(this.file, instances);
    this.instances = instances;
  }
}

import type { ConfigStore } from '../config.ts';
import type { ProviderUsage } from '../types.ts';
import type { Instance, Instances, Provider } from '../instances.ts';
import { antigravitySource } from './antigravity.ts';
import { claudeSource } from './claude.ts';
import { codexSource } from './codex.ts';

export type Reading = Omit<ProviderUsage, 'ok' | 'error' | 'fetchedAt'>;

export type Source = {
  /** The instance id: 'claude:<slug>', 'codex:<slug>' or 'antigravity' */
  id: string;
  provider: Provider;
  label: string;
  configDir?: string;
  fixHint: string;
  read: () => Promise<Reading[]>;
};

export type SourceStatus = {
  id: string;
  provider: Provider;
  label: string;
  configDir?: string;
  enabled: boolean;
  ok: boolean;
  error?: string;
  checkedAt?: string;
  fixHint: string;
  readings: ProviderUsage[];
};

type State = { readings: ProviderUsage[]; ok: boolean; error?: string; checkedAt?: string };

/** Holds each source's last good readings. A failed read keeps them and marks them ok: false. */
export class SourceRegistry {
  private readonly state = new Map<string, State>();

  constructor(
    private readonly listSources: () => Source[],
    private readonly config: ConfigStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  find(id: string): Source | undefined {
    return this.listSources().find((s) => s.id === id);
  }

  async refresh(source: Source): Promise<void> {
    const checkedAt = this.now().toISOString();
    try {
      const readings = await source.read();
      this.state.set(source.id, { ok: true, checkedAt, readings: readings.map((r) => ({ ...r, ok: true, fetchedAt: checkedAt })) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const previous = this.state.get(source.id)?.readings ?? [];
      this.state.set(source.id, { ok: false, error, checkedAt, readings: previous.map((r) => ({ ...r, ok: false, error })) });
    }
  }

  /** Drops a removed source's readings, so a source added later under the same id starts empty. */
  forget(id: string): void {
    this.state.delete(id);
  }

  /** Reads the enabled sources one at a time, so CLI processes never pile up. */
  async refreshEnabled(): Promise<void> {
    for (const source of this.listSources()) {
      if (this.config.isSourceEnabled(source.id)) await this.refresh(source);
    }
  }

  status(source: Source): SourceStatus {
    const state = this.state.get(source.id);
    return {
      id: source.id,
      provider: source.provider,
      label: source.label,
      configDir: source.configDir,
      enabled: this.config.isSourceEnabled(source.id),
      ok: state?.ok ?? false,
      error: state?.error,
      checkedAt: state?.checkedAt,
      fixHint: source.fixHint,
      readings: state?.readings ?? [],
    };
  }

  statuses(): SourceStatus[] {
    return this.listSources().map((s) => this.status(s));
  }

  enabledReadings(): ProviderUsage[] {
    return this.listSources()
      .filter((s) => this.config.isSourceEnabled(s.id))
      .flatMap((s) => this.state.get(s.id)?.readings ?? []);
  }
}

function sourceFor(instance: Instance): Source {
  switch (instance.provider) {
    case 'claude':
      return claudeSource(instance);
    case 'codex':
      return codexSource(instance);
    case 'antigravity':
      return antigravitySource();
  }
}

/** One source per instance the person added, in device row order. */
export function instanceSources(instances: Instances): Source[] {
  return instances.list().map(sourceFor);
}

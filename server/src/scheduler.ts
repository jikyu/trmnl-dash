import type { ConfigStore } from './config.ts';
import type { SourceRegistry } from './sources/index.ts';
import { buildSummary } from './summary.ts';
import type { TrmnlClient } from './trmnl.ts';

type Deps = { registry: SourceRegistry; client: TrmnlClient; config: ConfigStore; now: () => Date };

export class Scheduler {
  private running?: Promise<void>;

  constructor(private readonly deps: Deps) {}

  tick(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    const { registry, client, config, now } = this.deps;
    await registry.refreshEnabled();
    const url = config.get().webhookUrl;
    const readings = registry.enabledReadings();
    // After a restart whose first reads all failed, pushing no rows would blank the device. With no
    // enabled source at all, the empty rows are the truth, so the device clears.
    const noSources = !registry.statuses().some((s) => s.enabled);
    if (url && (readings.length > 0 || noSources)) await client.push(url, buildSummary(readings, now()));
  }

  start(): void {
    const loop = async () => {
      try {
        await this.tick();
      } catch (err) {
        console.error('Scheduler tick failed:', err instanceof Error ? err.message : err);
      }
      setTimeout(loop, this.deps.config.get().pushIntervalMinutes * 60_000);
    };
    void loop();
  }
}

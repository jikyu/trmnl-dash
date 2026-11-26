import { createApp } from '../src/app.ts';
import { ConfigStore } from '../src/config.ts';
import { Instances, type Provider } from '../src/instances.ts';
import { Scheduler } from '../src/scheduler.ts';
import { SourceRegistry, type Reading, type Source } from '../src/sources/index.ts';
import { TrmnlClient } from '../src/trmnl.ts';
import { tempDir } from './helpers.ts';

export type Post = { url: string; body: string };

/** A source whose reader returns whatever `next` holds, or throws it when it is an Error. */
export function fakeSource(id: string, next: { value: Reading[] | Error }, calls = { count: 0 }): Source {
  return {
    id,
    provider: id.split(':')[0] as Provider,
    label: id,
    fixHint: `fix ${id}`,
    read: async () => {
      calls.count += 1;
      if (next.value instanceof Error) throw next.value;
      return next.value;
    },
  };
}

export function weeklyReading(key: string, usedPct: number, name = key): Reading {
  return { provider: key.split(':')[0] as Reading['provider'], key, name, windows: { weekly: { usedPct } } };
}

export function createTestApp(sources: Source[] | ((instances: Instances) => Source[]) = []) {
  const dataDir = tempDir();
  const config = new ConfigStore(dataDir);
  const instances = new Instances(dataDir);
  const listSources = typeof sources === 'function' ? () => sources(instances) : () => sources;
  const clock = { now: new Date(2026, 10, 26, 18, 0) };
  const now = () => clock.now;
  const posts: Post[] = [];
  const responses: number[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    posts.push({ url, body: String(init.body) });
    return new Response('{}', { status: responses.shift() ?? 200 });
  };
  const registry = new SourceRegistry(listSources, config, now);
  const client = new TrmnlClient(fetchImpl, now);
  const scheduler = new Scheduler({ registry, client, config, now });
  const app = createApp({ config, registry, client, instances, now });
  /** Moves the clock to a local time on Nov 26, 2026. */
  const setTime = (hour: number, minute: number) => { clock.now = new Date(2026, 10, 26, hour, minute); };
  return { app, dataDir, config, clock, setTime, posts, responses, registry, client, scheduler };
}

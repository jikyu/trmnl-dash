import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { ConfigStore } from './config.ts';
import { Instances } from './instances.ts';
import { Scheduler } from './scheduler.ts';
import { instanceSources, SourceRegistry } from './sources/index.ts';
import { TrmnlClient } from './trmnl.ts';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const now = () => new Date();
const config = new ConfigStore(dataDir);
const instances = new Instances(dataDir);
const registry = new SourceRegistry(() => instanceSources(instances), config, now);
const client = new TrmnlClient();
const app = createApp({ config, registry, client, instances, now });

// Listen on loopback only; the default would listen on every interface.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 }, (info) => {
  console.log(`TRMNL Dash server on http://127.0.0.1:${info.port}`);
  new Scheduler({ registry, client, config, now }).start();
});

import { Hono } from 'hono';
import { ConfigStore, MIN_PUSH_INTERVAL_MINUTES } from './config.ts';
import type { Instances } from './instances.ts';
import { renderScreen } from './screen.ts';
import type { SourceRegistry } from './sources/index.ts';
import { buildSummary, MAX_PAYLOAD_BYTES } from './summary.ts';
import type { TrmnlClient } from './trmnl.ts';

export type AppDeps = {
  config: ConfigStore;
  registry: SourceRegistry;
  client: TrmnlClient;
  instances: Instances;
  now: () => Date;
};

const ALLOWED_HOSTS = new Set(['127.0.0.1:8787', 'localhost:8787']);
const WEBHOOK_PATTERN = /^https:\/\/trmnl\.com\/api\/custom_plugins\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (protocol === 'http:' || protocol === 'https:') && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function maskWebhookUrl(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/[^/]+$/, (uuid) => '••••' + uuid.slice(-4));
}

export function createApp(deps: AppDeps) {
  const { config, registry, client, instances, now } = deps;
  const app = new Hono();

  // A web page must not reach these routes through DNS rebinding or a cross-site request.
  app.use('/api/*', async (c, next) => {
    const host = c.req.header('host');
    const origin = c.req.header('origin');
    if (!host || !ALLOWED_HOSTS.has(host) || (origin !== undefined && !isLocalOrigin(origin))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  });

  const trmnlSettings = () => ({
    webhookUrl: maskWebhookUrl(config.get().webhookUrl),
    pushIntervalMinutes: config.get().pushIntervalMinutes,
    lastResult: client.lastResult ?? null,
  });

  app.get('/api/trmnl', (c) => c.json(trmnlSettings()));

  app.put('/api/trmnl', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'Send a JSON object.' }, 400);
    const patch: { webhookUrl?: string; pushIntervalMinutes?: number } = {};
    if ('webhookUrl' in body) {
      if (typeof body.webhookUrl !== 'string' || !WEBHOOK_PATTERN.test(body.webhookUrl)) {
        return c.json({ error: 'The webhook URL must look like https://trmnl.com/api/custom_plugins/<plugin UUID>.' }, 400);
      }
      patch.webhookUrl = body.webhookUrl;
    }
    if ('pushIntervalMinutes' in body) {
      const minutes = body.pushIntervalMinutes;
      if (!Number.isInteger(minutes) || minutes < MIN_PUSH_INTERVAL_MINUTES) {
        return c.json({ error: `The push interval must be a whole number of minutes, at least ${MIN_PUSH_INTERVAL_MINUTES}.` }, 400);
      }
      patch.pushIntervalMinutes = minutes;
    }
    config.update(patch);
    return c.json(trmnlSettings());
  });

  app.get('/api/sources', (c) => c.json(registry.statuses()));

  // Adding a source reads it right away, so its card does not wait for the next push interval.
  app.post('/api/sources', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'Send a JSON object.' }, 400);
    const result = instances.add(body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    const source = registry.find(result.instance.id)!;
    await registry.refresh(source);
    return c.json(registry.status(source), 201);
  });

  app.delete('/api/sources/:id', (c) => {
    const id = c.req.param('id');
    if (!instances.remove(id)) return c.json({ error: 'No such source.' }, 404);
    registry.forget(id);
    const { [id]: _removed, ...sources } = config.get().sources;
    config.update({ sources });
    return c.body(null, 204);
  });

  app.put('/api/sources/:id', async (c) => {
    const source = registry.find(c.req.param('id'));
    if (!source) return c.json({ error: 'No such source.' }, 404);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'Send { "enabled": true | false }.' }, 400);
    config.update({ sources: { ...config.get().sources, [source.id]: body.enabled } });
    return c.json(registry.status(source));
  });

  app.post('/api/sources/:id/test', async (c) => {
    const source = registry.find(c.req.param('id'));
    if (!source) return c.json({ error: 'No such source.' }, 404);
    await registry.refresh(source);
    return c.json(registry.status(source));
  });


  const summary = () => buildSummary(registry.enabledReadings(), now());

  app.get('/api/trmnl/preview', (c) => {
    const { body, bytes, tooLarge } = summary();
    return c.json({ body, bytes, limit: MAX_PAYLOAD_BYTES, tooLarge });
  });

  app.get('/api/trmnl/screen', async (c) => c.html(await renderScreen(summary().payload.merge_variables)));

  app.post('/api/trmnl/push', async (c) => {
    const url = config.get().webhookUrl;
    if (!url) return c.json({ error: 'Set the webhook URL first.' }, 400);
    const result = await client.push(url, summary(), { force: true });
    return c.json(result);
  });

  return app;
}

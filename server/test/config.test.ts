import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigStore } from '../src/config.ts';
import { tempDir, WEBHOOK } from './helpers.ts';

test('a missing config.json loads defaults', () => {
  const store = new ConfigStore(tempDir());
  const config = store.get();
  assert.equal(config.webhookUrl, undefined);
  assert.equal(config.pushIntervalMinutes, 10);
  assert.equal(store.isSourceEnabled('codex'), true);
  assert.equal(store.isSourceEnabled('claude:work'), true);
});

test('saved settings are written with mode 0600 and read back', () => {
  const dir = tempDir();
  new ConfigStore(dir).update({ webhookUrl: WEBHOOK, pushIntervalMinutes: 15, sources: { codex: false } });
  const file = join(dir, 'config.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const reloaded = new ConfigStore(dir);
  assert.equal(reloaded.get().webhookUrl, WEBHOOK);
  assert.equal(reloaded.get().pushIntervalMinutes, 15);
  assert.equal(reloaded.isSourceEnabled('codex'), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sources, { codex: false });
});

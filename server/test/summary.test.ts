import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSummary } from '../src/summary.ts';
import type { ProviderUsage, Window } from '../src/types.ts';

// Local time, so the expected strings hold in any time zone.
const NOW = new Date(2026, 10, 26, 18, 40);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

function reading(key: string, name: string, windows: Record<string, Window>, ok = true): ProviderUsage {
  return { provider: key.split(':')[0] as ProviderUsage['provider'], key, name, ok, fetchedAt: NOW.toISOString(), windows };
}

const SAMPLE_READINGS: ProviderUsage[] = [
  reading('claude:default', 'Claude', { weekly: { usedPct: 61, resetsAt: at(30, 9) } }),
  reading('claude:work', 'Claude work', { weekly: { usedPct: 12, resetsAt: at(32, 9) } }),
  reading('codex', 'Codex', { session: { usedPct: 10, resetsAt: at(26, 21, 15) }, weekly: { usedPct: 33, resetsAt: at(27, 21) } }),
  reading('antigravity:gemini-models', 'Agi Gemini', {
    session: { usedPct: 5, resetsAt: at(26, 19, 10) },
    weekly: { usedPct: 18, resetsAt: at(29, 8) },
  }),
  reading('antigravity:claude-and-gpt-models', 'Agi Other', {
    session: { usedPct: 0 },
    weekly: { usedPct: 0 },
  }),
];

test('the sample readings produce exactly the sample payload', () => {
  const expected = JSON.parse(readFileSync(new URL('../../trmnl/sample-payload.json', import.meta.url), 'utf8'));
  const summary = buildSummary(SAMPLE_READINGS, NOW);
  assert.deepEqual(JSON.parse(summary.body), expected);
  assert.ok(summary.bytes < 1000, `sample payload is ${summary.bytes} bytes`);
  assert.equal(summary.tooLarge, false);
});

test('a window whose reset has passed shows 0 with no reset time', () => {
  const r = reading('claude:default', 'Claude', { weekly: { usedPct: 80, resetsAt: at(26, 18, 35) } });
  const [row] = buildSummary([r], NOW).payload.merge_variables.providers;
  assert.deepEqual(row, { name: 'Claude', weekly: 0, weekly_reset: '' });
});

test('six readings keep the first five rows in source order', () => {
  const six = [...SAMPLE_READINGS, reading('antigravity:extra', 'Antigravity Extra', { weekly: { usedPct: 1 } })];
  const names = buildSummary(six, NOW).payload.merge_variables.providers.map((p) => p.name);
  assert.deepEqual(names, SAMPLE_READINGS.map((r) => r.name));
});

test('a missing window leaves its keys out', () => {
  const [row] = buildSummary([reading('codex', 'Codex', { weekly: { usedPct: 77, resetsAt: at(27, 21) } })], NOW)
    .payload.merge_variables.providers;
  assert.deepEqual(row, { name: 'Codex', weekly: 77, weekly_reset: 'Fri' });
  assert.equal('session' in row, false);
});

test('resets within 24 hours show HH:mm and later ones a short weekday', () => {
  const r = reading('codex', 'Codex', { session: { usedPct: 1, resetsAt: at(26, 21, 40) }, weekly: { usedPct: 1, resetsAt: at(29, 21, 40) } });
  const [row] = buildSummary([r], NOW).payload.merge_variables.providers;
  assert.equal(row.session_reset, '21:40');
  assert.equal(row.weekly_reset, 'Sun');
  const tomorrow = reading('codex', 'Codex', { session: { usedPct: 1, resetsAt: at(27, 8, 5) } });
  assert.equal(buildSummary([tomorrow], NOW).payload.merge_variables.providers[0].session_reset, '08:05');
});

test('percentages round to whole numbers and stop at 100', () => {
  const r = reading('codex', 'Codex', { session: { usedPct: 61.6 }, weekly: { usedPct: 104 } });
  const [row] = buildSummary([r], NOW).payload.merge_variables.providers;
  assert.equal(row.session, 62);
  assert.equal(row.weekly, 100);
});

test('a failed reading still contributes its last values', () => {
  const r = { ...reading('codex', 'Codex', { weekly: { usedPct: 10 } }, false), error: 'boom' };
  assert.equal(buildSummary([r], NOW).payload.merge_variables.providers[0].weekly, 10);
});

test('the size is the UTF-8 byte length of the serialized payload', () => {
  const r = reading('claude:default', 'Claude · 日本語', { weekly: { usedPct: 1 } });
  const summary = buildSummary([r], NOW);
  assert.equal(summary.bytes, Buffer.byteLength(summary.body, 'utf8'));
  assert.ok(summary.bytes > summary.body.length);
  assert.equal(summary.body, JSON.stringify({ merge_variables: summary.payload.merge_variables }));
});

test('a summary over 5 KB is marked too large', () => {
  const big = reading('claude:default', 'x'.repeat(5200), { weekly: { usedPct: 1 } });
  assert.equal(buildSummary([big], NOW).tooLarge, true);
});

test('the providers key ignores the updated time', () => {
  const a = buildSummary(SAMPLE_READINGS, NOW);
  const b = buildSummary(SAMPLE_READINGS, new Date(NOW.getTime() + 60_000));
  assert.notEqual(a.body, b.body);
  assert.equal(a.providersKey, b.providersKey);
});

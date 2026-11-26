import type { ProviderUsage, Window } from './types.ts';

/** TRMNL's merge variable limit on standard accounts. */
export const MAX_PAYLOAD_BYTES = 5000;
export const MAX_ROWS = 5;

export type Row = {
  name: string;
  session?: number;
  session_reset?: string;
  weekly?: number;
  weekly_reset?: string;
};

export type Payload = { merge_variables: { updated: string; providers: Row[] } };

export type Summary = {
  payload: Payload;
  body: string;
  bytes: number;
  tooLarge: boolean;
  /** The serialized rows without `updated`, which changes on every build. Equal keys mean nothing to push. */
  providersKey: string;
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function formatReset(resetsAt: Date, now: Date): string {
  return resetsAt.getTime() - now.getTime() <= DAY_MS ? clock(resetsAt) : WEEKDAYS[resetsAt.getDay()];
}

function windowValues(window: Window, now: Date): [number, string] {
  if (window.resetsAt) {
    const resetsAt = new Date(window.resetsAt);
    if (resetsAt <= now) return [0, ''];
    return [percent(window.usedPct), formatReset(resetsAt, now)];
  }
  return [percent(window.usedPct), ''];
}

function percent(usedPct: number): number {
  return Math.min(100, Math.max(0, Math.round(usedPct)));
}

function row(reading: ProviderUsage, now: Date): Row {
  const out: Row = { name: reading.name };
  const { session, weekly } = reading.windows;
  if (session) [out.session, out.session_reset] = windowValues(session, now);
  if (weekly) [out.weekly, out.weekly_reset] = windowValues(weekly, now);
  return out;
}

export function buildSummary(readings: ProviderUsage[], now: Date): Summary {
  const providers = readings.slice(0, MAX_ROWS).map((r) => row(r, now));
  const updated = `${MONTHS[now.getMonth()]} ${now.getDate()} ${clock(now)}`;
  const payload: Payload = { merge_variables: { updated, providers } };
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body, 'utf8');
  return { payload, body, bytes, tooLarge: bytes > MAX_PAYLOAD_BYTES, providersKey: JSON.stringify(providers) };
}

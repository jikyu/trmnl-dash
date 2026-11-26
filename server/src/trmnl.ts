import { clock, MAX_PAYLOAD_BYTES, type Summary } from './summary.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type PushResult = { at: string; ok: boolean; status?: number; message: string };

const POST_TIMEOUT_MS = 15_000;

export class TrmnlClient {
  lastResult?: PushResult;
  private lastPushedKey?: string;
  private rejectedKey?: string;
  private holdUntil?: Date;

  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async push(url: string, summary: Summary, { force = false } = {}): Promise<PushResult | undefined> {
    const now = this.now();
    // Rows already sent to one plugin are still new to a different webhook URL.
    const key = `${url}\n${summary.providersKey}`;
    if (this.holdUntil && now < this.holdUntil) {
      return force ? this.unrecorded(`TRMNL rate limit: pushes resume at ${clock(this.holdUntil)}.`) : undefined;
    }
    if (summary.tooLarge) {
      return this.result(false, `The payload is ${summary.bytes} bytes, over the ${MAX_PAYLOAD_BYTES}-byte limit. Turn a source off to shrink it.`);
    }
    if (key === this.rejectedKey) {
      return force ? this.unrecorded('TRMNL rejected these rows as too large. They are sent again once they change.') : undefined;
    }
    if (!force && key === this.lastPushedKey) return undefined;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: summary.body,
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
    } catch (err) {
      // The error message never carries the URL; the next tick tries again.
      return this.result(false, `Network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { status } = response;
    if (response.ok) {
      this.lastPushedKey = key;
      this.rejectedKey = undefined;
      return this.result(true, `Pushed ${summary.bytes} bytes.`, status);
    }
    if (status === 422) {
      this.rejectedKey = key;
      return this.result(false, 'TRMNL rejected the payload as too large (422).', status);
    }
    if (status === 429) {
      const next = new Date(now);
      next.setMinutes(60, 0, 0);
      this.holdUntil = next;
      return this.result(false, `TRMNL rate limit (429). Pushes resume at ${clock(next)}.`, status);
    }
    if (status === 403) {
      return this.result(false, 'TRMNL refused the push (403). Private plugin webhooks need a Developer Edition device.', status);
    }
    return this.result(false, `TRMNL answered ${status}.`, status);
  }

  /** Records the outcome as the last push result, which GET /api/trmnl returns. */
  private result(ok: boolean, message: string, status?: number): PushResult {
    this.lastResult = { at: this.now().toISOString(), ok, message, ...(status === undefined ? {} : { status }) };
    return this.lastResult;
  }

  /** A held Push now: tells the caller why nothing was sent, without replacing the last push result. */
  private unrecorded(message: string): PushResult {
    return { at: this.now().toISOString(), ok: false, message };
  }
}

export type Window = { usedPct: number; resetsAt?: string }; // resetsAt is ISO 8601

export type ProviderUsage = {
  provider: 'claude' | 'codex' | 'antigravity';
  key: string; // 'claude:work', 'codex:default', 'antigravity:<group>'
  name: string; // the row label on the device
  ok: boolean;
  error?: string;
  fetchedAt: string;
  windows: Record<string, Window>; // session, weekly
};

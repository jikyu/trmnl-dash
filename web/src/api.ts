export type Window = { usedPct: number; resetsAt?: string }

export type Reading = {
  key: string
  name: string
  ok: boolean
  error?: string
  fetchedAt: string
  windows: Record<string, Window>
}

export type Provider = 'claude' | 'codex' | 'antigravity'

export type SourceStatus = {
  id: string
  provider: Provider
  label: string
  configDir?: string
  enabled: boolean
  ok: boolean
  error?: string
  checkedAt?: string
  fixHint: string
  readings: Reading[]
}

export type PushResult = { at: string; ok: boolean; status?: number; message: string }

export type TrmnlSettings = {
  webhookUrl: string | null
  pushIntervalMinutes: number
  lastResult: PushResult | null
}

export type Preview = { body: string; bytes: number; limit: number; tooLarge: boolean }

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}`)
  return data as T
}

export const formatTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '')

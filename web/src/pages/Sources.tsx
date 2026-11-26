import { useCallback, useEffect, useState } from 'react'
import { api, formatTime, type Provider, type SourceStatus } from '@/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const WINDOW_LABELS: Record<string, string> = { session: 'Session', weekly: 'Weekly' }

function SourceCard({ source, onChange }: { source: SourceStatus; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
      await onChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const path = `/api/sources/${encodeURIComponent(source.id)}`
  const [status, badgeVariant] = !source.checkedAt
    ? (['Not read yet', 'secondary'] as const)
    : source.ok
      ? (['Working', 'default'] as const)
      : (['Failing', 'destructive'] as const)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{source.label}</CardTitle>
        <CardDescription>
          {[source.configDir ?? 'agy', source.checkedAt && `read ${formatTime(source.checkedAt)}`].filter(Boolean).join(' · ')}
        </CardDescription>
        <CardAction>
          <Switch
            checked={source.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => run(() => api('PUT', path, { enabled }))}
            aria-label={`Show ${source.label} on the device`}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Badge variant={badgeVariant}>{status}</Badge>
        </div>
        {!source.ok && source.error && (
          <Alert variant="destructive">
            <AlertTitle>{source.error}</AlertTitle>
            <AlertDescription>{source.fixHint}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
        {source.readings.map((reading) => (
          <div key={reading.key} className="flex flex-col gap-1">
            {source.readings.length > 1 && <p className="font-medium">{reading.name}</p>}
            {Object.entries(reading.windows).map(([name, window]) => (
              <p key={name} className="text-muted-foreground">
                {WINDOW_LABELS[name] ?? name}: {Math.round(window.usedPct)}% used
                {window.resetsAt && ` · resets ${formatTime(window.resetsAt)}`}
              </p>
            ))}
          </div>
        ))}
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" disabled={busy} onClick={() => run(() => api('POST', `${path}/test`))}>
          {busy ? 'Reading…' : 'Test'}
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => run(() => api('DELETE', path))}>
          Remove
        </Button>
      </CardFooter>
    </Card>
  )
}

const PROVIDERS: Record<Provider, { name: string; description: string; label?: string; dir?: string }> = {
  claude: {
    name: 'Claude Code',
    description: 'One Claude Code config dir, such as ~/.claude or the CLAUDE_CONFIG_DIR of an alias.',
    label: 'Claude work',
    dir: '~/.claude-work',
  },
  codex: {
    name: 'Codex',
    description: 'One Codex home, such as ~/.codex or the CODEX_HOME of another account.',
    label: 'Codex',
    dir: '~/.codex',
  },
  antigravity: {
    name: 'Antigravity',
    description: 'Reads agy -p /usage for the account agy is signed in to. Only one can be added.',
  },
}

function AddSource({ hasAntigravity, onAdded }: { hasAntigravity: boolean; onAdded: () => Promise<void> }) {
  const [provider, setProvider] = useState<Provider>('claude')
  const [label, setLabel] = useState('')
  const [configDir, setConfigDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { description, label: labelHint, dir: dirHint } = PROVIDERS[provider]
  const needsDir = provider !== 'antigravity'
  const blocked = provider === 'antigravity' && hasAntigravity

  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api<SourceStatus>('POST', '/api/sources', needsDir ? { provider, label, configDir } : { provider })
      setLabel('')
      setConfigDir('')
      if (provider === 'antigravity') setProvider('claude')
      await onAdded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a source</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs
          value={provider}
          onValueChange={(value) => {
            setProvider(value as Provider)
            setError(undefined)
          }}
        >
          <TabsList>
            {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
              <TabsTrigger key={p} value={p} disabled={p === 'antigravity' && hasAntigravity}>
                {PROVIDERS[p].name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <form id="add-source" onSubmit={add} className="flex flex-col gap-3">
          {needsDir && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="source-label">Label</Label>
                <Input id="source-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={labelHint} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="source-dir">Config dir</Label>
                <Input id="source-dir" value={configDir} onChange={(e) => setConfigDir(e.target.value)} placeholder={dirHint} />
              </div>
            </>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
        </form>
      </CardContent>
      <CardFooter>
        <Button type="submit" form="add-source" disabled={busy || blocked || (needsDir && (!label || !configDir))}>
          {busy ? 'Adding…' : `Add ${PROVIDERS[provider].name}`}
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function Sources() {
  const [sources, setSources] = useState<SourceStatus[]>()
  const [error, setError] = useState<string>()

  const load = useCallback(
    () =>
      api<SourceStatus[]>('GET', '/api/sources').then(
        (s) => {
          setSources(s)
          setError(undefined)
        },
        (err: Error) => setError(err.message),
      ),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Cannot reach the TRMNL Dash server</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {sources?.length === 0 && (
        <p className="text-muted-foreground">No sources yet. Add one to show its usage on the device.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {sources?.map((source) => <SourceCard key={source.id} source={source} onChange={load} />)}
        <AddSource hasAntigravity={!!sources?.some((s) => s.provider === 'antigravity')} onAdded={load} />
      </div>
    </div>
  )
}

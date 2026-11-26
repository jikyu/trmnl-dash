import { useCallback, useEffect, useState } from 'react'
import { api, formatTime, type PushResult, type TrmnlSettings } from '@/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function ResultAlert({ result }: { result: PushResult }) {
  return (
    <Alert variant={result.ok ? 'default' : 'destructive'}>
      <AlertTitle>{result.message}</AlertTitle>
      <AlertDescription>{formatTime(result.at)}</AlertDescription>
    </Alert>
  )
}

export default function Trmnl() {
  const [settings, setSettings] = useState<TrmnlSettings>()
  const [webhookUrl, setWebhookUrl] = useState('')
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [pushResult, setPushResult] = useState<PushResult>()
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(
    () =>
      api<TrmnlSettings>('GET', '/api/trmnl').then(
        (s) => {
          setSettings(s)
          return s
        },
        (err: Error) => setError(err.message),
      ),
    [],
  )

  // Only the first load fills the form, so a refresh never overwrites an edit that is not saved yet.
  useEffect(() => {
    void refresh().then((s) => s && setMinutes(String(s.pushIntervalMinutes)))
  }, [refresh])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(undefined)
    setSaved(false)
    try {
      const body: Record<string, unknown> = { pushIntervalMinutes: Number(minutes) }
      if (webhookUrl) body.webhookUrl = webhookUrl
      setSettings(await api<TrmnlSettings>('PUT', '/api/trmnl', body))
      setWebhookUrl('')
      setSaved(true)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const push = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setPushResult(await api<PushResult>('POST', '/api/trmnl/push'))
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
          <CardDescription>
            The webhook URL of your TRMNL private plugin. It is stored on this machine only and shown masked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="trmnl-settings" onSubmit={save} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <Input
                id="webhook-url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder={settings?.webhookUrl ?? 'https://trmnl.com/api/custom_plugins/…'}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="push-interval">Push interval (minutes, at least 5)</Label>
              <Input id="push-interval" type="number" min={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            {saved && (
              <Alert>
                <AlertTitle>Saved</AlertTitle>
              </Alert>
            )}
          </form>
        </CardContent>
        <CardFooter>
          <Button type="submit" form="trmnl-settings">
            Save
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Push</CardTitle>
          <CardDescription>
            The server pushes every push interval when the rows changed. Push now sends the current rows even when unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pushResult && <ResultAlert result={pushResult} />}
          {!pushResult && settings?.lastResult && <ResultAlert result={settings.lastResult} />}
          {!pushResult && !settings?.lastResult && <p className="text-muted-foreground">Nothing pushed yet.</p>}
        </CardContent>
        <CardFooter>
          <Button onClick={push} disabled={busy || !settings?.webhookUrl}>
            {busy ? 'Pushing…' : 'Push now'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

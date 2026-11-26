import { useCallback, useEffect, useState } from 'react'
import { api, type Preview as PreviewData } from '@/api'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Preview() {
  const [preview, setPreview] = useState<PreviewData>()
  const [error, setError] = useState<string>()
  const [screenVersion, setScreenVersion] = useState(0)

  const load = useCallback(
    () =>
      api<PreviewData>('GET', '/api/trmnl/preview').then(
        (data) => {
          setPreview(data)
          setError(undefined)
        },
        (err: Error) => setError(err.message),
      ),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const refresh = () => {
    setScreenVersion((v) => v + 1)
    void load()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Screen</CardTitle>
          <CardDescription>
            The full view at the original TRMNL's 800×480, rendered from trmnl/full.liquid and the payload below.
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={refresh}>
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <iframe
            key={screenVersion}
            title="TRMNL screen"
            src="/api/trmnl/screen"
            sandbox=""
            width={800}
            height={480}
            className="box-content border"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Payload</CardTitle>
          <CardDescription>The merge variables the next push sends, built from the last readings.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          {preview && (
            <>
              <div>
                <Badge variant={preview.tooLarge ? 'destructive' : 'secondary'}>
                  {preview.bytes} of {preview.limit} bytes
                </Badge>
              </div>
              <pre className="overflow-x-auto text-xs">{JSON.stringify(JSON.parse(preview.body), null, 2)}</pre>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

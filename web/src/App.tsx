import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Preview from '@/pages/Preview'
import Sources from '@/pages/Sources'
import Trmnl from '@/pages/Trmnl'

export default function App() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">TRMNL Dash</h1>
      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="trmnl">TRMNL</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <Sources />
        </TabsContent>
        <TabsContent value="trmnl">
          <Trmnl />
        </TabsContent>
        <TabsContent value="preview">
          <Preview />
        </TabsContent>
      </Tabs>
    </main>
  )
}

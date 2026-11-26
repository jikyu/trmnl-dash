import { readFileSync } from 'node:fs';
import { Liquid } from 'liquidjs';
import type { Payload } from './summary.ts';

const TEMPLATE_URL = new URL('../../trmnl/full.liquid', import.meta.url);
const liquid = new Liquid();

/**
 * Renders trmnl/full.liquid with the merge variables inside TRMNL's page shell, so the dashboard
 * shows the full view at the original device's 800×480. The template is read on every call so an
 * edit shows on the next refresh.
 */
export async function renderScreen(mergeVariables: Payload['merge_variables']): Promise<string> {
  const markup = await liquid.parseAndRender(readFileSync(TEMPLATE_URL, 'utf8'), mergeVariables);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://trmnl.com/css/latest/plugins.css">
<style>body { margin: 0; }</style>
</head>
<body class="environment trmnl">
<div class="screen">
<div class="view view--full">
${markup}
</div>
</div>
</body>
</html>
`;
}

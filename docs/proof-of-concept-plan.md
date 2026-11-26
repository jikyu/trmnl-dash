# Proof-of-concept plan

Show Claude Code, OpenAI Codex and Google Antigravity plan usage on a TRMNL Developer Edition device.

## Constraints

- **Device:** TRMNL with Developer Edition. Private plugins and webhooks need it; without it the webhook returns 403.
- **Usage comes from the official CLIs only.** Each CLI stays signed in with its own login. This project never reads, stores or mints a provider token, and never calls a provider's HTTP API directly.
- **TRMNL webhook limits:** 5 KB of merge variables per push (10 KB on TRMNL+), 12 pushes per hour (30 on TRMNL+). Over the size limit returns 422; over the rate limit returns 429.
- **No public URL.** The backend pushes outbound to TRMNL, so it can run behind NAT on a laptop.
- **UI:** shadcn/ui defaults, no custom styling.

## Architecture

```
 Claude Code ──statusLine stdin──► claude-statusline.mjs ──POST /api/ingest/claude──┐
 codex app-server ◄──JSON-RPC (stdio)───────────────────────────────────────────────┤
 agy -p /usage --output-format json ◄──spawn────────────────────────────────────────┤
                                                                                    ▼
 web (Vite + React + shadcn) ──/api──► server (Hono, 127.0.0.1:8787)
                                         collect → normalize → summarize (<5 KB)
                                         scheduler: push every 10 min if changed
                                                    │ HTTPS POST
                                                    ▼
                         https://trmnl.com/api/custom_plugins/<uuid>  (private plugin, Webhook)
                                                    │ Liquid markup
                                                    ▼
                                       TRMNL device (Developer Edition)
```

The server binds to 127.0.0.1 only. Its one secret is the TRMNL webhook URL, kept in `server/data/config.json` (gitignored, mode 0600).

## Usage sources

| Provider | How the server gets usage | Fields used |
|---|---|---|
| Claude Code | Claude Code runs a `statusLine` command and passes it session JSON on stdin. `claude-statusline.mjs` forwards that JSON to `POST /api/ingest/claude` and prints a short status line. | `rate_limits.five_hour` and `rate_limits.seven_day`: `used_percentage`, `resets_at` (Unix seconds) |
| OpenAI Codex | Spawn `codex app-server`, send `initialize`, then `account/rateLimits/read` over stdio JSON-RPC. Listen for `account/rateLimits/updated`. | Session and weekly windows from `GetAccountRateLimitsResponse` |
| Antigravity | Spawn `agy -p /usage --output-format json` on the push timer, with a 90-second timeout. | Gemini and Claude pools (5-hour and weekly) |

Claude Code setup, in `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "node /path/to/trmnl-dash/server/bin/claude-statusline.mjs" }
}
```

`rate_limits` is only present for Pro, Max and Ultra plans, and only after a session's first API response. Claude usage therefore updates only while Claude Code is in use. When a window's `resets_at` has passed, show it as 0%.

Sign-in happens in each CLI (`claude`, `codex login`, `agy`). The dashboard only reports whether each source is working.

## Data model

```ts
type Window = { usedPct: number; resetsAt?: string }; // ISO 8601
type ProviderUsage = {
  id: 'claude' | 'codex' | 'antigravity';
  ok: boolean;
  error?: string;
  fetchedAt: string;
  windows: Record<string, Window>; // session, weekly, ...
};
```

Each source keeps its last good reading. A failed read sets `ok: false` and keeps the old values.

## TRMNL plugin

1. Create a Private Plugin, set the strategy to Webhook and save. Copy the Webhook URL into the dashboard.
2. Paste the markup below into the Full layout.

Payload the server pushes:

```json
{
  "merge_variables": {
    "updated": "Nov 26 18:40",
    "providers": [
      { "name": "Claude", "session": 42, "session_reset": "20:00", "weekly": 61, "weekly_reset": "Mon" },
      { "name": "Codex", "session": 10, "session_reset": "21:15", "weekly": 33, "weekly_reset": "Fri" },
      { "name": "Antigravity", "session": 0, "session_reset": "", "weekly": 18, "weekly_reset": "Sun" }
    ]
  }
}
```

Markup (the platform adds the `view` wrapper):

```html
<div class="layout">
  <div>
    {% for p in providers %}
      <span class="title">{{ p.name }}</span>
      <span class="label">Session {{ p.session }}% · resets {{ p.session_reset }}</span>
      <div class="progress-bar"><div class="track"><div class="fill" style="width: {{ p.session }}%"></div></div></div>
      <span class="label">Weekly {{ p.weekly }}% · resets {{ p.weekly_reset }}</span>
      <div class="progress-bar"><div class="track"><div class="fill" style="width: {{ p.weekly }}%"></div></div></div>
    {% endfor %}
  </div>
</div>
<div class="title_bar"><span class="title">AI usage</span><span class="instance">{{ updated }}</span></div>
```

New data appears at the plugin's next scheduled refresh.

## Repo layout

```
web/                     Vite + React + TS + shadcn/ui
server/
  bin/claude-statusline.mjs
  src/index.ts           Hono app and routes
  src/sources/{claude,codex,antigravity}.ts
  src/summary.ts         ProviderUsage[] → merge_variables, size check
  src/trmnl.ts           webhook POST, 422/429 handling
  src/scheduler.ts       10-minute loop, skip when unchanged
  data/config.json       gitignored
```

Scaffold:

```bash
npm create vite@latest web -- --template react-ts
cd web && npx shadcn@latest init && npx shadcn@latest add card button input badge switch
# web/vite.config.ts: server.proxy = { '/api': 'http://127.0.0.1:8787' }
npm create hono@latest server   # nodejs template
```

## Server routes

| Route | Purpose |
|---|---|
| `GET /api/sources` | Status and last reading for each source |
| `POST /api/sources/:id/test` | Read one source now |
| `PUT /api/sources/:id` | Turn a source on or off |
| `POST /api/ingest/claude` | Receives the forwarded statusLine JSON |
| `GET /api/trmnl` / `PUT /api/trmnl` | Webhook URL (masked on read) and push interval |
| `GET /api/trmnl/preview` | Exact payload and its byte size |
| `POST /api/trmnl/push` | Push now |

## Dashboard pages

- **Sources:** one card per provider with status, last reading, an on/off switch and a Test button. When a source fails, show the CLI command that fixes it. For Claude, show the `statusLine` snippet.
- **TRMNL:** webhook URL, push interval, Push now.
- **Preview:** the payload JSON and its size.

## Milestones

1. Push the sample payload with `curl` and see it on the device.
2. Server with the TRMNL client, summary and scheduler, using fake sources.
3. Codex source.
4. Claude statusLine forwarder and ingest route.
5. Antigravity source.
6. Dashboard pages.

## Open questions

- The exact field names in Codex's `GetAccountRateLimitsResponse`. Read them from the app-server protocol schema in milestone 3.
- The JSON shape of `agy -p /usage --output-format json`, and the minimum `agy` version that has it. Check locally in milestone 5.
- Whether a user's existing `statusLine` needs to be kept. If so, the forwarder should run the old command and print its output.

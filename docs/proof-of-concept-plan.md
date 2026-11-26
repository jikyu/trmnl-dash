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
 Claude Code (one per config dir) ──statusLine stdin──► claude-statusline.mjs --install <id>
        ▲                                                   │ POST /api/ingest/claude/<id>
        └──── stdout of the user's previous statusLine ◄────┤ (runs it with the same stdin)
 claude -p /usage (fallback, per config dir) ◄──spawn──────────────────────────────────┤
 codex app-server ◄──JSON-RPC (stdio)──────────────────────────────────────────────────┤
 agy -p /usage ◄──spawn────────────────────────────────────────────────────────────────┤
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
| Claude Code | One source per installation. Claude Code runs a `statusLine` command and passes it session JSON on stdin. `claude-statusline.mjs --install <id>` forwards that JSON to `POST /api/ingest/claude/<id>`, then runs the user's previous `statusLine` command and prints its output. Falls back to `claude -p /usage`. | `rate_limits.five_hour` and `rate_limits.seven_day`: `used_percentage`, `resets_at` (Unix seconds) |
| OpenAI Codex | Spawn `codex app-server`, send `initialize`, then `account/rateLimits/read` over stdio JSON-RPC. Listen for `account/rateLimits/updated`. | `rateLimits.primary` and `rateLimits.secondary`: `usedPercent`, `windowDurationMins`, `resetsAt` (Unix seconds). `windowDurationMins` 300 is the session window and 10080 the weekly one. `account/rateLimits/updated` carries the same `rateLimits`. |
| Antigravity | Spawn `agy -p /usage` on the push timer, with a 90-second timeout, and parse its text report. One reading per model group. | Each model group's five-hour and weekly limits |

Sign-in happens in each CLI (`claude`, `codex login`, `agy`). The dashboard only reports whether each source is working.

### Claude Code installations

An installation is one Claude Code config dir. `CLAUDE_CONFIG_DIR` replaces the default `~/.claude`, and settings, session history and the claude.ai login all move with it, so each config dir is its own account with its own `settings.json` and its own `statusLine`. People run several side by side with shell aliases such as `alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'`. See [Environment variables](https://code.claude.com/docs/en/env-vars) and [Authentication](https://code.claude.com/docs/en/authentication).

`server/data/claude-installs.json` (gitignored) lists the installations:

```json
[
  { "id": "default", "label": "Claude", "configDir": "/Users/me/.claude", "previousCommand": "~/bin/my-statusline.sh" },
  { "id": "work", "label": "Claude work", "configDir": "/Users/me/.claude-work" }
]
```

The server stores `configDir` as an absolute path. The dashboard seeds one installation from the server's `CLAUDE_CONFIG_DIR`, or `~/.claude` when it is unset. The user adds the others by label and path. The file holds no secret, so the forwarder can read it without opening `config.json`.

The statusLine JSON has no field that names the config dir or the account, and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` removes `CLAUDE_CONFIG_DIR` from the forwarder's environment. Each installation's command therefore carries its id as an argument.

Adding an installation writes its `statusLine` into `<configDir>/settings.json`:

1. Read the file, or start from `{}` when it does not exist. If it is not valid JSON, stop and report the error.
2. If `statusLine.command` already runs `claude-statusline.mjs`, change nothing.
3. Otherwise save the old `statusLine.command` as `previousCommand` and replace only `command`, keeping `padding`, `refreshInterval` and every other key.
4. Write to a temporary file in the same directory, keep the original file mode, and rename it over the original.

The result:

```json
{
  "statusLine": { "type": "command", "command": "node /path/to/trmnl-dash/server/bin/claude-statusline.mjs --install work" }
}
```

Removing an installation puts `previousCommand` back, or deletes `statusLine` when there was none. It does this only while the command is still the forwarder's; otherwise it leaves the file alone and says so. The server touches nothing in a config dir except `settings.json`, and never reads `.credentials.json` or `.claude.json`.

`claude-statusline.mjs --install <id>`:

1. Read stdin to the end.
2. POST it to `http://127.0.0.1:8787/api/ingest/claude/<id>` with a 1-second timeout, and ignore any failure, so a stopped server never breaks the status line.
3. If the installation has a `previousCommand`, run it in a shell with the same stdin, working directory and environment, and print its stdout. Otherwise print nothing.
4. Ignore the previous command's stderr and exit code, and always exit 0. The forwarder adds no timeout of its own, and it runs the POST and the previous command at the same time so it adds no delay.

A `statusLine` in managed settings, `--settings`, `.claude/settings.local.json` or a project's `.claude/settings.json` overrides the user-level one, and the forwarder does not run there. This is a known edge case that the proof of concept does not handle.

When an installation has had no forwarded reading since the last push, the server runs `claude -p /usage --output-format json` with that installation's `CLAUDE_CONFIG_DIR` and reads the text report in `result`. With Claude Code 2.1.332, `-p /usage` runs as a local command (`"local_command": "usage"`, no model turn, no cost). Signed out, the report holds only session token and cost lines. The docs say subscribers also see plan usage bars, so milestone 4 writes the parser from a signed-in run and drops the fallback if the bars are not in the `-p` output.

`rate_limits` is only present for Pro and Max plans (Claude Code 2.1.80 or later), only after a session's first API response, and only once the user accepts workspace trust. Either window can be missing on its own. Claude usage therefore updates only while that installation is in use. When a window's `resets_at` has passed, show it as 0%. Two installations signed in to the same account report the same numbers; the plan treats them as separate rows and leaves it to the user's labels.

### Antigravity model groups

Antigravity's [`/usage` docs](https://antigravity.google/docs/cli/commands/usage) say the models in a group, such as Gemini Flash, Gemini Pro, or the Claude and GPT models, share a five-hour limit and a weekly limit. The Antigravity source returns one reading per group, named after the group as `agy` prints it, such as "Antigravity Gemini Pro". The group names are not hard-coded.

The [headless docs](https://antigravity.google/docs/cli/headless) say `/usage` produces a text report, not JSON, so the source runs `agy -p /usage` without `--output-format` and treats a non-zero exit as a failed read. A running `agy` session does not refresh its quota, so each read spawns a new process. Milestone 5 writes the parser from a local run's real output.

## Data model

```ts
type Window = { usedPct: number; resetsAt?: string }; // ISO 8601
type ProviderUsage = {
  provider: 'claude' | 'codex' | 'antigravity';
  key: string;  // 'claude:work', 'codex', 'antigravity:<group>'
  name: string; // the row label on the device
  ok: boolean;
  error?: string;
  fetchedAt: string;
  windows: Record<string, Window>; // session, weekly, ...
};
```

A source produces one or more readings: one for each Claude installation (source id `claude:<id>`), one for Codex (`codex`), and one per model group for Antigravity (`antigravity`). Each source keeps its last good readings. A failed read sets `ok: false` and keeps the old values, for every Antigravity group at once. Claude's `five_hour` maps to `session` and `seven_day` to `weekly`.

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
      { "name": "Claude work", "session": 7, "session_reset": "22:30", "weekly": 12, "weekly_reset": "Wed" },
      { "name": "Codex", "session": 10, "session_reset": "21:15", "weekly": 33, "weekly_reset": "Fri" },
      { "name": "Antigravity Gemini Pro", "session": 0, "session_reset": "", "weekly": 18, "weekly_reset": "Sun" },
      { "name": "Antigravity Gemini Flash", "session": 5, "session_reset": "19:10", "weekly": 9, "weekly_reset": "Sun" }
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

Antigravity group names in the sample are placeholders until milestone 5. Each extra installation or group adds a row, so milestone 1 checks that this many rows fit the Full layout.

New data appears at the plugin's next scheduled refresh.

## Repo layout

```
web/                     Vite + React + TS + shadcn/ui
server/
  bin/claude-statusline.mjs  forwarder; runs the previous statusLine command
  src/index.ts           Hono app and routes
  src/sources/{claude,codex,antigravity}.ts
  src/summary.ts         ProviderUsage[] → merge_variables, size check
  src/trmnl.ts           webhook POST, 422/429 handling
  src/scheduler.ts       10-minute loop, skip when unchanged
  src/claude-installs.ts install and remove the forwarder in each config dir
  data/config.json       gitignored; webhook URL
  data/claude-installs.json  gitignored; installations and previous commands
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
| `POST /api/sources/:id/test` | Read one source now (for a Claude installation, return its last forwarded reading) |
| `PUT /api/sources/:id` | Turn a source on or off |
| `POST /api/ingest/claude/:install` | Receives one installation's forwarded statusLine JSON |
| `GET /api/claude/installations` | Installations, each with its config dir and whether the forwarder is installed |
| `POST /api/claude/installations` | Add an installation (`label`, `configDir`) and install the forwarder in its `settings.json` |
| `DELETE /api/claude/installations/:install` | Restore the previous `statusLine` and remove the installation |
| `GET /api/trmnl` / `PUT /api/trmnl` | Webhook URL (masked on read) and push interval |
| `GET /api/trmnl/preview` | Exact payload and its byte size |
| `POST /api/trmnl/push` | Push now |

## Dashboard pages

- **Sources:** one card per source with status, last readings, an on/off switch and a Test button. When a source fails, show the CLI command that fixes it. Each Claude installation gets its own card with its label, config dir and a Remove button, and an Add installation form takes a label and a config dir. The Antigravity card lists one reading per model group.
- **TRMNL:** webhook URL, push interval, Push now.
- **Preview:** the payload JSON and its size.

## Milestones

1. Push the sample payload with `curl` and see it on the device.
2. Server with the TRMNL client, summary and scheduler, using fake sources.
3. Codex source. The field names above come from `codex app-server generate-json-schema` in codex-cli 0.172.0.
4. Claude installations: the forwarder with `--install <id>` and the previous command, the ingest route, installing and removing the forwarder in each config dir's `settings.json`, and the `claude -p /usage` fallback.
5. Antigravity source, one reading per model group, parsed from a local `agy -p /usage` run.
6. Dashboard pages.

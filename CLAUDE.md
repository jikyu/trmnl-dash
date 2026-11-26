# TRMNL Dash

TRMNL Dash shows Claude Code, OpenAI Codex, and Google Antigravity plan usage on a TRMNL Developer Edition device. A local Hono server collects usage from each official CLI, summarizes it, and pushes it to a TRMNL private plugin webhook. A Vite + React + TypeScript + shadcn/ui dashboard manages sources and the webhook. Node and TypeScript throughout, with npm.

The project is a proof of concept. [docs/proof-of-concept-plan.md](./docs/proof-of-concept-plan.md) is the source of truth for architecture, usage sources, the data model, the payload and markup, routes, dashboard pages, and milestones. Read the sections a task touches before changing code, and build milestones in order.

## Map

- `server/`: Hono app on `127.0.0.1:8787`. `src/sources/{claude,codex,antigravity}.ts` read usage, `src/summary.ts` builds `merge_variables` and checks size, `src/trmnl.ts` posts the webhook, `src/scheduler.ts` runs the push loop, `src/claude-installs.ts` installs the forwarder in each Claude Code config dir, and `bin/claude-statusline.mjs` forwards that installation's `statusLine` JSON to `POST /api/ingest/claude/:install` and runs the user's previous `statusLine` command.
- `web/`: the dashboard. Vite proxies `/api` to the server.

## Guardrails

- **Usage comes from the official CLIs only:** Claude Code's `statusLine` stdin with `claude -p /usage` as a fallback, `codex app-server` over stdio JSON-RPC, and `agy -p /usage`. Never read, store, or mint a provider token, and never call a provider's HTTP API, because each CLI owns its own sign-in.
- **The webhook URL is the one secret.** It lives in `server/data/config.json` (gitignored, mode 0600), is masked on read, and never appears in logs or responses. The server binds to `127.0.0.1` only.
- **Stay inside TRMNL's limits:** 5 KB of merge variables and 12 pushes per hour. Push only when the summary changed, and handle 422 (too large) and 429 (rate limited) without retry loops.
- **A failed read keeps the last good reading** and sets `ok: false`, so the device never blanks on one bad poll.
- **Resolve the plan's open questions from real output**, such as Codex's protocol schema or a local `agy` run, never from guessed field names.
- **UI uses shadcn/ui defaults** with no custom styling.

## How to work

- **Think before coding.** State your assumptions and tradeoffs. When the request allows materially different readings, present them instead of picking one silently. If a simpler approach exists or the request seems mistaken, say so in a sentence and continue as asked.
- **Decide the routine, ask on the consequential.** Make routine calls yourself and report them: naming, file placement, which pattern to follow, test shape, sequencing, how to fix a failing check. Ask, with a recommendation and its evidence, where being wrong is costly or taste decides: what to build or cut, what the dashboard or device shows, the data model, payload, or route contract, a new dependency, and anything hard to reverse. Finish the independent work first.
- **Simplest surgical change.** Write the minimum code for the demonstrated need: no speculative features, configurability, fallbacks, or abstractions for single-use code. Match the surrounding style, leave adjacent code alone, and report unrelated defects as follow-ups. Delete what your change makes obsolete.
- **Get buy-in before hardening.** Before adding complexity for a race, failure, or security edge case the request did not ask for, state the concrete failure mode, its likelihood, and its cost, and let the user decide.
- **Fix the root cause.** Trace a failure to its source and fix it there. Use a suppression only for a demonstrated false positive, keep it narrow, and say why it applies.
- **Define the finish line first.** Make it verifiable: a test of public behavior that fails then passes, the payload from `GET /api/trmnl/preview`, or the device showing the push. Run the smallest check that could falsify your claim, say what it proved and did not, and rerun a passing check only after a change.
- **Finish the whole task.** Do not end a turn with a summary that announces the next step, an offer to continue, or a question about work already requested. A text-only turn is a report, not proof: wait for background commands and subagents first. Stop only when nothing can advance without the user, or before an irreversible action such as a push or a delete.
- **Delegate rarely.** Use a subagent only for a sizeable independent investigation; do checks, lookups, and small reviews yourself. Keep tool output small: send long output to a scratch log and read failures from it, read files by range, and write shell commands without command substitution.
- **Land working slices.** Retained work lands with its docs; a spike's scaffolding does not merge.
- **Report plainly.** Say in a sentence what you are about to do before the first tool call. Close with the outcome, then the decisions and assumptions you made on the user's behalf.

## Verify

- There is no CI, so a check skipped locally is skipped for good. Run the checks each touched package defines on the exact head before every push and pull request.
- Stop dev servers by process ID or port, never by process name.

## Writing

Write plain, durable prose in docs, comments, and messages: active voice, short sentences, no mannered phrasing or invented labels, and every safety condition and scope qualifier kept. Use the plan's terms (provider, source, window, merge variables) verbatim. Anchor docs and comments to symbols or quoted code, not line numbers or issue history. Add a policy doc, decision entry, or report only when asked or needed to ship.

A commit subject or PR title is one imperative sentence naming the outcome: no type prefix or trailing period, about 72 characters. The body says what changed, why, and what the diff cannot show.

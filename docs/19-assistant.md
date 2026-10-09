# 19 · Admin assistant ("Ask the assistant")

Planner spec, 2026-09-29. An admin-only chat in the portal that can look at the state of the whole stack and explain what went wrong. It reads; it never acts.

## What it is, and is not

- It is the model API (Messages API with tool use) called from `web`, with a fixed set of **read-only tools** that wrap data the portal already holds or can fetch through `api`.
- It is **not** tooling. No shell, no file writes, no docker socket, no AMP actions. The "no raw console or shell through the app" rule in the working rules applies to it in full.
- It lives in `web` because `api` sits in the WireGuard namespace with no route to the internet. `web` calls `api` for data through `src/server/api-client.ts` as usual. No new service.

## Where

Admin → **Assistant** (new tab), plus an "Ask about this" button on Admin → Overview, Server, Events and Installs that opens the assistant with that page's context pre-loaded (e.g. "the install report from Rowan at 14:02").

## Tools (all read-only, all admin-gated, all logged)

| Tool | Returns | Source |
|---|---|---|
| `server_status` | state, players, TPS, memory, uptime, pack version, live flag, Play-first, pregen mode | api `/status` |
| `console_tail` | last N console lines (max 500), optional since/until, ping rounds filtered out | api console buffer |
| `events` | event log rows with the same filters the Events page has, max 500 | DB |
| `install_reports` | reports by player/outcome/date, with the full log of one report on request | DB |
| `sync_runs` | Lock/Build/Sync runs with their streamed logs | DB |
| `deploys` | image tags, commit SHAs, deploy times, CI status | DB + GHCR labels |
| `container_health` | name, state, health, restarts, memory, last 200 log lines per container (`deepslate-*` only) | a tiny read-only endpoint in `api` reading the docker socket **read-only** (`/var/run/docker.sock:ro`, GET only, container names whitelisted) |
| `tunnel_health` | wg handshake age, AMP reachability, api→AMP login state | api `/health` |
| `amp_backups` | backup list | api |
| `modpack` | mods.json, lockfile, diff between the two | repo copy in the image |
| `docs` | any file under `docs/`, the working rules, ROADMAP.md | copied into the web image at build |
| `players` | member list with roles, link state, last seen, hardware tier (no Discord IDs, no emails) | DB |

Every tool result passes the same redaction the install reports use, plus: no environment variables, no tokens, no `.env` contents, no player IPs. Tool outputs are capped (20 KB each) so a question can't pull the whole DB into a prompt.

## Behaviour

- System prompt: the project in one paragraph, the service layout from docs/02, the AMP quirks from docs/08, the current docs/11 status section, and the rule "you can only read; when the fix needs an action, name the button in the portal or the command for the VPS session, never claim to have done it."
- Answers cite what they looked at: a collapsible "Looked at: console (200 lines, 13:40–13:46), events (crash, since 13:00)" block under each reply.
- Streaming responses. Threads saved per admin (Prisma), with title, cost and token counts. Delete thread.
- Model from `.env` (`ASSISTANT_MODEL`, default `assistant-model`); key `ASSISTANT_API_KEY`; both documented in `.env.example`. Feature off when the key is missing, with a one-line note on the tab.
- Limits: 40 tool calls per question, 30 questions per admin per hour, a daily spend cap in `.env` (`ASSISTANT_DAILY_USD`, default 5) after which the tab says it is paused until midnight.
- Audit: each question, its tool calls and the spend go to the event log as `ASSISTANT_QUERY`, visible to admins.

## Not in scope (and why)

- Actions of any kind, even "restart the server". If wanted later, the only acceptable shape is: the assistant proposes an existing named operation, the admin clicks the existing button. Never a free-form command.
- Access for players. Admin only.
- Reading the AMP host's files or the VPS filesystem beyond the whitelisted containers' logs.

## Acceptance

- [ ] Admin asks "why did the server hang this morning?" and gets an answer citing the console lines around "Saving worlds" and the pregen events, with the Kill event named.
- [ ] Admin asks "what's wrong with kanefinch's install?" and gets the failed step from their last report and the log lines around it.
- [ ] A non-admin gets 403 on every assistant route.
- [ ] Tool outputs contain no tokens or env values (test with a fake secret planted in a container log).
- [ ] With no `ASSISTANT_API_KEY` the tab shows "Not set up" and nothing else breaks.
- [ ] Spend cap trips and resets.

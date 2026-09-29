# 16 · Analytics, file explorer, event log, branding

Planner spec, 2026-09-29. Extends Phase 3 (dashboard). Reference: AMP's own instance Analytics page (header tiles, 30-day sessions chart, countries panel, most active users) is the minimum bar for the analytics view; the portal should match it and then do better where it has data AMP doesn't (Discord identities, tiers, votes).

## 1. Where the data comes from

AMP's Analytics plugin is not exposed to `webapp` and its numbers aren't reachable through the API, so the portal keeps its own record. Everything below is derived from three sources the api already has:

| Source | What it yields |
|---|---|
| Console tail (`Core/GetUpdates`) | joins, leaves, deaths, chat, advancements, server start/stop, warnings and errors, command results |
| Status poll (`Core/GetStatus`, every 15 s) | state, player list, CPU, memory, TPS (from spark or `/tps` if available) |
| The portal itself | who each UUID is (Discord name, tier), votes, actions, admin operations |

New tables (Prisma):

```prisma
model Session {                 // one row per player session
  id        String   @id @default(cuid())
  mcUuid    String
  userId    String?             // linked portal user, if any
  joinedAt  DateTime
  leftAt    DateTime?           // null while online; closed on leave, server stop, or poller seeing them gone
  ip        String?             // from the join line; admin-only, pruned after 30 days
  country   String?             // resolved once from ip via a local GeoLite2/DB-IP database (no external calls per request)
  @@index([mcUuid, joinedAt])
}

model Event {                   // the event log
  id        BigInt   @id @default(autoincrement())
  at        DateTime @default(now())
  kind      EventKind           // JOIN LEAVE DEATH CHAT ADVANCEMENT SERVER_START SERVER_STOP CRASH WARN ERROR ADMIN_ACTION PLAYER_ACTION LINK REVOKE SYNC BACKUP
  actor     String?             // mcUuid or userId
  message   String              // human line
  raw       String?             // original console line, admin-only
  meta      Json?
  @@index([at]) @@index([kind, at]) @@index([actor, at])
}
```

`ServerSnapshot` stays as is (metrics every 15 s, pruned to 30 days, downsampled to 5-minute buckets after 48 h).

## 2. `/analytics` page

Range picker: Last 24 h / 7 days / 30 days / All time. Default 30 days. Everything below recomputes per range; percentages compare to the previous equal-length window (the arrows in AMP's tiles).

**Header tiles** (same eight as AMP, plus two): Total sessions, Unique players, New players (first session in range), Total play time, Bounce rate (sessions under 2 minutes), Avg session length, Sessions per player, Longest session, **Peak concurrent** (max players online at once, from snapshots), **Uptime %** (state Running over the range).

**Sessions chart**: area chart, one point per day (per hour for 24 h), sessions started. Below it, a second series for **players online** (max per bucket) toggleable. Same colour language as the dashboard.

**Countries**: table with flag, country, players, sessions, play time; a **Map view** toggle showing a world map with dots sized by play time. Use an inline SVG world map (no external tiles). Country comes from `Session.country`; if geo is disabled in settings, the panel shows "Location off".

**Most active players**: name with head, Discord display name, tier, play time, sessions, last seen, percent of total. Sort by any column. Click a row → `/players/<uuid>`.

**Player detail** `/players/<uuid>`: heads-up stats, play-time-by-day sparkline, session list, deaths, advancements, their event history, link state, tier. Admin sees IP history for 30 days.

**Extras AMP doesn't have**: busiest hour of day heatmap (7×24), deaths leaderboard, "who plays together" (pairs with the most overlapping session minutes).

Player-visible: everything except IPs and raw console lines. Admin-only: those two plus the export button (CSV of sessions and events for the range).

## 3. `/admin/files` file explorer

Read-only browser over the instance's `Minecraft/` tree, backed by `FileManager/GetDirectoryListing` and `GetFileChunk` through the api (the `webapp` user already has BrowseFiles and DownloadFiles, nothing else).

- Tree on the left, listing on the right: name, size, modified. Breadcrumbs, search-in-folder, sort.
- Preview pane for text-like files (`.properties`, `.toml`, `.json`, `.txt`, `.log`, `.cfg`, `.yml`) with syntax colouring and line numbers, capped at 2 MB, larger files show the head and a "Download" button.
- **Download** for single files ≤ 50 MB, streamed through the api. Never for `world/`, `world_*`, `*.dat`, `backups/`, `logs/latest.log` is fine, `session.lock` is not. Denied list in config.
- **No writes.** No upload, rename, delete, edit. Editing configs is done in the repo (`modpack/config/`) and shipped by Sync, which is the whole point of the manifest-is-truth rule. The page says so in a banner with a link to `/admin/modpack`.
- Special views: `whitelist.json`, `ops.json`, `banned-players.json` render as tables; `server.properties` as key/value with the values the manifest expects highlighted where they differ.
- Every download audited.

## 4. `/admin/events` event log

Full log of everything the api has seen or done, from the `Event` table.

- Filters: kind (multi-select), player, date range, free text. URL-addressable so a filter can be linked.
- Live tail toggle (SSE) for the last N minutes.
- Row: time, kind chip (coloured by severity: info / player / warning / error / admin), actor with head or Discord avatar, message. Expand for `raw` and `meta`.
- Kinds and their sources:
  - JOIN / LEAVE / DEATH / CHAT / ADVANCEMENT: console regexes (vanilla and NeoForge formats; keep the regexes in one file with tests against captured lines).
  - SERVER_START / SERVER_STOP / CRASH: state transitions from the poller plus "Done (" and "Stopping server" lines; a Running → Stopped without a stop line is CRASH.
  - WARN / ERROR: console lines at those levels, deduplicated within 60 s (same message = one row with a count).
  - ADMIN_ACTION / PLAYER_ACTION: from the actions registry (this replaces `AuditLog` writes; migrate `AuditLog` rows into `Event` and drop the table).
  - LINK / REVOKE: from docs/14.
  - SYNC / BACKUP: from the modpack sync and any backup job.
- Retention: CHAT 30 days, everything else 180 days, ADMIN_ACTION forever. Nightly prune.
- Export CSV for the current filter (admin).
- Players see a trimmed version at `/events`: JOIN, LEAVE, DEATH, ADVANCEMENT, SERVER_START/STOP only, no IPs, no raw.

Chat is stored because it feeds "most active" and the event log; say so on the server rules page.

## 5. Branding

One place to change how the portal looks, editable by admins without a deploy.

- `Branding` singleton row (or a `Setting` key/value table): server name, tagline, logo (upload → stored under `data/branding/`, served by the app), favicon, banner image for the login page, accent colour, dark/light default, Discord invite link, footer text, rules page markdown, MOTD text pushed to `server.properties` via the manifest on next sync.
- Admin page `/admin/branding` with live preview. Uploads restricted to PNG/SVG/WebP ≤ 2 MB, SVGs sanitised.
- The theme tokens the UI already uses take the accent from the branding row at request time (CSS variables set in the root layout), so no rebuild.
- Login page, nav header, `/install` page, the in-game `tellraw` link message (docs/14) and the installer's launcher profile name/icon all read from branding. The installer picks the name up at build time; a name change needs a rebuild and the page says so.
- Defaults ship in the seed so a fresh install has "Deepslate Works" and the current colours.

## 6. Settings page (small, needed by the above)

`/admin/settings`: geo lookup on/off, chat logging on/off, retention days per kind, download size cap, denied path list for the file explorer, analytics visible to players on/off. Stored in the same `Setting` table as branding.

## 7. Acceptance (adds to Phase 3)

- [ ] `/analytics` shows the ten tiles, the sessions chart, countries with map toggle, and most active players for 24 h / 7 d / 30 d / all, and matches AMP's own counts for the same period within ±1 session.
- [ ] `/players/<uuid>` works for a linked and an unlinked player.
- [ ] `/admin/files` browses the instance, previews `server.properties` as key/value, downloads a `.log`, and refuses `world/level.dat` with a clear message.
- [ ] `/admin/events` shows a join, a death, a chat line, a server restart and an admin action from a 10-minute test session, with live tail working; `/events` for a player hides IPs, raw lines and admin rows.
- [ ] Changing the accent colour and logo in `/admin/branding` is visible on the next page load without a deploy; the login page shows the new banner.
- [ ] Retention prune runs and is logged as an Event.

## 8. Installer telemetry (planner spec, 2026-09-29; appended by the VPS session at the planner's request)

1. At the end of every run (success or failure), `install.ps1` POSTs to `/api/installer/report`, authenticated with the same signed-in identity it already uses. Body: pack version, installer version, outcome (ok / failed / cancelled), the step that failed, duration; the full run log (the same text as `%TEMP%\deepslate-install.log`, ≤ 512 KB, truncated from the middle); system: Windows version and build, CPU name and core count, total RAM, GPU name(s) and driver version, free disk on the install drive, launcher version, Java found (which path, version), NeoForge present before/after. Redact before sending: any `C:\Users\<name>\` path becomes `C:\Users\~\`, no Windows username, no Microsoft account details, no launcher tokens, no IPs. Print one line before sending: "Sending the install log to deepslate.dsw.test so Alex can help if something went wrong." If the upload fails, say so and keep the local log; never block on it.
2. Stored as `InstallReport {id, userId, at, packVersion, installerVersion, outcome, failedStep, durationSec, system Json, log Text}`. Retention 90 days, nightly prune.
3. Admin → Installs page: table of reports (who, when, outcome, pack version, OS, RAM, GPU), filter by outcome, click to view the log with the failed step highlighted. On a player's page show their last install and their hardware summary; use the RAM/GPU to auto-suggest the PC tier and flag when the self-reported tier looks wrong.
4. `/me` shows the player their own last report and nothing else.
5. Event kind `INSTALL` added to the event log (one row per report, outcome in the message).
6. A heartbeat from the launcher profile: no. Out of scope; the report at install time is enough.

Acceptance: a failed run on a machine without the launcher produces a report with outcome=failed, failedStep="Checking the Minecraft Launcher", the OS/RAM/GPU fields filled, and no username anywhere in the stored log or system JSON.

**As built**, with the differences, is in docs/07 "Install reports" and "The PC tier is measured". Two differences from the text above: the tier is not only suggested but **set** from the report (Alex, 2026-09-29: "the 'your PC' should be decided by a script too"), so there is no "self-reported tier looks wrong" flag, the report records the tier before and the tier measured instead; and signing in became the installer's first step, so that the acceptance case can be reported at all.

## 9. Connection stats (planner spec, 2026-09-29; appended by the VPS session at the planner's request)

a. Add to mods.json, side server: tabtps. Config: tab list header "Deepslate Works · TPS {tps} · {online}/{max} online", footer "your ping {ping} ms", ping shown per player in the list.
b. api poller: every 15 s run `tabtps ping` (or spark ping if TabTPS lacks a bulk command) and parse per-player ping into `ServerSnapshot.pings` Json `{uuid: ms}`. Keep TPS/MSPT as now.
c. Home: ping next to each online player (green <80, amber <150, red above). `/players/<uuid>`: ping sparkline for the current session and average per session. Stats: average ping by player, and a "connection" tile: server TPS now, 24 h low, worst ping right now.
d. `/me`: "Your connection: <ping> ms, server TPS <tps>" while online, and your 7-day average.

Acceptance: with one player online, Tab shows TPS/ping/online count in game; Home shows the same ping within 30 s; the player page shows a ping series after 5 minutes online.

**As built**, with the differences, is in docs/05 "Connection". Three differences: the command is `pingall` (TabTPS has no `tabtps ping`; spark has no bulk command); the header and footer are made of TabTPS' own pieces, without words of ours; no ping number next to each player in the list.

**2026-09-29, later: TabTPS is out.** The server does not start with it next to BlueMap (docs/06). The pings come from spark, one player at a time; the Tab list is the game's own. Items b, c and d stand; item a does not.

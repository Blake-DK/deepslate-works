# 08 · API and server actions

Rewritten 2026-09-29 from the code. Two services answer HTTP: `web` (the site; the internet reaches it) and `api` (in the tunnel's network namespace; only `web` reaches it). Most pages are rendered on the server and read the database themselves, and what a button does is a server action in the page's `actions.ts`, so there are few routes. The first plan's routes (`/api/server/status`, `/api/me`, `/api/actions/<name>`, `/api/admin/vote`, `/api/admin/server/*`, `/api/admin/announce`, `/api/admin/audit`) were never built and are not needed.

## `web`: routes

| Method | Path | Who | Does |
|---|---|---|---|
| | `/api/auth/*` | anyone | Auth.js: sign-in, callback, session |
| GET | `/api/auth/verify` | anyone | 200 with a session, 401 without. Caddy's `forward_auth` asks it for the map host. No body |
| GET | `/api/health` | anyone | `{ok, db, api:{ok, tunnel, amp, rsync}, missingEnv, discord, guildGate}`. `ok` is the site's own health; the tunnel's state is reported, not required |
| POST | `/api/launcher/start` | anyone | the installer asks for a code to show (docs/07) |
| GET | `/api/launcher/poll` | the installer | has the code been approved; hands over the launcher token once |
| GET | `/api/modpack/manifest` | a launcher token, or a session, that may download; or `?key=` (`MANIFEST_KEY`, admins' own) | the mod list: pack version, Minecraft and NeoForge versions, files with addresses and checksums, `config_url`, `configs`, profile, memory, `installer: {version, sha256, size}`. 401 without sign-in; 403 `not_live` or `server_offline`. Written into the download log |
| GET | `/downloads/installer.zip`, `/downloads/config.zip` | as the mod list; `config.zip` also with the key | the file. Refusals as above, or for a browser a redirect to `/install`. Written into the download log |
| POST | `/api/installer/report` | a launcher token | one run of the installer (docs/07 "Install reports"): `mode` install or play, `outcome`, `failedStep`, `log`, `system` (with `java: {source, path, version, passedOver}`), `updatedFrom`, `updateProblem`. Answers `{ok, id, tier}`. 401 without a token, 403 `not_live` for a run of Play by somebody the site is not open for, 413 over 1.3 MB, 429 over 20 an hour |
| GET | `/api/events/stream` | members | the event log as it happens (`text/event-stream`), cut down for players |
| GET | `/branding/<file>` | anyone | logo, banner, tab icon |
| GET | `/news-image/<file>` | members | a news item's picture |
| GET | `/api/app/head/<uuid>.png` | members (the app's token, or a session) | a player's 24 px head (docs/21 §7). Fetched from Crafatar by `web` once a day per player and kept under `data/heads/`; only for members with a linked Minecraft account. Anyone else, and any failure, gets the grey placeholder (`branding/launcher/head-placeholder.png`); after a failed fetch that player is not asked for again for 10 minutes. `x-head-source`: `cache`, `fetched`, `stale` or `placeholder` |
| GET | `/api/admin/console` | admins | the server's console as it happens. Each event's `id` is the line's sequence number; a browser that reconnects sends `Last-Event-ID` and gets what it missed. Ends after 10 min, the browser reconnects |
| POST | `/api/admin/modpack/<cmd>` | admins | `lock`, `build`, `sync`, `sync-dry`; the log as it is written. `lock` runs in `web`; the others are handed to `api`. One at a time |
| GET | `/api/admin/events/export`, `/api/admin/analytics/export` | admins | CSV |
| GET | `/api/admin/files/download` | admins | one file from the server, through `api` |

Who may download is one rule (`src/shared/access.ts`, `src/server/modpack/gate.ts`): admins always; players while the site is live, or with early access, and while the server is up or asleep.

## `api`: routes

Every call carries `Authorization: Bearer <API_SERVICE_TOKEN>` and who is asking (`x-user-id`, `x-user-role`); `api` checks the role where a route changes something. `src/server/api-client.ts` in `web` is the only caller.

| Method | Path | Does |
|---|---|---|
| GET | `/health` | tunnel, AMP, rsync |
| GET | `/status` | the poller's last answer (at most 10 s old): `state`, `stateCode`, `availability` (`online`, `starting`, `sleeping`, `offline`), `players[]`, `online[{name, uuid, ping}]`, `maxPlayers`, `cpu`, `memMb`, `memMaxMb`, `tps`, `uptime`, `at`. Asks AMP itself when the poller's answer is older than 30 s |
| GET | `/players` | who is on, who is held in the entrance room and why |
| POST | `/link/release` | somebody has linked: let them in (called by `web` when `/link/<code>` is confirmed) |
| POST | `/player/revoke` | take somebody's way in away, and kick them if they are on |
| GET | `/actions` | the names of the actions an admin may run |
| POST | `/actions/<name>` | run one (below). 404 for a name that is not an admin's, 409 `server_offline` while the server is not running, 400 `validation` for input that does not pass |
| POST | `/server/start`, `/server/stop`, `/server/restart` | AMP's own. Before a stop or a restart a running pre-generation is paused and the save waited for |
| POST | `/server/kill` | ends the process. 409 `not_stopping` unless the server is in state 45 (Stopping) |
| GET, POST, DELETE | `/server/schedule`, `/server/restart-in {minutes 1..120}` | the planned restart, with warnings in the game every minute for the last five; one at a time, in memory |
| GET, POST | `/server/backup` | whether `webapp` may take and list backups, the list, and taking one |
| GET | `/console/tail?lines=`, `/console/stream?since=` | the last lines (`entries[{seq, at, text}]`, `state`); the console as it happens, as newline-delimited JSON with a heartbeat every 15 s |
| POST, GET | `/server/wake` | any member the server is open for (docs/13 §12): starts a server that is Asleep, once (202 `started`; 200 `already` while a wake runs, `awake` when up); 409 `off` / `crashed` / `busy`, 503 `unreachable`, 403 `not_open` / `not_member`. GET: `{server, wake: {phase idle|waking|ready|failed, startedAt, endedAt, leftS, by}}` |
| POST | `/console/send {command}` | admins only (docs/13 §11): one line to the Minecraft console, as typed, a leading `/` dropped, through the action `console.send`. 429 `rate_limited` above 5 a second for one admin; 409 `server_offline` unless running. In the event log as "Alex ran: <command>" |
| POST | `/players/:name/inventory {op: set\|clear\|give, slot?, item?, count?, components?}` | admins only (docs/13 §13): one vanilla command, the server's answer awaited (4 s), the player told, the event log written, the player read again. 409 `offline` (never the save file), 400 `validation` (slot, item not in the catalogue, components), 422 `refused` (the server's words), 504 `no_answer`, 429 above 5 a second |
| GET | `/players/:uuid/data?fresh=1` | admins only: the player's inventory, ender chest, health, food, XP level, position and dimension from `world/playerdata/<uuid>.dat` (NBT, read through AMP's file manager); with `live=1&name=` a player who is on is read as they are now (`data get entity`), `live: true`. `fresh=1` sends `save-all` first and waits up to 10 s for "Saved the game". 404 when the player has never been on |
| GET | `/status` (docs/13 §12) | besides AMP's figures: `server` (online, asleep, waking, starting, stopping, restarting, off, crashed, unreachable), `reason` (why AMP can't be reached), `sleepInMin`, `wake`. 200 also when AMP can't be reached |
| GET | `/pregen` | what chunky last said, the plan, `phase` (`generate`, `render`), `map` (BlueMap's figures for the map `world`: `status`, `percent`, `waiting`, `remaining`, `threads`, `stopped`), AMP's sleep mode and whether the portal may write it, how many are on |
| POST | `/pregen/on` | `{mode: "empty"|"now", what: "generate"|"render"|"both" (default "generate"), purge: boolean (delete the maps first; only with a `what` that renders), area: {x, z, radius}, window: {from, to}|null, capHours|null}`. 409 `sleep_permission` while AMP does not allow the portal to switch sleep off |
| POST | `/pregen/off`, `/pregen/cancel` | stop and keep where it got to; stop and forget the area |
| POST | `/modpack/build` | runs the build as a child process under `api`'s memory cap; answers newline-delimited JSON, `{"line"}` … `{"done","ok","code"}` |
| POST | `/modpack/sync` | `{dryRun?}`: rsync `dist/server/` to the instance; `Core.Restart` if the mods changed; writes the Setting `_packSynced`. One build or sync at a time (409 `busy`) |
| GET | `/files/list?dir=`, `/files/read?path=`, `/files/download?path=` | the server's files, read only; the world's data and anything outside the instance refused |

## Errors

JSON `{ error: { code, message } }`. Codes in use: `unauthorized`, `forbidden`, `validation`, `server_offline`, `not_live`, `not_stopping`, `sleep_permission`, `busy`, `amp_error`, `timeout`. The site turns each into one line a member understands.

## The action registry (`apps/api/src/actions/registry.ts`)

**Nothing sends a console command except through this file.** `apps/api/src/actions/run.ts` is the one function that sends, and the only file in `apps/api/src` with `SendConsoleMessage` in it.

```ts
type Action<I> = {
  name: string;                                 // "link.release"
  role: "system" | "ADMIN";                     // system: the portal by itself (a join, a timer); ADMIN: an admin, through POST /actions/<name>
  input: z.ZodType<I>;                          // checked; nothing a person typed reaches a command unchecked
  build: (ctx: ActionCtx, input: I) => string[]; // the commands, word for word
};
```

There is no role for players and no waiting for an answer: those come with Phase 4. The one limit on how often is on `console.send` (5 a second for each admin), which is kept out of `POST /actions/:name` (`OWN_ROUTE`) so it can only be sent through `/console/send`. An answer, where one matters, comes back through the console tail like any line (`apps/api/src/events/parse.ts` has every pattern) and is read by whoever asked: the door (`players/limbo.ts`), the pings (`status/ping.ts`), chunky and BlueMap (`status/pregen.ts`, `status/map.ts`), who is on (`status/online.ts`).

Every action that ran is an `Event` (who, what, with what input, the result), except the questions that change nothing and come round every few seconds (`limbo.keep`, `server.list`, `server.pings`, `player.where`, `map.status`, `map.list`, the reminders), and what the portal says to somebody at the door, which has a line of its own there.

| Group | Actions | Commands |
|---|---|---|
| The entrance room (docs/14) | `limbo.hold`, `limbo.holdPlay`, `limbo.holdClosed`; `limbo.remind`, `limbo.remindPlay`, `limbo.remindClosed`; `limbo.keep`; `limbo.kickIdle`, `limbo.kickIdlePlay`, `limbo.kickIdleClosed`; `link.release`, `limbo.releaseBack`; `limbo.build`, `limbo.clear`; `player.where` | `tag`, `gamemode`, `execute in <dimension> run tp`, `tellraw` with the link, `kick`, `whitelist add`, `fill`, `forceload`, `data get entity … Pos` and `… Dimension` |
| Members | `player.revoke` | `whitelist remove`, `kick` |
| The server | `server.say`; `server.restartWarning`, `server.restartCancelled`; `server.list`; `server.pings` | `say` (200 characters at most); `list`; `spark ping --player <name>` |
| The world | `world.seed`, `world.save`, `world.datapacks`, `world.locate`, `world.standable`, `world.blockIs` | `seed`, `save-all flush`, `datapack list`, `locate`, `execute in <dimension> if block …` |
| Pre-generation | `world.pregen`, `world.pregenContinue`, `world.pregenPause`, `world.pregenCancel`, `world.pregenProgress` | `chunky …` |
| The map | `map.status`, `map.list`, `map.update`, `map.purge`, `map.stop`, `map.start` | `bluemap`, `bluemap maps`, `bluemap update <map> [x z radius]`, `bluemap purge <map>`, `bluemap stop`, `bluemap start` |

A Minecraft name is `^[A-Za-z0-9_]{3,16}$` wherever one is taken; a dimension, a block and a map's name each have a pattern of their own; numbers are whole and bounded.

**What the portal sends by itself, and how often:** to a running server with somebody on it, one `spark ping` for each player every 15 s; `list` when AMP's list of players and the console's differ (looked at every 20 s, and after every restart of `api`); `limbo.keep` every 5 s while somebody is held; `bluemap` and `bluemap maps` every 30 s while the map render is on. Nothing is sent to a server that is asleep or starting.

## AMP methods used (recorded from the live instance, 2026-09-28 and 29)

All calls go to the ADS (`AMP_URL=http://10.77.0.2:8080`) at `/API/ADSModule/Servers/<AMP_INSTANCE_ID>/API/<Module>/<Method>`, JSON body, the session in an `Authorization: Bearer <sessionID>` header (until 2026-10-03 it was `SESSIONID` in the body, which AMP 2.8 logs as deprecated on every call; `Core.Login` has no session and keeps its body). `webapp` is a user **of the instance**, so `Core.Login` also goes through that path (a login against the ADS's own `/API/Core/Login` answers `result: 0, success: false`). The instance's modules (`Core.GetAPISpec`): `Core, MinecraftModule, FileManagerPlugin, LocalFileBackupPlugin, EmailSenderPlugin, WebhookPlugin, CommonCorePlugin, AnalyticsPlugin, StorePlugin`.

| Method | Args | What comes back, and what it is used for |
|---|---|---|
| `Core.Login` | `{username, password, token:"", rememberMe:false}` | `{"result":10,"success":true,"sessionID":"…","permissions":[…]}`; failure is `result: 0, success: false` |
| `Core.GetStatus` | `{}` | `State`, `Uptime`, `Metrics` (`CPU Usage`, `Memory Usage`, `Active Users`, `TPS`, each `{RawValue, MaxValue, Percent, Units}`), `Ports`. The poller, every 10 s; also the health check, which reuses the session |
| `Core.GetUpdates` | `{}` | the same status, and `ConsoleEntries` since this session last asked. The console tail |
| `Core.GetUserList` | `{}` | who AMP says is on |
| `Core.SendConsoleMessage` | `{message}` | only from `apps/api/src/actions/run.ts`. This is the call the planner's ruling of 2026-09-30 calls "SendConsoleInput": the admin console goes through it too |
| `Core.Start`, `Core.Stop`, `Core.Restart` | `{}` | in use since 2026-09-29 (Admin → Server, Sync, the planned restart). **`Core.Restart` does not start a server that is stopped or has failed**; that takes `Core.Start` |
| `Core.Kill` | `{}` | only while the server is stuck in Stopping, only by an admin |
| `Core.GetConfig` | `{node}` | `MinecraftModule.Limits.SleepMode`, `MinecraftModule.Limits.SleepDelayMinutes` (5 on this instance), `MinecraftModule.Minecraft.WorldSeed` |
| `Core.SetConfig` | `{node, value}` | **one node only, `MinecraftModule.Limits.SleepMode`**, and only by the pre-generation. Everything else is refused to `webapp`, as it should be |
| `Core.CurrentSessionHasPermission` | `{PermissionNode}` | before backups and before sleep mode is touched |
| `FileManagerPlugin.GetDirectoryListing`, `.GetFileChunk` | `{Dir}`; `{Filename, Position, Length}` | the file browser |
| `LocalFileBackupPlugin.GetBackups`, `.TakeBackup`, `.BackupWillStopServer` | | backups |

**States:** 0 Stopped, 10 Starting, 20 Running, 30 Sleeping, 40 Restarting, 45 Stopping, 50 preparing for sleep, 100 Failed (`apps/api/src/amp/client.ts`).

**What `webapp` may do** (a dozen of the instance's 318 permissions): manage the instance (`Instances.<id>.Manage`), `Core.AppManagement.StartApplication`, `.StopApplication`, `.RestartApplication`, send to and read the console, `FileManager.FileManager.BrowseFiles` and `.DownloadFiles`, `LocalFileBackup.Backup.CreateBackup` and `.ViewBackupsList`, `Settings.MinecraftModule.Limits.SleepMode`. The backup plugin is `LocalFileBackupPlugin` but its permissions are under `LocalFileBackup` (`…Plugin.Backup.TakeBackup`, as an earlier version of this file had it, does not exist). Not granted and not used: deleting or restoring backups, any other setting.

**Three things AMP does that the client has to know** (each cost an hour on 2026-09-29):

1. An error for a missing right comes back as HTTP 200 with `{"Title":"Unauthorized Access","Message":…}`.
2. After ADS has been restarted, an old session is answered with HTTP 200 and "This method requires the Session.Exists permission". The client signs in again and asks once more.
3. A session's permissions are fixed when it signs in, and every new session is handed the console's last forty lines again. So the client keeps one session, signs in again only when it must, and the console tail knows which lines it has read.

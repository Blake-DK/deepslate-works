# 08 · API and server actions

The app's own API is small; most pages are server components. These are the routes other things depend on.

## Public (session required unless noted)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/verify` | 200/401 for Caddy `forward_auth` (BlueMap). No body. |
| GET | `/api/modpack/manifest` | Lockfile + profile + server address + config list, JSON. **No session required** (the installer fetches it; the mod list isn't secret). Cache 60 s. Unauthenticated, so nothing personal in it. |
| GET | `/downloads/<file>` | `installer.zip`, `client.mrpack`. No session required, same reason. |
| GET | `/api/server/status` | cached snapshot: state, players, tps, mem, uptime, mapUrl |
| GET | `/api/server/history?hours=24` | player count series for the sparkline |
| POST | `/api/vote/<id>/ballot` | upsert own ballot `{modIds[], answers{}}` |
| GET | `/api/me` | own user, whitelist status, action cooldowns |
| POST | `/api/actions/<name>` | run a named action (below) |

## Admin (role ADMIN)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/vote` `/open` `/close` `/apply` | vote lifecycle |
| POST | `/api/admin/invites` | create |
| POST | `/api/admin/modpack/lock` `/build` `/sync` | stream logs over SSE. `lock` runs in `web`; `build` and `sync` are forwarded to `api` (`POST /modpack/build` runs the CLI as a memory-capped child process and answers with newline-delimited JSON, `{"line"}` … `{"done","ok","code"}`; `POST /modpack/sync`). One build or sync at a time (409 `busy`). |
| POST | `/api/admin/server/start` `/stop` `/restart` | with optional `{delayMinutes}` |
| POST | `/api/admin/announce` | store + `say` in game |
| GET | `/api/admin/audit?…` | audit log |

## What Phase 3 actually built (2026-09-29)

The pages render on the server and read the data directly, so most of the routes listed above never became HTTP routes in `web`. What exists:

| Where | Route | Does |
|---|---|---|
| web | `GET /api/admin/console` | live console as `text/event-stream`, admin only. Each event's `id` is the line's sequence number; a reconnecting browser sends `Last-Event-ID` and gets only what it missed. Ends after 10 min, the browser reconnects. |
| web | server actions in `app/(app)/admin/server/actions.ts` | start / stop / restart, restart with a warning, call it off, backup, announce (+ `say`), pin / unpin / delete an announcement |
| api | `GET /status` | the poller's last answer (at most 10 s old): `state`, `stateCode`, `availability` (`online` \| `starting` \| `sleeping` \| `offline`), `players[]`, `online[{name, uuid}]`, `maxPlayers`, `cpu`, `memMb`, `memMaxMb`, `tps`, `uptime`, `at`. Falls back to asking AMP when the poller's answer is older than 30 s. |
| api | `GET /server/schedule`, `POST /server/restart-in {minutes 1..120}`, `DELETE /server/schedule` | the planned restart (one at a time, in memory) |
| api | `GET /server/backup`, `POST /server/backup` | whether `webapp` may take and list backups (`Core.CurrentSessionHasPermission` for `LocalFileBackup.Backup.CreateBackup` and `LocalFileBackup.Backup.ViewBackupsList`), the list (`LocalFileBackupPlugin.GetBackups`), and `LocalFileBackupPlugin.TakeBackup` |
| api | `GET /console/tail?lines=`, `GET /console/stream?since=` | last lines (now with `entries[{seq, text}]`), and the live stream as newline-delimited JSON with a heartbeat every 15 s |

Installer (docs/07): `POST /api/installer/report` in `web`, launcher token required, body as in docs/07 "Install reports" (`mode` is `install` or `play`, `install` when left out), answers `{ok, id, tier}`; 401 without a token, 413 over 1.3 MB, 429 over 20 an hour.

docs/16 added, in `api` (admin only, GET only): `/files/list?dir=`, `/files/read?path=`, `/files/download?path=`; in `web`: `/api/events/stream` (live tail of the event log, trimmed for players), `/api/admin/events/export` and `/api/admin/analytics/export` (CSV), `/api/admin/files/download`, `/branding/<file>` (public: logo, banner, tab icon).

`api` polls `Core.GetStatus` + `Core.GetUserList` every 10 s (`apps/api/src/status/poller.ts`) and writes `ServerSnapshot`: on every change of state or player list, otherwise every 15 s while running and every 5 min while not. Rows older than 48 h are thinned to one per five minutes, rows older than 30 days are deleted (hourly). TPS, memory and the player limit come from AMP's own metrics (`TPS`, `Memory Usage`, `Active Users`); no console command is sent to measure anything.

## Server actions registry (`apps/api/src/actions/registry.ts`)

The registry lives in `api`, the only service with a route to AMP. `web` mirrors `POST /api/actions/<name>` for the browser and forwards to `api` with the service token and the user headers; `api` applies the role, rate limit and validation itself.

Every action is an object; nothing runs a console command outside this registry.

```ts
type Action = {
  name: string;                       // "whitelist.addSelf"
  role: "PLAYER" | "ADMIN";
  rateLimit: { perUser: number; windowSec: number };
  requires?: ("mcUsername" | "serverRunning")[];
  input: z.ZodType;                   // validated; player-supplied strings are never interpolated raw
  build: (ctx, input) => string;      // returns the exact console command
  expect?: RegExp;                    // console line that means success; timeout 5 s otherwise
  audit: true;
};
```

Initial set:

| name | role | command | notes |
|---|---|---|---|
| `whitelist.addSelf` | PLAYER | `whitelist add <mcUsername>` | idempotent; 5/hour |
| `player.spawn` | PLAYER | `tp <mcUsername> <spawn coords from server.properties>` or FTB Essentials `/spawn` run as the player via `execute as` | only when online; 6/hour |
| `player.home` | PLAYER | FTB Essentials `home` for the player | 12/hour |
| `player.setHome` | PLAYER | FTB Essentials `sethome` | 6/hour |
| `player.whereAmI` | PLAYER | `data get entity <mcUsername> Pos` + `Dimension` | parse the console reply |
| `player.kill` | PLAYER | `kill <mcUsername>` | in-page confirmation; 3/hour |
| `server.say` | ADMIN | `say <text>` | text ≤ 200 chars |
| `server.restart` | ADMIN | AMP `Core.Restart`, not console | with countdown `say` |
| `server.whitelistRemove` | ADMIN | `whitelist remove <name>` | |

`mcUsername` is validated as `^[A-Za-z0-9_]{3,16}$` at save time and again in `build`. Console output is read via `Core.GetUpdates` and matched against `expect`; the raw lines never reach the browser except in the admin console tail.

## AMP methods used (recorded from the live instance, 2026-09-28)

All calls go to the ADS (`AMP_URL=http://10.77.0.2:8080`) at `/API/ADSModule/Servers/<AMP_INSTANCE_ID>/API/<Module>/<Method>`, JSON body, `SESSIONID` in the body. `webapp` is an **instance-local** user, so `Core.Login` also goes through that proxy path (a login against the ADS's own `/API/Core/Login` answers `result: 0, success: false`). The AMP instance's API listing (`Core.GetAPISpec`) shows modules `Core, MinecraftModule, FileManagerPlugin, LocalFileBackupPlugin, EmailSenderPlugin, WebhookPlugin, CommonCorePlugin, AnalyticsPlugin, StorePlugin`.

| Method | Args | Sample response (trimmed) |
|---|---|---|
| `Core.Login` | `{username, password, token:"", rememberMe:false}` | `{"result":10,"success":true,"sessionID":"…","permissions":["Instances.<id>.Manage", "-Settings.Core.Security.…", …]}`; failure is `result: 0, success: false` |
| `Core.GetStatus` | `{}` | `{"State":0,"Uptime":"0:00:00:00","Metrics":{"CPU Usage":{"RawValue":0,"MaxValue":100,"Percent":0,"Units":"%"},"Memory Usage":{"RawValue":0,"MaxValue":6144,"Units":"MB"},"Active Users":{"RawValue":0,"MaxValue":20}},"Ports":[{"Port":25569,"Name":"Game Port","Listening":false},{"Port":2226,"Name":"SFTP Port","Listening":true}]}`. `State`: 0 Stopped, 10 Starting, 20 Ready (running), 40 Restarting, 45 Stopping, 100 Failed (mapping in `apps/api/src/amp/client.ts`). |
| `Core.GetUpdates` | `{}` | `{"Status":{…same as GetStatus…},"ConsoleEntries":[…],"Messages":[],"Tasks":[],"Ports":[…]}` |
| `Core.GetUserList` | `{}` | `{}` while stopped; map of online players |
| `Core.SendConsoleMessage` | `{message}` | used only by `apps/api/src/actions/` (Phase 4) |
| `Core.Start` / `Stop` / `Restart` | `{}` | not yet exercised (the permission-classifier refused the probe; Alex to confirm from the admin page in Phase 3) |
| `Core.SetConfig` | `{node, value}` | Refused for `webapp`: "does not have permission to modify setting" (verified by Alex from the AMP host side, 2026-09-28). With a nonexistent node the answer is `{"Status":false,"Reason":"No such node …"}`. |
| `FileManagerPlugin.GetDirectoryListing` | `{Dir:""}` | `[{"Filename":"mods","IsDirectory":true,…},…]` for the instance root (`AMP_Logs/ LocalBackups/ config/ defaultconfigs/ libraries/ logs/ mods/ plugins/ world/ …`) |
| `LocalFileBackupPlugin.GetBackups` | `{}` | `{"Title":"Unauthorized Access","Message":"You do not have permission…"}` (webapp has no backup rights; use AMP's UI for backups, or grant `TakeBackup` later) |
| `Core.GetAMPRolePermissions` | | `Unauthorized Access` (correct) |

Errors from AMP for missing rights come back as HTTP 200 with `{"Title":"Unauthorized Access","Message":…}`; the wrapper treats `Title` present as an error.

Added 2026-09-29 (checked against `Core.GetAPISpec` on the live instance): `Core.CurrentSessionHasPermission(PermissionNode)`, `LocalFileBackupPlugin.TakeBackup(Title, Description, Sticky, Local, S3, WasCreatedAutomatically, DirtyOnly, BackupWhileRunning)`, `LocalFileBackupPlugin.BackupWillStopServer()`. For docs/16: `FileManagerPlugin.GetDirectoryListing(Dir)`, `FileManagerPlugin.GetFileChunk(Filename, Position, Length)`, `FileManagerPlugin.ReadFileChunk(Filename, Offset, ChunkSize)`. `webapp` today: `FileManager.FileManager.BrowseFiles` yes, `FileManager.FileManager.DownloadFiles` yes, `Core.AppManagement.RestartApplication` yes, backups **no**. **The permission names**, from `Core.GetPermissionsSpec`: the plugin is `LocalFileBackupPlugin` but its permissions are under `LocalFileBackup`: `LocalFileBackup.Backup.CreateBackup`, `.ViewBackupsList`, `.DeleteBackup`, `.RestoreBackup`, `.ToggleStickiness`, `.ArchiveBackup`, `.TransferBackup`. (An earlier version of this file and of docs/11 named `LocalFileBackupPlugin.Backup.TakeBackup`, which does not exist.) `GetBackups` and `BackupWillStopServer` both need `ViewBackupsList`. `GetStatus.Metrics` keys: `CPU Usage`, `Memory Usage`, `Active Users`, `TPS` (each `{RawValue, MaxValue, Percent, Units}`). States seen: 20 Running, 30 Sleeping, 50 PreparingForSleep, 0 Stopped.

## Errors

JSON `{ error: { code, message } }`. Codes: `unauthorized`, `forbidden`, `rate_limited` (with `retryAfterSec`), `server_offline`, `not_online` (player not in game), `timeout`, `validation`, `amp_error`. The UI maps each to a one-line message a player understands.

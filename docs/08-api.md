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
| POST | `/api/admin/modpack/lock` `/build` `/sync` | run the CLI as a child process, stream logs over SSE |
| POST | `/api/admin/server/start` `/stop` `/restart` | with optional `{delayMinutes}` |
| POST | `/api/admin/announce` | store + `say` in game |
| GET | `/api/admin/audit?…` | audit log |

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

## Errors

JSON `{ error: { code, message } }`. Codes: `unauthorized`, `forbidden`, `rate_limited` (with `retryAfterSec`), `server_offline`, `not_online` (player not in game), `timeout`, `validation`, `amp_error`. The UI maps each to a one-line message a player understands.

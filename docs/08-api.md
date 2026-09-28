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

## AMP methods used

All calls go to the ADS (`AMP_URL=http://10.77.0.2:8080`) and address the instance via `/API/ADSModule/Servers/<AMP_INSTANCE_ID>/API/<Module>/<Method>` (docs/13 §4).

Fill this in from the live instance's `/API` listing during Phase 3. Expected: `Core.Login`, `Core.GetStatus`, `Core.GetUpdates`, `Core.SendConsoleMessage`, `Core.Start`, `Core.Stop`, `Core.Restart`, `Core.GetUserList` or `MinecraftModule.GetPlayers`-style list, `FileManagerPlugin.*` for reading `stats/<uuid>.json` and `whitelist.json`, `LocalFileBackupPlugin.TakeBackup` if present. Record the exact names, argument shapes and one sample response each.

## Errors

JSON `{ error: { code, message } }`. Codes: `unauthorized`, `forbidden`, `rate_limited` (with `retryAfterSec`), `server_offline`, `not_online` (player not in game), `timeout`, `validation`, `amp_error`. The UI maps each to a one-line message a player understands.

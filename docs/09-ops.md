# 09 · Deployment, security, operations

## Where it runs

Since 2026-10-23 everything runs at home on docker-01v as one Docker Compose stack, `deepslate`, managed in Dockhand;
the VPS is no longer used (2026-10-28). **deploy/home/README.md is the deploy and layout doc**; this section is the
short form.

```
/nvme/stacks/deepslate/         DEEPSLATE_DIR: the git checkout (uid 1000), following origin/main; modpack/, .git,
                                deploy/keys/deploy.key (git-ignored, mounted read-only into api)
/nvme/appdata/deepslate/        DEEPSLATE_DATA: postgres/, backups/ (the nightly and pre-deploy dumps), dist/, data/
                                (uploaded pictures, builds, private jars), geoip/, caddy/
Dockhand's data folder          the live compose file and .env of the stack (the only copy of the secrets)
```

`deploy/home/docker-compose.yml` (the reference; no `build:` sections) services: the one-shot steps `init`,
`repo-sync`, `installer`, `db-prep`, `migrate`; then `newt`, `caddy`, `postgres`, `web`, `api`, `map-relay`,
`backups`; with profiles `geoip`, `test` (docs/42) and `designer` (docs/39). No container publishes a port: the site is
published through Pangolin by the stack's own newt (docs/62). AMP stays on the AMP host, which api reaches over the LAN.

Until 2026-10-23 the stack ran on a VPS from `deploy/docker-compose.yml`, deployed by `deploy/deploy.sh`, and reached
the homelab through a WireGuard tunnel. Its files were removed on 2026-10-28; git history keeps them.

## Deploying (the only way)

**The host never builds images.** On 2026-09-29 a `docker compose up --build` on the VPS used all its memory and the
kernel killed live services (see docs/11 "OOM incident"). Images are built by GitHub Actions and pulled.

```
push to main ──► .github/workflows/ci.yml
                   check:  lint, typecheck, test
                   images: build apps/web + apps/api (docker/build-push-action, cache type=gha)
                           push ghcr.io/blake-dk/deepslate-web:{sha,latest}
                                ghcr.io/blake-dk/deepslate-api:{sha,latest}
in Dockhand ──► Images → Pull: deepslate-web, deepslate-api, deepslate-installer (private, Dockhand's GitHub login)
            ──► stack deepslate → Redeploy
                   every image pulled  →  init  →  repo-sync (checkout to origin/main)  →  installer (exe into dist/ci)
                   →  db-prep (a dump to backups/pre-deploy-*.sql.gz)  →  migrate (prisma migrate deploy)
                   →  postgres, caddy, web, api and the rest start
```

A Redeploy with "pull" does not log in for the three private images and quietly keeps the old ones: pull them first.
What each step does when it cannot, roll back (`IMAGE_TAG=<commit sha>` in Dockhand's `.env`) and the test pair's
`TEST_IMAGE_TAG` are in deploy/home/README.md. Do not redeploy while Admin → Modpack shows a build or sync running.

**Before a push: `deploy/check.sh`** (typecheck, lint, tests; `deploy/check.sh api test` for one package and one step).
The host has no Node: it runs them in a throwaway `node:22-alpine` container capped at 1.5 GB, as the checkout's owner,
and will not start with under 1.2 GB available or while another check runs.

**git on the host runs as the checkout's owner** (uid 1000), never as root: a `git status` or fetch as root leaves
files in `.git` that `repo-sync` and `web` (Admin → Lock commits there) cannot write.

**Before a migration**: `db-prep` takes a dump on every redeploy (`backups/pre-deploy-*.sql.gz`, newest 10 kept). A
migration has no way back but that dump.

- Never run `docker compose up --build`, `docker compose build` or `docker build` on the host, and every `docker run`
  carries `--memory`.
- If CI is down and a change cannot wait: build on another machine, push the image to GHCR under its own tag and set
  `IMAGE_TAG` to match. A build on the host is the last resort and Alex's call.

### Since PR B (docs/31, 2026-10-04)

Made for `deploy.sh` on the VPS; where each stands in the home stack:

- **Which images** (B-08): on the VPS `deploy.sh` ran the checkout's commit's images. At home a redeploy runs
  `IMAGE_TAG` (normally `latest`, main's newest); both containers report their commit in `PORTAL_COMMIT`, and the test
  site's footer says when images and checkout differ. Roll back with `IMAGE_TAG=<sha>` in Dockhand's `.env`.
- **api must be healthy and must reach the AMP host** (B-09). api has a healthcheck; web's `/api/health` shows
  `"api":{"ok":true` when it does.
- **A dump before a new migration** (B-19): `db-prep` dumps on every redeploy, before `migrate`.
- **git on the host runs without hooks, fsmonitor or an ssh command from `.git/config`** (B-17, short form): `web` can
  write that `.git`. `repo-sync` checks `.git/config` and `.git/hooks` against the copies in `GIT_GUARD_DIR` before it
  moves the checkout (deploy/home/README.md).
- **web gets only the variables it reads** (B-18), listed under `environment:` in the compose file. A new variable for
  web is added there, in `apps/web/src/env.ts` and in `deploy/home/.env.example`.
- **Logs are capped** at 5 files of 10 MB per container (B-21).
- **The nightly dump** (B-20) is `deploy/backup-loop.sh`, inside the `deepslate-backups` image: 00:00 UTC, the newest
  14 kept, a failed dump tried again after ten minutes. api copies the newest dump into `_backup/db/` in the instance
  over the pack's rsync link, where AMP's 01:00 UTC backup picks it up (docs/28 §4.7; B-07). Admin → Files refuses
  that folder.
- **The AMP host's ssh key is pinned** once `deploy/keys/known_hosts` exists (B-23). Until then api trusts the key
  afresh at each start.
- **Nothing runs as root but `init`** (with CHOWN, FOWNER, DAC_OVERRIDE and no network). The map relay runs as `nobody`
  (65534), `backups` and the database as postgres (70:70), web, api and api-test as uid 1000, the designer as its own
  user. api and api-test have `init: true`: node as PID 1 did not reap the `ssh` children it starts.

### The health watch (docs/32 §7 item 3, 2026-10-04)

api looks every ten minutes at the things that fail without anybody being told, and at once when a wake fails:

| Check | Wrong when |
|---|---|
| Database dump | none, under 10 kB, or older than 26 hours |
| Dump on the AMP host | the newest dump is over an hour old and api has not copied it |
| World backup | AMP lists none, the newest is older than 30 hours, under 1 GB, or a third smaller than the one before |
| Pack | the pack the site hands out is not the pack last synced to the server |
| Last wake | a player pressed Play and the server did not come up |

When a check goes from well to wrong, an ERROR event "Health: …" is written; the Discord feed posts it to the admin channel (not counted against the ten problems an hour the game's own errors share). When it is well again, a WARN event says so in Activity. What cannot be looked at (AMP out of reach) is "unknown" and never alerts by itself. Control Room shows "Needs a look" while anything is wrong.

For a monitor outside (Uptime Kuma): `GET https://deepslate.dsw.test/api/health`, down unless it answers 200 (web and its database; 503 otherwise) and the body contains `"api":{"ok":true}`. `"watch"` and `"pack"` are in the body too, but a monitor does not go down on them: they are things to look at, not an outage, and the health watch already posts them to the admin channel (Alex, 2026-10-31, after a backup-size warning turned the status page red). The detail (`checks`) is in the same answer for an admin session.

**Is the game answering** (Alex, 2026-11-01: AMP can say Running while nobody can join). While AMP says Running, api sends the game a server-list status request every 30 s at `SERVER_ADDRESS`, the way a player's game does: through the home router's port forward and mc-router (`apps/api/src/status/game-ping.ts`, 5 s timeout). After three misses in a row the server is "Not answering" (`unresponsive` in `shared/server-state.ts`) on the site, the app and the bot's Discord status, Play and downloads close as for Crashed, and an ERROR event "AMP says the server is running, but the game is not answering (…)" goes to the admin channel; the first answer after that writes the WARN "The game is answering again". The status answer comes from the game's network thread, so a main thread that hangs while the network still answers is not caught; a dead process, a crash AMP has not noticed, mc-router and the port forward are. From docker-01v the game is reached only by the public address (the AMP host's LAN address does not take 25565 from it, checked 2026-11-01); if hairpin NAT stops working, this reads "Not answering" although players outside can join.

Not looked at: S3, and the age of the NAS copy. Those need the AMP host's `status.json` (docs/28 §3 F).

## Dockhand

The stack `deepslate` lives in Dockhand on docker-01v, which runs it from its own copy of the compose file and `.env`
(edited there; `deploy/home/` holds the reference). A change to `deploy/home/docker-compose.yml` reaches the live stack
only when it is pasted into Dockhand. Dockhand pulls with its own `ghcr.io` credentials (its GitHub registry). The
VPS-era mirror (`deploy/dockhand-sync.py`) is no longer used.

## Memory limits

| Service | `mem_limit` | Notes |
|---|---|---|
| `web` | 768m | Next.js server; no longer runs builds |
| `api` | 512m | includes `modpack build`, a child process with a 256 MB heap that is first in line if the container runs out |
| `postgres` | 512m | the PostgreSQL upgrade and the reindex after it run in there too |
| `newt` 500m, `caddy` 64m, `map-relay` 32m, `backups` 64m, the one-shot steps 32m to 512m | | |

The full list is in `deploy/home/docker-compose.yml`; every service has one.

`modpack build` (jar downloads, the settings zip, the installer zip) runs inside `api`: Admin → Modpack → Build calls `POST /modpack/build` and streams the output line by line. Jars are streamed to disk and hashed in chunks, never held in memory. Measured 2026-09-29 with 11 jars, 17.8 MB: peak 75 MB. (The pack is 25 jars for the server since; not measured again, and no build has come near the limit.) `dist/` belongs to uid 1000 (api writes, web reads; the `init` step sets the owner). Do not run the CLI's `build` in a one-off container on the host.

## Caddy

The stack's own Caddy (`deploy/home/Caddyfile`, inside the `deepslate-caddy` image) serves plain http on :80 behind the
newt; Pangolin terminates TLS. Three host names from `.env`: `SITE_HOST` (`deepslate.dsw.test`, to `deepslate-web:3000`),
`MAP_HOST` (`map.deepslate.dsw.test`: `deepslate-web:3000` at `/api/auth/verify` first, then
`deepslate-map-relay:8100`; a 401 goes to the portal's login with `next`) and `TEST_HOST` (the test site, admins only).

The map host also sends `Content-Security-Policy: frame-ancestors https://deepslate.dsw.test` (added 2026-09-29), so
only the portal can show the map inside a page. A change to the Caddyfile arrives with the next image. BlueMap has been
in the pack since Phase 3; the map host answers 502 only while the game server is asleep or stopped, because BlueMap
runs inside it.

## `.env.example`

See `deploy/home/.env.example` (kept current; every variable commented; the live `.env` is Dockhand's). Notables: `API_URL`/`API_SERVICE_TOKEN` (web → api), `AMP_HOST` (the AMP host's LAN address), `AMP_URL=http://<AMP host>:8080`, `AMP_INSTANCE_ID`, `RSYNC_TARGET=amp@<AMP host>:`, `ROUTER_DASH_URL`, `NEWT_ID`/`NEWT_SECRET` (the site's newt, from Pangolin), `SITE_HOST`/`MAP_HOST`/`TEST_HOST`, `COOKIE_DOMAIN=.deepslate.dsw.test`, `MAP_URL=https://map.deepslate.dsw.test`, `DISCORD_GUILD_ID` and `DISCORD_GUILD_AUTO_JOIN` (the Discord server as the invite), `DEEPSLATE_DIR` (the checkout) and `DEEPSLATE_DATA` (the data), both absolute, `GHCR_OWNER`, `IMAGE_TAG`, `SERVER_ADDRESS`, `MANIFEST_KEY` (the mod list without a sign-in, for admins' own tools), `MODRINTH_USER_AGENT`, `LIMBO_POS` (the entrance room: `deepslate:limbo 0.5 65 0.5`) and `SPAWN_POS` (where somebody is let in who has never been in the world: `0.5 105 0.5`). Read by `api` and not in the example: `DISCORD_BOT_TOKEN` (optional, docs/04), `GEOIP_DB`. No `AMP_INSTANCE_DIR`.

## Security checklist

- No published ports: the site is reached only through Pangolin and the stack's newt. The host's `deepslate-firewall` gates the four networks by bridge name (`ds-edge`, `ds-web`, `ds-amp`, `ds-internal`; deploy/home/docker-compose.yml). Game and voice ports are the homelab's business (mc-router, docs/17). The AMP host admits this host alone on its API and map ports.
- Keys in `deploy/keys/` are git-ignored.
- AMP `webapp` user: a user of the one instance, with a dozen permissions (docs/08 "What `webapp` may do"): no deleting, no restoring, no setting but sleep mode. Rotate the password if it ever leaks into a log.
- Players never see raw console lines; admins do.
- Everything that ends up in a console command is checked against a strict pattern or a list, in one file (`apps/api/src/actions/registry.ts`). There is no path from free text to a command, for players or for admins, except `server.say`, which says it in chat.
- CSRF: Auth.js handles its routes; app POSTs use same-site cookies + origin check in middleware.
- Dependencies pinned by the lockfile. CI runs lint, typecheck and tests; it does not run `pnpm audit`.
- Backups: Postgres `pg_dump` nightly to `DEEPSLATE_DATA/backups` by the `backups` container, as `deepslate-YYYY-MM-DD.sql.gz`, the newest 14 kept (the `pre-*` migration dumps are not counted and not removed). Until 2026-10-03 a `%%F` in the compose file wrote one file, `deepslate-%F.sql.gz`, every night over the last. The world: AMP's backup tool, by hand from Admin → Server ("Back up"; it counts once AMP lists it, up to 45 minutes, and the card says "Kept" or "Not kept" with the reason) or in AMP; AMP silently drops a backup bigger than its backup size limit; whether AMP takes one every night is set in AMP and not known here. Restoring either is in "Runbook" below.

## Observability

- App logs to stdout (JSON in prod), `docker compose logs web`.
- `/api/health` returns 200 with db + AMP reachability. Uptime Kuma on the homelab watches the game servers (docs/17); whether it watches this is for Alex to say.
- Every AMP call logged with duration; slow (>2 s) calls warned.
- `ServerSnapshot` doubles as a poor man's metrics store: thinned after 48 hours, kept 30 days.
- The event log (Admin → Events) has what the portal did and what the server said; the server's console is on Admin → Server.

## Runbook

- **Authentik is down, or the owner cannot get through it** (docs/04): the owner signs in at `/login/admin` (the small
  "Admin sign-in" link under the button) with username, password and a code from the authenticator app. That is the one
  break-glass login: since 2026-10-20 only the owner (`ADMIN_DISCORD_ID`) can have it (Me → Sign-in). A session from it
  lasts 12 hours and shows on every admin's pages. Players who are signed in stay signed in (sessions are the site's,
  30 days); nobody new gets in until Authentik is back.
- **A sign-in says "belongs to a different account"** (`account-mismatch`, docs/04): one Authentik sign-in named two
  accounts, or a linked account's Discord ID changed. The event log has which (`auth.login`, DENIED). Nothing was
  changed; sort it out on People (remove the stray account) or in Authentik (the user's Discord connection).
- **A member without a Discord ID** (the old email sign-in's) before their first sign-in through Authentik: Admin →
  People → their menu → Set Discord ID…. Without Discord at all: an invite link, a new account, then their old one is
  removed.
- **No admin can sign in** (Authentik and password sign-in both lost, or never set up). On docker-01v:
  `docker exec -it deepslate-api pnpm admin:reset-auth <username>`
  `<username>` is the admin's password sign-in username, or their display name if they never set one up. It switches that admin's authenticator off (password sign-in stays off until it is set up again; the password is not touched) and prints a link, `https://…/login/once/<token>`, that works **once, within 15 minutes**. Open it, press Sign in (a session of 12 hours), and `/me/sign-in` asks for everything again: username, password, authenticator, new recovery codes. Both the reset and the use of the link are in the event log ("One-time sign-in link made from the command line for …"), and the sign-in shows on every admin's pages for 24 hours. Only the token's SHA-256 is stored (`OneTimeLogin`). An admin who still gets in can do the same for another admin more simply: Admin → People → row menu → Turn password sign-in off, then they set it up again.

- **Server won't start after a mod change** → the console on Admin → Server, or `logs/latest.log` in Admin → Files, names the mod. Switch it off in `mods.json` (Admin → Modpack), Lock, Build, Sync, and **Start**: a sync's restart does not start a server that has failed. There is no rollback command; git has every state of `mods.json` and the lock. (2026-09-29, TabTPS: twelve minutes from the failed start to a running server.) **Start the server once with any new server-side mod before building on it.**
- **What Sync does to the server** (2026-10-20): running → restarted when the mods changed; asleep → woken when they changed (the test server always); stopped → started on the test server, never on live (stopped on purpose: start it in Admin → Server); starting, failed or unknown → left alone. docs/06 "Sync and the server".
- **A player can't connect ("mod mismatch")** → Admin → Installs has their last run and the pack it installed; the pack the server runs is on Admin → Modpack. They press Play on the site, which brings their PC up to date.
- **A player's install fails** → Admin → Installs, the run, its log. Every failure so far was in there in full.
- **Restore the database** → `gunzip -c <dump>.sql.gz | docker exec -i deepslate-db psql -U deepslate -d deepslate` into an emptied database, with `web` and `api` stopped. Not rehearsed.
- Restore world from backup → AMP UI, backups tab, or documented CLI.
- **Rotate `AUTH_SECRET`** → a new value in the stack's `.env` in Dockhand (`openssl rand -base64 32`), then Redeploy; everyone signs in again. Rotating it no longer resets the admins' authenticators once `TOTP_SEAL_KEY` is set in `.env` and every admin has signed in once by password with a code since (that reseals their authenticator with the new key; `apps/web/src/server/auth/seal.ts`). Recovery codes are still made from `AUTH_SECRET`: after a rotation each admin makes new ones on Me → Sign-in. Never change or lose `TOTP_SEAL_KEY` itself: that resets every authenticator.
- Rotate AMP password → the stack's `.env` in Dockhand, then Redeploy. The password is in that `.env` and nowhere else (the copy on the AMP host, `/root/deepslate-webapp.pass`, was removed on 2026-09-29).
- **A new dimension from a datapack** (`modpack/datapacks/`): Build, Sync, then restart the server at a moment of your choosing; Sync does not restart for it. `POST /actions/world.datapacks` lists what is enabled.
- **A new world** (done 2026-09-29; 11-status has that day's record). **2026-10-03, done differently (docs/24 §7):** the world and seed were kept and only the region, entity and poi files from −6 to 5 (±3072 blocks around 0, 0) were deleted with the server stopped, together with player data and the saved data of Open Parties and Claims, Sophisticated Backpacks, Waystones and Corpse (`world/deaths/`); then pre-generation "now", both, radius 3072, without purging the map (chunky skips chunks that exist, BlueMap updates the changed area). No backup could be taken: AMP accepted every request that day and listed none. `world.standable` needs the chunk loaded (spawn is not kept loaded): force-load it for the test and release it. Server claims sit in the Open Parties and Claims data: re-make them after deleting it, one claim command at a time. The seed is AMP's to set (`MinecraftModule.Minecraft.WorldSeed`; the portal can read it, not write it), and AMP writes it into `server.properties` when the server starts, not before. With the server **stopped**: copy `world/` away over the rsync link and compare by checksum (`rsync -rltpcn --delete --itemize-changes`, no lines = the same), copy it back up under the new name, compare again, and only then empty `world/` (`rsync -r --delete <an empty folder>/ amp@…:world/`, after a dry run that shows deletions and nothing else). The link cannot rename, and an empty `world/` is as good as none: the game makes a new world in it. Then, through `api`: `POST /server/start`; `POST /actions/world.seed`; Sync (the datapack with the room's dimension lives in the world's folder and has gone with it) and a restart; `POST /actions/limbo.build` (the room is part of the world and goes with it); `POST /actions/map.purge` for `world`, `world_the_nether`, `world_the_end`; `POST /actions/world.pregen {x, z, radius}`. `level.dat` has the spawn (`Data.SpawnX/Y/Z`).
- **The map shows old tiles, or a render that never finishes.** With the server **stopped**, empty the three folders `bluemap/web/maps/world`, `world_the_nether`, `world_the_end` over the rsync link (`rsync -r --delete <an empty folder>/ amp@…:bluemap/web/maps/world/`, after a dry run that shows deletions only): tiles, low resolution and BlueMap's own record of what it has rendered all live there. (`bluemap purge <map>` does the same on a running server, one map at a time.) After the next start BlueMap renders everything that exists; to have that finish, Admin → Server → Pre-generation → *Render the map only*, which keeps the server awake until BlueMap says the map is updated. Done on 2026-09-29 at 16:48:52 UTC and, on Alex's word, again at 18:36:33 UTC. BlueMap's settings need no change for this: `maps/world.conf` has no `min-x`/`max-x`/`min-z`/`max-z`, and BlueMap only renders chunks that exist, so it renders the pre-generated area and what players add to it. Limits of ±1500 would hide everything explored later. The low-resolution tiles are made from the high-resolution ones as those are rendered. `render-thread-count: 1` (`core.conf`).
- **Chunky on a server that sleeps.** AMP puts an empty instance to sleep after five minutes (`MinecraftModule.Limits.SleepDelayMinutes`), pre-generation or not, and a stop in the middle of generating hung the server. Use Admin → Server → Pre-generation: it switches AMP's sleep mode off while it is due and back afterwards (needs `Settings.MinecraftModule.Limits.SleepMode` for `webapp`). Never a loop that wakes the server.
- **The server hangs in "Stopping"** → Admin → Server shows "End the process" while that is so (or `POST /server/kill` on api, admin caller; refused in any other state). What had not been saved is lost. Never used for the pre-generation.
- **After ADS has been restarted** the api's session is gone. Since 2026-09-29 the client notices (AMP answers HTTP 200 with "requires the Session.Exists permission") and logs in again; before, the portal showed "Unknown" until `api` was restarted.
- **Health says `amp: instance_down`** (since #83, 2026-10-15): ADS answers, but live's AMP instance is not running ("Instance Unavailable"); the password is not the problem. Start DeepslateWorks01 in AMP. If ADS cannot start it and its log says `error while creating mount source path '/nfs/filezilla/DeepSlate-MC': mkdir …: operation not permitted`, the NAS share is not mounted on the AMP host: the instance binds its backup folder there, and the empty mount point is immutable on purpose (docs/28), so it refuses to start rather than write backups to the local disk. Never create the folder or lift the flag. On the AMP host since 2026-10-15:
  - **At boot AMP waits for the share.** `/etc/systemd/system/ampinstmgr.service.d/backup-share-order.conf` runs `/usr/local/sbin/wait-for-backup-share` as `ExecStartPre` (as root, `TimeoutStartSec=infinity`): it tries `mount /nfs/filezilla` every 15 s until the share and `DeepSlate-MC` are there. No time limit, so with the NAS down for good *every* AMP instance on that host waits; mount the share, or `sudo systemctl kill ampinstmgr.service` and start instances by hand. `journalctl -u ampinstmgr.service -b | grep -i "waiting for\|is mounted"` shows the wait.
  - **While running the share is remounted.** `backup-share-remount.timer` (every minute, from 2 minutes after boot) runs `mountpoint -q /nfs/filezilla || mount /nfs/filezilla`; ADS's own repeated start attempts then succeed. If they have stopped, start the instance in AMP.
  - Still `instance_down` with the share mounted: `findmnt /nfs/filezilla`, then `journalctl -u nfs-filezilla.mount -n 30 --no-pager` on the AMP host.
- The box is short of memory → `free -m`, `docker stats --no-stream`, `journalctl -k | grep -i "killed process"`. Every container has a limit, so a container that grows is killed inside its own limit; look for something running outside one.
- **Read install reports without the database** → `api.sh "/installs?since=<ISO>&user=<name>"` (list) and `api.sh /installs/<id>` (one report, last 400 log lines; `?full=1` for all). Admin only, read only. In the site: Admin → People → Installs.

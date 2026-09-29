# 11 · Status and handover

Last updated 2026-09-29 (OOM incident and the deploy change that follows from it: CI builds the images, the VPS only pulls; before that: must-have mods synced, wait room + Discord link flow live in `api`, admin Server page). Read this before touching anything; update it at the end of every session. `docs/10-roadmap.md` stays the plan; this file records where reality is against it.

## Where things are

| Thing | Where |
|---|---|
| Repo (git, branch `main`) | `/home/ladm/Minecraft-site` on vps-01v (the folder Alex gave; the original brief files `00-overview.md`, `markdown`, `deepslate-works-design-docs.zip` stay at its root, the repo copy under `docs/` is canonical) |
| Live site | https://deepslate.dsw.test · map host https://map.deepslate.dsw.test (needs Alex's DNS A record; 401→login redirect works; 502 until BlueMap exists) |
| Compose stack `deepslate` | `/home/ladm/Minecraft-site/deploy/docker-compose.yml` → `deepslate-web`, `deepslate-api` (in the tunnel namespace), `deepslate-wg` (WireGuard, udp 51820), `deepslate-map-relay-inner`/`-outer`, `deepslate-db`, `deepslate-backups` |
| Secrets | `deploy/.env` (mode 600), `deploy/wireguard/wg_confs/wg0.conf` + `vps.key`, `deploy/keys/deploy.key` (all git-ignored; template `deploy/.env.example`, `deploy/wireguard/wg0.conf.example`) |
| Postgres data / dumps | `/root/docker/deepslate/postgres`, `/root/docker/deepslate/backups` (nightly, keep 7) |
| Reverse proxy | blocks `deepslate.dsw.test` and `map.deepslate.dsw.test` in `/root/docker/web-proxy/etc/Caddyfile` (copy in `deploy/Caddyfile.snippet`; the map block uses an explicit reverse_proxy + handle_response because `forward_auth` alone returns the 401 instead of redirecting) |
| Health | `GET /api/health` → `{ok, db, api:{ok,tunnel,amp,rsync}, missingEnv, discord, guildGate}`; `ok` is web's own health, tunnel state is reported not required |

The VPS has no Node, and **it never builds images** (see "OOM incident" below). Checks run in a throwaway container with a memory cap; images come from CI:

```
# checks (typecheck, lint, tests): capped, and as ladm so nothing in the repo ends up owned by root
docker run --rm --memory=1500m --memory-swap=2500m --cpus=2 -u 1009:1009 -e HOME=/tmp -e CI=1 \
  -v /home/ladm/Minecraft-site:/app -w /app node:22-alpine sh -c \
  'npm i -g --prefix /tmp/pnpm pnpm@10 >/dev/null 2>&1 && export PATH=/tmp/pnpm/bin:$PATH \
   && pnpm install --frozen-lockfile && (cd apps/web && pnpm exec prisma generate) \
   && (cd apps/api && pnpm exec prisma generate) && pnpm typecheck && pnpm lint && pnpm test'

# deploy: the only way (docs/09). Push to main, wait for CI, then:
sudo /home/ladm/Minecraft-site/deploy/deploy.sh

# Caddy reload after editing the Caddyfile
docker exec caddy sh -c 'caddy adapt --config /etc/caddy/Caddyfile --envfile /etc/caddy/caddy.env > /tmp/c.json \
  && wget -qO- --header="Content-Type: application/json" --post-file=/tmp/c.json http://127.0.0.1:2019/load'

# bootstrap invite (before any admin exists, or while Discord is unconfigured)
docker exec deepslate-web node apps/web/scripts/invite.mjs "for Alex" 14
```

Gotchas found the hard way: `CI=1` makes pnpm default to `--frozen-lockfile`; pnpm 10 needs `pnpm.onlyBuiltDependencies` (root `package.json`) for Prisma/esbuild postinstalls; ESLint plugins need the `public-hoist-pattern` lines in `.npmrc`; if you change `.npmrc`, delete `node_modules` before reinstalling.

## OOM incident, 2026-09-29 03:58 UTC

**What happened.** `docker compose -f deploy/docker-compose.yml up -d --build` on the VPS, to ship the wait-room audit fix. The host has 7.7 GB and had no swap. From the kernel's own process table at the moment it ran out: `dockerd` (the built-in BuildKit) 1.9 GB, the `next build` step 0.7 GB, the 41 running containers and host services about 5.1 GB. Image builds sit outside every container memory limit and inherit Docker's protection from the OOM killer (`oom_score_adj -500`), so the kernel killed bystanders instead: the tooling session, an Authentik worker and a user session manager. `authentik-db` had already been killed inside its own 256 MB limit at 03:12. The build itself finished (images stamped 03:58 and 04:00); the box was rebooted at 04:07 and all 41 containers came back by themselves. Every site answered correctly afterwards; `/api/health` was fully green again by 04:20.

**What changed, so it cannot happen the same way again.**

| Layer | Change |
|---|---|
| Deploy | CI builds `web` and `api` and pushes them to GHCR; the compose file has no `build:`; `deploy/deploy.sh` is the only way to deploy (docs/09) |
| tooling on this host | hook `/root/.tooling/hooks/mem-guard.py` refuses image builds outright, refuses `docker run` without `--memory`, refuses to start containers under 700 MB available |
| Builder | default buildx builder is `capped` (2 GB RAM, 3 CPUs, own container), for the day a local build is unavoidable; a test build that tried to take 5 GB was stopped at the cap with the host never below 2 GB available |
| Host | 4 GB swapfile, `vm.swappiness=10`; `earlyoom` (build tools and headless browsers go first; proxy, databases, Docker, SSH are spared) |
| This stack | `mem_limit` web 768m (was 1g), api 512m (was 256m, it now runs `modpack build`), postgres `shared_buffers=128MB` explicit. Applied to the running containers with `docker update`; the compose file carries them from the next deploy |
| `modpack build` | moved out of the `web` process into `api` as a child process: 256 MB heap, first to be killed if the container runs out, no secrets in its environment, output streamed line by line; jar downloads streamed to disk (they were read into memory whole). Peak 75 MB for the current pack |

**First pull-only deploy: 2026-09-29 05:09 UTC.** `deploy/deploy.sh` ran clean. `deepslate-web` and `deepslate-api` run `ghcr.io/blake-dk/deepslate-{web,api}:latest`, image revision `ba5decf` = repo HEAD. Checked afterwards: `/api/health` all green; AMP through api (login, `GetStatus`, players) answers in under 100 ms; `rsync --list-only amp@10.77.0.2:` with the deploy key lists the instance's `Minecraft/` tree and a plain shell is still refused by rrsync; Build through `POST /modpack/build` streams its lines and finishes in about a second with the jars cached (api peak 113 MB of 512); `dist/` belongs to uid 1000, web mounts it read-only. The smoke script's `SetConfig` write probe was not re-run (Alex's to run). AMP reported state 50 (`PreparingForSleep`) at the time: the instance sleeps when empty, which matters for the "downloads only while Running" rule; not changed here.

## Phase 0 · what was built

Matches `docs/10-roadmap.md` Phase 0 "Build" list. Files worth knowing:

- `apps/web/src/auth.config.ts` (edge-safe: Discord provider, cookie, session callback) and `apps/web/src/auth.ts` (full: credentials provider, invite consumption in `signIn`, `jwt` lookup). Discord provider is only registered when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set; the UI says so.
- `apps/web/src/middleware.ts`: only checks "logged in" and redirects to `/login?next=`. Role and onboarding checks read the database per request in `src/server/auth/session.ts` (`requireUser`, `requireOnboardedUser`, `requireAdmin`), so promotions apply without re-login.
- `src/server/auth/users.ts` `createUser`: first user ever, or the `ADMIN_DISCORD_ID` account, becomes ADMIN. Invite is consumed in the same transaction.
- `src/server/auth/invite-codes.ts` (pure, tested), `invites.ts` (db), `rate-limit.ts` (in-memory 10/min per IP for login and registration; Caddy here has no rate_limit module), `can.ts` (permission table from docs/03).
- `src/server/mojang.ts`: username → UUID with a 6 s timeout; onboarding refuses names Mojang doesn't know or that another member already claimed.
- Pages: `/login`, `/join/[code]`, `/join/[code]/email`, `/onboarding`, `/` (home shell), `/admin`, `/admin/invites`, `/admin/users`, and placeholders for `/mods /vote /install /map /players`. Route group `(app)` requires an onboarded user; `(public)` does not.
- API: `/api/auth/[...nextauth]`, `/api/auth/verify` (200/401 for Caddy forward_auth, phase 3), `/api/health`.
- Prisma schema is the full one from docs/03 (Vote, Ballot, Announcement, AuditLog, ServerSnapshot already exist). Migration `0001_init` applied.
- Tests (vitest, 10 passing): permissions, invite codes/state, rate limiter, Minecraft username regex and UUID formatting. CI workflow in `.github/workflows/ci.yml` (repo has no remote yet).
- UI: hand-written primitives in `src/components/ui/` in the shadcn style (same `cn()` and CSS-variable tokens), so `npx shadcn add` can be used later without a rewrite. Dark/light via `data-theme`, remembered in localStorage.

## Deviations from the design docs (deliberate)

1. **Caddy.** docs/02 and docs/09 assume a Caddy of our own. This VPS already has one (stack `web-proxy`) fronting several sites, so the app joins the external `web` network and gets a block in the existing Caddyfile. No second proxy, no published ports. `deploy/Caddyfile.snippet` is the block.
2. **Rate limiting** lives in the app, not Caddy (module not present in `caddy:2-alpine`).
3. **Resolved by docs/13.** AMP is on the homelab; `api` reaches the ADS at `10.77.0.2:8080` through the WireGuard container; no bind mount. Original note: **AMP is not on this VPS.** docs/02 and 09 assume a bind mount of the AMP instance directory. Alex: "the users will access the game server via pangolin, the vps has nothing to do with it, you only speak to amp." So: AMP is reached over Tailscale by HTTP API only; `pangolin-01v` is the players' tunnel and is out of bounds. Phase 2's `sync-server` will therefore need the AMP file API (or SSH/rsync to the AMP host) instead of a bind mount; Phase 4's stats reads likewise. Update docs/02, 06, 09 when the AMP host is known.
4. **Resolved by docs/13:** domain stays `deepslate.dsw.test`, map `map.deepslate.dsw.test`, `COOKIE_DOMAIN=.deepslate.dsw.test` is set. Original note: **Domain** is a placeholder (`deepslate.dsw.test`, wildcard already on this VPS). `COOKIE_DOMAIN` is empty until the map host exists (phase 3), so the session cookie is host-only.
5. **Prisma 6** pinned (`^6`) rather than 7; the classic migrate workflow, boring on purpose.
6. **No Dockhand registration** yet (this VPS's other stacks are managed there). Do it when the stack shape settles, or leave it git-driven.
7. **Location.** The build first went to `/opt/deepslate` (docs/09 layout); Alex wants the project in the folder he supplied, so the whole repo now lives in `/home/ladm/Minecraft-site` (owned by `ladm`) and `/opt/deepslate` no longer exists. Containers were recreated so Compose tracks the new path. Nothing is installed on the host: pnpm, Prisma, the checks and the image build all run in Docker.

## Keys for Alex to ferry to the AMP host session (docs/13 §5)

- VPS WireGuard public key: `IvQftNPCxX4H2jvwV6BYtZCkfkY7l6yb16T5PhP29ic=`
- Deploy key (`deploy.pub`, goes into `amp`'s `authorized_keys` rrsync line): `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIILAQ2zNCWgU8c2W84E7VPGhJtvCtDTm6lZF0sdT+Ueu deploy@portal`
- The AMP host's public key `D/ZFt5fGUd+8tLvS+9TbSZ7ZB0SLwmqPBsBEBjOiNg4=` is already in `wg0.conf`; the tunnel comes up as soon as the homelab side enables `wg-quick@wg0` with our key.

## `apps/api` (added this session, docs/13 §4)

Fastify 5 skeleton in the tunnel namespace: `src/env.ts` (fails fast), `src/auth.ts` (bearer service token, `X-User-*` headers parsed and re-validated), `src/amp/paths.ts` (ADS proxy path builder), `src/amp/client.ts` (`AmpClient` with login + one re-login on 401, `MockAmp` for `AMP_MOCK=1`), `src/health.ts` (tunnel = TCP to `10.77.0.2:22`, amp = login, rsync = ssh with the deploy key must be *refused by rrsync*, not unreachable; cached 30 s), routes `/health` and `/status`. Tests: 4. No Prisma in `api` yet; add it with the poller in Phase 3 (`prisma generate --schema ../web/prisma/schema.prisma` or a `packages/db` workspace). `web` talks to it only through `src/server/api-client.ts`.

## Discord server gate (added on Alex's request)

`DISCORD_GUILD_ID` set → the Discord provider requests `identify guilds`, and every Discord sign-in is refused with "You need to be in the group's Discord server" unless `users/@me/guilds` contains that id. `DISCORD_GUILD_AUTO_JOIN=1` makes membership count as the invite (no link needed for Discord users); default `0` keeps invite links required. Members who leave the server are refused on their next sign-in; existing sessions last until they expire (30 days) unless removed in `/admin/users`.

## AMP smoke test (2026-09-28 night, per planner instructions)

Run from inside `deepslate-api` through the tunnel, `AMP_URL=http://10.77.0.2:8080`, `AMP_INSTANCE_ID` (GUID) and `AMP_PASSWORD` from `deploy/.env` (verified byte-identical inside the container, no shell-special characters).

| Step | Result |
|---|---|
| 1. `Core/Login` as `webapp` **through the instance proxy path** | `result: 10, success: true`, permissions `Instances.<id>.Manage` + settings denials. (First attempt against the ADS's own `/API/Core/Login` gave `result: 0`: `webapp` is instance-local, corrected by Alex.) |
| 2. `Core/GetStatus` | 200, `State: 0` (instance stopped), Metrics `CPU Usage / Memory Usage (max 6144 MB) / Active Users`, Ports (game 25569 not listening) |
| 3. `Core/SetConfig` | **Refused**: "does not have permission to modify setting" (verified by Alex as `webapp` from the AMP host side, 2026-09-28). Smoke test complete. |

Also recorded (read-only): `GetUpdates` shape, `GetUserList` (`{}` while stopped), `FileManagerPlugin.GetDirectoryListing` works, `LocalFileBackupPlugin.GetBackups` and `GetAMPRolePermissions` are `Unauthorized Access` for webapp. Details in docs/08. `AMP_MOCK=0` now: the mock is off, `api` talks to the real instance. **The instance is stopped**, so with Alex's download rule players can't download until it runs; admins still can.

## Server build + wait room (2026-09-29)

Alex: "build the server with the must-have modpacks first and get the wait room working and the discord auth all set up".

- **Server files**: `server.properties` on the instance already matched docs/14 (online-mode on, white-list off, enforce-whitelist off, spawn-protection 0, port 25569 managed by AMP, seed `CubeCodersPowered`), so it is not synced. Shipped `modpack/server/config/bluemap/{core,webserver}.conf` (accept-download, webserver bound to `10.77.0.2:8100`). `eula=true` was already set.
- **api** (`apps/api`, now with Prisma against the shared schema): `amp/console.ts` tails `Core.GetUpdates` (2 s while running, 15 s otherwise) and parses UUID/login/leave/list lines; `actions/registry.ts` holds every console command (`limbo.hold`, `limbo.remind`, `limbo.keep`, `link.release`, `limbo.kickIdle`, `limbo.build`, `player.revoke`, `server.say`, `server.list`) with zod-validated input, `actions/run.ts` sends and audits; `players/limbo.ts` decides on every join (`decideJoin`: release only when the UUID belongs to a user with `verifiedAt` and `guildMember`), holds with a 15-min `LinkCode` (reused while valid), drags held players back every 5 s, reminds every 60 s, kicks after 15 min idle, releases on request from the portal, revokes (kick + unwhitelist), and re-checks guild membership every 5 min **only if `DISCORD_BOT_TOKEN` is set** (otherwise membership is refreshed at each Discord login). Routes: `GET /players`, `POST /link/release`, `POST /player/revoke`, `POST /actions/:name` (admin), `GET /console/tail` (admin), `POST /server/start|stop|restart` (admin).
- **Portal**: `/link/<code>` (login → Discord → guild check → onboarding keeps the return URL) binds the UUID + username from the `LinkCode` to the account (refuses a second UUID per account and a UUID already owned by someone else), marks the code used, asks api to release. Discord sign-in now sets `guildMember` (false when refused, true on success). Admin → Users "Remove" also kicks. New **Admin → Server** page: state, online/held players, Start/Restart/Stop with an in-page confirmation, "Build the room", revoke by name, `say`, console tail (last 120 lines, reload to refresh).
- Env: `LIMBO_POS` (default `0 250 0`), `SPAWN_POS` (empty = `spreadplayers` near 0,0 on the surface), `DISCORD_BOT_TOKEN` (optional), `DATABASE_URL` + `PORTAL_URL` passed to api by compose.
- Tests: api 11 (console parsing incl. a chat line that mimics a join, join decision, action builders and input refusal).
- **Done on the instance (2026-09-29 03:5x UTC):** first real Sync (11 jars + `config/bluemap`), `Core.Start` via api → `Done (1.756s)`, voice chat on 24454, BlueMap downloaded the client jar and bound its webserver to `10.77.0.2:8100`; **https://map.deepslate.dsw.test works behind the login** (anonymous → login redirect). Wait room built at `LIMBO_POS=0 250 0` (`limbo.build`: 847 + 405 + 81 blocks, 5 lights, chunks force-loaded). Spawn area is around 0,0 so `SPAWN_POS` can stay empty (`spreadplayers` near 0,0). Portal link flow exercised with a seeded `LinkCode` (bind, idempotent re-click, expired code, `/me` shows the link).
- **Not yet exercised:** a real player joining (hold → chat link → release). Needs someone to connect to `mc.dsw.test`; watch Admin → Server (held players + console).

### docs/14 acceptance · state

- [ ] A fresh account joins, lands in the room, can't leave, sees the link within 5 s. *Engine live; needs a real join.*
- [ ] Clicking the link with a Discord account in the server releases them to spawn within 5 s and `whitelist.json` gains them. *Portal side verified; release-on-online untested.*
- [ ] A Discord account outside the server is refused and the player stays in the room. *Login refusal verified earlier; room hold untested.*
- [ ] Leaving the Discord server puts the player back in the room next join. *Flag set at login; 5-min re-check needs `DISCORD_BOT_TOKEN`.*
- [ ] api down 2 min then back: nobody unverified escaped. *Tags persist; on restart api holds unknown joins again; no in-game command block yet (docs/14 §4 belt-and-braces not done).*

## Installer sign-in + "Update and Play" (Alex, 2026-09-28)

`LauncherAuth` model (migration `0004_launcher_auth`), `POST /api/launcher/start`, `GET /api/launcher/poll`, `/launcher/<code>` approval page (login required, shows the code and hostname, Yes/No), launcher tokens accepted by the manifest and downloads, "Sign out installer" per user in Admin → Users. Installer: `install.ps1` signs in (token cached a week), `-Play` opens the launcher on the selected profile; `Update and Play.bat` added; `Setup.bat` unchanged. Details in docs/07. Verified end to end with curl (start → approve → poll hands the token out once → manifest 200 with it, 401 with a wrong or revoked one) and a `pwsh` dry run of the stamped script using the token. Still untested on a real Windows PC.

## Launch switch (Alex, 2026-09-28)

`SiteSettings` row (`live`, `launchAt`; migration `0003_site_settings`), edited at **Admin → Settings**. Until `live`:
- players never see the server address (`/install`, `/me`, Home) and `/downloads/*` + the manifest refuse them (`not_live`); Home and Install show a launch banner with the date ("Launching Sat 4 Oct 2026, 19:00, in 6 days" / "to be announced");
- admins see everything, with a note that players see the launch page.
Once live, the earlier rule applies: downloads open while the server is running. The launch date is entered as UK time (`src/lib/uk-time.ts`, tested for BST/GMT). Default: not live, no date.

## docs/14 (Discord-gated join) · what landed now (2026-09-28 late night)

Per Alex's message: the Phase-1 data model bits and the onboarding change are in; the join hook, actions and `/link/<code>` are Phase 4 as scheduled.

- Prisma: `LinkCode` model, `User.verifiedAt`, `User.guildMember` (migration `0002_link_codes`).
- Onboarding is the PC question only. "Onboarded" now means `pcTier` set (`requireOnboardedUser`, nav). Nobody types a Minecraft username; the copy says the link happens in game.
- `/me`: "Linked: <mcUsername>" once linked, otherwise "Join the server to link your Minecraft account" with the address. No input box.
- Mojang lookup kept only as an admin tool: `/admin/users` has a "Link" box per unlinked member (checks with Mojang, sets `verifiedAt`) and "Unlink".
- `.env.example`: `LIMBO_POS`, `SPAWN_POS` placeholders for Phase 4.
- Alex's note on the launcher: the name people were reading is the Microsoft account name in the top left; the Minecraft name is the one to the right of the Play button. Moot now that nobody types it, but relevant for the admin fallback.

## Phase 2 · what was built (2026-09-28 late night)

- `packages/modpack`: `lock` (Modrinth resolution with required deps, newest release else beta with a warning, NeoForge latest 21.1.x from the maven, sha256 pack hash, config hashes, diff vs previous, temp+rename), `build client` (`client.mrpack` with CDN URLs + `overrides/config`), `build server` (`dist/server/mods` downloaded and sha512-checked, stale jars removed, `PACK_VERSION`), `build installer` (`installer.zip` with the manifest URL + pack version stamped into `install.ps1`), `config.zip`. `pnpm modpack <cmd>` in the node container; `MODRINTH_USER_AGENT` needed.
- `installer/`: `Setup.bat`, `README.txt`, `install.ps1` per docs/07 (launcher check, manifest fetch, Java 21 from the launcher runtime / PATH / Temurin download, NeoForge installer with `--install-client` then `--installClient` fallback, separate game dir, sha512-checked mods with stale-jar removal, options.txt per tier, uncompressed-NBT `servers.dat`, RAM by installed memory clamped to the manifest, launcher profile written with a backup, `installed.json`). Dry-run tested under `pwsh` on Linux (`-DryRun -Root <fake>`): all 8 steps pass, nothing written. **Not yet tested on a real Windows PC.**
- Web: `/install` (OS detection, Windows 3 steps / Mac-Linux 2 steps, pack version, copy address, PC hint), `GET /api/modpack/manifest`, `GET /downloads/{installer.zip,client.mrpack,config.zip}`, `/admin/modpack` (table with lock status per mod; Lock / Build / Sync (dry run) / Sync buttons streaming logs over SSE from `POST /api/admin/modpack/<cmd>`; lock commits `mods.lock.json`).
- `api`: `POST /modpack/sync` (admin header + service token): rsync `dist/server/mods/` with `--delete` (dry run first to detect changes), then `config/`, `bluemap/`, `defaultconfigs/` merged, then `Core.Restart` through the ADS proxy if mods changed. `dryRun: true` reports only. Health now reports the deploy key state: `ok` = refused by rrsync (wanted), `unrestricted` = full shell (current), `no_key`, `down`.
- **Download rule (Alex, 2026-09-28):** the manifest and `/downloads/*` are never public. Admins always; players only while the server is online (api `/status` state Running, cached 15 s); the Windows installer authenticates with `MANIFEST_KEY` (`deploy/.env`) stamped into its manifest URL at build time. With `AMP_MOCK=1` the mock reports Running, so players can download now; once the real AMP is wired, an offline server closes downloads for players.
- Current pack: `0.1.0+47b0b579`, 18 locked files (base + server-only; votable mods are off until the vote is applied), NeoForge 21.1.252. Built and served.

### Phase 2 acceptance (docs/10)

- [x] `modpack lock` resolves every enabled mod plus dependencies for NeoForge 1.21.1 and fails loudly on a mod without a compatible version.
- [ ] `client.mrpack` imports into the Modrinth App and launches to the main menu. *Built; needs a real client test.*
- [ ] Clean Windows VM: Setup.bat → launcher → profile → main menu → server in list. *Script dry-run passes on Linux; needs Windows.*
- [ ] Rerun says "already up to date"; bumping one mod replaces exactly that jar. *Logic present; needs Windows.*
- [ ] `sync-server` puts the jar set on the AMP instance; server starts; client connects. *Dry run over the tunnel works (11 jars would be copied); key restriction verified; AMP login works. Ready for a real Sync once Alex says go (the instance is stopped right now).*
- [ ] Alex's Mac or one friend's gets in via `.mrpack`.

### Mod list changes (Alex, 2026-09-28)

Added `additional-enchanted-miner` ("Quarry (Additional Enchanted Miner)", mining, M, suggested) with its library `scalable-cats-force` (hidden), and `pipez` (world, L, suggested; 1.21.1 build is a beta). 38 entries, 173 links verified. Vote was open: the ballot reads the manifest live, so both appear pre-ticked for anyone who hasn't saved; saved ballots keep their picks.

### Onboarding "no Minecraft account with that name" (Discord, 2026-09-28)

Two players hit it. The Mojang lookup was verified working from the container (Notch, jeb_, bramble09, Dinnerbone all resolve) and another player onboarded successfully minutes later, so the likely causes are a typo, an Xbox/Bedrock gamertag, or a Discord name. Failed attempts are now audited (`profile.onboard` DENIED with the name typed) and the copy spells out "Java Edition name from the launcher". Check Admin → Overview → recent activity to see what they typed.

## Phase 1 · what was built (2026-09-28)

- `modpack/mods.json`: 35 entries (33 visible + 2 hidden libraries), every slug verified against the Modrinth API for a NeoForge 1.21.1 build, every wiki and video link verified (`pnpm modpack verify-links`: 163 links, 0 failed). Dropped from docs/06: FTB Essentials and FTB Ultimine (CurseForge only, not on Modrinth; the docs rule excludes them), Advanced Mining Dimension (no NeoForge 1.21.1 build), Create Ultimine (only an addon for FTB Ultimine). VeinMiner (`veinminer`) replaces the Ultimine pair. Votable mods start `enabled: false`; base and server-only mods are on. `server_address` is the placeholder `mc.dsw.test`.
- `packages/modpack`: shared zod schema, `lint` (cross-field rules from docs/06), load estimate (docs/05 points), `verify-links` (Modrinth via API with backoff, YouTube via oEmbed where 401 = exists but not embeddable, wikis via HEAD/GET with a retry). `lock`/`build`/`sync-server` are Phase 2 stubs. Run with `pnpm modpack <cmd>` inside the node container (no Node on the host).
- Web: `/mods` (sections, cards with load/Suggested/pick-one chips, Mod page + Wiki + video thumbnails, "Will my PC run it?" with the user's row highlighted), `/vote` (client ballot form: checkboxes, radios per exclusive group with click-to-clear, suggested pre-ticked, live load estimate with the LOW-tier Heavy warning, settings questions, saves via server action, editable until close, auto-closes at `closesAt`), `/vote/results` (admins while open, everyone once closed; per-mod yes/%/per-tier bars, weak-PC-majority flag on Heavy mods, question counts; Close button), `/vote/results/apply` (diff at a chosen threshold; exclusive groups keep the winner; confirm writes `mods.json` atomically and commits `chore(modpack): apply ...`), `/admin/votes` (create draft with default questions JSON, open/close/delete; one open vote at a time). Home shows the open-vote banner.
- Tally and decision logic are pure and tested (`apps/web/tests/tally.test.ts`); manifest schema/lint tested in the package.
- Deploy: `deepslate-web` now runs as uid 1009 (= `ladm`) and mounts the live repo's `modpack/` and `.git` at `/repo` so "Apply results" can write and commit; `MODPACK_DIR=/repo/modpack`. Nothing else from the repo is mounted.

## Phase 1 acceptance (docs/10)

- [x] Every mod card has a working Mod page, Wiki and at least one real video link (`verify-links` passes).
- [ ] A player can submit a ballot on a phone in under two minutes and edit it later. *Built; a ballot was saved through the real server action in a smoke test (exclusive group and unknown answers filtered server-side). Needs a real phone click-through.*
- [x] Exclusive group (guns) allows one choice; load estimate updates live and warns LOW-tier users about Heavy sets.
- [x] Results page shows per-mod yes % and per-tier breakdown; closing freezes results (`resultJson`).
- [ ] "Apply results" produces a diff of `mods.json` and commits it on confirm. *Built; commit path not yet exercised end to end (needs a closed vote with ballots).*

Alex logged in with Discord and opened the vote; `phase-0` tagged at `0399eb0`. Player address is plain `mc.dsw.test`: Pangolin publishes it on the default 25565 and forwards to the AMP host's 25569 (voice chat 24454/udp the same way). No port in the server list.

## Phase 0 acceptance (docs/10) · current state

- [x] `docker compose up -d` on the VPS serves the site over HTTPS.
- [ ] Alex logs in with Discord and lands on an admin page. *Unblocked 2026-09-28: Discord app, `ADMIN_DISCORD_ID`, `DISCORD_GUILD_ID` and `DISCORD_GUILD_AUTO_JOIN=1` are in `deploy/.env`; the signin redirect was verified (scope `identify guilds`, correct callback). Not yet clicked through. Note: the Discord login creates a separate ADMIN user from the email account `admin@example.com`; that's fine, or remove the email one in Users afterwards.*
- [ ] Invite link lets a second account in; a third without an invite is refused. *Code paths exist; not clicked through.*
- [ ] Email/password fallback works for one invite. *Renders; not clicked through end to end.*
- [x] `/api/auth/verify` returns 401 without a session (200 with one not yet exercised).
- [ ] `/api/health` reports `tunnel: ok`. *Currently `down`: waiting on the homelab side to enable its peer with our public key.*

**Admin login (email route):** `admin@example.com`, created from the CLI; password handed to Alex in chat and recorded in `/root/HOSTING.md` (mode 600), never here. Reset any time with `docker exec deepslate-web node apps/web/scripts/admin.mjs admin@example.com Alex` (prints a new password; there is no GUI password change yet). First login lands on `/onboarding` (Minecraft name + PC tier), then Admin appears in the nav. The bootstrap invite `https://deepslate.dsw.test/join/2R97LWNC` (14 days) is still unused and can go to the first friend.

## Alex's to-do (blocking; docs/13 §7 plus what this session couldn't do)

0. ~~AMP smoke test~~ Complete: login, GetStatus, SetConfig refused. `Core.Start` gets exercised from the admin page in Phase 3.
0b. ~~Deploy key restriction~~ **Verified 2026-09-28**: with the key pinned (`IdentitiesOnly=yes`, no agent, no other identity in the container) `rsync --list-only amp@10.77.0.2:` lists the instance's `Minecraft/` (server.properties, mods/, config/, world/ …), so rrsync roots the key correctly. The earlier "unrestricted" verdict came from `ssh … true` returning exit 0 with no rrsync message on that host, which turned out to be a poor test; the health probe now lists the remote root instead and reports `ok` / `wrong_root` / `no_key` / `down`. Real Sync is therefore allowed once Build has run. Fingerprint of our key: `SHA256:5g0kW7Zo+q0CBsMiD5/42qnkFIkJe2MVw8Nod3J/xtE`.
1. ~~Host firewall UDP 51820~~ Done by Alex (in `host-firewall.sh`, survives restart).
2. DNS: `map.deepslate.dsw.test → 198.51.100.20`.
3. AMP: create instance `DeepslateWorks01`; create ADS user `webapp` with rights on that instance only; put `AMP_INSTANCE_ID` and `AMP_PASSWORD` in `deploy/.env`, set `AMP_MOCK=0`, `docker compose -f deploy/docker-compose.yml up -d api`.
4. ~~Discord OAuth app~~ Done 2026-09-28. Server gate on, auto-join on: anyone in the Discord server can sign in without an invite link; invite links are now only for the person without Discord.
5. Ferry the two keys above to the AMP host session; give this session the instance id and `webapp` password.
6. Does anyone lack Discord? (docs/10 q5.) `server_address` Pangolin publishes? (docs/10 q6.)
7. ~~Phase 0 click-through~~ done.
8. **Test the wait room** with one friend: connect to `mc.dsw.test`, confirm the room + chat link, click it, confirm release and `whitelist.json`. Then tick docs/14 acceptance.
9. Optional `DISCORD_BOT_TOKEN` (a bot in the Discord server) so api re-checks membership every 5 min; without it, leaving the server only bites at the next Discord login.
10. ~~GHCR login on the VPS~~ Done 2026-09-29: classic token, `read:packages` only, login stored in `/root/.docker/config.json`. Fine-grained tokens get 403 from GHCR.
11. **Rotate the GitHub token** that was pasted into the chat on 2026-09-29 once the pipeline is proven; the VPS only needs `contents:read` for `git pull`.

## Session log

- **2026-09-29 05:09** · First deploy from GHCR images via `deploy/deploy.sh`; images, AMP smoke, rsync listing and the in-api Build verified (see "OOM incident"). Planner specs 15, 15a, 16 arrived by push (`ba5decf`); read, not started.
- **2026-09-29 early morning** · OOM at 03:58 during `up --build`, reboot 04:07. Recovery check of every site, guardrails on the host (swap, earlyoom, capped builder, tooling hook), deploy moved to CI + GHCR + `deploy/deploy.sh`, `modpack build` moved into `api`, memory limits adjusted, `fetchJar` streams. api tests 21, modpack 9, web 20. Wait-room audit helper (`apps/api/src/audit.ts`: an audit row from a caller id that is not a user is kept with no user instead of failing the request) committed; it was already in the running image.

- **2026-09-28** · Phase 0 built and deployed (commit `374ea10`), handover doc added (`94471be`), repo moved into `/home/ladm/Minecraft-site` with the brief files kept at the root (`19d7abb`). Bootstrap invite issued.
- **2026-09-28 late night** · Phase 2: modpack lock/build/installer, `/install`, `/admin/modpack` with SSE runner, api sync (dry run verified), download gate (admin / online-only), MANIFEST_KEY, AMP smoke test (login refused), `phase-0` tagged, Quarry + Pipez added, onboarding audit.
- **2026-09-28 night** · Phase 1 built: `packages/modpack`, `modpack/mods.json` (verified), `/mods`, `/vote`, `/vote/results` (+apply), `/admin/votes`; web container now uid 1009 with `modpack/` + `.git` mounted for the apply-and-commit step.
- **2026-09-28 late** · Planner docs 12 and 13 applied: doc edits (00/02/04/08/09/10, the working rules); `COOKIE_DOMAIN=.deepslate.dsw.test`; map host Caddy block; `wireguard` + `api` + two map relays in compose; VPS WireGuard keys and deploy key generated (public halves above); `api` skeleton with tests; web `api-client.ts`, health now reports the tunnel; Discord server gate. Firewall line left for Alex (permission refused). Tunnel `down` until the homelab enables its peer. Map-host 401→login redirect verified. Admin email account created via `scripts/admin.mjs`. Alex added the Discord app values and the server id (auto-join on) and restarted `web`; OAuth redirect verified.

## Suggested plan updates for the next session

- When the tunnel is up: confirm AMP method names against `http://10.77.0.2:8080/API` through `api` (docs/08 "AMP methods used"), then set `AMP_MOCK=0`.
- Tick the Phase 0 boxes with Alex, tag `phase-0`; tick Phase 1 (phone click-through, one real apply-and-commit), tag `phase-1`; then Phase 2 (`modpack lock|build|sync-server`, `/install`, `/admin/modpack`, `installer/`). Phase 2 needs `server_address` from Alex (what Pangolin publishes) and the AMP instance for `sync-server`.
- docs/06 `sync-server` still describes a bind mount; rewrite it for rsync over the tunnel when Phase 2 starts (docs/13 §4 has the command).
- ~~GitHub remote~~ done 2026-09-29: `Blake-DK/deepslate-works` (private), CI builds the images. Dockhand: the stack is deployed by `deploy/deploy.sh`, not from Dockhand; if it is ever added there, as pull-only.
- Phase 3 prep: the map host needs a DNS name under the chosen domain and `COOKIE_DOMAIN` set; the Caddy block needs `forward_auth deepslate-web:3000 { uri /api/auth/verify }` and a `reverse_proxy` to BlueMap on the AMP host over Tailscale.

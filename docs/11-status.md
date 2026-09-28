# 11 · Status and handover

Last updated 2026-09-28 late night (Phase 2 built; AMP smoke test complete and mock off; launch switch added). Read this before touching anything; update it at the end of every session. `docs/10-roadmap.md` stays the plan; this file records where reality is against it.

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

The VPS has no Node. Everything runs through Docker:

```
# checks (typecheck, lint, tests) without installing Node on the host
docker run --rm -v /home/ladm/Minecraft-site:/app -w /app node:22-alpine sh -c \
  'apk add --no-cache libc6-compat openssl >/dev/null && npm i -g pnpm@10 >/dev/null 2>&1 \
   && pnpm install --no-frozen-lockfile && cd apps/web && pnpm exec prisma generate \
   && pnpm typecheck && pnpm lint && pnpm test'

# deploy
cd /home/ladm/Minecraft-site && docker compose -f deploy/docker-compose.yml up -d --build

# Caddy reload after editing the Caddyfile
docker exec caddy sh -c 'caddy adapt --config /etc/caddy/Caddyfile --envfile /etc/caddy/caddy.env > /tmp/c.json \
  && wget -qO- --header="Content-Type: application/json" --post-file=/tmp/c.json http://127.0.0.1:2019/load'

# bootstrap invite (before any admin exists, or while Discord is unconfigured)
docker exec deepslate-web node apps/web/scripts/invite.mjs "for Alex" 14
```

Gotchas found the hard way: `CI=1` makes pnpm default to `--frozen-lockfile`; pnpm 10 needs `pnpm.onlyBuiltDependencies` (root `package.json`) for Prisma/esbuild postinstalls; ESLint plugins need the `public-hoist-pattern` lines in `.npmrc`; if you change `.npmrc`, delete `node_modules` before reinstalling.

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
7. Click through Phase 0 acceptance, then the VPS session tags `phase-0`.

## Session log

- **2026-09-28** · Phase 0 built and deployed (commit `374ea10`), handover doc added (`94471be`), repo moved into `/home/ladm/Minecraft-site` with the brief files kept at the root (`19d7abb`). Bootstrap invite issued.
- **2026-09-28 late night** · Phase 2: modpack lock/build/installer, `/install`, `/admin/modpack` with SSE runner, api sync (dry run verified), download gate (admin / online-only), MANIFEST_KEY, AMP smoke test (login refused), `phase-0` tagged, Quarry + Pipez added, onboarding audit.
- **2026-09-28 night** · Phase 1 built: `packages/modpack`, `modpack/mods.json` (verified), `/mods`, `/vote`, `/vote/results` (+apply), `/admin/votes`; web container now uid 1009 with `modpack/` + `.git` mounted for the apply-and-commit step.
- **2026-09-28 late** · Planner docs 12 and 13 applied: doc edits (00/02/04/08/09/10, the working rules); `COOKIE_DOMAIN=.deepslate.dsw.test`; map host Caddy block; `wireguard` + `api` + two map relays in compose; VPS WireGuard keys and deploy key generated (public halves above); `api` skeleton with tests; web `api-client.ts`, health now reports the tunnel; Discord server gate. Firewall line left for Alex (permission refused). Tunnel `down` until the homelab enables its peer. Map-host 401→login redirect verified. Admin email account created via `scripts/admin.mjs`. Alex added the Discord app values and the server id (auto-join on) and restarted `web`; OAuth redirect verified.

## Suggested plan updates for the next session

- When the tunnel is up: confirm AMP method names against `http://10.77.0.2:8080/API` through `api` (docs/08 "AMP methods used"), then set `AMP_MOCK=0`.
- Tick the Phase 0 boxes with Alex, tag `phase-0`; tick Phase 1 (phone click-through, one real apply-and-commit), tag `phase-1`; then Phase 2 (`modpack lock|build|sync-server`, `/install`, `/admin/modpack`, `installer/`). Phase 2 needs `server_address` from Alex (what Pangolin publishes) and the AMP instance for `sync-server`.
- docs/06 `sync-server` still describes a bind mount; rewrite it for rsync over the tunnel when Phase 2 starts (docs/13 §4 has the command).
- Decide whether the repo gets a GitHub remote (CI file is ready) and whether the stack goes into Dockhand.
- Phase 3 prep: the map host needs a DNS name under the chosen domain and `COOKIE_DOMAIN` set; the Caddy block needs `forward_auth deepslate-web:3000 { uri /api/auth/verify }` and a `reverse_proxy` to BlueMap on the AMP host over Tailscale.

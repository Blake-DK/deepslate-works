# 31 · Review and bug list

VPS session, 2026-10-04, 12:30 to 12:50 UTC, against `main` `21df993`. Review only: nothing was fixed, deployed, synced or restarted. The roadmap that goes with it is `docs/32-seasons-1-to-4-roadmap.md`.

## How it was done, and what could not be done

- **Code:** six read-throughs in parallel (web, api, Discord, modpack, launcher, deploy and CI), then the main findings checked again by hand against the files. "Confirmed" below means the path was traced in the code, or the fact was read from a live public endpoint, git or the Modrinth API. **Nothing was reproduced on the running system.**
- **This session ran as `ladm` with no docker and no sudo.** So, against the brief:
  - `deploy/check.sh` was **not run**. In its place: CI on `main` is green on `21df993`, `271f7dc` and `bf5e9d3` (`gh run list`).
  - **Container logs were not read.** `/root/docker` is not readable either (proxy log, dumps).
  - **The game console, TPS and memory snapshots, the event log and the install reports were not read**: api is only reachable from inside the stack, and web needs an admin session. I did not make one from the secrets in `deploy/.env`.
  - Section "Needs root on the VPS" lists the read-only commands that fill these gaps. Brief item 8 (live evidence) is therefore almost entirely open.
- **Read live, without signing in:** `/api/health`, `/api/version`, and that `/downloads/DeepslateWorks.exe` (307 to sign-in), `/api/modpack/manifest` (401) and the map host (302 to sign-in) are closed.
- **Modrinth and the NeoForged maven** were queried on 2026-10-04 for every file in the lock.
- **PR #91** (app 3.5.0, the Settings tab) was open while the review ran and was merged at 12:35 UTC (`bfd2030`), before this file was pushed. Its findings are marked "PR 3.5.0" and now apply to `main`. The findings marked "app 3.4.2" were read on 3.4.2 and were not read again on 3.5.0.

## Where each finding stands (planner's reply and addendum, 2026-10-04)

The rows below are kept as written on the day. This section is the state; update it, not the rows.

- **Fixed and running (deployed 2026-10-04):**
  - B-01 (PR #92): the site hands out the pack the server runs.
  - PR B, deploy and ops (PR #94): B-08, B-09, B-17 short form, B-18, B-19, B-20, B-21, B-23 (`deploy/keys/known_hosts` made; fingerprint in docs/11 for Alex to compare on the AMP host), and the dump copy for B-07.
  - PR C, the door (PR #95): B-02, B-03, B-04, B-41, B-43, the Control Room card. A real player (m1_owl) was let in through it at 15:08 UTC. Still to try by hand: held for Play first, leave, rejoin, press Play, land where you stood.
  - PR D, the link (PR #96, and #99 for B-39's detail on the host): B-05, B-06, B-15, B-16, B-33, B-34, B-35, B-36, B-37, B-39.
  - B-62, B-63, S-14 (PR #93, app 3.5.1, another session).
- **On `dev`, not deployed:** B-22 (the WireGuard and socat images pinned to the digests read on 2026-10-04; the next deploy recreates the tunnel, the relays and api once).
- **PR E, the lock:** the code and `mods.json` are on `main` (PR #98): B-25, B-10's pins, B-26, B-28, B-30. **The Lock itself is not run.** One quiet night, on Alex's go, after his AMP backup: Lock (expect the two Sophisticated mods and nothing else), Build, Sync, the start watched, `server-mods.sh`, then the lock and `server-loaded.json` together as one PR. Until then B-10 is open: the server still runs the old Sophisticated jars.
- **B-07:** the database half is proven (2026-10-04: the day's dump loaded into a throwaway Postgres in 4 s, 0 errors, counts matching; and that dump was the first to leave the VPS, copied to the AMP host at 14:54 UTC). **Still open:** a world archive restored into scratch from the NAS, one object read back from S3, the NAS-down boot test, and the docs/28 runner (work for it sits on branches `backups-run` and `backups-28`, unmerged).
- **B-24:** `dockhand-sync.py` unchanged (Dockhand has no https on that port; the hop is on the tailnet). The three `deploy/.env.bak-*` files and the stray `deepslate-%F.sql.gz` wait for Alex's yes or no.
- **New on 2026-10-04, open: B-66, the first wake after the deploy failed.** m1owl pressed Play at 15:03:03 UTC; AMP went to `Failed` (state 100) with an empty console and the wake gave up after three minutes. A second Start at 15:06 worked. The wake code was not changed by any of the PRs above. The cause is in AMP's own log on the homelab and has not been read. Until it is known, a player who presses Play alone can meet a dead server with nobody to start it. Medium; the AMP host paste for it is in the session's handover.
- **Not built, asked for by the planner:** the health fields and the admin-channel post of docs/32 §7 item 3 (dump age, world backup age, tunnel, a post when something goes red). A failed wake belongs in the same alert.
- **Deferred** until Season 1's W1.1 to W1.5 are in, not dropped: B-11, B-54 to B-61 (the launcher; one release with B-55, B-57, B-59 first), B-12 (noted: the instance has no `PACK_VERSION`, docs/33 §1, so the recorded pack is only the VPS's own record), B-13, B-14, B-27, B-29, B-31, B-32, B-38, B-40, B-42, B-44, B-45, B-46 to B-53, B-64, B-65, and every S- item not named above. S-10's entity ids go in with W1.1 (ServerCore excludes only ghast, warden and hopper_minecart, docs/33 §11).
- **Deferred, new:** **B-17b**, rsync into `Minecraft/_incoming` and a host-side apply step, planner spec to follow (the deploy key can delete: rrsync without `-ro` over `Minecraft/`, docs/33 §7, §10). The proper form of B-17 (web proposes, something else commits, `.git` read-only) is also a planner spec, not before Season 1.

## Critical: reported to Alex during the session

**B-01. The site hands out a pack the server does not accept, so Play first holds every non-admin at the door.** Details in the table. Not proven from here: that Play first is on today (its default is on) and that somebody has actually been held.

## The five to fix first

1. **B-01** · the pack mismatch between the site (`d7521da9`) and the server (`0d33a462`). Merge branch `lock-0d33a462` and deploy, or switch Play first off until then.
2. **B-02, B-03, B-04** · the entrance room forgets who it holds. A member held twice ends up sealed in the room; an api restart can pull playing members into it; a held member is orphaned by a deploy. One fix: keep `held` and `back` in the database. B-01 makes these fire today.
3. **B-05, B-06** · leaving the Discord server does not stick (`/link` sets `guildMember` back to true), and a link is made by a plain GET, so a stranger in the room can get a member to link them with one click.
4. **B-07** · no restore has ever been proven and the database dumps exist only on the VPS's own disk. The first step is small: load last night's dump into a throwaway Postgres, copy the dumps off the host.
5. **B-08, B-09** · a deploy pulls the moving `latest` tag with nothing tying the images to the commit, and reports "deployed" with `api` broken. Both small, both in `deploy.sh`.

Close behind: **B-10** (Sophisticated Backpacks and Core pinned below "losing item data" fixes; every new player's kit has a backpack) and **B-11** (a 2.2.0 PC can loop in the hand-over to the exe).

## Confirmed bugs

Severity: critical, high, medium, low. Size: S under a day, M one to three days, L a week.

### Joining, the pack and the entrance room

| ID | Sev | Area | What is wrong | Evidence | How to reproduce | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| B-01 | critical | modpack, joining | The server's recorded pack is `0.1.0+0d33a462`; the site's manifest and Play give `0.1.0+d7521da9`. Play first compares them exactly, so a member's Play never counts and they are held as "wrong version". Lock `0d33a462` (NeoForge 21.1.253, the prisoner-villager texture) was built and synced but lives only on branch `lock-0d33a462` (`403f7df`, `3e10c5d`), not on `main`; the deploy checkout is on `main` | Live: `/api/health` → `"pack":{"server":"0.1.0+0d33a462","main":"0.1.0+d7521da9","same":false}`; `/api/version` → `"pack":"0.1.0+d7521da9"`. `apps/api/src/shared/join-gate.ts:50`. `apps/web/src/app/api/modpack/manifest/route.ts:45`. `git merge-base --is-ancestor origin/lock-0d33a462 origin/main` fails. `requirePlay` default true (`shared/settings.ts:28`) | A non-admin presses Play and joins: held in the room, "press Play" again changes nothing. Admins are exempt | Merge `lock-0d33a462` by PR, deploy. Stopgap: Play first off. Then B-12 so it cannot recur silently | S |
| B-02 | high | api, limbo | A member held twice is sealed in the room or loses their place. `held` and its `back` position live in memory and are dropped on leave; at the second hold `where()` returns the room itself as "back" | `apps/api/src/players/limbo.ts:122-127` (`this.held.delete`), `:233` (`back = … await this.where(name)`, no check for the limbo dimension); `actions/registry.ts:356,399` | Join without a valid Play (or B-01): held. Quit, or take the 15-minute kick. Rejoin, still blocked. Then the door opens (Play counted, vote cast): `limbo.releaseBack` teleports into the room and tags `verified`; every later join is a no-op. Variant: satisfy the door before rejoining and land at spawn, not at the base | Store `back` per UUID in the database; never accept a `back` in the limbo dimension; fall back to the stored one, else spawn | M |
| B-03 | high | api, limbo | An api restart can pull playing members into the room with a code that does not exist. `resync()` holds every online name with no UUID in memory; after a restart both maps are rebuilt from AMP's last ~40 lines, where a `list` answer names everyone and the "UUID of player" lines are long gone | `limbo.ts:138-142` (`uuid ? … : null`, then `hold(name, uuid ?? "", …)`), `:250`; `status/online.ts:39` sends `list` at every start | Two api restarts close together (two deploys), or one soon after a join | In `resync` skip names without a UUID, or look the member up by `mcUsername`; act on the live `list` answer only | S |
| B-04 | medium | api, limbo | A member being held when api restarts is orphaned: unverified, adventure mode, no prompt, and Play or a vote never releases them | `limbo.ts:135-144`, `:305` (`tick` returns when `held.size === 0`) | Hold a member (Play first), deploy | Same store as B-02; on resync look again at online members without the tag | M (with B-02) |
| B-05 | medium | web, auth | Leaving the Discord server does not stick. `linkWithCode` writes `guildMember: true` without asking Discord, and nothing ends the 30-day session or the launcher tokens | `apps/web/src/server/link.ts:40`; `apps/web/src/auth.ts:121-124` | A member leaves the server, joins the game, is held, opens `/link/<code>` with the old cookie: released. With the bot it repeats every 5 minutes; without it, it is permanent | Do not write `guildMember` in `linkWithCode`; refuse when `discordId` is set and the flag is false; raise `sessionVersion` when the flag goes false | S |
| B-06 | medium | web, link | A Minecraft account is linked by a plain GET with no confirmation | `apps/web/src/app/(app)/link/[code]/page.tsx:18`; `(public)/join/page.tsx:23` | Anyone held in the room sends their own `/link/ABC123` to a member who has not linked yet; one click binds the stranger's account to the member and lets the stranger in | The GET shows "Link <name> to <you>?" with a POST button | S |
| B-12 | medium | modpack | Nothing checks that the lock matches the tree at Build, and the recorded pack comes from `dist/server/PACK_VERSION`, which only `build server` writes. A Build of `config` alone followed by Sync records the old version | `packages/modpack/src/build.ts:63,89`; `apps/api/src/routes/modpack.ts:28`, `players/pack.ts` | Change a file under `modpack/config`, Lock, Build config, Sync: `_packSynced` unchanged | Build recomputes the hash inputs and refuses with "run Lock first"; `recordSynced` reads the lock; Admin warns when the manifest's pack differs from `_packSynced` | S |
| B-13 | medium | api, sync | A Sync that fails after the mods step never restarts and never records; the retry sees "mods: up to date" and does not restart either. The server keeps old jars in memory with new ones on disk until the next sleep or crash | `apps/api/src/modpack/sync.ts:44,55,63,73,85` | Make the config rsync fail after the mods rsync; Sync again | Keep "restart owed" until a start has loaded the synced set | M |
| B-14 | medium | web, modpack | Admin → Lock skips the channel scan and writes nothing for a side-only change. No lock entry has `channels`, so the CI rule that came from the TaCZ kick never fires | `apps/web/src/server/modpack/run.ts:26` (no `jarCache`); `packages/modpack/src/sides.ts:104`; `cli.ts:76-78` | Flip `chunky` to `both` in `mods.json`, Admin → Lock: "unchanged" | One shared write-or-not function for the CLI and the site, with the scan | M |
| B-15 | low | web | The `/join/<code>` invite page offers "Continue with Discord" to people the guild gate will refuse before the invite is looked at | `apps/web/src/auth.ts:121` | Open an invite as someone not in the Discord server | Say so on the page, or look at the invite first | S |
| B-16 | low | web | An expired code of one's own counts as a wrong guess: five old chat links lock a member out for 15 minutes | `apps/web/src/server/link.ts:26-27` | Click five old links | Count only codes that do not exist | S |

### Data, backups and deploy

| ID | Sev | Area | What is wrong | Evidence | How to reproduce | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| B-07 | high | ops, backups | No restore has been proven, for the world or the database. The dumps are on the same disk as the database, unencrypted, never loaded; S3 has never been listed; the NAS-down boot test is "planned, not run"; docs/28 §9 steps 3 to 8 (runner, schedule, Admin → Backups, Discord lines) are not built (`apps/api/src/backup/` does not exist); nothing detects a 22-byte zip or a backup a third too small, both seen on 2026-10-03 | `deploy/docker-compose.yml:33,148`; docs/28 §1, §10 "Restore, tried" unticked; docs/09 runbook "Not rehearsed"; docs/11 "the bucket has not been listed" | Lose the VPS disk: accounts, links, votes and the event log are gone | Now: load the newest dump into `docker run --rm --memory=256m postgres:16-alpine` and count users; copy dumps off the host; list the bucket; unpack one NAS archive into scratch. Then docs/28 §9 | S now, L for docs/28 |
| B-08 | high | deploy | `deploy.sh` pulls `IMAGE_TAG=latest` and never checks that CI finished or that the images match the commit. web and api are pushed minutes apart (11:13:09 and 11:15:53 on `21df993`), and `ci.yml` has no `concurrency`, so an older run can finish last | `deploy/deploy.sh:54`; `deploy/docker-compose.yml:41,93`; `.github/workflows/ci.yml` | Deploy between the two pushes: new api, old web | Default `IMAGE_TAG` to `git rev-parse HEAD`; assert `PORTAL_COMMIT` in both containers after `up`; add a concurrency group | S |
| B-09 | medium | deploy | "deployed." is printed with `api` broken: no healthcheck on api, the script waits for web only, and `/api/health` is `ok` on the database and env alone | `deploy/deploy.sh:122-128`; `apps/web/src/app/api/health/route.ts:25` | Deploy an api image that fails at start | Healthcheck on api; fail the deploy when `api.ok` is false | S |
| B-17 | high | security | A hole in `web` becomes code running as `ladm` on the host with push rights: web mounts `.git` and `modpack/` read-write, and `deploy.sh` runs git in that `.git` as ladm (hooks, `core.fsmonitor`, `core.sshCommand`). The same hole can edit `mods.json` and the lock, which decide what runs on every PC. Not exploited, no hole in web is known | `deploy/docker-compose.yml:53-54`; `deploy/deploy.sh:44-49` | By reading only | Short: `git -c core.hooksPath=/dev/null -c core.fsmonitor= -c core.sshCommand=` in `as_owner`. Proper: web proposes, api or a host step commits; `.git` read-only | S, then M |
| B-18 | medium | security | `web` gets every secret in `.env`, including `AMP_PASSWORD`, `DISCORD_BOT_TOKEN`, the webhooks and `POSTGRES_PASSWORD`, none of which it reads | `deploy/docker-compose.yml:47` | | An explicit `environment:` list for web | S |
| B-19 | medium | deploy | Migrations run inside web at start with no dump before them and no way back; `docker image prune` runs before the health wait | `apps/web/Dockerfile:30`; `deploy/deploy.sh:119` | A migration that fails: web restarts in a loop, the old image is gone | `deploy.sh` dumps when `prisma/migrations` changed; prune after health | S |
| B-20 | medium | ops | The nightly dump fails silently (one echo, then 24 h sleep, no retry), nothing reads the newest dump's age, and its hour moves with every container restart | `deploy/docker-compose.yml:156-161` | Stop the database at dump time | A fixed hour, a retry, the dump's age and size in health | S |
| B-21 | medium | ops | Container logs have no size cap (no `logging:` in compose, no `/etc/docker/daemon.json`); api logs a line per AMP poll | compose file; `apps/api/src/server.ts:56` | Wait | `max-size: 10m`, `max-file: 5` on every service | S |
| B-22 | low | ops | `wireguard:latest` and `alpine/socat:latest` float; Dockhand's redeploy can change the tunnel image unasked | `deploy/docker-compose.yml:70,122,131` | | Pin by version or digest | S |
| B-23 | low | ops | The SSH host key of the AMP host is trusted afresh at every api recreate (`accept-new`, `known_hosts` in the container's own home) | `apps/api/src/modpack/sync.ts:31`; `health.ts:27` | | Mount a pinned `known_hosts`, `StrictHostKeyChecking=yes` | S |
| B-24 | low | ops | Three `deploy/.env.bak-*` files hold old secrets (git-ignored, mode 600). `dockhand-sync.py` sends the whole `.env` over plain http to a tailnet address | `ls deploy/`; `deploy/dockhand-sync.py` | | Remove on Alex's yes; https or drop the copy | S |

### The pack

| ID | Sev | Area | What is wrong | Evidence | How to reproduce | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| B-10 | medium | modpack | Sophisticated Core and Backpacks are pinned below fixes for lost item data and a crash. The pins were meant to come off "at the next ordinary Lock" (docs/11) | Pins `blXGSmAb` (1.5.2.2343), `pJxNzk4X` (3.26.6.2174). Modrinth: Core 1.5.4.2356 `J74ZuoEw` "Fixed backpacks and storages losing item data when migrating worlds; Fixed memory settings crashing"; Core 1.5.5.2363 `nSoNwJfm`; Backpacks 3.26.7.2182 `Igmp9PwW` | | Move both pins together or unpin, start the server once | S |
| B-25 | medium | modpack | NeoForge floats (`"neoforge": "latest"`): each Lock can bump it, PCs follow, nothing moves the server. Today: server loaded 21.1.252, live lock 21.1.253, maven 21.1.255 | `modpack/mods.json`; `modpack/server-loaded.json`; maven metadata | Lock twice a week apart | Pin NeoForge in `mods.json`; bump it together with AMP | S |
| B-26 | medium | modpack | Lock refuses the whole pack when a both-sided mod needs a client-only library (Rechiseled → Fusion). A votable mod that wins stops the Lock | `packages/modpack/src/sides.ts:50-52`; docs/11 line 201 | Enable `rechiseled`, Lock | Keep such a library client-side, or mark those mods not votable | S |
| B-27 | medium | modpack | "Newest release" leaves mods on old releases while fixes ship as betas: Industrial Foregoing 3.6.27 (2025-04) against ten betas to 3.6.39, on a 2026 Titanium; Create Crafts & Additions 1.6.0 against 1.7.2; JEI | `packages/modpack/src/lock.ts:47`; Modrinth versions | | Warn when a beta is months newer than the release; pin deliberately | S |
| B-28 | low | modpack | Vanillin is in the base pack and needs Create's bundled Flywheel, but `requires` is empty and lint does not check that required mods are on. Its Modrinth page says it is incompatible with shaders, and Iris with two shader packs is offered as extras | `modpack/mods.json` (`flw-vanillin`); docs/11 line 623 | Vote Create out | `requires: ["create"]`, the lint rule, a note on the Iris extra | S |
| B-29 | low | modpack | Ender Dragon Fight Remastered is server-only but its jar carries 6.5 MB of sounds PCs never get, so the fight's own music and sounds are silent | The jar: `assets/endfight/sounds`, no classes; Modrinth client `optional` | Fight the dragon | Make it `both` before Season 1's finale, or accept | S |
| B-30 | low | modpack | `hashResourcePack` hashes `README.md`, which Build leaves out, so a README edit changes the pack version; `buildServer` never removes a file dropped from `modpack/server/defaultconfigs/` | `packages/modpack/src/lock.ts`, `build.ts` | | Same file list for hash and Build; clean the folder | S |
| B-31 | low | modpack | The load estimate is saturated: 52 visible client mods total 70 points and Heavy starts at 15. Cataclysm (73 MB) and Mowzie's (36 MB) are rated M | `modpack/mods.json` | Open the ballot | New bands, or rate by measured memory | S |
| B-32 | low | modpack | The live OPAC server config was edited by hand (docs/26) and the repo ships it only as `defaultconfigs/`, so the repo is not its source | docs/26; `modpack/server/defaultconfigs/` | Rebuild the world | Ship it under `config/` or record the live copy | S |

### The portal

| ID | Sev | Area | What is wrong | Evidence | How to reproduce | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| B-33 | low | web | Two routes are public because the middleware skips image extensions: item icons and the admin logo previews | `apps/web/src/middleware.ts:24`; `app/items/icon/[...path]/route.ts`. Live: `GET /items/icon/minecraft/stone.png` without a cookie → 200 | As the evidence | `loadCurrentUser()` in both routes | S |
| B-34 | low | web | A mod ballot's closing time is read as UTC, not UK time: an hour late until 25 Oct | `apps/web/src/app/(app)/admin/votes/actions.ts:34` (polls use `ukLocalToDate`) | Set a closing time | `ukLocalToDate` | S |
| B-35 | low | web | An email-fallback member made admin has a password-only admin login, which docs/04 says does not exist | `admin/users/actions.ts:18`; `auth.ts:57-74` | Promote an email account | Refuse `credentials` for ADMIN | S |
| B-36 | low | web | A player's page shows countries, sessions and ping to every member whatever "Stats visible to players" says | `apps/web/src/app/(app)/players/[uuid]/page.tsx:87,111` | Switch the setting off, open a player page as a member | Apply the switch there | S |
| B-37 | low | web | Removing a member is not a ban: their next Discord sign-in makes a new account | `admin/users/actions.ts:42`; `auth.ts:137` | Remove someone who is still in the Discord server | A blocked-id list, or say so on the button | S |
| B-38 | low | web | Install reports: personal names are not blanked on arrival (docs/07 says they are); the body is read whole before the size check when there is no `content-length` | `apps/web/src/app/api/installer/report/route.ts:28-40` | | Pass the names; cap the stream | S |
| B-39 | low | web | `/api/health` is public and names tunnel, AMP, rsync and bot state and missing env variables | `app/api/health/route.ts:26` | `curl` it | Details for admins only | S |
| B-40 | low | web, tests | The four-day empty Activity log would still not be caught: the test checks the shape of the query object, no test runs against a real Postgres, and CI never applies the migrations | `apps/web/tests/event-query.test.ts:42`; `ci.yml` has no postgres service | Put the old clause back: tests pass | A CI job with `postgres:16`, `prisma migrate deploy` and a few real queries | M |

### api and the console

| ID | Sev | Area | What is wrong | Evidence | How to reproduce | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| B-41 | medium | api, AMP | Login is not single-flight and the tail tracks sessions by a counter. Two logins that overlap can make ~40 old console lines count as live: joins handled again, chat and deaths doubled in the log and in Discord. The 2026-09-29 incident class; unlikely on any one day | `apps/api/src/amp/client.ts:99,108-109,121-122`; `amp/console.ts:147-158` | Two calls meet a dead session at once | One shared login promise; the tail compares the session id it used | S |
| B-42 | low | api | Pre-generation can leave AMP's sleep off for good: `setSleep`'s result is ignored and `sleepWas` cleared; `tick` has no guard against overlapping | `apps/api/src/status/pregen.ts:274,353,491-494` | AMP out of reach at the window's end | Keep `sleepWas` until a read confirms; a busy flag | S |
| B-43 | low | api | Sessions are left open or go missing when a join or leave happens during an api restart (the replayed line is ignored and nothing reconciles) | `apps/api/src/events/recorder.ts` | Leave during a deploy | Reconcile against the `list` answer | S |
| B-44 | low | api | Reply matchers take any matching console line: a ground clear can report "Cleared 0 items" from an unrelated "No entity was found" | `apps/api/src/events/parse.ts` (`killReply`, `invReply`) | Clear items while a verified member joins | Match the reply to the command by order or marker | S |
| B-45 | low | api | A logo pick runs `build config` and `build server` under its own flag, beside a Build or Sync; Sync and Build write no event, only a log line | `apps/api/src/routes/branding.ts`; `routes/modpack.ts` | Pick a logo during a Sync | The one modpack lock; an audit row | S |

### Discord

| ID | Sev | Area | What is wrong | Evidence | How to reproduce | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| B-46 | medium | bot, feed | Lines are posted twice after an api restart: the cursor is saved only at the end of a round and `stop()` neither waits nor saves. Pending "left" lines, "The server is back." and death runs are lost. docs/22 §11 says nothing is posted twice | `apps/api/src/discord/announcer.ts:128-131,163-209`; `apps/api/src/index.ts:10` | Deploy while people chat | Save the cursor per delivered event; `stop()` awaits the round | M |
| B-47 | medium | bot | Privileged intents are never retried after one refusal, though docs/22a says the bot picks them up at its next reconnect. Chat from Discord and member-left events stay dead until api restarts | `apps/api/src/discord/gateway.ts:29,152,205-207` | Start with the intents off, switch them on | Try the full set on each fresh identify | S |
| B-48 | low | bot | The health card forgets a failure: one 20-line log for all channels, so chat lines push the admin channel's failed send out and the card reads "ok" | `announcer.ts:216,356` | Fail an admin send, then 20 chat lines | Keep the last send per channel | S |
| B-49 | low | bot | A retried event changes state before the send succeeds: death counts inflate after an outage, "The server is back." can be skipped | `announcer.ts:378-395,421-423` | Discord down during a death | Change state after the send | S |
| B-50 | low | bot | An unlinked Discord user can take any nickname, a member's or Alex's, and it shows in game chat exactly as a linked name would | `apps/api/src/discord/bot.ts:237`; `actions/registry.ts:544` | Nickname "Bramble09" in #game-chat | Mark unlinked names, or refuse a nickname equal to another member's Minecraft name | S |
| B-51 | low | bot | A vote post made again after the poll closed carries live buttons; with the card's forum differing from the webhook's, every reply makes another post | `announcer.ts:560,582-587` | Delete a closed vote's post, let the result be sent | Pass the closed state; compare the channel ids | S |
| B-52 | low | bot | A member who left while the gateway was down can play for up to 5 minutes; that check calls Discord directly, outside `rest.ts`, with no 429 handling | `apps/api/src/players/limbo.ts:383-395` | | Check at join when the flag is older than the last READY | S |
| B-53 | low | bot, tests | `discord-bot.test.ts:135` "nothing replayed twice" asserts on a fake that never replays; no test covers interactions, incoming messages, member-removed, op 7 or op 9. Everything was built against a stand-in and the live reconnect night is unreported | `apps/api/tests/discord-bot.test.ts` | | Tests with a replaying fake | M |

### The launcher

| ID | Sev | Area | What is wrong | Evidence | How to reproduce | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| B-11 | medium | bridge 2.2.0 | Once `handover.json` exists and the exe checks out, every Play hands over to the exe before anything else. If the exe does not come up on that PC there is no way back to playing as 2.x. And while the site offers the exe the script never updates itself, so a fixed bridge cannot reach those PCs. The logic is confirmed; what would stop the exe on a real PC is not | `installer/DeepslateWorks.ps1:538-551,4843-4851`, ~4898 | Write `handover.json` (state `downloaded`), deny execute on the exe, press Play twice | Count tries; after two with no progress drop the file and carry on as 2.x; let the script update first | M |
| B-54 | medium | app 3.4.2 | A refused copy cannot update (docs/10 item 17, confirmed in code), and a new exe that starts and then fails has already deleted its predecessor, so a bad release cannot be recalled | `installer/app/src/Engine/Engine.cs:91,113`; `Home/SelfUpdate.cs:77-82`; `App/Program.cs:51` | Ship an exe that dies after start | Item 17; delete `.old` only once the window is up | M |
| B-55 | medium | app 3.4.2 | "Ready" never goes stale: with the app left open and the pack changed, Play starts the old mods and the server refuses them | `installer/app/src/Ui/AppUi.cs:370`; `Engine.cs:447,455` | Leave the app on Ready, Sync a new pack, press Play | In `Go(true)`, start a fresh run when ready is older than ~10 minutes or an update is known | S |
| B-56 | medium | app 3.4.2 | A WMI query and a full read of the game log run on the UI thread every 2 s while the window is open, beside the game. Path confirmed, cost on a weak PC not measured | `AppUi.cs:633,694-701`; `Extras/ExtrasGame.cs:50-61`; `PackMods.cs:163-170` | Play on a LOW-tier PC with the window open | Background thread, 5 to 10 s, read the log's tail | M |
| B-57 | low | app 3.4.2 | One failed mod download ends the run with "Something went wrong": no retry, no "check your internet" | `Engine.cs:47-50,243`; `Http.cs` | Drop the connection during a download | Two or three retries; a network message | S |
| B-58 | low | app 3.4.2 | A half-extracted Java is accepted on the next run | `Java.cs:112-115`; `Engine.cs:183-186` | Close the window during the Java step | Extract to `runtime.new`, rename | S |
| B-59 | low | app 3.4.2 | Manifest file names are used unchecked (`..\..\x` writes outside `mods\`). The source is our own site | `Engine.cs:235-237` | | Accept only `Path.GetFileName(name)` | S |
| B-60 | low | app 3.4.2 | `launcher_profiles.json.bak` is overwritten at every write, so the copy from before Deepslate is gone after the second Play | `Launcher.cs:114` | Play twice | Keep the first copy under its own name | S |
| B-61 | low | CI | Nothing forces a bump of `installer/VERSION`: two pushes at 3.4.2 publish different exes, and PCs on "3.4.2" never take the second. Also the Node 20 deprecations and xUnit2029/2031 (docs/10 item 11); several tests assert on source text | `.github/workflows/installer.yml`; `PackModsTests.cs:98-100` | | Fail the workflow when `installer/app` changed and VERSION did not | S |
| B-62 | low | PR 3.5.0 | With the launcher open, any difference in Java arguments now fails Play ("Close the Minecraft Launcher"); on `main` the same PC plays | PR #91, `Engine.cs` | Change memory in Settings with the launcher open | Launch, and say the memory applies after the launcher is closed | S |
| B-63 | low | PR 3.5.0 | `GameOptions.WriteOver` deletes `options.txt` before moving the new one in; a kill between loses every keybind | PR #91 | | `File.Replace`, as `MoveOver` does | S |

The failed installer run on PR #91 (`37201702406`) was a test fault, not a product one: the smoke test set the memory slider to 8 on an 8 GB runner whose slider ends at 4. Fixed in `1c93a412`; the rerun is green.

### Tests

| ID | Sev | Area | What is wrong | Evidence | Proposed fix | Size |
|---|---|---|---|---|---|---|
| B-64 | low | api tests | A wall-clock assertion (`< 1200` ms around a child process) and real sleeps: will flake on a loaded runner or in `check.sh` on a swapping VPS | `apps/api/tests/build.test.ts:61-65,85,133` | Fake timers | S |
| B-65 | medium | tests | No test for what has broken or would hurt most: `Limbo.resync`, hold → leave → rejoin, `refreshGuild`, `syncServer` and `recordSynced`, concurrent AMP logins, `linkWithCode`, the `/downloads` gate, the middleware matcher, the admin check on `/api/admin/*`, `deploy.sh`, the dump loop, `drift.ts` | named files have no test | Tests with each fix above | M |

## Suspected, not proven

| ID | Sev | Area | What may be wrong | Evidence | What would prove it | Proposed fix | Size |
|---|---|---|---|---|---|---|---|
| S-01 | medium | api, Discord | The guild refresh reads any 404 as "left the Discord". If Discord answers Unknown Guild with 404 (bot removed, wrong guild id), every online linked player is unflagged, unwhitelisted and kicked within 5 minutes | `apps/api/src/players/limbo.ts:390-393` | Discord's status and body for that case | Require JSON `code === 10007` | S |
| S-02 | medium | bot | The gateway can loop on a dead resume address for ever, and has no timer for "open but no Hello" | `apps/api/src/discord/gateway.ts:93,123,219` | A night of real reconnects | Clear the session after three failed resumes; a 30 s watchdog | S |
| S-03 | low | api | A chat entry whose Source AMP does not fill as a plain name falls through to the system-line patterns; typed text "UUID of player X is …" could then bind a member's UUID to X | `apps/api/src/events/parse.ts:319-321` | An AMP chat entry with such a Source | When the type is chat, parse as nothing else | S |
| S-04 | low | web | `safeNext` lets `/\host` through, an open redirect by way of onboarding | `apps/web/src/server/auth/next-url.ts:6`; `onboarding/actions.ts:15,20` | `/onboarding?next=/%5Cevil.example` on a test build | Refuse `\` and control characters | S |
| S-05 | low | web | After signing in from the map host, the `next=https://map…` target is probably dropped (Auth.js's default redirect keeps to the base URL) | `apps/web/src/auth.config.ts`; `(public)/login/actions.ts` | Sign in from the map host signed out | A `redirect` callback using `safeNext` | S |
| S-06 | low | deploy | The portal's session cookie is passed on to BlueMap's web server inside the game JVM | `deploy/Caddyfile.snippet` (the live Caddyfile is under `/root`) | Read the live block | `header_up -Cookie` | S |
| S-07 | low | deploy | If `deepslate-wg` restarts alone, `api` and the inner map relay keep a dead network namespace until recreated | `network_mode: service:wireguard` | Restart wg alone on a quiet night | A healthcheck that recreates, or restart them together | S |
| S-08 | low | web | The live console stream strips `\n` but not a bare `\r`, which ends an SSE line | `apps/web/src/app/api/admin/console/route.ts:26` | A console line with `\r` | Strip it | S |
| S-09 | low | modpack | FallingTree's own page lists VeinMiner as a reported incompatibility; the pair was never tried on a tree (docs/06) | FallingTree's Modrinth description | Chop a tree with both | Ship `/veinminer groups remove Wood` if needed | S |
| S-10 | low | modpack | ServerCore's activation range has no exclusions for Cataclysm's or Mowzie's bosses: a boss more than 32 blocks from every player ticks once a second | `modpack/server/config/servercore/config.yml` | One boss fight at range | Add the boss entity ids | S |
| S-11 | low | modpack | The starter kit given on the tick a player is dead goes into a dead inventory and is lost | `modpack/datapacks/deepslate-tools` kit functions | Die at the moment of release | Give only to living players | S |
| S-12 | low | bot | A double click on a vote button can throw a unique-key error ("Something went wrong") though the vote is stored; a result edit in an archived forum post may be refused | `apps/api/src/shared/polls.ts:147`; `announcer.ts:606-613` | Live Discord | Catch the conflict; reply first, then edit | S |
| S-13 | low | api | A crash followed by AMP's own restart is recorded as a restart, so no CRASH row | `apps/api/src/events/recorder.ts` | AMP's auto-restart setting, and a crash | Read the crash line before settling | S |
| S-14 | low | PR 3.5.0 | One out-of-range value in the settings block makes the server reject the whole report, including the "ok" that Play first counts | PR #91, `settingsSchema` | An unusual `options.txt` | `.catch(null)` on the block | S |
| S-15 | low | world | 87 "Block-attached entity at invalid position" lines on 2026-10-04 at (-67,5,289), (-245,5,155), (-103,5,298): item frames or paintings in a generated structure. Logged, not fixed | docs/33 §2 | Read the game log | Alex can kill them from the admin console if the spam grows | S |

## Looked at and found sound

- **No free text from a player reaches the console.** The only `SendConsoleMessage` outside tests and docs is `apps/api/src/actions/run.ts:32`. Every player-derived argument in the registry is a validated name, code, number or enum; Discord chat, poll text, site name and tagline go through `JSON.stringify` with control characters and `§` refused. `console.send` is admin only, one line, 5 a second, audited on every outcome.
- **Downloads are not public**: an allow-list of four names, a launcher token or a checked session, the gate, a constant-time key for `config.zip`. Checked live for the exe, the manifest and the map.
- **Every `/api/admin/*` route and every admin page and server action** checks the role itself.
- **Admin password and TOTP, one-time links, invites, the launcher's device flow, ballots and polls, markdown, SVG upload, CSV export, the file explorer's path rules.**
- **api's service token** (global hook, timing-safe), **AMP client** (10 s timeout on every call, one retry), **console tail dedupe**, **backup watch**, **NBT readers**, **join codes**.
- **Discord**: `allowed_mentions` empty on every message, markdown escaped, no echo loop, interactions checked for guild and role on the server side, 429 handling, secrets never logged or returned.
- **Launcher**: the `deepslate://` handler takes only `deepslate://play`, the site host is built in, updates are checked by size, SHA-256 and version, mods by SHA-512 through a staging folder, zip-slip guarded, reports redacted on the PC and again on the server.
- **Sides**: every lock entry agrees with Modrinth today; no client-only mod goes to the server and no server-only mod to PCs; the nine server-only jars register no required channels.
- **Datapacks**: valid for 1.21.1, five `@a` passes per tick and no `@e` scan, the kit's tag set last, spawn's adventure mode undone on walking out, logging out, dying and changing dimension. One deviation from docs/27 is recorded in the function itself (the claim plus 5 blocks).
- **Compose**: a memory limit and restart policy on every service, the database publishes no port, web is not in the tunnel's namespace, no build on the host, no `chown -R` over `deploy/` or the root, all git in `deploy.sh` as the owner.
- **Nothing secret in git history** (marker hits are placeholders and test strings).

## Drift between the lock, the catalogue and the server

| Check | Result |
|---|---|
| Enabled in `mods.json` but not locked | none (67 enabled, 74 locked) |
| Locked by dependency only | balm, craft-config, guideme, kotlin-lang-forge, placebo, titanium |
| Locked though `enabled: false` | `rpl` (pulled in by Create Big Cannons) |
| Loaded by the server, not in the lock | none |
| In the lock for the server, not in the loaded list | KotlinLangForge and ScalableCatsForce (a language provider and a wrapper; probably not listed as mod files, not confirmed) |
| Version differences by file name | none in 60 jars |
| NeoForge | server loaded 21.1.252 (start of 2026-10-03 19:33), `main`'s lock 252, the live lock 253, maven 255 |
| The lock on `main` against the live one | `d7521da9` against `0d33a462` (B-01) |

`modpack/server-loaded.json` is the start of 2026-10-03 19:33 UTC. What the instance holds now is in the AMP host paste.

Newer versions on Modrinth for NeoForge 1.21.1: only the two Sophisticated mods have newer releases (B-10). Betas newer than the locked release: Industrial Foregoing 3.6.39 (`7otXKx1D`), Create Crafts & Additions 1.7.2 (`hsjVajlP`), JEI 19.57.0.450 (`Tn0dgwL0`). Extras with newer releases: makeup-ultra-fast-shaders 9.5g, entity-model-features 3.3.10, entitytexturefeatures 7.2.5. At the newest build already: Create, TaCZ, Sodium, ServerCore, Cataclysm, Mowzie's, EDF, BlueMap, Chunky, AE2, Immersive Engineering. Noisium is unlisted on Modrinth and unchanged since 2024-08.

## Docs that say one thing while the code does another

- `docs/02` line 18 and `docs/11` "Where things are": dumps "keep 7"; compose keeps 14.
- `docs/04`: the launcher token is "good for three things"; it is also taken for poll votes, wake, an admin's Start, the app's home, heads, news pictures, extras and updates. And "no password-only path" for admins (B-35).
- `docs/07`: the exe is "about 280 KB" (CI builds about 770 KB); "if the new exe cannot start, `.old` is put back" covers only a failed start call (B-54); "on any problem the run carries on as 2.x" does not hold once `handover.json` exists (B-11); names blanked on arrival (B-38). The pack list file is `pack.json` in code, `pack-list.json` and `packlist.json` in comments.
- `docs/09`: the Caddy block shows `forward_auth` with `handle_errors`, the snippet uses `reverse_proxy` with `handle_response`; "`DISCORD_BOT_TOKEN` is not in the example" (it is); health "db + AMP reachability" (AMP is not required); the nightly AMP backup "not known here" (docs/11 has the 01:00 trigger).
- `docs/12`: a 15 s status poll; it is 10 s. `docs/14`: the prompt "every 60 s"; it is 15 s.
- `docs/13` line 134: the rsync health check as `ssh … true`; the code runs `rsync --list-only`.
- `docs/22` §3: "only `rest.ts` and `webhook.ts` call Discord"; `limbo.ts:388` does too. §13: news keeps a `news:<id>` row; none is saved. `docs/22a` line 56 (B-47).
- `docs/27`: the adventure area is the claim; it is the claim plus 5 blocks (recorded in the function).
- `docs/28` §4.4, §4.7: the `backups` settings section and the `/dbdumps` mount do not exist yet (not built, rather than drift).
- `the working rules`: "SendConsoleInput"; the call is `Core.SendConsoleMessage`. `.env.example`: `SERVER_ADDRESS` "What Pangolin publishes".
- `ROADMAP.md` "In progress" still lists the 2026-09-29 items as not started (docs/10 item 13), and neither it nor `docs/11` records the "We're live" click.
- `docs/10` P0 item 4 (Pabulum): after go-live one Play should move him on; not confirmed.
- 71 remote branches, among them the throwaway `work/options-fixture` with a workflow that has `contents: write`.

## Needs root on the VPS (read-only, for the next session that has it)

```
# what runs, and from which commit
docker ps -a --filter name=deepslate- --format '{{.Names}}\t{{.Status}}\t{{.Image}}'
docker exec deepslate-web printenv PORTAL_COMMIT; docker exec deepslate-api printenv PORTAL_COMMIT

# B-01: who has been held, and why
/root/.config/deepslate/api.sh GET '/events?kind=ADMIN&q=join.blocked'     # or Admin → Activity, words "wrong version"
docker logs --since 2026-10-04T00:00:00 deepslate-api 2>&1 | grep -iE 'wrong version|held|resync' | tail -50

# errors and warnings since go-live
for c in deepslate-web deepslate-api deepslate-wg deepslate-backups deepslate-db; do
  echo "== $c"; docker logs --since 2026-10-04T00:00:00 $c 2>&1 | grep -iE 'error|warn|unhandled|ECONN|timeout|⨯' | sort | uniq -c | sort -rn | head -30; done

# the game console, TPS and memory, install reports (the api's read-only routes)
/root/.config/deepslate/console.sh | grep -iE "ERROR|WARN|Can't keep up|Exception|crash" | tail -80
/root/.config/deepslate/api.sh GET /status
/root/.config/deepslate/api.sh GET /installs | head -100          # outcomes other than ok since 2026-10-04

# dumps (B-07, B-20)
ls -la --time-style=full-iso /root/docker/deepslate/backups; gzip -t /root/docker/deepslate/backups/deepslate-2026-10-0*.sql.gz
docker logs --tail 20 deepslate-backups

# logs on disk (B-21), the tunnel, the proxy (S-06), web's .git (B-17)
du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail
docker exec deepslate-wg wg show wg0 | grep -vi private
sed -n '/deepslate.dsw.test/,/^}/p' /root/docker/web-proxy/etc/Caddyfile
docker exec deepslate-web sh -c 'ls -la /repo/.git/hooks; grep -nE "fsmonitor|sshCommand|hooksPath" /repo/.git/config'
journalctl -k --since -7d | grep -i 'killed process'; free -m; df -h /
```

The restore rehearsal (B-07) makes and removes one throwaway container, so it is not strictly read-only: `docker run --rm --memory=256m postgres:16-alpine`, load the newest dump, `select count(*) from "User"`.

## For the AMP host session: the complete paste

```
You are the tooling session on the AMP host (amp-01v) for Deepslate Works. This is a read-only check for a
review written on the VPS on 2026-10-04 (docs/31-review-and-bug-list.md, docs/32-seasons-1-to-4-roadmap.md).
The game is live and friends are playing. Do not restart, stop, sync, update, delete, move or edit anything,
in AMP or on the host. Do not run a backup and do not restore over anything. If a check needs a write, skip it
and say so. Never print secrets: no keys, no passwords, no S3 credentials, no WireGuard private key.
Report back as one message with a heading per number below: what you ran, what it showed, and "not checked"
with the reason where you could not.

1. The pack on the instance (the portal says the server runs 0.1.0+0d33a462; main's lock is d7521da9).
   - List <instance>/Minecraft/mods with size and sha1 of each jar (sha1sum), and the count.
   - The NeoForge version the server actually starts (the libraries folder and the first lines of
     logs/latest.log: --fml.neoForgeVersion). Expected 21.1.252 or 21.1.253: say which.
   - Is there a PACK_VERSION file in the instance root, and what does it say?
   - Does a resource pack or the villager texture exist on the server side (config/, resourcepacks/, or
     server.properties resource-pack=)? Only say what is there.

2. The game's own log since go-live (2026-10-04 00:00 UTC).
   - From logs/latest.log and the rotated logs of 3 and 4 October: counts and the 40 most common lines
     matching ERROR, "Can't keep up", "Exception", "moved too quickly", "lost connection", "Disconnecting",
     "channels" (mod mismatch at the handshake), "wrong version". Give counts per player name for
     disconnects, no chat lines.
   - ls -la crash-reports/ and the first 30 lines of any report dated 3 or 4 October.
   - The start times in the log (lines with "Done (") and the time to Done for each.
   - If spark is answering from files: the newest spark profile or health report in the instance folder
     (do not send a console command for it).

3. Memory and CPU of the instance: the Java process's flags (-Xmx, -Xms, GC), its resident memory now,
   the host's free memory, swap in use, load average, and dmesg / journalctl -k for "Killed process" in the
   last 7 days.

4. Disk: df -h for the instance disk and for each NFS share; du -sh of the instance, of world/, of
   world/dimensions/, of bluemap/, of the backup folder on the NAS. The roadmap adds one pre-generated
   dimension of radius 3,000 blocks per season with its own map: say how much room there is for that.

5. NFS: findmnt -t nfs,nfs4; the matching /etc/fstab lines (options: hard or soft, nofail, x-systemd);
   whether the backup folder is on the share right now; what AMP would write to if the share were not
   mounted (is the mount point an empty directory on the local disk?). Do not unmount anything.

6. AMP's backups (docs/28).
   - Backups.json for the instance: for each entry name, time, total and compressed size, StoredLocally,
     StoredRemotely. Mark any entry under 1 GB or more than a third smaller than the one before it.
   - ls -la --time-style=full-iso of the backup folder on the NAS; any zip not named in Backups.json
     (orphans), including a 22-byte one from 2026-10-03 21:21.
   - unzip -tq on the newest zip (read-only test). Say how long it took.
   - The triggers in scheduleTimes.json: the interim nightly one (id 6db1e248-…, MatchHours [1], Local and
     S3 true) and that the old hourly one is off. Did the 2026-10-04 03:00 run and, if it has happened by the
     time you read this, the 2026-10-05 01:00 run finish, with StoredRemotely true?
   - S3: if a list-only key is in place, list the bucket (names, sizes, dates, count; at most 40 expected)
     and confirm the newest object's size equals the local zip's. If no such key exists, say so; do not use
     AMP's own write key from a shell.
   - What is excluded from the backup (bluemap/, world-backup-20260929, tacz_backup) and that logs/ and
     crash-reports/ are in.
   - Has any restore ever been done on this host, to any folder? If there is room on a scratch path that
     is not the instance, say how much, so a restore test into scratch can be planned. Do not do it now.
   - Is there a status.json as docs/28 §3 F describes, how old is it, and does it hold anything secret?

7. The deploy key and rsync: the authorized_keys line for the portal's key in the amp user's home (print
   the options and the command, not the key): command="/usr/bin/rrsync … /Minecraft", restrict,
   from="10.77.0.1" expected. File modes and owner of .ssh. sshd -T for that user and address:
   passwordauthentication, permitrootlogin, allowtcpforwarding.

8. WireGuard: wg show (no private key): the peer's allowed IPs (10.77.0.1/32 expected), last handshake,
   keepalive. sysctl net.ipv4.ip_forward. The firewall rules that confine the tunnel (nft list ruleset or
   iptables -S, only the parts naming wg0 or 10.77.0.0/24). What on this host listens on addresses the VPS
   can reach (ss -ltnp), and which of those the rules allow.

9. mc-router (docs/17): image and tag, restart policy, its mappings (mc.dsw.test, boys.dsw.test,
   vanilla.dsw.test), uptime, and the last 50 lines of its log for errors. Voice chat's UDP port (24454):
   is it forwarded and listening?

10. The AMP users: the roles and permissions of the portal's user (webapp): confirm it still cannot do more
    than start, stop, restart, console, read files, backups and the sleep setting, and say whether it has
    Settings.MinecraftModule.Minecraft.ViewDistance, .SimulationDistance and .ServerMOTD (docs/10 item 10).
    Does any AMP user that the portal uses have file DELETE rights? (The season roadmap needs to know who
    would delete world/dimensions/deepslate/frontier_s1 at a season's end: the answer today should be
    "nobody but Alex".)

11. Server files the repo should own but may not.
    - diff of <instance>/Minecraft/config/openpartiesandclaims-server.toml (or the world's serverconfig
      copy, say which exists) against the repo's modpack/server/defaultconfigs/openpartiesandclaims-server.toml
      if you have the repo; otherwise print the file without comments.
    - config/waystones-common.toml or waystones-server.toml: the lines about travel between dimensions
      (dimensionalWarp or similar) and their values.
    - config/servercore/config.yml: the activation-range section's excluded entities.
    - server.properties: view-distance, simulation-distance, function-permission-level, spawn-protection,
      level-name, white-list, enforce-secure-profile, max-players, motd.
    - bluemap: the list of map configs (config/bluemap/maps/*.conf) and whether any names deepslate:limbo.
    - world/datapacks: the list, with dates.

12. The world's shape on disk: ls of world/dimensions/ (each namespace and dimension with du -sh), the
    region file count of the overworld, and whether world/playerdata has a file per player who has joined
    since the reset (count and newest date only, no contents).

13. Anything else you see on this host that looks wrong for a live server: a full disk, a failing unit
    (systemctl --failed), a pending reboot, an AMP update waiting, clock drift (timedatectl), an expiring
    certificate.
```

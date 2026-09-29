# 10 · Roadmap and acceptance criteria

Work top to bottom. A phase is done when every box in its "Done when" list is true and Alex has clicked through it on the VPS. Then commit a tag `phase-N`.

**State on 2026-09-29, 19:00 UTC.** A box is ticked only with what shows it, in italics after it. `phase-0` is tagged. Phases 1 to 3 are built and in daily use, each with one or two boxes that need a person to click through; the planner's additions (docs/14 joining, docs/16 analytics and event log, docs/17 mc-router, docs/18 guide) are built too. Phase 4 has not begun, apart from what the entrance room brought forward. The detail, and what came in between, is in `docs/11-status.md`; the same for people who are not building it in `ROADMAP.md`.

## Phase 0 · Foundation

Build:
- pnpm workspace, Next.js app, Prisma schema from 03, migrations, seed script (one admin from `ADMIN_DISCORD_ID`).
- Auth.js with Discord + credentials, invite flow from 04, onboarding (Minecraft username → UUID via Mojang, PC tier).
- `deploy/` compose + Caddyfile + `.env.example`; CI: lint, typecheck, test.
- `apps/api` skeleton with `/health` and the service-token middleware, wired into compose with the `wireguard` container and map relays (docs/13).
- Layout shell: top nav (Home, Mods, Vote, Install, Map, Players, Admin for admins), phone-friendly, dark and light themes.

Done when:
- [x] `docker compose up -d` on the VPS serves the site over HTTPS. *Since 2026-09-28; deployed by `deploy/deploy.sh` since 2026-09-29.*
- [x] Alex logs in with Discord and lands on an admin page. *Daily since 2026-09-28.*
- [ ] An invite link lets a second Discord account in; a third account without an invite is refused with the right message. *Not clicked through: members come in through the Discord server (`DISCORD_GUILD_AUTO_JOIN=1`), and one invite was made, for kanefinch, who joined by it on 2026-09-29. The refusal has not been watched.*
- [ ] The email/password fallback works for one invite. *Sign-in with email and password is used by every test script; through an invite, not clicked through.*
- [x] `/api/auth/verify` returns 200 with a session cookie and 401 without. *The map host sends a visitor without a session to the sign-in page and shows the map to one with a session.*
- [x] `/api/health` reports `tunnel: ok` once the AMP host side is up. *Every deploy prints it.*

## Phase 1 · Catalogue and vote

Build: `/mods`, `/vote`, `/vote/results`, `/admin/votes`, manifest loader, `modpack lint`, `modpack verify-links`. Populate `mods.json` from 06 with verified slugs, wikis and real video links.

Done when:
- [x] Every mod card has a working Mod page link, Wiki link and at least one real video link (`modpack verify-links` passes). *Lint: 40 mods, no errors, no warnings (2026-09-29).*
- [ ] A player can submit a ballot on a phone in under two minutes and edit it later. *Four ballots are in; whether any came from a phone is not known.*
- [x] Exclusive group (guns) allows one choice; load estimate updates live and warns LOW-tier users about Heavy sets.
- [x] Results page shows per-mod yes % and per-tier breakdown; closing freezes results.
- [ ] "Apply results" produces a diff of `mods.json` and commits it on confirm. *Built; never run on a closed vote. The vote is still open; the recommended mods were switched on by hand on 2026-09-29, and applying the result will be the first real run.*

## Phase 2 · Modpack and installer

Build: `modpack lock`, `build client|server|installer`, `sync-server`; `/install`; `/admin/modpack`; `installer/` per 07.

Done when:
- [x] `modpack lock` resolves every enabled mod plus dependencies for NeoForge 1.21.1 and fails loudly on any mod without a compatible version. *32 files, 2026-09-29.*
- ~~`client.mrpack` imports into the Modrinth App~~ struck 2026-09-29: Windows only.
- [x] On a clean Windows VM with only the launcher installed: run `Setup.bat`, open the launcher, choose the profile, press Play, reach the main menu, see the server in the list. Under five minutes on a normal connection excluding downloads. *On two real PCs, not a VM: Alex's (2026-09-29 morning) and Pabulum's (18:08 UTC, after installer 1.4.1 fixed the Java step; he joined four minutes later).*
- [ ] Rerunning the installer with no changes prints "already up to date" and changes nothing; after bumping one mod it replaces exactly that jar. *Alex's Play runs go through quickly; nobody has watched the one-jar case.*
- [x] `sync-server` puts the same jar set on the AMP instance; the server starts and a client built from the same lockfile connects. *Sync from Admin → Modpack; bramble09 and samoyedx on the same pack, 2026-09-29.*
- ~~Alex's Mac gets in via `.mrpack`~~ struck 2026-09-29: Windows only.

## Phase 3 · Server dashboard

Build: AMP wrapper + poller + `ServerSnapshot`, home page, `/map` with BlueMap behind `forward_auth`, `/players`, `/admin/server`, announcements. Add BlueMap to the server pack.

Done when:
- [x] Home shows Online/Offline correctly within 20 s of a real change, player names with heads, TPS and memory. *Poll every 10 s, page every 10 s; watched through starts, sleeps and stops on 2026-09-29.*
- [x] The map loads at `map.<domain>` only when logged in; logged out redirects to login and back. *302 to `/login?next=…` without a session (checked 2026-09-29 18:4x UTC). The map itself is empty since 18:36 UTC and is to be rendered again from Admin → Server.*
- [ ] Admin restart with a 5-minute countdown warns in game every minute and restarts on time. *One with one minute ran on 2026-09-29 18:26 to 18:27 UTC, on time; the five-minute one has not.*
- [x] Console tail streams live for admins; players cannot reach it. *403 for a player, checked by the smoke test.*
- [ ] `/api/health` is green and monitored. *Green; whether anything outside watches it is for Alex to say.*

## Phase 4 · Player self-service

Build: action registry, `/me`, `/admin/actions`, FTB Essentials on the server, stats reader.

Done when:
- [x] A new player can whitelist themselves and join without asking Alex. *Brought forward as the entrance room (docs/14): samoyedx joined, waited in the room, linked on the site and was let in and whitelisted, 2026-09-29 18:12 to 18:16 UTC.*
- [ ] Home / set home / spawn / where am I / kill work for an online player and return a clear one-line result; each is rate limited and audited.
- [ ] An offline player pressing an action gets "You need to be in the game for this".
- [ ] Audit log shows who did what, when, and the server's reply.
- [x] No route exists that passes free text from a player into a console command (grep the codebase for `SendConsoleMessage` outside `apps/api/src/actions/`; there must be none). *`apps/api/src/actions/run.ts` is the only file; the registry has no player actions at all yet.*

The planner's additions, each with its own acceptance list (state in docs/11-status.md): docs/14 joining (the entrance room, Play first, early access), docs/16 analytics, file browser, event log, branding, docs/17 mc-router (the homelab's), docs/18 player guide, docs/19 admin assistant (not begun).

## Phase 5 · Later
Discord bot (status, join/leave, chat relay, `/whitelist`), events page, season archive. Design when Phase 4 has been live for a couple of weeks and the group has opinions.

## Open questions for Alex (answer before Phase 2)

1. ~~Domain name~~ Answered (docs/13): `deepslate.dsw.test`, map `map.deepslate.dsw.test`.
2. ~~Is AMP on the same VPS?~~ Answered (docs/13): no; ADS on the homelab over the WireGuard tunnel, `AMP_INSTANCE_ID` pending until the instance exists.
3. ~~Which port is the instance's API on?~~ Answered (docs/13): none needed; calls go through the ADS proxy path.
4. ~~Season 1 world settings~~ Answered (docs/12): from the vote; defaults Normal difficulty, Corpse keeps items (keepInventory off), PvP off.
5. Does anyone not have Discord? If nobody, skip the credentials provider entirely. **Pending.** (The provider is built and costs nothing to keep.)
6. ~~`server_address` for the manifest~~ Answered: `mc.dsw.test`, no port, by mc-router on the homelab (docs/17); Pangolin is no longer part of it.

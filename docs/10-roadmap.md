# 10 · Roadmap and acceptance criteria

Work top to bottom. A phase is done when every box in its "Done when" list is true and Alex has clicked through it on the VPS. Then commit a tag `phase-N`.

**State on 2026-10-03, 19:00 UTC** (checked against `main` `7d0e5be` and the running server; the full check is "Where the build stands" in `docs/11-status.md`). A box is ticked only with what shows it, in italics after it. `phase-0` is the only tag. Phases 0 to 3 are built and in daily use, each with boxes that need a person to click through. The planner's additions are built: docs/14 joining, docs/16 analytics and event log, docs/17 mc-router, docs/18 guide, docs/21 launcher look and Discord feed (steps 1 to 3), docs/22 Discord bot (steps 1 to 6), docs/23 site look (all four steps), docs/25 starter kit. Started: docs/20 seasons (step 1 of 6) and docs/24 world regen (run as Alex amended it). Not begun: Phase 4 and docs/19. Going live is the next milestone; "Open items, by priority" at the end of this file is the order of work.

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
- [x] "Apply results" produces a diff of `mods.json` and commits it on confirm. *First real run 2026-10-03 on the closed "Season 1 mods" vote, at 40% (`fa37b30`). The commits stay on the deploy checkout by design and reach `main` by PR (lock `d7521da9`, PR #71); `deploy.sh` now refuses while any are unpushed (PR #73).*

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
- [x] The map loads at `map.<domain>` only when logged in; logged out redirects to login and back. *302 to `/login?next=…` without a session (checked again 2026-10-03 18:5x UTC). The map was rendered again with the ±3072 pre-generation, finished 18:03 UTC on 2026-10-03.*
- [ ] Admin restart with a 5-minute countdown warns in game every minute and restarts on time. *One with one minute ran on 2026-09-29 18:26 to 18:27 UTC, on time; the five-minute one has not.*
- [x] Console tail streams live for admins; players cannot reach it. *403 for a player, checked by the smoke test.*
- [ ] `/api/health` is green and monitored. *Green on 2026-10-03 18:5x UTC (db, tunnel, AMP, rsync, Discord feed and bot, pack same). Whether anything outside watches it is still for Alex to say.*

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
Partly brought forward: the Discord feed (docs/21) and bot (docs/22) post status, joins and leaves and relay chat both ways (built 2026-10-02; the bot is not yet fully set up in the Discord server, docs/22a). Still to come: `/whitelist`-style admin commands, events page, season archive. Design when Phase 4 has been live for a couple of weeks and the group has opinions.

## Open questions for Alex (answer before Phase 2)

1. ~~Domain name~~ Answered (docs/13): `deepslate.dsw.test`, map `map.deepslate.dsw.test`.
2. ~~Is AMP on the same VPS?~~ Answered (docs/13): no; ADS on the homelab over the WireGuard tunnel, `AMP_INSTANCE_ID` pending until the instance exists.
3. ~~Which port is the instance's API on?~~ Answered (docs/13): none needed; calls go through the ADS proxy path.
4. ~~Season 1 world settings~~ Answered (docs/12): from the vote; defaults Normal difficulty, Corpse keeps items (keepInventory off), PvP off.
5. Does anyone not have Discord? If nobody, skip the credentials provider entirely. **Pending.** (The provider is built and costs nothing to keep.)
6. ~~`server_address` for the manifest~~ Answered: `mc.dsw.test`, no port, by mc-router on the homelab (docs/17); Pangolin is no longer part of it.

## Open items, by priority (2026-10-03, 19:00 UTC)

Collected from a check of every spec in `docs/` against the code on `main` `7d0e5be`, the running server, and the installer's logs. Each item names where it comes from. **P0** blocks going live or puts data at risk; **P1** is the next build work; **P2** can wait. "Person" marks a step only Alex or a player can do. Done items stay in the phase lists above or in `docs/11-status.md`.

### P0 · before "We're live"

1. ~~**The backup route.**~~ **Done 2026-10-03** (PR "fix(api): a backup counts once AMP lists it"): the job waits for `GetBackups`, fails after 45 minutes with the reason, shown in Admin → Server → Backups. Left: AMP's backup size limit is Alex's to check in AMP (the portal's AMP user cannot read it); recommended: exclude `bluemap/` (32.6 GB of the ~51 GB) and keep the limit at least twice the resulting backup (docs/11). Nightly world backups in AMP itself: not checked. *docs/24 §5 B.1 and H; docs/09 runbook.*
2. ~~**The nightly database dump overwrites itself.**~~ **Done 2026-10-03** (PR "fix(deploy): date the nightly database dump"): `deepslate-YYYY-MM-DD.sql.gz`, newest 14 kept, `pre-*` dumps not counted, a failed dump not kept. Checked after the deploy in docs/11. *docs/09 "Backups".*
3. **`modpack/server-loaded.json` on `main` is the 2026-10-01 19:37 start, not the 2026-10-03 16:50 one** that docs/11 says PR #71 brought; the newer file is only on branch `lock-d7521da9` (`17649f4`). CI's `check-sides` compares the lock with the older list. Take the file from that branch to `main` (one-file change). *docs/07 "mod check"; docs/11 "Deploy and publish".*
4. **Pabulum cannot get in.** His last run (2026-10-03 10:52:44 UTC, installer 1.5.6) was refused by `/api/modpack/manifest` with `not_live` ("Not launched yet", seen in the proxy log), so early access does not let him through today, and a 1.5.x copy updates itself only after the manifest answers, so he stays on 1.5.6. Check his early-access flag in Admin → People; after go-live, or with the flag, one Play moves him to 2.2.0 and the app. Consider answering an old script's manifest call with the update even when the gate is shut. *docs/13 §9 early access; docs/07 "The installer updates itself".*
5. **The Discord bot cannot write in the admin channel** ("add Deepslate Works to the channel's permissions", six times 18:05 to 18:30 UTC on 2026-10-03), while `/discord` still shows the admin channel as `ok`. Person: give the bot the channel permission; code: show a refused channel as not ok. *docs/22 §8, docs/22a.*
6. **Go live.** docs/24 steps 1 to 5, G and H are done and written up in docs/11 (spawn claim moved, 36.7 GB backup). Left, Person: Alex stands in the world and checks the starter kit on his first release (docs/25 §7; he was online from 18:30 UTC), flips "We're live", and the news item goes out. *docs/24 §4, §7; docs/25 §7.*

### P1 · next build work

7. **Phase 4 · player self-service** (this file, Phase 4): player actions spawn / home / set home / where am I / unstick with rate limits and the offline message; a homes mod on the server; `/me` quick actions; "My stats" reader (docs/12 §4); `/admin/actions`. None built; the registry has no PLAYER actions. *docs/05 Phase 4; docs/18 "Home, spawn and getting unstuck".*
8. **docs/20 seasons, steps 2 to 6** (frontier, season file and `/season`, Admin → Seasons with `Season`/`SeasonClear`, trials, wipe), waiting for the planner and for Alex's answers in §11; Gateways, Apothic Attributes and Multiplayer Bosses held for the planner. Unblocks docs/21 feed §10 steps 4 and 5 and docs/22 §13 season posts.
9. **Small code gaps against the specs:** AMP calls not timed and slow calls not warned (docs/09 "Observability"); no origin check in `middleware.ts`, only per route (docs/09 "Security"); `window.confirm` on kill, purge, distance and menu actions (docs/05 "Admin server" says in-page); Admin → Pack status column thinner than docs/05 and no enable toggle (by decision, docs/02 data flow still says UI toggles); BACKUP event only on the button (docs/16 §1).
10. **docs/21 launcher §12 step 2**: stamp the chosen logo into the exe at Build (not built). **AMP grants** for view/simulation distance and the MOTD (`Settings.MinecraftModule.Minecraft.{ViewDistance,SimulationDistance,ServerMOTD}`), Person in AMP. *docs/15 §4; docs/21 §12.*
11. **CI hygiene** from the installer workflow's logs: `actions/checkout`, `upload-artifact`, `download-artifact` v4 run on deprecated Node 20 (move to the Node 24 majors); xUnit2029 in `UiTests.cs:42,44` and xUnit2031 in `AssetsTests.cs:130`.

### P2 · later, or waiting on a person

12. **docs/19 admin assistant**: not begun; needs `ASSISTANT_API_KEY` from Alex.
13. **Docs out of date**: docs/02 repo layout (installer, `deploy/ops-lock.sh`, `apps/api/src/discord/`), docs/03 tables and migrations (0023; `AdminLogin`, `OneTimeLogin`, `Poll`, `PollAnswer`, `DiscordPost`), docs/04 (the bot exists), docs/05 page list (v6 layout), docs/06 catalogue (83 entries, lock `d7521da9`), `ROADMAP.md` "In progress" (still lists the 2026-09-29 planner items, Better Tab Info, the outdated badge, fuller logs and the join code, as not started; they are built). `AuditLog_migrated_20260929` table never dropped.
14. **Phases 1 to 3 tags**: only `phase-0` is tagged; tag each phase once its person-boxes are clicked through.
15. **Person checks still open**: invite for a second account and refusal of a third; email fallback through an invite; a ballot on a phone; a rerun replacing exactly one jar; a five-minute planned restart; external monitoring of `/api/health`; Play first with a non-admin; leaving Discord sends a player back to the room; docs/16 figures against AMP's; docs/20 LOW-tier PC in a Cataclysm dungeon; docs/22 chat relay checks; docs/23 §9 look by eye; the app's lantern and window sizes (docs/21); read Alex's three install reports without a measured tier (2026-10-03 18:26, 18:29, 18:33 UTC, app 3.4.2) in Admin → Installs: likely `game_check` or `unfinished` reports, not readable from here.
16. **Smaller polish**: `/install` without a screenshot per step or a "what changed"; 13 visible mods without a video; Sophisticated Backpacks' `howTo` still says "Craft a backpack" (docs/25, a `mods.json` change); unsigned exe (docs/07 "Signing", pending a decision); stale remote branches `branding-logo`, `version-footer`, `report-quiet`, `lock-c99f2aae` (delete only on Alex's yes).

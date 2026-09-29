# 10 · Roadmap and acceptance criteria

Work top to bottom. A phase is done when every box in its "Done when" list is true and Alex has clicked through it on the VPS. Then commit a tag `phase-N`.

## Phase 0 · Foundation

Build:
- pnpm workspace, Next.js app, Prisma schema from 03, migrations, seed script (one admin from `ADMIN_DISCORD_ID`).
- Auth.js with Discord + credentials, invite flow from 04, onboarding (Minecraft username → UUID via Mojang, PC tier).
- `deploy/` compose + Caddyfile + `.env.example`; CI: lint, typecheck, test.
- `apps/api` skeleton with `/health` and the service-token middleware, wired into compose with the `wireguard` container and map relays (docs/13).
- Layout shell: top nav (Home, Mods, Vote, Install, Map, Players, Admin for admins), phone-friendly, dark and light themes.

Done when:
- [ ] `docker compose up -d` on the VPS serves the site over HTTPS.
- [ ] Alex logs in with Discord and lands on an admin page.
- [ ] An invite link lets a second Discord account in; a third account without an invite is refused with the right message.
- [ ] The email/password fallback works for one invite.
- [ ] `/api/auth/verify` returns 200 with a session cookie and 401 without.
- [ ] `/api/health` reports `tunnel: ok` once the AMP host side is up.

## Phase 1 · Catalogue and vote

Build: `/mods`, `/vote`, `/vote/results`, `/admin/votes`, manifest loader, `modpack lint`, `modpack verify-links`. Populate `mods.json` from 06 with verified slugs, wikis and real video links.

Done when:
- [ ] Every mod card has a working Mod page link, Wiki link and at least one real video link (`modpack verify-links` passes).
- [ ] A player can submit a ballot on a phone in under two minutes and edit it later.
- [ ] Exclusive group (guns) allows one choice; load estimate updates live and warns LOW-tier users about Heavy sets.
- [ ] Results page shows per-mod yes % and per-tier breakdown; closing freezes results.
- [ ] "Apply results" produces a diff of `mods.json` and commits it on confirm.

## Phase 2 · Modpack and installer

Build: `modpack lock`, `build client|server|installer`, `sync-server`; `/install`; `/admin/modpack`; `installer/` per 07.

Done when:
- [ ] `modpack lock` resolves every enabled mod plus dependencies for NeoForge 1.21.1 and fails loudly on any mod without a compatible version.
- ~~`client.mrpack` imports into the Modrinth App~~ struck 2026-09-29: Windows only.
- [ ] On a clean Windows VM with only the launcher installed: run `Setup.bat`, open the launcher, choose the profile, press Play, reach the main menu, see the server in the list. Under five minutes on a normal connection excluding downloads.
- [ ] Rerunning the installer with no changes prints "already up to date" and changes nothing; after bumping one mod it replaces exactly that jar.
- [ ] `sync-server` puts the same jar set on the AMP instance; the server starts and a client built from the same lockfile connects.
- ~~Alex's Mac gets in via `.mrpack`~~ struck 2026-09-29: Windows only.

## Phase 3 · Server dashboard

Build: AMP wrapper + poller + `ServerSnapshot`, home page, `/map` with BlueMap behind `forward_auth`, `/players`, `/admin/server`, announcements. Add BlueMap to the server pack.

Done when:
- [ ] Home shows Online/Offline correctly within 20 s of a real change, player names with heads, TPS and memory.
- [ ] The map loads at `map.<domain>` only when logged in; logged out redirects to login and back.
- [ ] Admin restart with a 5-minute countdown warns in game every minute and restarts on time.
- [ ] Console tail streams live for admins; players cannot reach it.
- [ ] `/api/health` is green and monitored.

## Phase 4 · Player self-service

Build: action registry, `/me`, `/admin/actions`, FTB Essentials on the server, stats reader.

Done when:
- [ ] A new player can whitelist themselves and join without asking Alex.
- [ ] Home / set home / spawn / where am I / kill work for an online player and return a clear one-line result; each is rate limited and audited.
- [ ] An offline player pressing an action gets "You need to be in the game for this".
- [ ] Audit log shows who did what, when, and the server's reply.
- [ ] No route exists that passes free text from a player into a console command (grep the codebase for `SendConsoleMessage` outside `apps/api/src/actions/`; there must be none).

## Phase 5 · Later
Discord bot (status, join/leave, chat relay, `/whitelist`), events page, season archive. Design when Phase 4 has been live for a couple of weeks and the group has opinions.

## Open questions for Alex (answer before Phase 2)

1. ~~Domain name~~ Answered (docs/13): `deepslate.dsw.test`, map `map.deepslate.dsw.test`.
2. ~~Is AMP on the same VPS?~~ Answered (docs/13): no; ADS on the homelab over the WireGuard tunnel, `AMP_INSTANCE_ID` pending until the instance exists.
3. ~~Which port is the instance's API on?~~ Answered (docs/13): none needed; calls go through the ADS proxy path.
4. ~~Season 1 world settings~~ Answered (docs/12): from the vote; defaults Normal difficulty, Corpse keeps items (keepInventory off), PvP off.
5. Does anyone not have Discord? If nobody, skip the credentials provider entirely. **Pending.**
6. `server_address` for the manifest: whatever Pangolin publishes (placeholder `mc.dsw.test`). **Pending.**

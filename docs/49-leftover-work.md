# 49 · Leftover work, in one place

Collected 2026-10-10 against `dev` `ee78660a` and `main` `9c7e673c`, from docs/10, 11, 28, 34 to 48 and the VPS
session's reports of 2026-10-09 and 2026-10-10. Every item was checked against git, the pull requests (#18 to #29) and
the code; items found done were dropped. "Unverified" means the doc says open and nothing shows it done, but it could
not be checked from the VPS. The source docs stay the detail; this file is the list.

Who it waits on: **Alex**, **planner**, **VPS** (the VPS session), **AMP host** (the AMP host session), **players**.

## Next up, in order

1. Check the "Play first" and "We're live" switches, then deploy the AMP state fix (on `dev`, below, API). Until it is
   live, nobody presses "End the process": it can kill the server mid-save while it is going to sleep.
2. The refill with nobody online, then the AMP host's after check.
3. Live's own mod capture into `server-loaded.json`, and check-sides in `deploy/check.sh`. Today CI checks the sides
   against the test server's capture.
4. Prove in real use: the bot filter (PR #24), "Not open yet" with a real player, the "We're live" post. Correct
   docs/47 §4 on the door fix.
5. docs/48: prove Part A (on `dev`), then build Part B (Maintenance) before "We're live" is ever switched off again.

## Reopening and deploy

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| Door fix proof | The redo passed on the test stack on 2026-10-10 (server branch frozen at `c23ed0d5`); docs/47 §4 still lists it as unproven. Record only. | docs/47 §4 | open | planner |
| The two switches | "Play first" and "We're live": state never confirmed after the reopening. | docs/47 §1, §6; docs/11 | open | Alex |
| The refill | Pre-generate the overworld (centre 0 0, radius 10176), then the Nether (centre 64 552, radius 448), nobody online; then the AMP host's after check and the overworld edge check; the map re-renders. | docs/47 §5.1 | open | Alex, AMP host |
| Live's mod capture | Run `deploy/server-mods.sh` against live; the repo's `server-loaded.json` is still the test server's (`fd58a726`). | docs/47 §5.4 | open | VPS |
| Deploy `main` | PR #29 (Live/Test switch order) reached `main` after live was last seen on `6b7d71d4`. | docs/11 | unverified | Alex |
| Unproven in real use | A real PC updating itself from 3.5.5 (the first installs-page row proves it); the Test tab on the `main` build (wake watch, test game check). | docs/47 §4 | open | Alex, players |

## Server and mods

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| One quiet restart | NeoForge 21.1.253 on live (lock is 253, server is 252), view distance 20, MOTD from Branding, the AMP memory value. Needs the AMP grants in docs/15 §4. | docs/46 §7.6; docs/43 §7.3 | open | AMP host, Alex |
| Test datapacks off live | The sample Frontier and three worldgen packs need a `level.dat` edit; `work/test-packs-off` is parked for it. | docs/11; docs/47 §3 | open | AMP host, Alex |
| Grave mod config | It rewrites its config after every Sync start, so the repo's copy is not what runs. | docs/47 §5.12 | open | VPS |
| Season mods mechanism | The `season` field and `shippedFiles()` are not built; six mods are only `enabled: false`. Must land before more season work goes to test. | docs/44; docs/46 §7.2 | open | VPS |
| Season 1 code before 30 Nov | Finale gate (docs/41, to be reissued), `finale.groupRadius`, W1.6 banner, W1.7 wipe, W1.8 hall, W1.11 guide section, T5 portal. | docs/34; docs/43 §3 | open | planner |
| Worlds, builds, designer | Worlds Steps 1 to 3; build import Step 3; designer API-key mode; designer 3c (rest), 3d, 3e and the "design ready" Discord line. | docs/36, 37, 39, 40 | open | Alex's word |
| KaneFinch's items | Diamond chestplate, diamond sword, totem, from the console while he is online. | docs/47 §5.2 | open | Alex |

## Web app

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| docs/48 Part A | On `dev` (`ee78660a`), not deployed; the A6 proof on the test site. | docs/48 | in progress | VPS |
| docs/48 Part B | Maintenance switch and per-admin tick, not built. Until then, "We're live" off shows players launch wording. | docs/48; docs/47 §5.6 | open | VPS |
| Tester tick for non-admins | Not built. | docs/45; docs/46 §7.5 | open | planner |
| Phase 4 self-service | Player actions, homes, `/me`, "My stats" (its endpoint, docs/12 §4); the registry has no player actions. | docs/10 Phase 4 | open | — |
| Phase 5 and the admin assistant | Not begun; needs an API key. | docs/19; docs/10 P2.12 | open | Alex |
| Small gaps | Origin check in middleware; `window.confirm` in 3 components; the BACKUP event only from the button. | docs/10 item 9; docs/43 | open | VPS |
| Next.js 16 | Still on `^15`; move to 16.3.x. | docs/10 item 18 | open | VPS |
| Health output | Names a tool; hide it if the page can be read from outside. | docs/47 §5.11 | open | VPS |

## API and AMP

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| AMP state names | Fixed on `dev` 2026-10-10 (docs/11); deploy it, then the kill button is safe. | docs/47 §5.7 | fixed, not deployed | Alex (deploy) |
| R-04 | An AMP refusal returned as HTTP 200 counts as success; needs AMP's real answers first. | docs/35 | open | AMP host |
| AMP call timing | No duration log or slow-call warning. | docs/10 item 9b; docs/43 §3 | open | VPS |
| Review leftovers | R-06, R-16, R-21, R-43. | docs/35 | open | VPS |
| Test instance | The test api asks AMP for a backup list it may not see; the test instance's "Enforce Whitelist" tick. | docs/46 §7.10 | unverified | AMP host |

## App (installer and launcher)

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| 3.6.2 | Name removed jars to every player at their next Play. | docs/47 §5.10 | open | VPS |
| R-10 uninstaller | Deletes saves and schematics; the `launcher_profiles.json` write is unsafe. | docs/35 | open, next release | VPS |
| R-42 | Checksums for the Java and NeoForge downloads; exe signing (accepted 2026-10-07, where the key lives is undecided). | docs/07 "Signing"; docs/38 §4 | blocked on the key | Alex |
| Update before the gate | `SelfUpdate` still runs after the gated manifest. | docs/10 item 17 | open | — |
| Logo in the exe | Stamp the chosen logo into the exe at Build. | docs/21 §12 | open | — |
| Build warnings | xUnit2029/2031 and the `Buffer()` deprecation. | docs/43 §7.16 | unverified | — |

## Discord bot

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| PR #24 proof | Needs a private test webhook in `deploy/.env` and a root `test-up.sh`. | docs/47 §4 | open | Alex (`.env` edits need his go) |

## Security

The findings themselves stay in docs/38; this is only what is still to do.

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| Deploy key and the live world | Build the staging-folder apply step, then reopen and close I4. | docs/46 §7.3 | open | VPS, AMP host |
| Health login | Slow the 30-second health login. | docs/46 §7.3 | open | VPS |
| Register follow-ups | Rotate the 2026-10-08 test secrets; root read-outs for sshd and the firewall; branch protection strict mode; the Snyk ignores SR-02 and SR-08; SR-20 live checks. | docs/38; docs/43 §7, §10 | open | Alex (root), AMP host |

## Ops and backups

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| Encrypted DB dump | Commit `7f4ddcc5` on the local branch `work/security-a3`, not merged. | docs/43; docs/46 §7.4 | open | Alex, VPS |
| Backups package | Restore test into scratch; the portal's own four-a-day runner and status-file reader; "Back up now" while stopped or asleep; progress on the dashboard; a list-only S3 key. | docs/28 §9; docs/46 §7.4 | open | AMP host |
| BlueMap while asleep | 502s while the server sleeps. | docs/43 §7.6 | open | AMP host |
| check-sides locally | `deploy/check.sh` does not run it; only `ci.yml` does. | docs/47 §5.8 | open | VPS |
| Deploy guard | Refuses after a branch with an upstream changes `.git/config`. | docs/47 §5.9 | open | VPS |
| Pre-push name check | The installed hook differs from the pending copy; install the pending one as root. | VPS report 2026-10-10 | open | Alex (root) |
| Local git tidy | The old pre-rewrite `phase-0` tag and one wrongly prefixed local branch on the VPS. | VPS report 2026-10-10 | open | VPS |
| Old copies | About 18.5 GB of old worlds and scratch copies on the AMP host; old `.env` and Caddyfile copies; leftover tables. Nothing is deleted without Alex's word. | docs/47 §5.15; docs/46 §7.9 | open | Alex |
| AMP host noise | Reverse proxy agent, logrotate, pending updates. | docs/46 §7.7 | open | AMP host |
| Must-vote polls | Three close 2026-10-11 19:00 UTC; while open they hold non-voters at the door. | docs/43 §7.15 | unverified | Alex |

## Docs

| Item | What remains | Source | Status | Waits on |
|---|---|---|---|---|
| Missing docs | docs/41 (Season 1 rewards and finale rule) and docs/42a (the AMP host half of the test server). Both numbers are reserved. | docs/46 §7.8 | open | planner, AMP host |
| Stale docs | docs/02 to 06; the docs/10 header still says "State on 2026-10-03"; `architecture.mmd` lacks the test stack and the build designer. | docs/10 P2.13; docs/43 §6 | open | — |
| View distance and MOTD | Write view distance 20 and the MOTD from Branding into the docs and `mods.json`. | docs/47 §5.14 | open | VPS |
| Acceptance boxes | docs/42 §11 (10, likely partly met); docs/10 person checks: invite and refusal, email fallback, phone ballot, one-jar rerun, 5-minute restart. | docs/42; docs/10 item 15 | unverified | Alex, players |
| Phase tags | Phases 1 to 3 are not tagged. | docs/10 P2.14 | open | Alex |

## Docs that can go later

Reviewed 2026-10-10; none was removed, because each is still the cited source for open work above.

- **docs/12** (planner update, 2026-09-28): superseded by docs/13 except §4, which still defines the `GET /stats/:uuid` endpoint Phase 4 needs,
  and docs/13 keeps 12 in its reading order. Remove once Phase 4 has its
  own spec.
- **docs/15** (AMP host finish): done, but §4 holds the AMP setting keys and `server.properties` values for the quiet
  restart above. Remove after that restart, moving §4 into docs/09.
- **docs/43** (audit, 2026-10-08): its open items are all in this file. Remove once docs/46 and docs/11 stop pointing
  at it.
- **docs/26** (spawn corpse): fold into docs/27 once its §4 checks are seen in game.

Two files share 21 (`21-discord-feed`, `21-launcher-look`); code cites "docs/21 §N" 82 times without the name, so the
numbers stay.

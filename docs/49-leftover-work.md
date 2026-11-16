# 49 · Leftover work, in one place

Collected 2026-11-16 against `dev` `638383c` and `main` `02df584`, from docs/10, 11, 34 to 64. It replaces the list of 2026-10-10. The source docs stay the detail; this file is the list. Every row was checked the same day against git, the code and what can be read from live and test (the api's health, the databases, the servers' files through AMP); a row says so where it could not be checked.

Rows from the old list that were found done are dropped: testers (docs/57), gun balance (docs/61), the site's Maintenance (docs/48 Part B), Admin's rename (docs/48 Part A), the Mods guide by type (docs/52), the season ship mechanism (docs/44), the AMP state names, the live regen (docs/64) and everything that only concerned the VPS checkout. Dropped at the check of 2026-11-16, with what showed them done:

- **The pre-generation:** finished 2026-11-14 08:35 UTC, all four worlds, 2,740,629 chunks; BlueMap said the maps are up to date.
- **A PC through Test with pack `437dc9a3`:** two members' PCs installed it and joined the test server on 2026-11-09.
- **App 3.6.8's first report:** the report of 2026-10-28 14:46 UTC shows the zoom key added and "connected textures on"; five members' PCs have reported on 3.6.8 since.
- **The two switches:** "We're live" is on, "Play first" is on, Maintenance is off.
- **The site's health output:** an anonymous caller gets five yes-or-no fields and no tool's name.
- **R-21:** a player who is on with no session gets one, marked `inferred`.
- **Removed jars named at Play:** the app has listed them as "(removed)" since 2026-10-02.
- **The health login:** the api logs in to AMP only when its session is gone, not at every check.

Who it waits on: **Alex**, **planner**, **build** (the build session on docker-01v), **AMP host** (the AMP host session), **players**.

## Next up, in order

1. Alex answers docs/63 §6 (six decisions). The Frontier's pre-generation on test, its snapshot and the worldgen freeze must all happen before 1 December.
2. Before the three new mods go to `main`: the claim test, the change log entry and the two waiting entries (table below).
3. The checks after the 2026-11-01 deploy, and the copper golem crash, which can happen again on any day.
4. The clean-up of the move home, by 2026-12-06.

## Season 1, opening Tue 1 December

| Item | What remains | Source | Waits on |
|---|---|---|---|
| The six decisions | The seal, the order, the worldgen freeze, radius 3,000, the snapshot copied at the opening, when the boss mods reach PCs. A recommendation stands for each. None is answered in docs/63. | docs/63 §6 | Alex |
| The seal datapack | Empty structure tags so boss structures appear only in the Frontier. Not built: nothing of it is in `modpack/`. | docs/63 §3 | build, after decision 1 |
| The Frontier on test | s1 back on test, pre-generate, the structure table, the snapshot before anyone enters. Not run. | docs/63 §2 | build, Alex |
| The copy to live | The snapshot copied at the opening, with a backup first and Alex's yes. | docs/63 §2 | Alex, AMP host |
| Season 1 code | Not built: the finale gate, the app's banner (W1.6; the site already sends the line), the W1.7 wipe, W1.8 `hall.update`, the T5 portal, `frontier.build`. Built: the guide's Season section (W1.11). | docs/34; docs/43 §3; docs/11, 2026-10-04 | planner, build |
| docs/41 | Season 1 rewards and the finale rule: the number is reserved, the doc is not written. Alex's decisions of 2026-10-07 are the input. | docs/46 §7.8 | planner |
| The rehearsal | Kill and first-hit conditions for modded bosses, the reward function, the trophy's components. Never run against the real game. | docs/34 §7 | build, Alex |
| Finale date | Sat 26 December by the rule, or the 19th. | docs/11, 2026-10-04 | Alex |

## The new mods on `dev` (Epic Knights, TACZ Turrets, Mekanism Missiles)

| Item | What remains | Source | Waits on |
|---|---|---|---|
| Claim test | In game on test: an Industrial Bomb against a claim. Nobody has joined the test server since the limits were synced on 2026-11-14 (its last join is 2026-11-09), so the limits themselves have not been seen by a player either. | docs/11, 2026-11-14 | Alex |
| Change log entry | None written for the three mods. It needs a title so it tags the players' role, and `onSync`. | docs/11, 2026-11-08 | build |
| The two waiting entries | `2026-11-01-map-squares` and `2026-11-01-not-answering` have no `live` or `onSync` and hold every later entry back; the last entry posted is `2026-10-30-new-land`. Mark them once Alex is content with "Not answering" (next table). | `apps/api/src/changelog.ts` | Alex's word, build |
| The warhead mod's state | It calls itself "in active development". The big bombs are off by recipe, fallout is off, missile range is 500. Decide whether it stays. | docs/11, 2026-11-14 | Alex |

## Live, after the 2026-11-01 deploy

| Item | What remains | Source | Waits on |
|---|---|---|---|
| The copper golem crash | Live crashed on 2026-11-03 22:19 UTC and dropped the player who was on: Friends & Foes 5.0.4 sends a client-only packet from the server when a copper golem turns into a statue (`CopperGolemEntity.becomeStatue`); the watchdog then stopped the server and AMP had it back within two minutes. It will happen again when another golem oxidises fully. 5.0.5 came out on 2026-11-16 and its notes do not name this. Report it upstream; until a fix, patch the jar (docs/58) or tell players to wax their golems. | live's `crash-reports/crash-2026-11-03_22.19.42-server.txt` | build, Alex |
| "Not answering" | One alarm since the deploy: 2026-11-04 02:57:42 to 02:58:37 UTC, 55 seconds, nobody online, during the pre-generation, 20 TPS in the snapshots either side. Whether the game really let nobody in for that minute cannot be told afterwards. None in the twelve days since. | docs/11, 2026-11-01; live's `Event` | Alex's word |
| Test level name | `streamtest-potato` back to `world` in AMP: still not done on 2026-11-16, so the testers of 2026-11-09 played in the stream-test world. The test world's leftovers from the stream tests. | docs/11, 2026-11-01 | Alex |
| Sync's "config: 7 file(s) updated" | Reported on every Sync, never looked into. A lead: the server writes some shipped configs anew at its start (the grave mod's is one, below), so Sync may find them changed each time. | docs/11, 2026-10-29 | build |
| The patched ArPhEx | Never tried in game: the compass on Ashmoon, the two cave spiders, the castle round trip, no such mob in the main world. | docs/11, 2026-10-29 | Alex, players |
| Village mods | Waystones in the new villages; the three `locate structure` checks. | docs/11, 2026-10-29 | Alex |
| Voice chat | Can move past 2.6.24 once every PC has Sound Physics 1.5.2. Of the ten members who have ever sent an install report, five have pressed Play on the current pack; the other five are on older ones. | docs/11, 2026-10-26 | build |
| The Fairy Lights crash | Reported upstream; our patched jar stays until a fixed release. | docs/11, 2026-10-27 | — |
| The live map | Nobody has looked at the map by eye since the pre-generation ended, for dark squares at the edges. | docs/11, 2026-11-01 | Alex |

## The move home (docs/62)

| Item | What remains | Source | Waits on |
|---|---|---|---|
| The clean-up, by 2026-12-06 | The WireGuard peer on the AMP host, `deepslate-wg`, udp 51820, the VPS stack, the tunnel's lines on the AMP host, the old whitelist names, the two dry-run resources, the temporary access. On docker-01v nothing of the tunnel is left (no link, no listener, no container, no tunnel address in live's settings); the AMP host and the VPS cannot be seen from there, so their part is not checked. | docs/62 §7; docs/11, 2026-10-23 | Alex, AMP host |
| The doc edits | docs 00, 02, 09, 13, 17, 28, 38, 42 and the working rules, as one commit. Not made. | docs/62 §7 | build |
| Outside monitor | The check on `/api/health/live`. | docs/11, 2026-10-23 | Alex |
| Offsite dumps | A copy of the home dumps offsite, newer than 24 hours. Health shows the newest dump and its copy on the AMP host; nothing shows one further away. | docs/62 §8 | build, Alex |
| Old copies | About 180 GB of old worlds on the AMP host; old `.env` and Caddyfile copies; the stopped VPS data. Nothing is deleted without Alex's word. | docs/11, 2026-10-30 | Alex |

## Server and mods

| Item | What remains | Source | Waits on |
|---|---|---|---|
| NeoForge | Live runs 21.1.252 (its crash report of 2026-11-03 says so); the lock pins 21.1.253; 21.1.266 is the newest. It moves with the AMP install. | docs/11, 2026-10-26 | AMP host, Alex |
| Test datapacks on live | Still there on 2026-11-16: `deepslate-test-probe`, `deepslate-test-t_shift_a` and `deepslate-test-t_shift_b` in the world's `datapacks/`, and the dimension folders `t_shift_a`, `t_shift_b` and `frontier_sample`. The sample Frontier's datapack and its map file are gone; its dimension stays until `level.dat` is edited. | docs/47 §3 | AMP host, Alex |
| Grave mod config | The values that run are the repo's. But at the first start after every Sync NeoForge sets the repo's file aside as `corpse-server-N.toml.bak` (five so far, the newest 2026-10-30) and writes its own, which leaves out `death_storage_duration` (its default is the same -1). Make the repo's file the one NeoForge writes, so it stops. | docs/47 §5.12 | build |
| Server settings | Live's `server.properties` reads view distance 16, simulation distance 10 and "Modded Minecraft with friends" as its MOTD; `mods.json` says 20, 8 and "Deepslate Works", and Branding has a third MOTD. Which is meant is not written down; docs/06 and docs/30 still give the old view distance. | docs/47 §5.14; docs/11, 2026-10-12 | Alex, build |
| The server's mod capture | `server-loaded.json` is the test server's start of 2026-11-08, as it must be while the new mods are only there. After they reach live, take it from live again. | docs/47 §5.4; docs/11, 2026-10-26 | build |
| Worlds, builds, designer | Worlds Steps 1 to 3; build import Step 3; designer 3c (rest), 3d, 3e, its API-key mode and the "design ready" Discord line. | docs/36, 37, 39, 40 | Alex's word |
| KaneFinch's items | A diamond chestplate, a diamond sword and a totem, owed since 2026-10-10. Nothing records that they were given. | docs/47 §5.2 | Alex |
| AMP host noise | The reverse proxy agent, logrotate, pending updates. Nothing records them done; not checked from docker-01v. | docs/46 §7.7 | AMP host |

## Web app, api and AMP

| Item | What remains | Source | Waits on |
|---|---|---|---|
| Next.js 16 | Still on 15 (15.5.28 in the lockfile); move to the newest 16.x. | docs/10 item 18 | build |
| Small gaps | No Origin check in middleware (routes check for themselves); `window.confirm` in three components; the BACKUP event only from the button, so AMP's scheduled backups and the nightly dumps leave none. | docs/10 item 9 | build |
| AMP call timing | No duration log, no slow-call warning. | docs/10 item 9b | build |
| R-04 | An AMP refusal returned as HTTP 200 counts as success: the console line, Start, Restart and Sync's calls do not look at the answer; SetConfig and TakeBackup do. | docs/35 | AMP host, build |
| Review leftovers | R-06: a forum post the bot could not make is not tried again. R-16: three routes (wake, vote, inventory) still check Origin by themselves instead of with the shared helper. R-43: the site's Lock writes the Extras lock before the pack's. | docs/35 | build |
| The map while asleep | The site's Map page says the map is only there while the server runs; the map's own address still answers 502. | docs/43 §7.6 | build |
| The bot filter of PR #24 | Never proven: it needs a private test webhook in the stack's `.env` and a redeploy. | docs/47 §4 | Alex |
| Test instance | The test api still asks AMP every ten minutes for a backup list its role may not see, and ignores the answer; whether "Enforce Whitelist" was unticked on the test instance is not recorded. | docs/46 §7.10 | build, AMP host |
| Phase 4 self-service | Player actions, homes, "My stats". | docs/10 Phase 4 | Alex's word |
| Phase 5 and the admin assistant | Not begun. | docs/19 | Alex |
| Old defaults | `apps/api/src/env.ts` still defaults `AMP_URL`, `AMP_TUNNEL_IP`, `ROUTER_DASH_URL` and `RSYNC_TARGET` to the retired tunnel's address. Live sets all four itself. | planner review 2026-11-16 | build |

## App (installer and launcher)

| Item | What remains | Source | Waits on |
|---|---|---|---|
| R-10 uninstaller | It removes the whole game folder, saves and schematics with it, and moves only the screenshots out, while telling the player their worlds are kept. Its `launcher_profiles.json` write deletes the file and then moves the new one in (the install-time write replaces it in one step); a backup and a read-back check soften that. | docs/35 | build |
| R-42 | No checksum on the Java and NeoForge downloads; exe signing, blocked on where the key lives. | docs/07; docs/38 §4 | Alex |
| Update before the gate | `SelfUpdate` still runs after the gated manifest, so a PC the gate refuses cannot update itself. | docs/10 item 17 | build |
| Send to Alex on Test | It sends the live profile's game log, not the test profile's. | docs/11, 2026-11-09 | build |
| Logo in the exe | The lantern icon is built in; stamping the logo chosen in Branding into the exe at Build is not. | docs/21 §12 | build |
| Build warnings | xUnit2029 and xUnit2031 in the app's tests. | docs/43 §7.16 | build |

## Security, ops and backups

| Item | What remains | Source | Waits on |
|---|---|---|---|
| Register follow-ups | The rows still open in docs/38 and Part C of docs/60. Not gone through row by row at this check. | docs/38; docs/60 | Alex, security planner |
| The staging-folder apply step | Not built anywhere; docs/38 lists I4 as met and it was never reopened. | docs/46 §7.3 | build, AMP host |
| Encrypted DB dump | Not built: `BACKUP_PUBLIC_KEY` is handed to the container and nothing reads it. The branch it was on lived only in the old VPS checkout and is in no ref of the repository or of docker-01v's checkout. | docs/43 | Alex, build |
| Backups package | A restore test into scratch; "Back up now" while asleep; a list-only S3 key. | docs/28 §9 | AMP host |
| Pre-push check | It refuses a branch name and old history, nothing else: no addresses (see the address clean-up, 2026-11-16) and no player names: the name check was put off on 2026-10-09 until live was back, and never came. The hook is in no repository; its sha256 is pinned in a file only root can read. | planner review 2026-11-16 | build, Alex |
| The sides check | `deploy/check.sh` does not run it; only CI does. | docs/47 §5.8 | build |
| Dependabot | PRs #115 (actions) and #117 (npm) are open against `dev`. | GitHub | Alex |

## Docs

| Item | What remains | Source | Waits on |
|---|---|---|---|
| Missing | docs/41 (above) and docs/42a (the AMP host half of the test server). | docs/46 §7.8 | planner, AMP host |
| Stale | docs/02 to 06 against the home stack; `architecture.mmd` has the home stack but not the test pair or the designer; docs/53's opening list still says Mekanism lost the vote, and it is in the pack; `ROADMAP.md` and the state line of docs/10 describe early October (both now say so); docs/47 §4 still lists the door fix as unproven. | docs/10 P2.13 | build, planner |
| Test names | The titles of the pack tests in `packages/modpack/tests/ship.test.ts` and `apps/api/tests/pack-ship.test.ts` have grown into a history; move the history to a comment. | planner review 2026-11-16 | build |
| Acceptance boxes | All ten boxes of docs/42 §11 and the person checks of docs/10 (invite and refusal, email fallback, phone ballot, one-jar rerun, 5-minute restart) are unticked. | docs/42; docs/10 item 15 | Alex, players |
| Phase tags | Phases 1 to 3 are not tagged; `phase-0` is the only tag. | docs/10 P2.14 | Alex |

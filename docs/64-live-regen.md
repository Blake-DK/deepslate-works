# 64 · The live regen: new land wherever nobody has been, then the dev pack live (runbook, 2026-10-30)

Alex, 2026-10-30: "plan the main world regen of unused chunks and make this go live". This is that plan as agreed
("Yes, start", with the recommendation for each decision in §1). It replaces the regen paragraph of docs/11's
2026-10-28 section and is step 3 of docs/63 §2, brought forward. Report in `docs/11-status.md`.

## 1. What is decided

1. **A short test check instead of the week-long preview** (docs/63 §2 step 2): the village mods and ArPhEx
   5.0.2-dsw.1 have never started, so test runs them once, pre-generates around spawn and Alex looks (§3).
2. **What is kept.** A chunk stays when any of these holds, and so do the chunks within 2 of it (a square):
   - a player spent **2 minutes** or more in it (`InhabitedTime`; it counts while a player is within simulation
     distance, so a house keeps its surroundings);
   - it is claimed (Open Parties and Claims, the server's claims included);
   - it holds a lit nether portal (a `minecraft:nether_portal` point of interest; ruined portals have none);
   - a player logged out or has their bed or anchor in it;
   - it holds a grave (Corpse) or a waystone a player placed (`Origin` PLAYER in `waystones.dat`).

   Then any chunk enclosed by kept chunks is kept too: a patch of new land inside a settled area would only be a scar.
   Everything else that exists is deleted and made again by the new pack. On the 2026-10-28 copy that is 34,719 kept,
   1,590,671 (97.9 %) deleted, of which 1,503 whole regions. The chunks to be deleted held no block a player is likely
   to have placed: the 75 holding a sign or similar had no player time at all.
3. **Ashmoon is trimmed by the same rule.** Its square was pre-generated before ArPhEx's structures moved there, so
   the Crawling Castle and the rest are 3,300 to 4,600 blocks out (docs/11, 2026-10-14). Made again, they come within
   the pre-generated area, and the Crawling Compass leads somewhere near.
4. **Pre-generation in the window:** the main world to radius **5,000** (about 390,000 chunks, some 4 hours at the
   28 to 38 chunks/s of 2026-10-03) and Ashmoon to radius 3,000 (about 30 minutes). The rest of the old main world
   (x −11,264 to 13,119, z ±10,180) fills in afterwards in "when nobody's online" mode (§5 W14).
5. **Untouched:** the Nether, the End, `deepslate:limbo`, the Frontier sample, ArPhEx's own dimensions, everything
   outside `region/`, `entities/` and `poi/` of the main world and Ashmoon. Inventories, advancements, claims,
   backpacks, waystones and graves stay.
6. **When:** an evening Alex picks, before Sun 15 November (docs/63 §2 step 3). Season 1 stays off live
   (`"ship": []`); docs/63 is otherwise unchanged.

## 2. The tools

Not in this repository (they name hosts); on the hosts themselves, like the 2026-10-10 trim's.

| Step | Where | What |
|---|---|---|
| R1 | AMP host, `sudo` | `r1-copy-out.sh <instance>`: the stopped world copied to a work folder, every file hashed on both sides; the last `latest.log` kept as R5's baseline |
| R2 | docker-01v, ladm | `tools/r2-keep-set.sh <instance>`: what the rule reads (region, poi, playerdata, deaths, claims, waystones of both dimensions) copied over, `regen-keep.py` run, the two delete sets sent back with `SET_APPROVED=no` |
| R3 | AMP host, ladm | `r3-trim-copy.sh <instance>`: MCA Selector 2.9 (the 2026-10-10 jar) deletes the set from the copy, never the instance; checks that only set chunks went and no other file changed |
| R4 | AMP host, `sudo` | `r4-copy-back.sh <instance>`: the instance's world renamed aside to `/home/amp/regen-keep/<instance>/`, the trimmed copy put in; listing, owner, modes and chunks checked |
| R5 | AMP host, `sudo` | `r5-start-log-check.sh <instance>`: the first start's log against the baseline |
| R6 | AMP host, `sudo` | `r6-way-back.sh <instance>`: the kept world renamed back (instant) |
| R7 | AMP host, `sudo` | `r7-save-record.sh <instance>`: the set, maps and every R log on the host and the NAS, checksums verified |

AMP host scripts: `/home/ladm/regen-2026-10/`; the set in force: `regen-set.conf` there. docker-01v:
`/home/ladm/deepslate-regen-2026-10/` (tools, copies, maps). Every script ends on `RESULT: PASS` or `RESULT: FAIL`,
refuses when a condition is not met, and asks for a typed `yes` before it changes a world. R3 and R4 refuse on live
unless `regen-set.conf` says `SET_APPROVED=yes` with the checksums of the set Alex saw. The delete step was rehearsed
on four live regions (two whole, two mixed): every set chunk gone, none outside the set lost.

## 3. Phase 0: the check on test (before the window)

1. The test checkout at `origin/dev` (done 2026-10-30: `9862e25`, with the ArPhEx jar in `data/private-jars/`).
2. Alex, test site: Build, Sync, Start. The session reads the start: Done, no FATAL, the new jars loaded
   (every jar `dev` added since `main`, ArPhEx 5.0.2-dsw.1 among them), the world's datapacks listed as before.
3. Pre-generation on test: main world, centre 0 0, radius 1,500, "now", generate and render.
4. `locate structure` from spawn for a CTOV village, `villagesandpillages:village_witch`, `joshie:village_ocean`;
   on Ashmoon `arphex:crawling_castle`.
5. Alex in the game and on the test map: the land, a village, Ashmoon with a Crawling Compass (`/give`), Lungers,
   no ArPhEx mob in the main world.
6. **Rehearsal of R1 to R5 on test** with the world Alex walked: the whole chain on a real world, timed, in the
   order of §5. Test's world is then refilled by pre-generation; R6 is tried once to prove the way back.

Phase 0 is done when the start is clean, the structures are found and Alex says the land is right.

## 4. Gates for the window

Stop and report if one is not so; do not work around it.

- [ ] Phase 0 done (§3), the rehearsal passed.
- [ ] `origin/main` merged into `dev`; CI green on `dev`; the change log has `2026-10-29-arphex-ashmoon` and
      `2026-10-30-new-land` (both `onSync`).
- [ ] The ArPhEx jar in live's `data/private-jars/`, sha512 `f5f142ce…` (live's Build fails without it).
- [ ] Nobody online; Alex has told the group in Discord when the server goes down and for how long.
- [ ] AMP host: 2 × the world + 10 GB free (R1 checks it; 92 GB free on 2026-10-30 for a 19 GB world).
- [ ] Alex has said "go" in the session.

## 5. The window

Live stays **Stopped** (in the panel, not Sleeping: a stopped server refuses Play's wake) from W2 to W8.

| # | Who | What | Seen |
|---|---|---|---|
| W1 | Alex | Admin → Site settings: "We're live" **off** (only admins and early access can join while it runs) | |
| W2 | Alex | Panel: live **Stop** | `42-game-stopped-legs.sh DeepslateWorks01 stopped`: PASS |
| W3 | session | Database dump (`deepslate-db`); AMP backup "Before the regen", listed with a size within 45 minutes. If AMP does not list it, R1's copy and the kept world in R4 are the way back; report and go on only on Alex's word | |
| W4 | Alex | R1 | PASS; files and bytes |
| W5 | session | R2; the maps and summary to Alex: kept and deleted per dimension, the reasons, the watch list | Alex: yes or a change of rule |
| W6 | session | `SET_APPROVED=yes` with both checksums written in `regen-set.conf`, quoting Alex's yes | |
| W7 | Alex | R3, then R4 (a typed yes each) | PASS each |
| W8 | session + Alex | The `dev` → `main` PR (title and body without attribution), CI, merge; Dockhand: pull the private images, Redeploy `deepslate`. Live Build and Sync, then Start | the site healthy; Build and Sync done |
| W9 | session | R5 (sudo); `world.seed`, the world's datapacks listed as before, `world.standable` at `SPAWN_POS`, `opac` claims still there | PASS |
| W10 | session | Pre-generation, Ashmoon: `{ "mode": "now", "what": "both", "purge": false, "area": { "x": 0, "z": 0, "radius": 3000, "world": "deepslate:moon" }, "window": null, "capHours": null }` | 100 % and rendered |
| W11 | session | Pre-generation, main world: the same with `"radius": 5000` and no `world` | 100 % and rendered; rate, time |
| W12 | session | `locate` from spawn: CTOV village, witch village, ocean village; on Ashmoon the Crawling Castle. The seam at a kept area looked at on the map | distances |
| W13 | session | AMP backup "After the regen"; R7 | listed; PASS |
| W14 | Alex | "We're live" **on**. The bot posts the two change log entries (the Sync's check). Then pre-generation "when nobody's online", main world, generate and render, in two squares of radius 10,000 (the route's largest), centres −1,300 0 and 3,100 0: the old area but two strips of 180 blocks at its north and south edges, which generate when someone gets there | |

**Time:** W2 to W9 about 1½ hours (R1 copy and hashing ~10 min, R2 ~10 min, reading the maps, R3 ~5 min, R4
~5 min, the PR's CI ~15 min); W10 and W11 about 4½ hours with the server running and nobody else on.

**The map:** not purged. BlueMap re-renders a region when its chunks change, so the new land replaces the old tiles as
it is generated. Beyond radius 5,000 the old tiles stay until W14's run reaches them.

## 6. If something fails

- Before W7: nothing in the instance has changed. Start live again (or leave it asleep), "We're live" on.
- R4 or later, before anyone has played on the new world: `sudo bash /home/ladm/regen-2026-10/r6-way-back.sh
  DeepslateWorks01` puts the old world back by a rename. If the PR is already merged, the old world runs with the new
  pack (the new mods only add land in new chunks): acceptable for a night; decide the rest in daylight.
- After players have played on the new world, R6 would lose their progress: not without Alex.

## 7. Hard rules

- Only the chunks of the approved set, in `region/`, `entities/` and `poi/` of the main world and Ashmoon, are
  deleted, and only from the work copy. The instance's world is renamed aside, never deleted.
- Nothing on the AMP host outside `/home/ladm/regen-2026-10/` and `/home/amp/regen-keep/` is written, apart from
  the instance's `world` by R4. The old worlds of 2026-10-09/10 (about 180 GB in `/home/amp/season1-trim-keep/` and
  `/home/ladm/livetrim/`) are listed for Alex, not removed.
- The api never starts live for pre-generation and never ends its process (docs/11 "Pre-generation from the portal").
- If a step does not show what this doc says, stop with the server in a safe state (stopped, or running with
  pre-generation off) and report.
- "We're live" and the news item are Alex's.

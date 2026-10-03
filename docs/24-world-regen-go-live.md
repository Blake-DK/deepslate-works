# 24 · The world made again, 100 chunks pre-generated, then live

Planner, 2026-10-03, on Alex's "regen the first 100 chunks around spawn to go live". Input for the VPS session: read it, don't rewrite it. Report in `docs/11-status.md`.

## 1. What this is

The one world reset that was promised for after the vote (docs/11 to-do 8, docs/20 decision 3, `ROADMAP.md` "World terrain"). Today's world was generated on 2026-09-29, before Create, Farmer's Delight, the building mods, Cataclysm and Mowzie's Mobs went in, so its first 1500 blocks have none of their ores, crops or structures. The nearest boss structure is 10,000 blocks out.

**Reading taken** (Alex can overrule any of these before saying go):

1. **The whole world is made again**, same seed, not only the region files around spawn. Cutting chunks out of the old world would leave old terrain wherever anyone walked beyond them and would keep player data that points at blocks that are gone. The procedure in docs/09 "A new world" has been run once and is the one used here.
2. **"100 chunks" is a radius**: 100 chunks each way from spawn, 1600 blocks, a square of 201 × 201 = **40,401 chunks**. The last run was 1500 blocks (35,721 chunks), so this is that area and a little more.
3. **Everything in the world goes**: builds, inventories, positions, advancements, claims and parties, waystones, corpses, the `verified` tag. The whitelist, the links between Discord and Minecraft accounts, early access, sessions and the event log are the portal's and stay.
4. **"We're live" is Alex's click**, last, after he has stood in the new world himself.

## 2. Before anything is touched (gates)

Stop and report if any of these is not so. Do not work around one.

- [ ] **The vote "Season 1 mods" is closed and Apply results has run**, then Lock, Build and Sync. The pack the world is made with is the pack people will play. A mod added after this step has no ores or structures within 1600 blocks, which is the fault this reset exists to fix. If the vote is still open, that is Alex's to close (Admin → Pack → Votes); say so and wait.
- [ ] **The server has been started once with that pack**: "Done", no ERROR line that was not there before (the `createdeco:placard` recipe is known). Gateways to Eternity and Multiplayer Bosses stay off, as docs/11 left them.
- [ ] The Sophisticated Backpacks pins are off if this Lock allows it (docs/11, bosses report). If CI's `check-sides` refuses, leave them and say so.
- [ ] **Nobody is online** and the three early testers have been told in Discord by Alex.
- [ ] `GET /api/health`: tunnel ok, amp ok, rsync ok. `webapp` still holds `Settings.MinecraftModule.Limits.SleepMode` and the two backup permissions.
- [ ] **Alex has said "go" in the session**, after reading the gate results. This doc is not the go.

## 3. Steps

Each step ends with what was seen, in the report. Every console command goes through the action registry. Every stop goes through `quiesce()`.

**A. Put the old pre-generation away.** `POST /pregen/off`, then `POST /pregen/cancel` (chunky still holds a finished task for radius 1500). `GET /pregen` shows mode off and no area in hand.

**B. Back up, twice, and prove both.**
1. `POST /server/backup` while the server runs, named "Before the go-live reset". It must appear in AMP's list with a size.
2. Stop the server. Copy `world/` down over the rsync link, compare by checksum, copy it up as `world-backup-<YYYYMMDD>/`, compare by checksum again (docs/09, word for word). Keep the copy on the VPS under `/root/docker/deepslate/backups/world-<YYYYMMDD>-before-go-live/`.
3. `world-backup-20260929/` and its VPS copy are not touched. If disk on either side is short, report sizes and wait, do not delete an older backup to make room.

**C. Empty the world and the map.** Server stopped.
1. Dry run of the emptying of `world/`: it must list deletions and nothing else. Then the real one.
2. The same for `bluemap/web/maps/world`, `world_the_nether`, `world_the_end` (docs/09 "The map shows old tiles").
3. Nothing else in the instance is deleted. Not `config/`, not `defaultconfigs/`, not `mods/`.

**D. First start.** `POST /server/start`, wait for "Done".
1. `world.seed` answers `-3899835130120818196`. `level.dat` says the same. If not, stop: the seed is AMP's (`MinecraftModule.Minecraft.WorldSeed`) and only Alex sets it.
2. Read the spawn from `level.dat`. The seed is the same but the pack is not, so the height may differ. `world.standable` at `SPAWN_POS`. If `0.5 105 0.5` is no longer a place to stand, report the new spawn and set `SPAWN_POS` in `deploy/.env` to it (x and z stay 0.5, 0.5 if the game still spawns at 0, 0), then `deploy/deploy.sh`.
3. `world/serverconfig/` has Open Parties and Claims' file with the shipped values (200 claims, `deepslate:limbo` unclaimable): a new world takes them from `defaultconfigs/`. Read it back and say so.

**E. The room.** Sync (the two datapacks live in `world/datapacks/` and went with the world), restart, `world.datapacks` lists `deepslate-limbo` and `deepslate-tools`, then `limbo.build`. `LIMBO_POS` is unchanged.

**F. Pre-generate and render.** `POST /pregen/on` with:

```json
{ "mode": "now", "what": "both", "purge": false, "area": { "x": 0, "z": 0, "radius": 1600 }, "window": null, "capHours": null }
```

- The card must say 40,401 chunks. Mode "now" because the site is not live and the only people who can join are admins and one early-access member.
- The plan switches AMP's sleep off and gives it back at the end. No wake loop, no start by the api, no ending of the process: the rules of docs/11 "Pre-generation from the portal" stand unchanged.
- If someone does join and the server lags, Stop on the card, tell Alex, carry on when they have left. Do not kick anyone.
- Report: start and end time, chunky's rate, the size of `world/` afterwards, then BlueMap at 100% for the overworld.
- The nether and the end are not pre-generated.

**G. Check that the reset did what it was for.** On the running server, from spawn:
1. `world.locate` for one Cataclysm structure, one Mowzie's structure and `minecraft:village_plains`. Report each distance. Before the reset the boss ones were 10,000 to 14,700 blocks away. If none of the modded ones is within about 3000 blocks, say so plainly, it is a finding, not a failure of the step.
2. The village at about 203 blocks and the cherry grove at about 278 are still there. If a worldgen mod moved them, report what is near spawn instead, the news item of 2026-09-29 describes them.
3. No new ERROR line during the generation. "Can't keep up" lines during chunky are expected and are not reported one by one.

**H. A backup of the finished world.** `POST /server/backup`, "Fresh world, 1600 pre-generated". This is what going live can fall back to.

**I. Write it down.** docs/11: a section for this run with the table of steps and what was seen, "Where the build stands" rows for the server and the map, to-do 8 and 9 struck. docs/09 "A new world": the date and anything that differed from the first time. `ROADMAP.md`: the "World terrain" line done, the docs/20 line reworded now that its deadline has passed. A news item is **not** posted by the session, Alex posts it with going live.

## 4. Alex's part, after the report

1. Join with Bramble09 **without** being let through as an admin if that can be arranged, otherwise have one of the three testers join: entrance room, link or code, released at spawn on the ground, not in a tree and not in the air.
2. Walk to the village. Look at the map on the site.
3. Admin → Site settings → **We're live**.
4. Tell the planner the date and hour. Season 1 starts one month after it (docs/20 §4) and the planner sets the dates in the season file.

## 5. Hard rules

- Nothing is deleted before its copy has been compared by checksum on both sides.
- Only `world/` and the three BlueMap map folders are emptied. A delete anywhere else needs Alex's yes, per `the working rules`.
- The api never starts the server for the pre-generation and never ends its process. `POST /server/kill` stays what it is: Alex's, and only in "Stopping".
- If a step does not show what this doc says it should, stop there with the server in a state that is safe to leave (stopped, or running with pre-generation off) and report. Do not improvise the next step.
- "We're live" is not pressed by a session.

## 6. Acceptance

- [ ] Seed `-3899835130120818196`, new `world/`, made with the pack that the closed vote produced.
- [ ] Two backups of the old world proven by checksum, one backup of the new world after pre-generation.
- [ ] 40,401 chunks at 100%, sleep mode given back to what it was.
- [ ] Room rebuilt in `deepslate:limbo`, both datapacks enabled, `SPAWN_POS` a place to stand.
- [ ] BlueMap overworld rendered to 100% with no tiles of the old world.
- [ ] Distances to a Cataclysm structure, a Mowzie's structure and the village reported.
- [ ] A real account has come through the entrance room to spawn (Alex's part).
- [ ] docs/11, docs/09 and `ROADMAP.md` say what happened.

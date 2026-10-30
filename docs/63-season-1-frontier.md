# 63 · Season 1's bosses arrive as a new world: the Frontier, in order (plan, 2026-10-29)

Docker-01v session, 2026-10-29, for Alex. Builds on docs/51 (Seasons 1 and 2), docs/44 (season mods), docs/36
(worlds) and docs/11's entries of 2026-10-28 (new terrain, the live regen prepared) and 2026-10-29 (village mods).
**Where this file and docs/51 §5 (B, C) or §6 decision 1 differ, this file holds.** Season 1's content, calendar and
the opening on Tue 1 December 19:00 UK are unchanged. Nothing here is built or run yet.

**Alex (2026-10-29):** Season 1 is not switched on, and its bosses come in as a new world, not as a change to the
main overworld.

## 1. What has changed since docs/51 was written (2026-10-11)

1. **The live overworld is about to be regenerated** with Overhauled Overworld, Streams Reflowing and the village
   mods (CTOV with Lithostitched, Villages&Pillages, Tidal Towns). Everything of x −11,264 to 13,119, z ±10,180 that
   players have not touched is made again. It is made without the Season 1 mods, so it holds no boss structures, as
   Alex wants.
2. **The Frontier must be made with the same worldgen as live.** It uses the vanilla overworld biomes, so Overhauled
   Overworld's trees and plants, Streams and the new villages all reach it. Generated on test with the s1 mods but
   without those mods, it would not match the land live makes beyond it.
3. **The test server now runs a fresh world on live's seed** (both `level.dat` read, 2026-10-28). docs/51 §6
   decision 1 assumed this; it is now true. Same seed, same mods, same datapack: the same Frontier.
4. **docs/51 §8 item A5 (the Frontier's own copies of the biomes) is not built**, and it is the large one. Without
   it, once the s1 mods are on live, Cataclysm's and Mowzie's structures would be made in every new chunk anywhere:
   the main overworld beyond the regen's edge, new Nether and new End. §3 below offers a smaller way.
5. **The test server ships `s1` today** (`TEST_SEASONS_SHIP=s1`), so the land it makes now has boss structures in
   its overworld too. That spoils the preview of the live regen; it is being taken off (another session).
6. **The test Frontier is where the rehearsals and testers fight.** A boss killed there before the copy would be
   missing on live. So the copy is taken from a snapshot made straight after the pre-generation (§2 step 5).
7. docs/51's dates for B (19 October to 15 November) have slipped; nothing of B has run. The VPS is gone: test and
   live are both on the AMP host at home, so the copy is local.

## 2. The order

| # | When | Who | What |
|---|---|---|---|
| 1 | now | other session | `s1` off test (`TEST_SEASONS_SHIP` empty), so the test overworld shows the regen as live will get it |
| 2 | to about Sun 8 Nov | Alex | The preview on test: terrain and village mods, no s1. Alex says the land is right |
| 3 | by Sun 15 Nov | Alex, AMP host | **The live regen** (docs/11, 2026-10-28): the terrain and village mods go to `main` with `"ship": []`; backup, the cut in the offline window, Build, Sync, full pre-generation. Live never makes land with the s1 mods |
| 4 | after step 2, alongside step 3 | this repo | **The seal** (§3) and the worldgen freeze (§4) on `dev`, with tests |
| 5 | after step 2 | Alex, AMP host | **The Frontier on test.** `TEST_SEASONS_SHIP=s1`, the seal off, Build, Sync, start. Nobody online: pre-generate `deepslate:frontier_s1`, centre 0 0, radius 3,000 (about 141,000 chunks; time and disk written down). Stop. **Snapshot** `world/dimensions/deepslate/frontier_s1/` (all of it) as the pristine copy for live. Then `locate structure` for every Season 1 boss structure from the arrival point, the coordinates kept as a table (docs/51 B2) |
| 6 | straight after 5 | Alex, AMP host | The seal on test, restart. Checks: the Frontier's bosses are still in their structures (two visited); `locate` finds no Cataclysm or Mowzie's structure in a new chunk anywhere; Mowzie's mobs only in the Frontier; a PC joins. From here test stays on `s1` with the seal |
| 7 | 16 to 22 Nov | Alex, two players | docs/51 B3 to B5 on test: the rehearsal, the temple and portal, the weak-PC check. In the test Frontier, after the snapshot |
| 8 | Mon 23 Nov | Alex, AMP host | The opening rehearsed on test (docs/51 C6), the copy step timed from the snapshot |
| 9 | Tue 24 Nov | this repo | News and Discord, a week ahead (docs/51 C7) |
| 10 | Tue 1 Dec, from 16:00 UK | Alex, AMP host | **The opening** (below) |

**The opening, Tue 1 December**, live stopped for the copy, nobody online:

1. Backup of live's world and a database dump.
2. The `dev` → `main` PR: `index.json` `"ship": ["s1"]`, the seal on, the change log entry for players. Merged;
   Redeploy; Build; Sync (the five mods, `deepslate-season-s1`, `deepslate-frontier-s1`, the seal, the Frontier's
   map).
3. Live stopped: the pristine snapshot copied to live's `world/dimensions/deepslate/frontier_s1/` **before** live
   first starts with the Frontier's datapack. `seed` of both read again first.
4. Start. Health clear; `execute in deepslate:frontier_s1` at two boss structures from the table finds them.
5. The arrival platform in the Frontier (`world.arrival` when built, else by hand), the portal in the temple lit.
6. 19:00 UK: Start in Admin → Seasons. The season post.

The Frontier is never generated on live; if the snapshot is lost or does not load, the fallback is to pre-generate
it on live in the same window with the seal off, then seal and restart (§5 decision 5).

## 3. The seal: boss structures only where they already are

Instead of docs/51 §8's biome copies, for Season 1:

- **On test, during step 5 only,** the s1 mods run as they come, so the Frontier's 141,000 chunks get their
  structures and bosses.
- **Everywhere else and from then on** a datapack (`deepslate-seal-s1`, built from the repo) replaces with empty
  lists every Cataclysm `has_structure/*` biome tag, Mowzie's `has_mowzie_structure`, and the amethyst nest's biome
  list in its structure file. No new chunk on any world can start a boss structure. What was made in the Frontier
  stays: a structure's pieces and its boss are saved in the chunks.
- **Mobs:** Mowzie's `spawn_config.dimensions` names only `deepslate:frontier_s1`; Cataclysm's three spawn tags
  emptied and the Ignited Berserker's weight 0 (Cataclysm has no setting by dimension).
- **What it costs:** Cataclysm's small mobs (deeplings, wild amethyst crabs, koboletons) spawn nowhere, the
  Frontier included; `locate` no longer finds the Frontier's structures on live, so admins use step 5's table; land
  beyond radius 3,000 in the Frontier has no boss structures. Step 6 shows whether any of Season 1's counted bosses
  needs one of those spawns.
- **Size:** S to M (one datapack, two configs, a Build switch to leave it out for step 5, tests), against L for A5.
  A5 stays the way forward if step 6 shows the seal breaks a boss, and for a later season if Alex wants new
  structures in more than one world.

## 4. The worldgen freeze

From step 5 to the opening, the lock entries that shape land do not change: Overhauled Overworld, Cristel Lib,
Streams Reflowing, CTOV, Lithostitched, Villages&Pillages, Tidal Towns, Cataclysm, Mowzie's, Lionfish, and NeoForge
itself. Any other mod may move. If one of these must move, step 5 is done again. The same versions are on live from
the regen (step 3), so live's land beyond the Frontier's edge joins it cleanly.

## 5. What players see

- **Until 1 December:** nothing of Season 1. The regen is its own news item when it happens: new land past where
  anyone has built, nothing they made is touched.
- **24 November:** "Season 1 opens on Tuesday 1 December at 19:00. Your next Play after that downloads the boss mods
  (about 110 MB). The bosses live in the Frontier, a new world through the portal in the temple at spawn."
- **1 December, 19:00 UK:** the server is back with the new pack. The door asks each player to press Play once
  (Cataclysm, Mowzie's Mobs, Lionfish API, Curios; Ender Dragon Fight Remastered is on the server only). At spawn,
  the temple and its lit portal; through it, the arrival platform in the Frontier. `/season`, the Home line and the
  pinned post say where each boss lives. The main overworld looks as it did after the regen; no boss is ever made
  there.
- **Testers** (docs/57) get the same mods on the test server from step 6.

## 6. Open decisions, with the recommendation

1. **The seal (§3) instead of the biome copies (docs/51 §8, A5) for Season 1.** Recommended: yes. It meets "bosses
   only in the new world" with a fraction of the work and is proven in step 6 before anything reaches live. *Blocks:*
   step 4.
2. **The order: the live regen before s1 ships anywhere but test, and s1 back on test only after the preview.**
   Recommended: as in §2. The regen and the Frontier's pre-generation can then run in the same weeks. *Blocks:*
   steps 3 and 5.
3. **The worldgen freeze (§4) from step 5 to 1 December.** Recommended: yes; the alternative is pre-generating the
   Frontier again after any change. *Blocks:* step 5.
4. **Large biomes, radius 3,000** (docs/51 §6 decision 3). Recommended: keep, unless step 5's table shows a Season 1
   structure missing or further than 2,500 blocks; then radius up to 4,000 before the snapshot. *Blocks:* nothing
   until step 5.
5. **How the Frontier reaches live** (docs/51 §6 decision 1). Recommended: the pristine snapshot copied at the
   opening, as docs/51 said, now from a snapshot taken before anyone enters the test Frontier. Fallback: pre-generate
   on live in the opening window (seal off, then on), timed from step 5. *Blocks:* the opening.
6. **When the boss mods reach players' PCs.** Recommended: at the opening, by the next Play, as docs/51 §1 says
   (mods change only at a changeover); 110 MB is small enough for one evening. *Blocks:* nothing.

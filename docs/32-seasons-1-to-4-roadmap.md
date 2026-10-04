# 32 · Seasons 1 to 4 roadmap

VPS session, 2026-10-04 (review and planning; nothing built, nothing changed on the server). It builds on `docs/20-seasons-bosses-trials.md` (the mechanism: season file, Frontier, recording, `/season`), `docs/21-discord-feed.md` §6 and `docs/22-discord-bot.md` §13 (the Discord moments). Where this file and docs/20 differ, docs/20 is the mechanism and this file is the content and the calendar. The bug list that goes with it is `docs/31-review-and-bug-list.md`.

## 0. What is fixed, and the calendar

Decided by Alex, not reopened here:

- Seasons run 6 weeks. Season 1 starts a month after go-live.
- The main world is permanent. Part of a season is on the main world, part is off world in a zone that is reset each season.
- Boss mods go straight into the pack, not through the vote.
- The pack stays light: every addition has a load rating and a view on LOW-tier PCs.
- Season moments post to Discord: "the boss has awoken" in game chat, a post in season-updates for each new boss or mob.

**Go-live date.** The brief says 2026-10-04. `docs/11-status.md` does not record the "We're live" click (its last word is "left: Alex's look and We're live"), and this session cannot read the setting (no admin session, no database). The dates below stand on Alex's word; if the click was on another day, move every date by the same number of days.

| Season | Opens (Wednesday) | Finale evening (Saturday) | Ends, zone reset (Wednesday) |
|---|---|---|---|
| 1 · First Blood | 4 Nov 2026 | 12 Dec 2026 | 16 Dec 2026 |
| 2 · The Drowned and the Frozen | 16 Dec 2026 | 23 Jan 2027 | 27 Jan 2027 |
| 3 · Fire and Iron | 27 Jan 2027 | 6 Mar 2027 | 10 Mar 2027 |
| 4 · The Otherside | 10 Mar 2027 | 17 Apr 2027 | 21 Apr 2027 |

Each boundary Wednesday is a changeover day: End season (freeze), backup, zone reset, new pack, new season opens that evening. Mods change only on those four days (docs/20 decision 8), so a player updates once per season, by pressing Play.

**Rhythm inside every season** (proposed, Decision 1): something new every Friday at 19:00 UK (a trial opens, a boss joins the ladder), the finale on the last Saturday at 20:00 UK, then four quiet days to finish trials before the freeze.

**How difficulty ramps.** Season 1 can be finished alone or in pairs with iron and diamond. Season 2 wants two or three people per boss. Season 3 wants a group and has the first timed and no-death trials. Season 4 is the hardest content in the pack, with a boss rush as the finale. Nobody is locked out by having missed a season: rewards are trophies, titles and points, never better gear (docs/20 decision 6).

**Names.** "First Blood", "the Frontier" and the other names are working names (docs/20 §11 question 2, Decision 2).

## 1. What is common to all four seasons

**Detection, one path.** Every boss kill and every trial ends in an advancement of the season datapack, and the server prints `<name> has made the advancement [<title>]` or `has completed the challenge [<title>]`. `apps/api/src/events/parse.ts` already reads those lines. Titles are unique across seasons and the build fails on a duplicate (docs/20 §4). Trials that need counting (a timer, a death count, a wave number) count on a scoreboard inside the datapack and the datapack grants the advancement when the count is met, so the portal still sees one kind of line. The api never reads a scoreboard. The safety net is docs/20's: `world/advancements/<uuid>.json` read at server start and every 10 minutes while somebody is on.

**Group credit.** Everybody within 48 blocks of a boss kill gets the tick and the trophy (docs/20 decision 7).

**Tracking in the portal.** `Season` and `SeasonClear` (docs/20 §7), `/season` with ladder, trials, scoreboard and hall of fame, one line on Home, the banner in the app.

**Rewards.** A trophy item per boss (vanilla item, custom name and lore, no stats), a title per season shown on `/season`, the player page and in the Discord post, and points. First on the server gets the points twice and the name on the ladder for good.

**The off-world zone, in general.** One dimension per season under `world/dimensions/…`, reached by a waystone at spawn and left by a waystone at its own spawn (docs/20 §5). What a player carries out, they keep: ores, loot, trophies. What stays is lost at the reset: builds, chests, waystones placed there, beds, corpses. No claims in the zone. The reset is docs/20's wipe: everyone moved to main-world spawn, a backup taken in the same run, server stopped, the one named folder deleted, server started. Until Alex has watched one wipe, the delete is a printed command for him, not automatic.

**The same seed problem, and the proposed answer.** A datapack dimension cannot carry its own seed in 1.21.1, so a second overworld with the same noise settings is a copy of the main world. docs/20 uses `minecraft:large_biomes` for Season 1. For later seasons: Minecraft seeds each noise from the world seed and the noise's own id, so a copy of the vanilla noise settings whose noises are renamed (`deepslate:s2/continentalness` instead of `minecraft:continentalness`, and so on) gives different terrain from the same seed. **Not verified on the server.** It must be proven on a throwaway dimension before Season 2's zone is promised (work item W2.1). If it does not hold, the fallback is `large_biomes` again with the zone's spawn moved 20,000 blocks out, which is different ground for all practical purposes.

**What persists on the main world, every season.**
- Trophies, as items.
- Titles and points, on `/season` → Hall of fame, frozen at End season.
- **The Hall of Fame at spawn**: a small building inside the spawn claim with one alcove per season: a sign with the season's name and dates, the top three as player heads, a sign per boss with who was first. Written by an action (`hall.update`, in the registry, values from `SeasonClear`, no free text) at End season. New, not in docs/20 (Decision 9).
- The old zone's BlueMap render, kept read-only as "Frontier · Season N" in the hall of fame (docs/20 §5).
- The bosses themselves: a season decides which fights count, the mods stay. A Season 1 boss killed in Season 3 gives loot and no points.

**Load, and weak PCs.** Ratings as in `mods.json`: L light, M medium, H heavy. Today's pack is 74 files in the lock. The check docs/20 §3 asked for (a measured LOW-tier PC standing in a Cataclysm dungeon, FPS and memory written down) has still not been done, and it gates Season 1, not only the later ones. Every mod below gets the same check before it goes in: server started once, time to "Done" against today's 18.5 s, one LOW-tier PC in the new content. A mod that fails it is cut, the season runs on what the pack already has.

**Gateways to Eternity and Multiplayer Bosses stay out** in this plan. Gateways needs Apothic Attributes, which changes armour, Protection and crits for everyone (docs/11, step 1 report). Multiplayer Bosses never lowers a boss's health again and has a dead config switch. Wave fights are done with a datapack arena instead (Season 3). Decision 4 if Alex wants Gateways anyway.

## 2. Season 1 · First Blood (4 Nov to 16 Dec 2026)

**Pitch:** "The world has monsters with names now. Find them, beat them with a friend, get your name on the wall."

**Theme:** the overworld. Learn the ladder, learn the Frontier, one easy win a week.

### Bosses

No new mod. Everything is already in the lock and has been started on the server.

| Mod | Slug | Version in the lock (Modrinth, NeoForge 1.21.1, checked 2026-10-04) | Side | Load | Needs | Conflicts |
|---|---|---|---|---|---|---|
| Mowzie's Mobs | `mowzies-mobs` | 1.8.2, `xgAXTl17`, still the newest | both | M | `geckolib` (in the lock) | none seen |
| L_Ender's Cataclysm | `l_enders-cataclysm` | 3.33, `PsPYpoCC`, still the newest | both | M | `lionfish-api`, `curios` (in the lock) | none seen |
| Ender Dragon Fight Remastered | `edf-remastered` | 5.0.2+mod, `5OYoqItD`, still the newest | server | L | none | anything else that rebuilds the End island (see Season 4) |

Candidates that were open, and the recommendation:

1. **No new mod (recommended).** The first season should prove the machinery (season file, Frontier, recording, Discord posts, the wipe) with content that is known to start. Entity ids are already verified (docs/11).
2. Illager Invasion, `illager-invasion` v21.1.6-1.21.1-NeoForge (`9bEpNrvK`), both, L, needs Puzzles Lib 21.1.62 (`1TmfTuyw`). Adds illager minibosses to raids. Small, but it changes raids on the main world for everybody. Not now.
3. Gateways to Eternity for the trials. Held, see §1.

**Ladder** (ids as verified on the server in docs/11):

| Tier | Boss | Entity | Where | For | Points |
|---|---|---|---|---|---|
| 1 | The Elder Guardian | `minecraft:elder_guardian` | Ocean monument | 1 to 2 | 10 |
| 1 | Frostmaw | `mowziesmobs:frostmaw` | Snowy biomes | 1 to 2 | 10 |
| 1 | The Ferrous Wroughtnaut | `mowziesmobs:ferrous_wroughtnaut` | Wrought chamber, underground | 1 to 2 | 10 |
| 2 | Umvuthi, the Sunbird | `mowziesmobs:umvuthi` | Umvuthana grove, savanna | 2 to 3 | 15 |
| 2 | The Warden | `minecraft:warden` | Ancient city | 2 to 3 | 15 |
| 2 | The Wither | `minecraft:wither` | Summoned | 2 to 3 | 15 |
| 2 | Cataclysm's lesser guardians: Amethyst Crab, Coralssus, Kobolediator | `cataclysm:amethyst_crab`, `cataclysm:coralssus`, `cataclysm:kobolediator` | Amethyst nest, sunken city, cursed pyramid | 2 to 3 | 10 each |
| 3 | The Ender Dragon, remastered | `minecraft:ender_dragon` | The End, the finale evening | everybody | 30 |

The Sculptor (`mowziesmobs:sculptor`) is left for Season 2: it is a climbing puzzle and a hard fight in one.

### Trials

One opens each Friday. All are plain advancement criteria, so nothing new has to be parsed.

| Week | Trial | Solo or group | Detected by | Reward |
|---|---|---|---|---|
| 1 | Iron Week: wear a full set of iron and carry a shield | solo | `inventory_changed` | 5 points |
| 2 | First Steps Out: stand in the Frontier | solo | `changed_dimension` to the zone | 5 points |
| 3 | The Engineer: hold a Precision Mechanism (Create) | solo | `inventory_changed` | 10 points |
| 4 | Ominous: open an ominous vault in a trial chamber | group of 2 to 3 suggested | `item_used_on_block` on an ominous vault (the criterion vanilla's "Revaulting" uses; check its shape on the server) | 15 points |
| 5 | Hero of the Village: win a raid | group | `hero_of_the_village` | 15 points |
| 6 | The Dragon, together | everybody | the dragon's kill advancement, 48-block rule widened to the whole End for this one | 30 points and the season trophy |

**Server goal:** "50 boss kills between us", counted by the portal from `SeasonClear`, shown as a bar on Home.

### The zone: the Frontier

As docs/20 §5 writes it: datapack `deepslate-frontier-s1`, dimension `deepslate:frontier_s1`, overworld biomes on `minecraft:large_biomes`, radius 3,000, pre-generated with Chunky through the Pre-generation card (which gains a dimension picker), a BlueMap map "Frontier · Season 1". One waystone at spawn named "The Frontier", one in the zone named "Home", both placed by `frontier.build`. Waystones' server config must allow travel between dimensions and the pack ships no Waystones config today: read the default and ship the file.

**Why it matters in Season 1:** on the main world the boss structures exist only inside ±3,072 blocks of spawn (made again on 2026-10-03) and again from about 11,600 blocks out. The Frontier is fresh ground where every Cataclysm and Mowzie's structure generates.

**Reset:** 16 Dec, by the wipe of docs/20 §5, watched by Alex, the delete as a printed command.

### Week by week

| Week | Friday drop | Also |
|---|---|---|
| 1 (4 Nov) | Season opens Wednesday: the Frontier, tier 1 bosses, Iron Week | Season post in season-updates, pinned |
| 2 (13 Nov) | First Steps Out | First "has awoken" lines expected |
| 3 (20 Nov) | The Engineer; tier 2 opens (Umvuthi, Warden, Wither) | Three boss posts |
| 4 (27 Nov) | Ominous; Cataclysm's lesser guardians join the ladder | "New this week" post |
| 5 (4 Dec) | Hero of the Village | "A week to go" on 9 Dec |
| 6 (11 Dec) | Finale Saturday 12 Dec 20:00 UK: the Dragon, together | End season and the wipe on Wednesday 16 Dec |

### Work needed

Must ship before 4 Nov unless marked "can follow". Sizes S (under a day), M (one to three days), L (a week).

| # | Where | What | Size | Before opening? |
|---|---|---|---|---|
| W1.1 | modpack | `build seasons`: season file → datapack (advancements, wake advancements, trophies, reward functions), lint (duplicate titles, unknown entity, dates), sample season, tests. docs/20 step 3 | L | yes |
| W1.2 | modpack, api | The Frontier: dimension datapack, `frontier.build`, Waystones config, OPAC no-claim in that dimension, Pre-generation card with a dimension picker, BlueMap map. docs/20 step 2 | L | yes |
| W1.3 | api, web | Recording: `Season`, `SeasonClear`, the recorder on ADVANCEMENT events, the advancements-file reader, `SEASON` event kind. `/season`, the Home line, `GET /api/season/current` | L | yes |
| W1.4 | web, api | Admin → Seasons: lint, Build and reload (`season.reload`), Start, End (freeze), give and take back a tick (`season.grant`, `season.revoke`). docs/20 step 4 | M | Start yes; End by week 5 |
| W1.5 | bot, api | Season moments: docs/21 §6 lines and docs/22 §13 forum posts (season, boss, trial posts with `threadId`), "has awoken" | M | yes |
| W1.6 | launcher | The season banner on the Play tab, xUnit for the five states. docs/20 §7 | S | can follow in week 1 |
| W1.7 | api, AMP host | The wipe: `frontier.evacuate`, hold-at-join for offline players, backup in the same run, the printed delete command. docs/20 step 6 | M | by week 5 |
| W1.8 | api | `hall.update` and the Hall of Fame building at spawn | S | by week 6 |
| W1.9 | person | The LOW-tier check in a Cataclysm dungeon (docs/20 §3, §10), still open | S | yes, it gates Cataclysm counting at all |
| W1.10 | AMP host | Room for the Frontier (pre-generated radius 3,000 and its map), `world/dimensions/deepslate/frontier_s1` in the backup or deliberately out of it, who may delete the folder | S | yes |
| W1.11 | web | Guide section "Season" from the current file (docs/18) | S | can follow |

A month is tight for three L items in one session's hands. The order that protects the opening day: W1.1, W1.3, W1.2, W1.5, W1.4, then the rest. Try the whole thing with the sample season a week before (docs/20 §9: "finished and tried a week before that date", so by 28 Oct).

### Discord moments

- Season post in season-updates on 4 Nov: "Season 1 · First Blood has begun. Six weeks, a trial every week." Pinned.
- One post per boss the first time it is woken or named: "Frostmaw · Season 1", with replies "has awoken", "has fallen, first on the server, to …".
- One post per trial each Friday at 19:00 UK.
- In #game-chat and in game: "Frostmaw has awoken. samoyedx and m1owl are in the fight."
- 9 Dec "A week to go", 11 Dec and 12 Dec the finale reminders, 16 Dec "Season 1 has ended" with the top three, then "The Frontier has been reset."

### Risks, cost, and what to cut

- **The build is the risk, not the content.** If it runs late, cut in this order: the app banner (W1.6), the Hall of Fame building (W1.8), the server goal bar, "has awoken" (keep kills), the forum posts (fall back to plain lines in #game-chat). Never cut: recording and the freeze.
- **If the Frontier is not ready,** open the season on the main world inside ±3,072 (the structures are there) and open the Frontier in week 3 with its own restart. First Steps Out moves to that week.
- **Performance:** no new mod. The Frontier adds disk (pre-generation and map), not client load. A second loaded dimension costs the server memory only while somebody is in it.
- **Weak PCs:** Cataclysm arenas are the unknown (W1.9).

## 3. Season 2 · The Drowned and the Frozen (16 Dec 2026 to 27 Jan 2027)

**Pitch:** "Something big lives under the sea, and something worse is frozen in the ice. Bring friends and a boat."

**Theme:** oceans and ice. Cataclysm's overworld bosses, in groups of two or three. It runs over Christmas and New Year, so weeks 2 and 3 are light and can be done alone at odd hours.

### Bosses

From the pack already: The Leviathan (`cataclysm:the_leviathan`, sunken city), Scylla (`cataclysm:scylla`, acropolis), Maledictus (`cataclysm:maledictus`, frosted prison), The Ancient Remnant (`cataclysm:ancient_remnant`, cursed pyramid), The Sculptor (`mowziesmobs:sculptor`, monastery).

One new mod, three candidates (Modrinth API, NeoForge 1.21.1, read 2026-10-04):

| | Slug | Version, id, date | Side | Load | Needs | Notes |
|---|---|---|---|---|---|---|
| **A, recommended** | `aquamirae` | 7.2.10, `iUPJ8ziU`, 2026-09-20, release | both | **M** (25 MB jar) | Fragmentum 5.1.1 (`NuCBdQM6`, 7.6 MB, new library), `geckolib` (in the lock) | An ice maze in frozen oceans with a ghost ship and Captain Cornelia. Fits the theme exactly. Its structures need fresh frozen-ocean chunks, which the Season 2 zone gives |
| B | `bossesrise` | 2.1.2, `lE9PF6Wp`, 2026-05-21, release | both | M (23 MB) | `geckolib` | Souls-style bosses in their own structures. No new library, but no link to the theme, and harder than Season 2 should be |
| C | none | | | | | Cataclysm's five are a full season on their own. The safe choice if Aquamirae fails its start or its LOW-tier check |

Known conflicts with the lock: none found in either mod's Modrinth dependency data (no `incompatible` entries). Not known until the server has started with it: Fragmentum next to Sodium 0.8.13 and Iris on PCs (Fragmentum is a rendering and animation library), Aquamirae's ocean structures next to Cataclysm's sunken city. Both are the "start it once and send one LOW-tier PC in" check, to be done in week 5 of Season 1.

**Ladder:** tier 1 The Sculptor and Captain Cornelia (2 to 3 players, 15 points), tier 2 The Ancient Remnant, Scylla, Maledictus (3 or more, 20 points), tier 3 The Leviathan as the finale (everybody, 30 points).

### Trials

| Week | Trial | Solo or group | Detected by | Reward |
|---|---|---|---|---|
| 1 | Sea Legs: visit a deep frozen ocean in the zone | solo | `location` with biome | 5 |
| 2 | Christmas Dinner: eat five different Farmer's Delight meals | solo | `consume_item`, one criterion per meal | 10 |
| 3 | The Conduit: stand in full conduit power | solo or pair | `effects_changed` | 10 |
| 4 | The Maze: reach the ghost ship in the ice maze | group | `location` with structure (id read from the server, never typed from memory) | 15 |
| 5 | Monument Men: kill three Elder Guardians in one evening | group | datapack scoreboard, reset each day, grants the advancement at three | 20 |
| 6 | The Leviathan, together | everybody | boss kill | 30 and the trophy |

**Server goal:** "Catch 1,000 fish between us" is tempting but needs statistics read from files; keep it to events the portal already has: "75 boss kills between us".

### The zone: the Frozen Frontier

`deepslate:frontier_s2`, overworld biomes, on renamed-noise settings (§1) so the ground is new. If the renamed noises do not hold up, `large_biomes` with the zone's spawn 20,000 blocks out. Radius 3,000. Same waystone pair, same rules. The zone's spawn is put on a coast (the build action looks for one within the pre-generated area, or Alex picks the spot on the map).

**Reset:** 27 Jan. Season 1's Frontier map stays in the hall of fame; Season 2's joins it.

### Persists

Trophies (a Leviathan trophy, Cornelia's), the title "of the Deep" for a full ladder, the Season 2 alcove in the Hall of Fame, the Frozen Frontier's map.

### Week by week

| Week | Friday drop | Also |
|---|---|---|
| 1 (16 Dec) | Opens Wednesday: new pack, the Frozen Frontier, tier 1, Sea Legs | Everybody updates by pressing Play; "New this season: Aquamirae" post |
| 2 (25 Dec, drop moved to Wed 23 Dec) | Christmas Dinner | Light week |
| 3 (1 Jan, drop moved to Wed 30 Dec) | The Conduit | Light week |
| 4 (8 Jan) | The Maze; tier 2 opens | Three boss posts |
| 5 (15 Jan) | Monument Men | "A week to go" on 20 Jan |
| 6 (22 Jan) | Finale Saturday 23 Jan: the Leviathan | End and wipe 27 Jan |

### Work needed

| # | Where | What | Size | Before opening? |
|---|---|---|---|---|
| W2.1 | modpack | Renamed-noise generator for a new zone per season (`build frontier <id>`), proven on a throwaway dimension | M | yes, by Season 1 week 4 |
| W2.2 | modpack | Aquamirae and Fragmentum in `mods.json` (adventure category), Lock, verify-links, start the server once, structure and entity ids read from the server | S | yes, checked in Season 1 week 5 |
| W2.3 | person | One LOW-tier PC in the ice maze | S | yes |
| W2.4 | modpack | Season file `s2.json`; the daily-reset scoreboard trial | M | yes |
| W2.5 | web, api | Moved drops (a trial's `opensAt` is already a date, so nothing to build); "what changed in the pack" on the season post | S | yes |
| W2.6 | api | The first automatic wipe, if Alex watched Season 1's and said yes | S | by week 5 |
| W2.7 | AMP host | Disk after two zones' maps; the old Frontier's BlueMap folder kept, the old dimension folder gone | S | yes |

### Discord moments

"Season 2 has begun" with what changed in the pack; a post for Captain Cornelia as the new boss ("New this season"); the two holiday trials posted on their moved days; the Leviathan finale reminders; the end with the top three; "The Frozen Frontier has been reset".

### Risks, cost, and what to cut

- **Holidays.** People are away or have more time, nobody knows which. The light middle keeps both happy. If the finale date is bad, it moves a week earlier, not later (the wipe date stays).
- **Performance:** +33 MB of download, one new library that touches rendering. Rated M. If the LOW-tier check fails, cut Aquamirae (candidate C) and the season loses one boss and one trial, nothing else.
- **Changeover on 16 Dec is the first with a mod change and a wipe on the same day.** Rehearse on a copy, or do the wipe on Tuesday night.
- Cut first: Monument Men (the scoreboard trial), then Aquamirae.

## 4. Season 3 · Fire and Iron (27 Jan to 10 Mar 2027)

**Pitch:** "The Nether is not empty any more. Build the best gear your factory can make, because you will need it."

**Theme:** the Nether and the machines. The first season that asks for a group and for the tech mods (Create, Immersive Engineering, the guns) to be used in anger.

### Bosses

From the pack already: Ignis (`cataclysm:ignis`, burning arena), The Netherite Monstrosity (`cataclysm:netherite_monstrosity`, soul black smith), The Harbinger (`cataclysm:the_harbinger`, ancient factory, overworld). The two Nether structures have no place in overworld biomes (docs/11), so they need the Nether or a Nether-type zone.

One new mod, three candidates:

| | Slug | Version, id, date | Side | Load | Needs | Notes |
|---|---|---|---|---|---|---|
| **A, recommended** | `bosses-of-mass-destruction-forge` | 1.3.3, `snhDYBxP`, 2026-07-17, release | both | **L** (1.9 MB) | CERBON's API 1.3.0 (`5wbxkBQ1`), Cloth Config 15.0.140+neoforge (`izKINKFg`), `geckolib` (in the lock) | Four set-piece bosses: the Night Lich, the Nether Gauntlet, the Obsidilith, the Void Blossom. Small jar, two small libraries. The original `bosses-of-mass-destruction` is Fabric only; this is the port |
| B | `mutant-monsters` | v21.1.1-1.21.1-NeoForge, `dauEcrnZ`, 2025-11-17, release | both | L (1.3 MB) | Puzzles Lib 21.1.62 (`1TmfTuyw`) | Mutant zombies, creepers, skeletons and endermen that spawn everywhere, the main world included. Makes every night harder for everyone, which the casual players did not ask for |
| C | `borninchaos` | 1.7.6, `ttcWWp3r`, 2026-06-17, release | both | M (11.5 MB) | `geckolib` | Many aggressive mobs everywhere. Same objection as B, and heavier |

Known conflicts: none in the dependency data. To check at the first start: Bosses of Mass Destruction's structures in the End next to Ender Dragon Fight Remastered (the Obsidilith sits on End islands, not the main island, so a clash is unlikely but unproven), and Cloth Config is `optional` on both sides on Modrinth although the mod lists it as required: the lock's side rule must send it to both.

**Ladder:** tier 1 The Night Lich and The Harbinger (3 players, 20 points), tier 2 The Nether Gauntlet and The Netherite Monstrosity (3 to 4, 25 points), tier 3 Ignis as the finale (everybody, 35 points).

### Trials

The first counted trials. All counting is in the datapack; the portal sees advancements.

| Week | Trial | Solo or group | Detected by | Reward |
|---|---|---|---|---|
| 1 | Fireproof: stand in the zone's Nether wearing a full set of netherite or better | solo | `location` plus equipment predicate | 10 |
| 2 | The Arsenal: craft a Create Big Cannons cannon barrel and an Immersive Engineering revolver | solo | `inventory_changed`, item ids read from the server | 10 |
| 3 | The Arena, wave 5: an arena in the zone where waves are summoned by a function, counted on a scoreboard | group of 2 to 4 | scoreboard → advancement | 20 |
| 4 | Speed Run: kill the Wither within 3 minutes of summoning it | group | a timer scoreboard started by the wake advancement, checked in the kill reward | 20 |
| 5 | The Arena, wave 10, nobody dies | group | scoreboard, a death inside the arena resets the run | 30 |
| 6 | Ignis, together | everybody | boss kill | 35 and the trophy |

**Server goal:** "100 boss kills between us".

### The zone: the Furnace

`deepslate:frontier_s3`, a Nether-type dimension (Nether biomes, renamed-noise copy of `minecraft:nether`'s settings, so it is not the main Nether again). Cataclysm's burning arena and soul black smith generate by biome, so they appear there. Radius 1,500 (Nether travel is short and Nether chunks are expensive to render). The waystone pair as before; the arena is built at the zone's spawn by an action (`arena.build`, a structure file in the datapack) and claimed for the server.

The main Nether is untouched and permanent. Bosses found there count as well.

**Reset:** 10 Mar.

### Persists

Trophies; the title "Fireproof" for a full ladder; an Arena champions sign in the Hall of Fame (the best wave reached, by group); the Furnace's map.

### Week by week

| Week | Friday drop | Also |
|---|---|---|
| 1 (27 Jan) | Opens Wednesday: new pack, the Furnace, tier 1, Fireproof | "New this season: four new bosses" post |
| 2 (5 Feb) | The Arsenal | |
| 3 (12 Feb) | The Arena opens (wave 5); tier 2 opens | Arena post, with the best wave edited in |
| 4 (19 Feb) | Speed Run | |
| 5 (26 Feb) | The Arena, wave 10, nobody dies | "A week to go" on 3 Mar |
| 6 (5 Mar) | Finale Saturday 6 Mar: Ignis | End and wipe 10 Mar |

### Work needed

| # | Where | What | Size | Before opening? |
|---|---|---|---|---|
| W3.1 | modpack | A Nether-type zone from the generator of W2.1; check the two Cataclysm structures generate in it (`locate` on the server) | M | yes |
| W3.2 | modpack | The arena: structure file, wave functions, scoreboards, the no-death rule, `arena.build`. Tried with two real players | L | by week 3 |
| W3.3 | modpack | Timed trials: timer scoreboard in the season datapack's tick function (one objective, players with the wake tag only, so the per-tick cost does not grow with the player count) | M | by week 4 |
| W3.4 | modpack | Bosses of Mass Destruction, CERBON's API, Cloth Config in `mods.json`; Lock; start once; ids from the server; LOW-tier check | S | yes |
| W3.5 | web | `/season`: an arena board (best wave per group) | S | by week 3 |
| W3.6 | bot | Arena post with the record edited into the first message | S | by week 3 |
| W3.7 | AMP host | Disk, and the tick time with a second Nether loaded during a fight (spark, from the console) | S | yes |

### Discord moments

"Season 3 has begun"; four boss posts for the new bosses; "The Arena is open"; a line in #game-chat for every new arena record; the Speed Run's first finishers; the Ignis finale; the end; "The Furnace has been reset".

### Risks, cost, and what to cut

- **The arena is the largest piece of new datapack work in the plan** and the first thing that ticks every game tick. A badly written selector is a server-wide cost. Keep every selector limited to players tagged as inside the arena.
- **Performance:** the mod is small (L). The cost is server side: two Nethers and boss arenas with many entities. ServerCore's activation range already throttles mobs outside player range.
- **Weak PCs:** Ignis's arena is fire, particles and a large model. Particle Rain and shaders are extras, not base, so a LOW-tier PC runs it bare. Check it in week 5 of Season 2.
- Cut first: the wave-10 no-death trial, then Speed Run, then the whole arena (replace with two "do a thing" trials). The mod is cheap, cut it last.

## 5. Season 4 · The Otherside (10 Mar to 21 Apr 2027)

**Pitch:** "There is a door under the ancient cities, and the dragon has learned new tricks. One last push, everybody."

**Theme:** the deep dark and the End. The hardest fights in the pack, and a boss rush to close the year.

### Bosses

From the pack already: The Ender Guardian (`cataclysm:ender_guardian`, ruined citadel, the End), the Obsidilith and the Void Blossom if Season 3 took Bosses of Mass Destruction, the remastered Dragon again, at the end of a rush.

One new mod, three candidates:

| | Slug | Version, id, date | Side | Load | Needs | Notes |
|---|---|---|---|---|---|---|
| **A, recommended** | `deeperdarker` | 1.4.1-neoforge-1.21.1, `TuD0Zvi3`, 2026-06-05, release | both | **L to M** (3.8 MB) | none | A portal in ancient cities to the Otherside, a sculk dimension with its own mobs and the Stalker boss. No libraries. **It brings its own dimension, which is this season's zone**, so no generator work |
| B | `aether` | 1.21.1-1.5.10-neoforge, `K5X5qMwG`, 2025-09-28, release | both | M to H (39 MB) | owo-lib (required, **beta only** for 1.21.1: 0.12.15.5-beta.1, `NMCHU6DZ`), Accessories and Cumulus embedded | Three dungeon bosses in a sky dimension, friendlier than A. But a beta library, a second accessories system next to Curios, and a year since its last release |
| C | `eternal-starlight` | 0.9.1+1.21.1+neoforge, `IyTc0Vvj`, 2026-09-20, release | both | H (58 MB) | none | A full dimension with bosses. Still before 1.0, the largest download of all candidates |

Also looked at and not recommended: End Remastered (`endrem` 6.3.0, `Xzg42PX9`), which replaces the eyes of ender with a hunt for sixteen custom eyes. A good season-long trial on paper, but it changes how the End is reached on the permanent main world. The Twilight Forest has no Modrinth project (searched 2026-10-04), so it is out by the Modrinth-only rule. YUNG's Better End Island rebuilds the same island Ender Dragon Fight Remastered does: not together.

Known conflicts: none in the dependency data. To check at the first start: Deeper and Darker's sculk shaders and particles on a LOW-tier PC (the Otherside is dark, fog-heavy and full of sculk animation), and its portal blocks inside OPAC claims.

**Ladder:** tier 1 The Warden, three in one night (group, 20 points), tier 2 The Stalker and The Ender Guardian (4 or more, 30 points), tier 3 the Rush (below, 50 points).

### Trials

| Week | Trial | Solo or group | Detected by | Reward |
|---|---|---|---|---|
| 1 | The Door: enter the Otherside | solo | `changed_dimension` | 10 |
| 2 | Quiet as the Grave: spend ten minutes in an ancient city without a Warden being summoned | pair | scoreboard timer in a structure, reset by the Warden's spawn | 20 |
| 3 | Deep Collector: hold one of each of the Otherside's signature items | solo | `inventory_changed`, ids from the server | 15 |
| 4 | Glass Cannon: kill the Ender Guardian wearing no chestplate | group | equipment predicate in the kill criterion | 30 |
| 5 | Veterans: kill any three bosses from Seasons 1 to 3 in one evening | group | scoreboard, daily reset | 25 |
| 6 | The Rush: the Wither, the Ender Guardian and the Dragon, in that order, in 45 minutes, on the finale evening | everybody | timer scoreboard across three kill advancements | 50 and the year's trophy |

**Server goal:** "150 boss kills between us", and a year-end line: total kills across the four seasons.

### The zone: the Otherside

The mod's own dimension, `deeperdarker:otherside` (id to be read from the server). No Frontier this season, which also gives the Frontier machinery a rest. Reached by the mod's portal in ancient cities, and, so that nobody has to find a city first, a waystone pair as in every season (the zone waystone placed by `frontier.build` pointed at the mod's dimension).

**Reset:** 21 Apr. The wipe deletes `world/dimensions/deeperdarker/otherside/` and nothing else; the wipe action takes the folder from the season file (W4.2), still one named folder with the server stopped.

**Bring home:** as always, what you carry. The mod's gear is strong (sculk-tier armour and tools): that is this season's loot, by the mod's own design, and it is the one place where "rewards are not better gear" bends. Say so on the Season page (Decision 6).

### Persists

Trophies; the titles "Otherside Walker" and, for the Rush, "Year One"; the Hall of Fame's fourth alcove and a year board (most points over four seasons); the Otherside's map.

### Week by week

| Week | Friday drop | Also |
|---|---|---|
| 1 (10 Mar) | Opens Wednesday: new pack, the Otherside, The Door, tier 1 | "New this season" post |
| 2 (19 Mar) | Quiet as the Grave | |
| 3 (26 Mar) | Deep Collector; tier 2 opens | Two boss posts |
| 4 (2 Apr) | Glass Cannon | Easter weekend: a light social week, no group deadline |
| 5 (9 Apr) | Veterans | "A week to go" on 14 Apr |
| 6 (16 Apr) | Finale Saturday 17 Apr: the Rush | End, wipe and the year board on 21 Apr |

### Work needed

| # | Where | What | Size | Before opening? |
|---|---|---|---|---|
| W4.1 | modpack | Deeper and Darker in `mods.json`; Lock; start once; dimension, entity and item ids from the server; LOW-tier check in the Otherside | S | yes |
| W4.2 | api, modpack | The wipe and the map take the zone's dimension folder from the season file instead of assuming `deepslate/frontier_<id>` | S | yes |
| W4.3 | modpack | The Rush: one timer across three kill advancements; a rehearsal with admins | M | by week 5 |
| W4.4 | modpack | Structure-bound timer trial (Quiet as the Grave) | M | by week 2 |
| W4.5 | web | Year board in the hall of fame | S | by week 6 |
| W4.6 | planner | What comes after Season 4: a break, a Season 5, or a vote on it | S | by week 4 |

### Discord moments

"Season 4 has begun"; a post for the Stalker as the new boss and "the Otherside is open"; the Rush announced a week ahead with the time; live lines in #game-chat during the Rush ("The Wither has fallen, 31 minutes left"); the end with the top three and the year's top three; "The Otherside has been reset".

### Risks, cost, and what to cut

- **Weak PCs are the real risk this season**: sculk, fog and particles. If the LOW-tier check fails, the zone becomes a plain Frontier (End-type, renamed noises, with Cataclysm's ruined citadel in it) and the season runs on the Ender Guardian and the Rush.
- **The Rush can fail on the night.** That is allowed: it is a trial, not a gate. The season still ends with the Dragon kill counting on its own.
- **Gear creep** from the Otherside's loot (Decision 6).
- Cut first: Quiet as the Grave (the fiddliest detection), then Glass Cannon, then the mod.

## 6. Pack growth over the four seasons

| Season | Added | Download added | Files in the lock (today 74) | Load |
|---|---|---|---|---|
| 1 | nothing | 0 | 74 | no change |
| 2 | Aquamirae, Fragmentum | about 33 MB | 76 | +M |
| 3 | Bosses of Mass Destruction, CERBON's API, Cloth Config | about 3.3 MB | 79 | +L |
| 4 | Deeper and Darker | about 3.8 MB | 80 | +L to M |

Six files and about 40 MB in half a year. Nothing is removed at a season's end: taking a mod out deletes its blocks and items from the permanent world. That is the cost of "bosses on the main world" and the reason each choice above is small and has no worldgen in the main overworld beyond new structures in new chunks.

All versions above were read from the Modrinth API on 2026-10-04 and will have moved by the time each season is locked: check again at Lock, as always.

## 7. Where we can improve

The whole project, ranked by value against effort. Bugs are in `docs/31-review-and-bug-list.md` and are named here only where the improvement is larger than the fix. "Value" is for the players and for Alex's evenings; sizes as above.

| Rank | Area | What | Why | Size |
|---|---|---|---|---|
| 1 | Backups and restore | Prove one restore of each kind and write down how long it took: the database dump into a throwaway Postgres, a world archive from the NAS into scratch, one object from S3. Copy the database dumps off the VPS. Then build docs/28 §9 (runner, schedule, Admin → Backups, Discord lines) | Nothing has ever been restored (docs/31 B-07). A backup that has not been restored is a hope | S, then L |
| 2 | Reliability | The entrance room keeps its state in the database (docs/31 B-02 to B-04), and Admin warns when the site's pack and the server's differ (B-12) | The door is the one thing every player passes every evening. Today it forgets everything at each deploy | M |
| 3 | Monitoring and alerting | Something outside the VPS watches `/api/health` (open since Phase 3), and health grows the things that fail silently: age of the newest dump, age of the newest world backup, `pack.same`, api's own health, the tunnel's last handshake. A red field posts to the admin channel once | B-01 was visible in `/api/health` for hours and nobody was told | S |
| 4 | Deploy | Images pinned to the commit, api health required, a dump before migrations, log size caps (B-08, B-09, B-19, B-21) | Four small changes in two files remove the ways a deploy can go wrong quietly | S |
| 5 | Player experience | Phase 4, the small half: "take me to spawn" and "unstick me" on the site and in the app, through the action registry | The most common request on any friends' server, and the registry has been waiting for its first player action | M |
| 6 | Performance on weak PCs | Measure instead of estimate: the app already reports hardware; add FPS and memory from the game's own log at the end of a session, shown per tier in Admin. Do the LOW-tier boss check before each season. Move the app's 2-second game watch off the UI thread (B-56). Re-rate Cataclysm and Mowzie's and fix the saturated load bar (B-31) | "Weak PCs are first-class" rests on one measured tier and no measured frame rates | M |
| 7 | Onboarding | A confirm step on the link (B-06), a clearer invite page (B-15), `/install` with a picture per step (docs/10 item 16), and the app updating before the gate (docs/10 item 17) so nobody is ever stuck on an old copy | The first ten minutes decide whether a friend comes back | M |
| 8 | Test coverage | A CI job with a real Postgres that applies the migrations and runs a few real queries (B-40); tests for the door's restart paths, Sync, and the link flow (B-65); a version-bump check for the app (B-61) | Every production fault so far was in code with no test that could have seen it | M |
| 9 | Security | web stops holding secrets it does not use and stops writing `.git` (B-17, B-18); leaving Discord really ends access (B-05); the cookie is not passed to BlueMap (S-06); the exe is signed (docs/07, pending) | The site is the one internet-facing part | S to M |
| 10 | Admin tooling | Admin → Seasons (in this roadmap); "what changed" between two locks before Sync; a "who is held and why" card on the Control Room with a Release button; in-page confirms instead of `window.confirm` (docs/10 item 9) | Alex should not need a console or a session to see why a friend cannot get in | M |
| 11 | Pack upkeep | Pin NeoForge (B-25); a weekly "newer versions" report from Modrinth with changelog lines (ROADMAP "later ideas"); take the Sophisticated pins off (B-10); mods change at season boundaries only | Keeps the pack still between seasons and makes each boundary a known piece of work | S |
| 12 | Discord | The feed survives a restart without repeats (B-46); intents retried (B-47); unlinked names marked (B-50); a real reconnect night recorded | Season moments will make Discord the group's front page | M |
| 13 | Docs | Bring docs/02, 03, 04, 05, 06, 09 up to the code (docs/10 item 13 and docs/31's drift list); `ROADMAP.md` "In progress" rewritten; record the go-live click; delete merged remote branches on Alex's yes (71 today) | The status file is 268 KB; the short docs are what a new session reads first | S |
| 14 | Admin assistant | docs/19, read-only | Useful, but everything above makes it less needed | M |

## 8. Decisions for Alex

Each with the recommendation and what it holds up.

1. **The weekly hour and the finale night** (docs/20 §11 question 1). Recommended: drops on Friday 19:00 UK, finales on the last Saturday 20:00 UK, seasons change over on Wednesdays. *Blocks:* the Season 1 file (W1.1) and every date in this plan.
2. **Names**: "First Blood", "The Drowned and the Frozen", "Fire and Iron", "The Otherside", "the Frontier". Recommended: keep them, they are only strings in a file. *Blocks:* the Season 1 file and the first Discord post.
3. **Season 1 with no new mod.** Recommended: yes. *Blocks:* nothing; a no means a Lock, a server start and a LOW-tier check before 4 Nov.
4. **Gateways to Eternity** (with Apothic Attributes, which changes armour and Protection for everyone). Recommended: leave out for all four seasons; the Season 3 arena is a datapack. *Blocks:* W3.2's shape.
5. **One boss mod each for Seasons 2, 3 and 4**: Aquamirae, Bosses of Mass Destruction, Deeper and Darker, each only after its start and LOW-tier check. Recommended: yes to all three as the plan, decided for good one season ahead. *Blocks:* W2.2 by 2 Dec, W3.4 by mid January, W4.1 by late February.
6. **Season 4's loot is better gear** (the Otherside's armour and tools), against docs/20 decision 6. Recommended: allow it, say so on the Season page. *Blocks:* nothing until February.
7. **What leaves the zone.** Recommended: whatever a player carries; builds, chests and corpses are lost at the reset, said plainly on the Season page and a week before each reset. *Blocks:* the guide text (W1.11) and the wipe's warning lines.
8. **Who deletes the zone's folder.** Recommended: Alex, from a printed command, for Season 1; automatic from Season 2 if he watched the first and is happy. *Blocks:* W1.7 and the AMP host's permissions.
9. **A Hall of Fame building at spawn**, written by the portal at each season's end. Recommended: yes, a small one; Alex builds the shell, the portal fills signs and heads. *Blocks:* W1.8.
10. **"Has awoken" in the month before Season 1** (docs/21 §12 question 3). Recommended: no; it needs the season datapack, which is the month's work. *Blocks:* nothing.
11. **Fix order for docs/31.** Recommended: B-01 today; then the door (B-02 to B-04), the link (B-05, B-06), the restore rehearsal (B-07) and the deploy pins (B-08, B-09) before any season work starts. *Blocks:* the start of W1.1.
12. **Play first while B-01 to B-04 are open.** Recommended: off until B-01 is fixed, on again after. *Blocks:* friends getting in tonight.
13. **External monitoring of `/api/health`** (Uptime Kuma on the homelab, or another). Recommended: yes, with the admin channel as the alert. *Blocks:* improvement 3.
14. **Was "We're live" pressed on 2026-10-04?** If on another day, the calendar in §0 moves by the difference. *Blocks:* the dates.

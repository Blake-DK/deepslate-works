# 20 · Seasons, bosses and trials

Planner, 2026-10-02. Input for the VPS session: read it, build it in the order of §9, record deviations in `docs/11-status.md`.

## 1. Why and what it is

A small server of friends goes quiet after two or three weeks: everybody has a base, nobody has a reason to log in on the same evening. This adds three things that give a reason and that can be topped up without touching the world:

- **Bosses**: a ladder of fights, some for one player, most for a group.
- **Trials**: named challenges with a tick, a score and a first-to-finish.
- **Seasons**: six weeks with a theme, a ladder, a set of trials, a scoreboard and a finale. Then the scoreboard is frozen into a hall of fame and the next season starts.

The whole thing is driven by one file per season in the repo (principle 3: the manifest is the truth). Adding a trial is a commit, a Build and a Sync; nobody reinstalls anything.

## 2. Decisions (Alex, 2026-10-02)

1. **The main world is permanent.** No season ever resets it. Bases, factories and claims stay.
2. **Some of a season is on the world, some is off it.** Bosses and their dungeons generate in the main world. Each season also has its own dimension, **the Frontier**, which is wiped when the season ends (§5).
3. **Boss mods go straight in**, not through the vote: L_Ender's Cataclysm and Mowzie's Mobs, in the base of the pack before the world is made again after the vote closes, so their structures exist from the first chunk.
4. **A season runs six weeks.** Start and end are dates in the manifest, changeable by an admin.

Planner's defaults, change them if Alex says otherwise:

5. **Rewards are trophies, titles and points, not better gear.** The bosses drop their own loot already. A season must not leave late joiners behind.
6. **Group kills count for the group.** Everybody within 48 blocks of a boss kill gets the tick.
7. **Mods change only at a season's start.** Inside a season only data changes (trials, gateways, dates), which needs no update on any PC.

## 3. Mods

Checked on the Modrinth API on 2026-10-02 for NeoForge 1.21.1. Check again at Lock, as always.

| Slug | What | Side | Newest | Pulls in | When |
|---|---|---|---|---|---|
| `l_enders-cataclysm` | Eight or so large bosses, each in its own dungeon, with their gear | both | 3.33, release, 2026-09-20 | `lionfish-api`, `curios` | now |
| `mowzies-mobs` | Four smaller bosses met while exploring, good for two or three players | both | 1.8.2, release, 2026-03-15 | `geckolib` | now |
| `edf-remastered` | The Ender Dragon with a second phase and 500 health. PCs do not need it | server | 5.0.2+mod, release, 2026-07-16 | none | now |
| `gateways-to-eternity` | Trials as wave fights: open a gateway, beat the waves, take the reward. Gateways are data files | both | 1.21.1-5.1.0, release, 2026-06-19 | `placebo` (already in the lock), `apothic-attributes` | now, see the check below |
| `multiplayerbosses` | Boss health and loot by the number of players near | both | 1.0.0, release, 2026-03-15 (the only build) | none | only if the test in §9 step 1 says it works with Cataclysm |
| `enhanced-celestials` | Blood moons and harvest moons | both | 6.0.2.6, release, 2026-08-07 | two libraries | not now: a drop for a later season |

`mods.json`: a new category `adventure` ("Bosses & trials", `votable: false`), entries `enabled: true`, `recommended: false`, libraries `hidden: true` as elsewhere. Load: Cataclysm **M**, Mowzie's **M**, Gateways **L**, EDF **L**. Wiki and video links verified by `verify-links` like every other entry.

Before any of this is built on (the working rules: start the server once with any new server-side mod):

- Start the server with all of them. No errors at start and the time to "Done" noted against today's 16 s.
- **Apothic Attributes changes things by being there** (new attributes, changes to some potions and to how armour works). Read what it changes on this pack with TaCZ and Corpse. If it changes combat in a way the friends would notice, say so in the status and leave Gateways out until the planner answers. The trials list (§6) works without it.
- One LOW-tier PC (measured tier) joins and stands in a Cataclysm dungeon. FPS and memory written down. If it does not hold, report before the world is made again.
- Cataclysm's and Mowzie's entity ids and structure ids are read from the jars or the running server (`/summon` tab completion, the registries), never typed from memory or from this doc.

## 4. The season file

`modpack/seasons/<id>.json`, one per season, plus `modpack/seasons/index.json` naming the current one. Shape (field names are the builder's to settle):

```json
{
  "id": "s1",
  "name": "Season 1 · First Blood",
  "startsAt": "2026-10-10T16:00:00Z",
  "endsAt": "2026-11-21T16:00:00Z",
  "frontier": { "dimension": "deepslate:frontier_s1", "noise": "minecraft:large_biomes", "radius": 3000 },
  "bosses": [
    { "id": "elder_guardian", "title": "The Elder Guardian", "entity": "minecraft:elder_guardian", "tier": 1, "points": 10, "where": "Ocean monument", "hint": "Bring milk and a door." }
  ],
  "trials": [
    { "id": "week1_iron", "title": "Trial: Iron Week", "opensAt": "2026-10-10T16:00:00Z", "points": 5, "kind": "advancement", "criteria": { "trigger": "minecraft:inventory_changed", "conditions": {} }, "hint": "…" },
    { "id": "gate_small", "title": "Trial: The Small Gate", "opensAt": "2026-10-17T16:00:00Z", "points": 15, "kind": "gateway", "gateway": "deepslate:s1/small" }
  ],
  "finale": { "at": "2026-11-21T18:00:00Z", "title": "The Dragon, together", "boss": "ender_dragon" }
}
```

`pnpm modpack build seasons` (part of `build server`) turns it into a datapack `deepslate-season-<id>`:

- One advancement per boss and per trial under `deepslate:<id>/…`, in its own tab of the advancements screen (root: the season's name, a background, the season's icon). `announce_to_chat: true`, `show_toast: true`, frame `challenge` for bosses and `task` for trials.
- **Titles are unique across all seasons and a test fails the build if two are equal.** The server's console line carries only the title (`<name> has completed the challenge [<title>]`), which is what `events/parse.ts` already reads; the title is how the portal knows which trial it was.
- A boss advancement: `minecraft:player_killed_entity` with the entity type. Its reward is a function that grants the same advancement to every player within 48 blocks (`execute at @s run advancement grant @a[distance=..48] only …`) and gives each of them the trophy (below).
- A trial of kind `advancement` passes `criteria` through as written. A trial of kind `gateway` is granted by the gateway's completion reward (a command reward, if the mod has one; check). If it has none: the api grants it when it reads the gateway's completion line in the console, pattern in `events/parse.ts` with a test against a real line.
- Trials before their `opensAt` are in the datapack as `hidden: true`. Finishing one early counts and is shown on the site as "found early".
- Trophy: a loot table per boss giving one named item with lore ("Season 1 · The Elder Guardian · <date is not possible, leave it out>"), no stats. Plain vanilla items with custom name, lore and enchantment glint.
- Lint in the modpack package: unknown entity or advancement trigger, a duplicate id or title, `opensAt` outside the season, dates that do not parse.

Data only, so: Build, Sync, then `reload` on the console through the action registry (new action `season.reload`). No restart, no new pack version on PCs. The season datapacks are **not** part of the pack hash that Play first compares.

A new Frontier dimension is the one thing that needs a restart (a new dimension counts from the next start, as with limbo).

## 5. The Frontier

One extra dimension per season, an overworld with different terrain, made for exploring, mining out and boss hunting, so the main world's surroundings are not stripped and so that **mods added in a later season have fresh chunks to generate their structures in**. Wiped when the season ends.

- Datapack `deepslate-frontier-<id>`: `dimension/frontier_<id>.json`, type `minecraft:overworld`, noise generator with the overworld biome source.
- **Seed.** In 1.21.1 a dimension file cannot carry its own seed, so with `minecraft:overworld` settings the Frontier would be a copy of the main world. Use other noise settings per season: `minecraft:large_biomes` for Season 1, `minecraft:amplified` is too heavy for weak PCs, so later seasons need settings of their own (a copy of the overworld's with shifted noises). Verify on the server that the terrain at 0,0 differs from the main world before anything else. If this turns out not to be workable, report; do not add a dimensions mod unasked.
- **Getting there and back.** Waystones, nothing new for players to learn: one waystone at spawn named "The Frontier", one in the Frontier at its spawn named "Home", both placed and named by an action (`frontier.build`, same manner as `limbo.build`) and both protected (spawn protection or an admin claim). Check that Waystones allows travel between dimensions in its server config and ship that setting. Beds and respawn anchors work as in the overworld; a death there drops a corpse there.
- **No claims in the Frontier.** Open Parties and Claims: forbid claiming in that dimension if its config can (check); if it cannot, say so on the Season page: "Nothing in the Frontier is kept."
- **Pre-generation and the map.** Chunky to the manifest's `radius` through the existing Pre-generation card, which gains a dimension picker. BlueMap gets a map for it, named "Frontier · Season 1".
- **The wipe**, at season end, admin only, behind a confirmation that names the folder and its size: everyone in the Frontier is moved to the main world's spawn (online by `execute in minecraft:overworld run tp`; offline players are moved at their next join, by the same hold-at-join that the door already has), a backup is taken, the server is stopped, `world/dimensions/deepslate/frontier_<id>/` is deleted and nothing else, the old datapack is removed, the next season's is in place, the server starts. The BlueMap render of the old Frontier is kept and shown read-only in the hall of fame ("Season archive" from ROADMAP's later ideas, now for the Frontier only).
- Until the first wipe has been watched through by Alex, the delete step is a printed command for him to confirm, not an automatic one.

## 6. What a season contains

Season 1 as a template. The planner fills the real file when §9 step 1 has reported the entity ids; the builder ships a small sample season for tests.

**Boss ladder** (three tiers, the season is "finished" by the group when tier 3 falls):

| Tier | Who | For |
|---|---|---|
| 1 | Elder Guardian, the Warden, the Mowzie's Mobs bosses | one to three players, first two weeks |
| 2 | The Wither, the first half of Cataclysm's bosses | a group, weeks three and four |
| 3 | The remastered Ender Dragon as the finale, on a named evening | everybody |

The other half of Cataclysm is Season 2's ladder. The mod is in from the start; a season only decides which fights count.

**Trials**, one new one opening each week on the same day, three kinds:

- *Do a thing*: plain advancement criteria. "Clear an ominous trial chamber", "ride a Create train 1,000 blocks", "cook every Farmer's Delight meal".
- *Beat a gateway*: one small (solo), one medium (two or three players), one large for the last fortnight. Gateway files under the season datapack; the pearl that opens one is the reward of the trial before it or a recipe.
- *Server goal*: one per season that everybody adds to and nobody wins alone, counted by the portal from events ("100 boss kills between us"). Shown as a bar on Home.

**Points**: per manifest. First clear of a boss or trial on the server gets the points again as a bonus and the name on the ladder for good.

## 7. Portal

**`/season`** (sidebar, Community, above Players & stats), for every member:

- Header: season name, "Week 3 of 6", days left, the next thing that opens and when.
- Ladder: each boss as a card: undefeated, or "First fell to samoyedx, m1owl and Bramble09 on 14 Oct", with heads. Where and hint from the manifest.
- Trials: this week's on top, each with who has done it; future ones as "Opens Friday".
- Scoreboard: points per player and the server goal's bar.
- Hall of fame tab: every finished season, frozen: ladder, scoreboard, the old Frontier's map.
- Home gets one line: "Season 1 · 12 days left · this week: The Small Gate".

**Admin → Seasons**: the seasons in the repo with their state (not started, running, ended), lint result of the file, buttons: Build and reload (data only), Start, End season (freezes the results, the same idea as closing a vote: a `resultJson` that never changes afterwards), Wipe the Frontier (§5) and "Give / take back a tick" for the cases the console line was missed, audited.

**Data**: `Season` (id, name, dates, state, `resultJson`), `SeasonClear` (season, kind boss or trial, item id, player, at, first, early, source: console, file or admin). Unique on season + item + player.

**Recording**: from the ADVANCEMENT events the api already makes, matched by title against the current season's file. Belt and braces, because a console line can be missed while the api restarts: at server start and every 10 minutes while somebody is on, read `world/advancements/<uuid>.json` for linked players through the file manager (as the inventory reader does) and add what is missing, with the time the file gives.

**Words on the site and in the event log**: "samoyedx beat the Elder Guardian (Season 1, first on the server)", "Trial opened: The Small Gate", "Season 1 ended. Bramble09 leads with 85 points". An announcement is made by itself when a trial opens, when a boss falls for the first time and when a season starts or ends; with the Discord bot (Phase 5) the same lines go to Discord.

**Guide** (docs/18): a "Season" section built from the current file: how to reach the Frontier, that it is wiped, what counts, that a group kill counts for all within 48 blocks.

## 8. Rules that stay

- No free text from a player reaches the console. Every new command is an action in the registry: `season.reload`, `season.grant`, `season.revoke`, `frontier.build`, `frontier.evacuate`.
- The wipe deletes one named folder inside the instance and only with the server stopped and a backup taken in the same run.
- Weak PCs first: if the LOW-tier check in §3 fails, Cataclysm does not go in on the planner's word alone. Report first.
- Sources are Modrinth only.

## 9. Order of work

1. **Mods and the check** (§3). Report: start time, errors, what Apothic Attributes changes, the LOW-tier numbers, the entity and structure ids, whether Multiplayer Bosses does anything to a Cataclysm boss. *This must land before the world is made again after the vote closes; it is the only step with a deadline.*
2. **The Frontier for Season 1** (§5) without the wipe: dimension, waystones, pre-generation, map. Goes in with the same world reset.
3. **Season file, build, datapack, recording, `/season`** (§4, §7) with the sample season. Read-only for players.
4. **Admin → Seasons**, start and end, the freeze, hall of fame.
5. **Gateway trials**, if step 1 cleared the mod.
6. **The wipe**, built and tried on a copy of the instance or a throwaway dimension before Season 1 ends.

## 10. Done when

- [ ] The server starts clean with the §3 mods and a LOW-tier PC plays in a Cataclysm dungeon at a frame rate Alex accepts.
- [ ] A player takes the waystone at spawn to the Frontier and back; the terrain there is not the main world's; it cannot be claimed.
- [ ] Killing a ladder boss with two players near gives both the tick, the toast, the chat line and the trophy and `/season` shows both within a minute with "first on the server".
- [ ] A trial added to the file reaches the game by Build, Sync and reload with nobody restarting or updating and shows on `/season` as open at its `opensAt`.
- [ ] A kill made while the api was down appears on `/season` within 10 minutes of the api coming back.
- [ ] Two equal titles, an unknown entity or a date outside the season fail the build with a line that says which.
- [ ] End season freezes the board; a later kill of a Season 1 boss changes nothing in the hall of fame.
- [ ] The wipe removes the Frontier's folder and nothing else, nobody is left inside it and the old map is still viewable.

## 11. Open, for Alex

1. The season's day and hour for weekly openings and the finale (a time most of the group can make).
2. Names: "the Frontier" and "Season 1 · First Blood" are placeholders.
3. Whether the first season starts with "We're live" or a week after, so people have a base first. Planner's suggestion: a week after.

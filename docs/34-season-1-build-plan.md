# 34 · Season 1 build plan

VPS session, 2026-10-04, for the planner to amend. Nothing in it is built. It turns `docs/20-seasons-bosses-trials.md` (the mechanism), `docs/32-seasons-1-to-4-roadmap.md` §2 (Season 1's content) and the planner's order of work (reply of 2026-10-04, section F) into what is built, in which order, how each piece is proven, and what has to be decided before the first line of code. Where it differs from docs/20 it says so and why.

Work lands on `dev` (the working rules "Branches"); `main` moves when Alex wants a deploy.

## 1. The pieces and the calendar

| # | Piece | What it is | Size | Needs |
|---|---|---|---|---|
| W1.1 | Season file and `build seasons` | `modpack/seasons/<id>.json`, lint, and a build step that turns it into a datapack | L | nothing |
| W1.3 | Recording and `/season` | `Season`, `SeasonClear`, the recorder, the advancements-file reader, the page, the Home line, `GET /api/season/current` | L | W1.1's file format |
| W1.2 | The Frontier | dimension datapack, `frontier.build`, Waystones and OPAC settings, pre-generation with a dimension picker, its map | L | one server restart; disk on the AMP host |
| W1.5 | Discord moments | season, boss and trial posts; "has awoken" | M | W1.3's `SEASON` events |
| W1.4 | Admin → Seasons | lint result, Build and reload, Start, End (freeze), give and take back a tick | M | W1.3 |
| W1.9 | LOW-tier check | one measured LOW-tier PC in a Cataclysm dungeon | Alex | a dungeon near spawn |
| W1.10 | Room on the AMP host | disk for the Frontier and its map; who deletes its folder | AMP host | docs/33 §4 |

**Alex, 2026-10-04, after this plan was written: a season is a month, from the last Monday to the last Monday (docs/32, "Amendment"). Season 1 opens on Monday 30 November 2026 at 19:00 UK and ends on Monday 28 December.** The build has eight weeks, not four; the dates below are the new ones, and every "4 November" and "28 October" further down this file reads "30 November" and "23 November".

| When | What |
|---|---|
| done 2026-10-04 | W1.1: the season files, lint, `build seasons` (on `dev`) |
| done 2026-10-04 | W1.3 recording and `/season`; W1.4 Admin → Seasons (announce, start, end, a tick given or taken back); W1.5 Discord moments; W1.2's datapack (on `dev`, docs/11 first section) |
| to 25 Oct | W1.3 |
| 26 Oct to 8 Nov | W1.2 and W1.5 |
| 9 to 15 Nov | W1.4 Start; the sample season end to end on `dev`; W1.11 the guide's Season section |
| 16 to 22 Nov | slack; W1.6 the app's banner |
| **Mon 23 Nov** | **Rehearsal** on the real server with the sample season (§7) |
| 24 to 29 Nov | fixes from the rehearsal |
| **Mon 30 Nov, 19:00 UK** | Season 1 opens |
| by 14 Dec | W1.7 the wipe, tried on a throwaway dimension; W1.4 End |
| by 21 Dec | W1.8 `hall.update` and the Hall of Fame |
| Sat 19 Dec, 20:00 UK | the finale (Alex, 2026-10-05: the Saturday before Boxing Day, not the last Saturday) |
| Mon 28 Dec | End season, the wipe, Season 2 opens |

If the build is behind at the rehearsal, the cuts are docs/32 §2's, in its order. Recording and the freeze are never cut.

## 2. W1.1 · the season file

`modpack/seasons/s1.json`, and `modpack/seasons/index.json` naming the current season and the sample. Shape as docs/20 §4, with the field names settled here:

```json
{
  "id": "s1",
  "name": "Season 1 · First Blood",
  "startsAt": "2026-11-30T19:00:00Z",
  "endsAt": "2026-12-28T19:00:00Z",
  "accent": "#b8652c",
  "icon": "minecraft:netherite_sword",
  "groupRadius": 48,
  "bosses": [
    { "id": "frostmaw", "title": "Frostmaw", "entity": "mowziesmobs:frostmaw", "tier": 1, "points": 10,
      "opensAt": "2026-11-04T19:00:00Z", "where": "Snowy biomes", "hint": "It sleeps until you come close. Bring a shield and a friend.",
      "trophy": { "item": "minecraft:blue_ice", "name": "Frostmaw's Tooth" } }
  ],
  "trials": [
    { "id": "iron_week", "title": "Iron Week", "opensAt": "2026-11-06T19:00:00Z", "points": 5, "solo": true,
      "hint": "Wear a full set of iron and carry a shield.",
      "criteria": { "trigger": "minecraft:inventory_changed", "conditions": {} } }
  ],
  "goal": { "title": "50 boss kills between us", "count": "boss_kills", "target": 50 },
  "finale": { "at": "2026-12-12T20:00:00Z", "title": "The Dragon, together", "boss": "ender_dragon", "groupRadius": 0 }
}
```

Differences from docs/20's sketch:

- **`opensAt` on bosses too.** docs/32's ladder opens in tiers (tier 2 in week 3, Cataclysm's lesser guardians in week 4). A boss killed before its `opensAt` counts and shows as "found early", as a trial does.
- **`trophy` per boss** in the file, so the planner or Alex changes an item by a commit.
- **`groupRadius`**, 48 by default; `0` on the finale means "everyone in that dimension" (docs/32: the 48-block rule widened to the whole End for the Dragon).
- **Times are UTC in the file** and shown in UK time everywhere. Lint refuses a time without `Z`.

Season 1's bosses, trials, points and weeks are docs/32 §2's tables, entered as they stand. Trophy items are proposed in the file for the planner to change.

## 3. W1.1 · `build seasons`

`pnpm modpack build seasons`, and part of `build server`. Output: `dist/server/datapacks/deepslate-season-<id>/`, which Sync already puts into `<world>/datapacks/`. Generated, never committed, and not part of the pack hash (docs/20 §4).

```
deepslate-season-s1/
  pack.mcmeta                                   pack_format 48, as the two datapacks we ship
  data/deepslate/advancement/s1/root.json       the season's tab: name, icon, background
  data/deepslate/advancement/s1/boss/<id>.json  frame challenge, announce_to_chat, show_toast
  data/deepslate/advancement/s1/wake/<id>.json  hidden, announce_to_chat, no toast ("Woke <title>")
  data/deepslate/advancement/s1/trial/<id>.json frame task; hidden until found
  data/deepslate/function/s1/boss/<id>.mcfunction   group credit, trophies, the wake taken back
  data/deepslate/function/s1/tick.mcfunction        the 15-minute wake timer
  data/deepslate/loot_table/s1/trophy/<id>.json     one named item, lore, glint, no stats
  data/minecraft/tags/function/tick.json            adds deepslate:s1/tick
```

- **A boss advancement:** trigger `minecraft:player_killed_entity` with the entity type; reward `function` `deepslate:s1/boss/<id>`.
- **Its function** (runs as the killer, at the killer): `advancement grant @a[distance=..48] only deepslate:s1/boss/<id>`; `loot give @a[distance=..48] loot deepslate:s1/trophy/<id>`; `advancement revoke @a[distance=..48] only deepslate:s1/wake/<id>`. With `groupRadius` 0 the selector is `@a[distance=0..]`, everyone in the killer's dimension.
  - **A trap to prove at the rehearsal:** granting the advancement to the others runs the reward function again for each of them. The function must not hand the trophy out twice. Proposed: the trophy is given only to players who do not yet hold a per-boss tag, and the function tags them. One line more, and it also stops a second kill of the same boss handing out a second trophy.
- **The wake advancement** (docs/21 §6): trigger `minecraft:player_hurt_entity` with the entity type. Taken back at the kill (above) and 15 minutes after it was got, by a scoreboard timer in `tick.mcfunction`. The tick function touches only players who hold a wake advancement's tag, so its cost does not grow with the player count.
- **A trial** passes `criteria` through as written. Counted trials (Season 3) are not built now.
- **Titles are unique across every season file in the repo**, wake titles included; the build fails on a duplicate and names both. The console line carries only the title, and that is how the portal knows what was done.
- **Lint** (in `packages/modpack`, run by CI): unknown entity namespace, a duplicate id or title, an `opensAt` outside the season, a date that does not parse or has no `Z`, a trophy item that is not `namespace:path`, a trigger not in the list of 1.21.1's triggers. Entity ids are checked against the list verified on the server on 2026-10-02 (docs/11), kept as `modpack/seasons/entities.json`; an id not in it is an error until somebody has checked it on the server and added it.
- **The sample season** `modpack/seasons/sample.json`: two vanilla bosses that take a minute to find (the Elder Guardian is too far: a Ravager and an Iron Golem), two trials (hold a crafting table; sleep in a bed), its own id `sample` and titles that no real season will use. It is what the tests build and what the rehearsal runs.

**Tests:** the file's schema and lint (each error with the line that says which), the datapack's tree against a snapshot of the sample season, every JSON file parses, every function line starts with a known command, titles unique across the real files in the repo, the generated pack has no file outside its own namespace except the tick tag.

**What the tests cannot show:** that Minecraft loads the files. Three things in particular are unproven until the server has seen them: the 1.21.1 shape of `player_killed_entity` and `player_hurt_entity` conditions for a modded entity, the reward function running for a granted (not earned) advancement, and `loot give` with custom name, lore and glint as item components. §7 is where they are proven.

## 4. W1.3 · recording

**Tables** (one migration): `Season` (`id`, `name`, `startsAt`, `endsAt`, `state` `upcoming | running | ended`, `resultJson`), `SeasonClear` (`seasonId`, `kind` `boss | trial`, `itemId`, `mcUuid`, `userId` nullable, `at`, `first`, `early`, `source` `console | file | admin`), unique on season + kind + item + player. As docs/20 §7.

**The recorder** (`apps/api/src/seasons/`): on every ADVANCEMENT event, the title is looked up in the current season's file (api reads `modpack/seasons/` from its read-only mount). A boss or trial title writes a `SeasonClear`; a wake title writes none. It waits 5 seconds after the first clear of a boss so that the group's names are one `SEASON` event (docs/21 §6). `first` is decided in the database, in one transaction, so two kills in the same second cannot both be first.

**The safety net:** at server start and every 10 minutes while somebody is on, `world/advancements/<uuid>.json` for linked players through AMP's file manager, as the inventory reader does; what is missing is added with `source: file` and the time the file gives.

**A new event kind `SEASON`**, visible to players (added to `PLAYER_KINDS`): season started, trial opened, boss awoken, boss fell (first, and again), trial done first, goal at 25/50/75/100 %, new leader (once a day at most), a week to go, the finale, season ended. Written by the recorder and by a clock that looks once a minute at `opensAt`, `finale.at` and `endsAt`. W1.5 only posts them.

**Before the season starts and after it ends, nothing is recorded:** the recorder looks at `Season.state`. A Season 1 boss killed in Season 3 gives loot and no row.

**Points:** per file; first on the server gets them twice. The scoreboard is a query over `SeasonClear`, not a stored number, until End season freezes it into `resultJson`.

## 5. W1.3 · the site

- **`/season`** (Community, above Players & stats): header (name, "Week 3 of 6", days left, what opens next and when), the ladder as cards with heads, the trials with this week's on top, the scoreboard and the goal's bar, and a Hall of fame tab (empty until a season has ended).
- **Home:** one line, the same words as the app's banner.
- **`GET /api/season/current`** for members and for the app's token: `{ state, id, name, startsAt, endsAt, week, weeks, daysLeft, thisWeek, next }` (docs/20 §7). Weeks and days are worked out by the portal.
- **Read-only for players in this step.** Admin → Seasons is W1.4.

**Tests:** the recorder against the console lines the server really prints for an advancement (they are in `events/parse.ts`'s tests already), group clears within the 5 seconds as one event, `first` under two simultaneous clears, a wake title making no clear, nothing recorded outside the season, the file reader adding a missed clear, `current` in each state (none, upcoming, running, ended), week and day arithmetic across the clock change on 25 October.

## 6. W1.2, W1.4, W1.5 in outline

Written up in full when W1.1 and W1.3 are in; the open points are already known.

- **W1.2, the Frontier.** docs/20 §5, with the real keys from docs/33 §11: `config/waystones-common.toml` without the 27 XP cost on `is_interdimensional` warps and with `deepslate:frontier_s1` in `wildWaystonesDimensionAllowList`; `deepslate:frontier_s1` added to OPAC's `ALL_BUT` list beside `deepslate:limbo`. Both live files are read from the instance before anything is written (docs/20 §5), and OPAC's live config was edited by hand (docs/31 B-32), so the repo is not its source today. **First check, before any other work:** the terrain at 0, 0 in a `large_biomes` dimension differs from the main world's.
- **W1.4, Admin → Seasons.** Start and End are the two buttons that matter; End writes `resultJson` once and never again. `season.reload`, `season.grant`, `season.revoke` are actions in the registry; a grant takes a member and an item id from the file, never free text.
- **W1.5, Discord.** docs/21 §6 and docs/22 §13 as written: one forum post per season, boss and trial, replies inside it, `threadId` on `DiscordPost`. The health watch's rule applies here too: a post that fails is retried, never doubled (docs/31 B-46 is deferred, and season posts are where it would show).

## 7. The rehearsal, Wednesday 28 October

On the real server, with the sample season, by Alex or the root session with two players in game. This session cannot run any of it.

1. Build (all), Sync, then the datapack is loaded (decision 3).
2. The server's log shows no error for the datapack; `datapack list` names `deepslate-season-sample`.
3. One player kills the sample boss with a second within 48 blocks: both get the toast, the chat line and one trophy each; a third player further away gets nothing.
4. The same boss killed again: no second trophy.
5. Hitting the other sample boss prints the wake line once; killing it takes the wake back.
6. `/season` shows both clears within a minute, with "first on the server" on the right one.
7. api is stopped, a trial is done, api is started: the clear appears within 10 minutes (`source: file`).
8. The Discord lines and posts, if W1.5 is in.
9. The sample season's datapack is taken off the server again and its rows are deleted, so nothing of it is left on 4 November.

Report the same day, as the planner asked.

## 8. Decisions for the planner

Each with a recommendation. 1 to 3 block W1.1; the rest block later pieces.

1. **The real Season 1 datapack stays off the server until the changeover on 4 November.** Once it is loaded, a boss kill grants the advancement, and it cannot be earned again when the season opens. So the rehearsal runs the sample season, and `s1` is built and synced on opening day. *Recommended: yes.*
2. **The hour the season opens on Wednesday 4 November.** The planner fixed Friday 19:00 UK for drops and Saturday 20:00 UK for finales, not this. *Recommended: 19:00 UK, and `endsAt` 19:00 UK on 16 December.* Note the clocks: 4 November is GMT, so 19:00 UK is `19:00Z`.
3. **`reload` or a restart to load a season datapack.** docs/20 §4 says `reload`, with nobody restarting. On a server with seventy-odd mods a `reload` re-reads every recipe and tag (11,189 recipes at the last start) and can stall the game for many seconds. *Recommended: try `reload` at the rehearsal with a player on and time it; if it stalls for more than 5 seconds, a changeover uses the planned-restart path instead, and a mid-season change of a trial waits for the next restart.*
4. **Trophy items.** *Recommended: this session proposes one vanilla item per boss in `s1.json`; the planner or Alex changes them by commit.*
5. **Boss `opensAt`.** docs/20 has it on trials only; docs/32's weekly schedule needs it on bosses. *Recommended: add it, with "found early" as for trials.*
6. **The sample season's two bosses** (a Ravager and an Iron Golem, so that the rehearsal takes minutes). *Recommended: yes; any two vanilla mobs that can be summoned will do.*
7. **A player who is not linked** cannot be on the server at all (the entrance room), so `SeasonClear.userId` is only null for a member removed later. *Recommended: keep their rows, shown by Minecraft name.*
8. **Admins count.** Alex plays too. *Recommended: admins are on the ladder like anyone.*
9. **The health watch at the wipe** (docs/31, 2026-10-04): the first backup after a wipe is a third smaller and the watch calls it wrong until the next one. *Recommended: the wipe (W1.7) tells the watch to start comparing afresh; not before.*

## 9. What stands in the way

- **PR E's Lock night** (docs/31): a Sync and a server restart with new jars. It should be done before the rehearsal, not in the same week.
- **The failed wake of 4 October** (docs/31 B-66): unexplained. A changeover evening is the worst time to meet it again. The AMP host's log has the answer.
- **W1.9**, the LOW-tier check: without it Cataclysm's three lesser guardians do not go on the Season 1 ladder (docs/20 §8), and week 4's drop needs a replacement.
- **This session has no docker, no sudo and no Minecraft account.** Every proof on the server is Alex's or the root session's; the plan above puts all of them on two days, 28 October and 4 November.
- **OPAC's live config is not in the repo** (B-32). W1.2 changes that file, so it has to be brought into the repo first.

## 10. Temples: captured builds, a real portal, locked ground (Alex, 2026-10-05)

Alex's ask, in his words: take things people have built and use them in the world; spawn a temple for the boss battle; inside it a portal into the boss world; lock the chunks so that nobody can destroy the building, but mobs inside can be killed. His answers the same day: the boss world is **the Frontier**; the portal is **a real portal mod, installed without a vote**. Nothing of this section is built.

**The portal mod, checked on Modrinth 2026-10-05.** Server Sided Portals (`server-sided-portals`, Crystal Nest), version 2.2.1 `6ybc8eyX` for NeoForge 1.21.1, with its library Cobweb (`cobweb`, project `dQcfqGbl`), 1.4.0 `c10AZba0`. Its page says it runs on the server only and works with any client, vanilla included: nothing changes on players' PCs, so no weak-PC check and no new download for anybody. A portal is a frame of blocks named by a block tag (`<dimension>_portal_frame`), lit with an item named by an item tag, leading to a dimension made by a datapack, which is what `deepslate-frontier-<id>` already is. Not checked: the tags' exact paths (its wiki), that Cobweb is server-only too (Modrinth lists Cobweb as needed on both sides), the licence's terms for a private pack (a licence of Crystal Nest's own), and how it sits beside the 70-odd mods. Two other server-only candidates exist (`worldportal`, `dimensionlink`); both are at version 0.0.x and all rights reserved.

**The pieces.**

| # | Piece | How | Proven? |
|---|---|---|---|
| T1 | The portal mod on the server | `server-sided-portals` and `cobweb` in `mods.json` as server-only; Lock, Build, Sync, one restart. The frontier datapack gains the frame and igniter tags | no: the server has to start with it once before anything is built on it (the working rules) |
| T2 | Capture a build | Admin → Seasons, "Capture a build": a name and two corners. The game has no console command that saves a structure, so the action sets a structure block in SAVE mode beside the build and powers it; the file lands in `world/generated/deepslate/structures/<name>.nbt` and is kept through a Frontier wipe. 48 blocks a side at most per piece; a larger build is captured as a grid of pieces by the same action | no |
| T3 | Place a build | "Place": a captured build, a dimension, a position. `place template deepslate:<name>` per piece, in the main world or the Frontier | no |
| T4 | Lock the ground | the action that claims spawn today, for any chunks: a server claim in Open Parties and Claims over the temple's chunks, in either dimension | the claim: yes (spawn). Killing mobs inside a server claim: not known, see below |
| T5 | The portal in the temple | a frame of the tagged block inside the build (so it is captured and placed with it), lit once by an admin; its twin in the Frontier | no |

**What stands in the way.**

- **Open Parties and Claims' live settings are not in the repo** (docs/31 B-32). Whether a player may hurt mobs inside a server claim is one of them. The file is read off the server first; if it protects mobs today, the setting changes for the spawn claim too.
- **docs/20 §5 said "no claims in the Frontier"** and "Waystones, nothing new for players to learn". A temple with a portal replaces the waystone pair as the way in; a server claim around the Frontier's temple is an admin's claim, not a player's, so the rule for players stands. For the planner to amend.
- **A lit portal can be broken like a nether portal** (a frame block removed). The claim keeps players from it; mobs' explosions inside a server claim are another of OPAC's settings.
- **T1 needs a Lock**, and the Lock night (PR E) has not been run. The portal mod goes into that same evening rather than a second one.
- **A captured build holds what stood there**: chests with their contents, and modded blocks. The capture action leaves entities out; whoever captures empties the chests first.

**Order.** T1 with the Lock night, then the terrain check and T5 by hand in the sample season's Frontier; T2 to T4 after that, tried at the rehearsal on 23 November.

**Done on `dev`, 2026-10-05 (T1's repo half).** `server-sided-portals` (`6ybc8eyX`, server only) and `cobweb` (`c10AZba0`) are in `mods.json`, not locked. **Cobweb goes on PCs as well as the server**: Modrinth lists it as required on the client, and the Lock refuses to make such a mod server-only (the rule from the TaCZ kick of 2026-10-01). So PCs get one small library at their next Play after the Lock; the portal mod itself stays off them. The season file's `frontier` has `portal` (`frame`, `igniter`), and `deepslate-frontier-<id>` carries the two tags the mod reads (`data/deepslate/tags/block/<dimension>_portal_frame.json`, `…/tags/item/<dimension>_portal_igniter.json`, from its wiki's "Datapack usage"). Defaults: frame `minecraft:reinforced_deepslate`, igniter `minecraft:knowledge_book`, neither obtainable in survival, so a portal is an admin's to make; lint refuses obsidian and fire. The guide's Season section and the First Steps Out hint say "the portal in the temple at spawn" instead of the waystones. Not proven: that the server starts with the two mods, that a knowledge book lights the frame, that a vanilla-looking client sees the portal, and which frame the mod builds on the far side.

## 11. Alex's decisions, 2026-10-05

Asked one by one and answered the same day. They settle §8's 8 and the three differences from docs/21 §6 that docs/11 lists; the planner amends docs/20, docs/21 and docs/32 where they say otherwise.

| Question | Answer |
|---|---|
| Season 1's finale | **Saturday 19 December, 20:00 UK**, not Boxing Day. In `s1.json`. Later seasons keep "the last Saturday" unless the poll says otherwise |
| Cataclysm's three lesser bosses on the Season 1 ladder | **They count, whatever the weak-PC check says.** W1.9 no longer blocks anything; a player on a weak PC gets the tick by standing within 48 blocks |
| Admins on the scoreboard | Yes, like anyone |
| The way into the Frontier | **The portal in the temple, and nothing else.** No waystone pair |
| Who makes a portal | Admins only (reinforced deepslate and a knowledge book, as built) |
| Mobs inside a locked area | If Open Parties and Claims' settings keep players from hurting mobs in a server claim, that is changed, for spawn as well |
| "Has awoken" | names the first player to hit, at once (as built) |
| How a season begins | Start is pressed (as built) |
| The `.env.bak-*` files and `deepslate-%F.sql.gz` | deleted (docs/31 "for Alex"); the command is his or the root session's |
| Mod versions | **every mod that is switched on is pinned** in `mods.json`; a test fails on "latest". An update is a commit that names the mod |
| An outside monitor | Alex has Uptime Kuma on another server; one HTTP keyword monitor on `/api/health` |
| What is built next | the temple's buttons (§10, T2 to T4) |

**Built on `dev`, 2026-10-05 (T2 to T4).** Actions `build.capture`, `build.place`, `build.lock` (registry, no generic route), api `GET /builds`, `POST /builds/capture`, `POST /builds/place`, and a "Builds" card on Admin → Seasons. A build is 192 blocks a side and 12 pieces of 48 at most; what was captured (name, size, where from) is kept in the setting `_builds`. Worlds: the main world or a `deepslate:frontier_*`, never the entrance room. **Not proven on the server**: that a redstone block set by command makes a SAVE structure block write its file, that `place template` finds files in `world/generated/`, that `forceload` holds the area for the commands, and the form of the `oclaims` claim outside spawn. Also on `dev`: every enabled mod pinned (a test fails on "latest"), and the finale on 19 December.

**On `dev`, 2026-10-05, later (Alex: "view the other dimensions and pregen all dimensions we make").** The Pre-generation card has a World list: the main world, the Nether, the End, and every Frontier that index.json ships (`ship` or `frontiers`). An area carries its `world`; chunky is pointed at it, the map step renders that world's own map, and "delete the map" and "the whole map" stay with that one map when the world is not the main one. Another world is another area: chunky's task in hand is called off first, so one world at a time. `build seasons` also writes `config/bluemap/maps/<dimension's name>.conf` for a shipped Frontier, because BlueMap only makes map configs for the worlds it finds at its first start; the map's id is the file's name (`frontier_sample`). `modpack/seasons/index.json` gained `frontiers`: a season's Frontier shipped without its advancements; the sample's is. **Not proven**: the keys of the map config against BlueMap 5.7 (written from memory of its defaults: `world`, `dimension`, `name`, `sorting`, `sky-color`, `ambient-light`, `remove-caves-below-y`, `storage`), that chunky takes a datapack dimension by its id, and how the pre-generation's sleep and map steps behave on a second world. A map is seen by every member on the Map page, not by admins alone: BlueMap has no per-person maps.

**On `dev`, 2026-10-05, evening (Alex: "upload builds to the site", "links to sites I can get builds from").** Admin → Seasons, Builds: an upload form (a name and a file, `.nbt` or WorldEdit `.schem`, 8 MB and 256 blocks a side at most), the list of uploads with Remove, and three links (createmod.com/schematics, Planet Minecraft, Abfielder; not opened from the VPS, which they refuse). Files are kept in `data/builds/` (web writes, api reads; `deploy.sh` makes the folder with web's owner). `modpack build builds`, and a step of `build server`: each file becomes `data/deepslate/structure/upload/<name>.nbt` in the datapack `deepslate-builds`; a `.schem` (Sponge version 2 or 3) is turned into a structure file by `packages/modpack/src/builds.ts` with its own NBT reader and writer (`nbt.ts`), 500,000 blocks at most; `dist/builds.json` lists what was built and what did not read. Place takes an upload as one template (`build.placeUpload`, `place template deepslate:upload/<name>`). Not taken: `.litematic`, the old `.schematic`. **Not proven**: that the game loads a structure file written here (the tests read it back with the same code, no real WorldEdit file was at hand), entities in a `.schem` (left out), and a structure wider than 48 placed by `place template`.

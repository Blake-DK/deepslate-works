# 51 · Seasons 1 and 2: the plan

VPS session, 2026-10-11, with Alex. Builds on docs/20 (the mechanism), docs/32 (the content of Seasons 1 to 4),
docs/34 (Season 1's build plan), docs/36 (zones by the shift), docs/42 (the test server) and docs/44 (season mods).
**Where this file and those differ on dates, on the order of work, or on where something is proven, this file holds.**
Their content (bosses, trials, points, rewards) stands unless a section below changes it. They are not rewritten.

## 1. The calendar: the players' vote (Alex, 2026-10-11)

Three polls were open on the site until 2026-10-11 19:00 UTC. Standings at 17:05 UTC, 9 votes each:

| Poll | Result | Before |
|---|---|---|
| When a season starts | The 1st of the month 4, "I don't mind" 3, first Monday 1, first Friday 1, last Monday 0 | the last Monday |
| How long a season is | Two months 4, six weeks 3, one month 2 | one month |
| The final boss fight | The last Sunday, 18:00 UK 6, last Saturday 1, last Friday 1, "I don't mind" 1 | the last Saturday, 20:00 UK |

**Alex: follow the vote.** This replaces docs/32's amendment of 2026-10-04 (the last Monday, one month) and
docs/34 §11's finale on 19 December. If the counts at the close differ from the standings above, this section is
checked again before any date is put in a file.

- **The rule:** a season opens at 19:00 UK on the 1st of a month and ends when the next one opens, on the 1st two months
  later. The finale is the last Sunday before the end, at 18:00 UK. A new trial or boss tier opens on a Friday at
  19:00 UK (unchanged; the vote did not ask).
- **UK time, not UTC.** The file keeps UTC with `Z` (docs/34 §2); lint works out the UK time. Season 2's finale is on
  Sunday 28 March 2027, the day the clocks go forward: 18:00 UK is **17:00Z**. Its end, Thursday 1 April 19:00 UK, is
  **18:00Z**.
- **Mods change only at a changeover**, now the 1st of every second month. A player updates once a season, by pressing
  Play.

| Season | Opens (19:00 UK) | Finale (Sunday 18:00 UK) | Ends, zone wiped (19:00 UK) | Weeks |
|---|---|---|---|---|
| 1 · First Blood | Tue 1 Dec 2026 (`19:00Z`) | Sun 31 Jan 2027 (`18:00Z`) | Mon 1 Feb 2027 (`19:00Z`) | 9 |
| 2 · The Drowned and the Frozen | Mon 1 Feb 2027 | Sun 28 Mar 2027 (`17:00Z`) | Thu 1 Apr 2027 (`18:00Z`) | 8½ |
| 3 · Fire and Iron | Thu 1 Apr 2027 | Sun 30 May 2027 | Tue 1 Jun 2027 | 9 |

Then 1 August, 1 October and so on. October and November 2026 stay plain play.

**The finale is the evening before the changeover** (Sunday, then Monday 19:00 UK). docs/32 had two days between them.
One evening is enough for End season, the wipe and the new pack only if they are rehearsed (§5 C6). If Alex wants a
week for stragglers instead, the finale moves to Sunday 24 January; the rule then says "the second-last Sunday".

## 2. What is already built, and what that means

Built on `main` (docs/11, "Season 1's machinery"): the season file, its lint and `build seasons`; `Season`,
`SeasonClear`, the recorder, the advancements-file safety net; `/season`, the Home line, `GET /api/season/current`;
Admin → Seasons (Announce, Start, End, Reload datapacks, give and take back a tick); the Discord moments; the Frontier
datapack (`deepslate-frontier-<id>`, large biomes); build capture, place and lock; uploads of builds; the pre-generation
card's world list; `SEASONS_SHIP` for the test server's datapacks (docs/42 T5); Server Sided Portals and Cobweb on live.

**None of it has run against a real server with a real season.** The rehearsal (§5 B3) is the first time.

Found while planning, each with its fix in §5:

1. **The main world has no boss structures near spawn, and will not get them back.** The trim of 2026-10-10 took out
   every chunk that held a boss-mod structure, and the refill pre-generates out to radius 10,176 *without* the season
   mods. Inside that circle, Mowzie's and Cataclysm's structures exist nowhere on the main world. **The Frontier is the
   boss world** (Alex, 2026-10-05, docs/34 §10), and now it is the only one. Every hint in `s1.json` that says "Snowy
   biomes", "An amethyst nest", "The sunken city" and so on must say "in the Frontier".
2. **The Frontier is large biomes, radius 3,000.** Large biomes makes every biome four times wider, so a 6,000-block
   square holds fewer kinds of biome. Nobody has checked that it holds a snowy biome, a savanna, a desert, a deep ocean
   and an amethyst nest. It has to be read with `locate` (§5 B2).
3. **`s1.json` contradicts itself:** the Dragon's hint says "Saturday 26 December, 20:00 UK" while `finale.at` is 19
   December, and "Hero of the Village, Together" opens on 23 December, after that finale. The new calendar replaces
   both.
4. **The Frontier on live must be generated with the season mods loaded**, or it has no boss structures either. The
   season mods reach live only at the changeover (docs/44). So either the Frontier is pre-generated on live on opening
   day, or it is pre-generated on the test server (same seed, same mods, same datapack) and copied to live at the
   changeover. §4 decision 1.
5. **docs/44's season mods mechanism is not built** (`shippedFiles` does not exist). Until it is, the test server gets
   the boss mods only through a test-only commit. It is the first build item.
6. **The test server changes the rehearsal.** docs/34 §7 put it on live on 23 November. It can now run on test, earlier,
   and as often as needed. Live sees the season only on opening day.
7. **Unknown on live:** whether the Ender Dragon is still alive. If it was killed, an admin respawns it (four end
   crystals) before the finale. Ender Dragon Fight Remastered comes back with the season mods, and the respawned fight
   is its fight.

## 3. Season 1 · First Blood, on the new calendar

Content as docs/32 §2, with the bosses and trials of `s1.json`. Changes: nine weeks instead of four, the drops spread
out, two light weeks over Christmas and New Year, and **Christmas Dinner moves here from Season 2** (Christmas is now
in Season 1).

| Date (19:00 UK unless said) | Opens | Also |
|---|---|---|
| **Tue 1 Dec** | The season, the Frontier, tier 1 (the Elder Guardian, Frostmaw, the Ferrous Wroughtnaut), the Dragon on the ladder, **Iron Week** | Season post in season-updates, pinned. Everybody's next Play brings the boss mods back |
| Fri 4 Dec | **First Steps Out** (through the portal in the temple at spawn) | |
| Fri 11 Dec | **The Engineer**; tier 2 (Umvuthi, the Warden, the Wither) | Three boss posts |
| Fri 18 Dec | **Ominous** | |
| Wed 23 Dec | **Christmas Dinner**: eat five different Farmer's Delight meals (solo, 10 points; meal ids read from the server) | Light weeks: nothing else opens until 8 January |
| Fri 8 Jan | Cataclysm's lesser guardians (the Amethyst Crab, Coralssus, the Kobolediator) | Three boss posts |
| Fri 15 Jan | **Hero of the Village, Together** | |
| Sun 24 Jan | — | "A week to go" |
| **Sun 31 Jan, 18:00 UK** | **The finale: the Dragon, together** | Reminders on the 30th and an hour before |
| **Mon 1 Feb, 19:00 UK** | End season (the freeze), the Hall of Fame, the wipe, Season 2 opens | "Season 1 has ended" with the top three; "The Frontier has been reset" |

Unchanged from docs/32: points, the 48-block group credit (0 for the Dragon: everyone in the End), "first on the server"
counts twice, trophies are items with no stats, admins are on the scoreboard, the server goal "50 boss kills between
us". Cataclysm's three count whatever the weak-PC check says (Alex, docs/34 §11).

## 4. Season 2 · The Drowned and the Frozen, on the new calendar

Content as docs/32 §3, with **Aquamirae** (Alex, 2026-10-11) and its library Fragmentum. Christmas Dinner has gone to
Season 1; a trial from Aquamirae's own items takes its place.

| Date (19:00 UK) | Opens | Also |
|---|---|---|
| **Mon 1 Feb** | New pack (Aquamirae, Fragmentum), the Frozen Frontier, tier 1 (the Sculptor, Captain Cornelia), **Sea Legs** | "New this season: Aquamirae" |
| Fri 12 Feb | **The Conduit** | |
| Fri 26 Feb | **The Maze** (reach the ghost ship in the ice maze); tier 2 (the Ancient Remnant, Scylla, Maledictus) | Three boss posts |
| Fri 12 Mar | **Monument Men**: three Elder Guardians in one evening, the first counted trial | |
| Fri 19 Mar | **The Captain's trial**: hold one of Aquamirae's signature items (ids read from the server) | "A week to go" on Sun 21 Mar |
| **Sun 28 Mar, 18:00 UK (`17:00Z`)** | **The finale: the Leviathan** | Clocks go forward that morning |
| **Thu 1 Apr, 19:00 UK (`18:00Z`)** | End, the wipe, Season 3 opens | |

**The zone:** `deepslate:frontier_s2`, overworld-shaped, **by the shift of docs/36** (W2.1 as amended), so its ground
is not the main world's or Season 1's. The arrival point on a coast. Radius 3,000, centred on the arrival point.

**What it needs from the world:** every Season 2 boss lives in a structure (the sunken city, the acropolis, the frosted
prison, the cursed pyramid, the monastery, the ice maze). Like Season 1, none of them exists near spawn on the main
world. The zone must hold all six, read with `locate` on test.

## 5. The work, in order

Owners: **VPS** (this session: site, api, app, repo, CI), **AMP host** (the game server, world files, backups),
**Alex** (decisions, root steps, building in game), **planner** (specs).
Sizes: S under a day, M one to three days, L about a week.

### A · Before anything goes to test (from 12 October)

| # | Owner | What | Size | Proven by |
|---|---|---|---|---|
| A1 | VPS | **The new calendar in code:** lint's rule (19:00 UK on the 1st, two months apart; the finale on the last Sunday at 18:00 UK; a trial or tier on a Friday at 19:00 UK, or a date the file marks as moved), `s1.json`'s dates, hints that say "in the Frontier", Christmas Dinner added, the Dragon's hint. `/season`'s "Week N of M" for a nine-week season starting on a Tuesday. Words that say "a month" in the guide, the Discord lines and `README`/`ROADMAP` | M | tests: lint on both seasons' dates, week arithmetic across 25 October and 28 March |
| A2 | VPS | **docs/44, the season mods mechanism:** `season` on a mod, `shippedFiles(lock, ship)`, the nine readers, the pack hash over what ships. The six Season 1 mods carry `"season": "s1"` | M | docs/44's tests; "Done when" there |
| A3 | planner | **docs/41**, Season 1's rewards and the finale rule (reissued), so A4 has a spec | S | — |
| A4 | VPS | The finale in code from docs/41 (the gate, `groupRadius` 0 on the Dragon) | S to M | tests |

### B · Proven on the test server (19 October to 15 November)

The test server ships `s1` (`SEASONS_SHIP=s1` and, after A2, its mods). Live is untouched.

| # | Owner | What | Size |
|---|---|---|---|
| B1 | AMP host, VPS | Test starts with the six Season 1 mods back through A2 (not a test-only commit). Time to "Done" written down | S |
| B2 | AMP host | **The Frontier on test:** pre-generate `deepslate:frontier_s1`, radius 3,000, from the pre-generation card. Time and disk written down. Then `locate structure` for every Season 1 boss structure from the arrival point; a table of what is found and how far. If anything is missing or further than 2,500 blocks: radius up, or the zone moves to the shift (as Season 2), decided by Alex on the numbers | M |
| B3 | Alex, two players, VPS | **The rehearsal, on test**, with the sample season: docs/34 §7 steps 1 to 7 as written, plus: `reload` timed with a player on (docs/34 §8 decision 3). The Discord lines need a private test webhook (docs/49, "Discord bot"); without it, step 8 is read from the event log | M |
| B4 | Alex, VPS | **The temple and the portal on test:** a knowledge book lights a reinforced deepslate frame (Server Sided Portals); the far side lands in the Frontier; capture, place and lock (docs/34 §10 T2 to T5); whether players can hurt mobs inside a server claim, and the OPAC setting changed if not (Alex, docs/34 §11) | M |
| B5 | Alex | The LOW-tier PC in a Cataclysm structure in the test Frontier: FPS and memory written down. Does not block (docs/34 §11) | S |

### C · Live, before opening day (16 to 30 November)

| # | Owner | What | Size |
|---|---|---|---|
| C1 | AMP host, Alex | The quiet restart already queued (docs/49): the sample Frontier and the three worldgen test packs off live's `level.dat`, NeoForge 21.1.253, view distance, MOTD. **Before** the season, so the opening restart changes only the season | S |
| C2 | AMP host | Read live's Dragon state (`level.dat`, the dragon fight data). If killed: the respawn is a step of the finale evening's runbook | S |
| C3 | Alex | The temple at spawn on live, inside the spawn claim; the portal frame in it, lit once the Frontier exists on live (opening day) | M |
| C4 | VPS | App 3.7 with the season banner (W1.6), and with it docs/49's 3.6.2 item (removed jars named to players). If it is not ready, the banner follows in the first week (docs/32 cut order) | S to M |
| C5 | VPS, AMP host | **The opening runbook**, one page, every step a paste: `index.json` `ship: ["s1"]`; `dev` → `main` PR; deploy; Build; Sync (the six mods, `deepslate-season-s1`, `deepslate-frontier-s1`); the Frontier in place (§6 decision 1); restart; Start in Admin → Seasons at 19:00 UK; the portal lit; the season post | S |
| C6 | Alex, AMP host, VPS | **Mon 23 Nov: the opening, rehearsed on test** with `s1`'s files and the start moved to that evening: C5's runbook step by step, timed. Then the test Season and its rows deleted | S |
| C7 | VPS | Tell players a week ahead (news and Discord): what a season is, that the next Play downloads the boss mods again, and where the Frontier is | S |

**Tue 1 Dec, 19:00 UK: Season 1 opens.**

### D · During Season 1 (December and January)

| # | Owner | What | By |
|---|---|---|---|
| D1 | VPS | W1.7 **the wipe**: `frontier.evacuate`, hold-at-join for offline players, the backup in the same run, the delete printed for Alex. Tried on test on a throwaway Frontier | Sun 10 Jan |
| D2 | VPS, Alex | W1.8 `hall.update` and the Hall of Fame: Alex builds the shell at spawn, the portal fills signs and heads | Sun 24 Jan |
| D3 | VPS | **The shift in the Frontier builder:** lint takes the shift as well as large biomes; `deepslate-frontier-s2` built by it (docs/36). Proven on test: ground and biomes differ from the main world's and from `frontier_s1` at the arrival point | Fri 18 Dec |
| D4 | VPS | Aquamirae and Fragmentum in `mods.json` with `"season": "s2"`, versions read again from Modrinth, pinned; Lock | Fri 18 Dec |
| D5 | AMP host, Alex | Test ships `s2`: one start with Aquamirae (time to "Done", no errors), entity, structure and item ids read from the server into `entities.json`; the Frozen Frontier pre-generated; `locate` for the six structures of §4; one LOW-tier PC in the ice maze | Sun 10 Jan |
| D6 | VPS | `s2.json`, and the first counted trial (Monument Men: a scoreboard reset each day, the advancement granted at three); tested on test with two players | Sun 17 Jan |
| D7 | AMP host | Disk: two Frontiers and their maps; the old Frontier's map kept read-only, its dimension folder gone after the wipe | Sun 24 Jan |
| D8 | Alex, AMP host, VPS | **Mon 25 Jan: the changeover rehearsed on test:** End `s1`, the wipe, `ship: ["s2"]`, the new pack, Start `s2`. Timed, because live has one evening for it | Mon 25 Jan |
| D9 | VPS | The Season 2 post, "what changed in the pack" with it (W2.5) | Fri 29 Jan |

**Sun 31 Jan: the finale. Mon 1 Feb, 19:00 UK: Season 1 ends, Season 2 opens.**

### E · During Season 2 (February and March)

| # | Owner | What | By |
|---|---|---|---|
| E1 | Alex | Whether the wipe deletes the folder itself from now on (docs/32 decision 8), after watching the first | Mon 8 Feb |
| E2 | VPS, AMP host | Season 3's start on test: Bosses of Mass Destruction (docs/32 §4), the Nether-type zone 20,000 out (docs/36), the arena (the largest piece of datapack work in the plan) | mid-March |
| E3 | VPS | Season 2's finale and changeover runbook with the clock change in it | Sun 21 Mar |

## 6. Decisions

### Made (Alex, 2026-10-11)

- The calendar of §1: the 1st of the month, two months, the finale on the last Sunday at 18:00 UK.
- Season 2's new mod is Aquamirae, after its start and LOW-tier check on test.
- This plan lives in the repo as docs/51.

### Open, with the recommendation

1. **How the Frontier reaches live.** Recommended: **pre-generate it on the test server and copy the dimension folder
   to live at the changeover.** Test runs the same seed, the same mods (after A2) and the same datapack, so the ground
   is the same; the AMP host has a rehearsed transfer script from 2026-10-10. Pre-generating 140,000 chunks on live
   on opening day, with nobody online, is the fallback, timed in B2. *Blocks:* C5, and the same for Season 2 (D5).
2. **The finale on the evening before the changeover** (§1). Recommended: keep it (the vote said the last Sunday), and
   rehearse the changeover on test so one evening is enough (C6, D8). *Blocks:* A1's lint rule.
3. **The Frontier's shape for Season 1.** Recommended: large biomes as built, unless B2's `locate` table shows a boss
   structure missing; then the shift, which is built for Season 2 anyway (D3) and could come forward. *Blocks:* nothing
   until B2.
4. **Players' boss items held since 2026-10-09** (docs/11, "Season 1 mods off live"): 4 players, one a boss drop.
   Recommended: Alex gives the swaps back as originally planned, not tied to the season. *Blocks:* nothing.
5. **"Has awoken" and boss posts in the light weeks.** Recommended: unchanged; the clock posts only on the dates in
   the file. *Blocks:* nothing.

## 7. What gets cut if it runs late

docs/32's order still holds for Season 1, with one change: **the portal in the temple is not cut**, because it is now
the only way into the only boss world. If the temple is not ready, an admin's `execute in deepslate:frontier_s1 run tp`
is not a player's way in; the fallback is a single portal frame at spawn with no building round it.

1. The app's banner (C4) → follows in week 1.
2. The Hall of Fame building (D2) → the hall is the `/season` tab only.
3. The server goal's bar.
4. "Has awoken" (keep the kills).
5. The forum posts → plain lines in #game-chat.

Never cut: recording, the freeze, the Frontier.

For Season 2: Monument Men first, then the Captain's trial, then Aquamirae (the season runs on Cataclysm's five).

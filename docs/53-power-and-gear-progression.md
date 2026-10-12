# 53 · Power and gear progression

Planner, 2026-10-12. A player's voice note to Alex: the quarry runs fine on a Pitiful Generator, so there is no
reason to build better power; and nothing in the pack beats diamond armour and guns, so there is no reason to build
better gear. He wants something like the old Tekkit chain: small generator, battery, bigger machines, reactors,
power armour. Alex: "lets plan all 3".

Checked against `dev` today: the claim holds.

- The quarry (`additional-enchanted-miner`, mod id `quarryplus`) ships no settings (docs/06), so it runs on the
  mod's defaults: `powerMap.quarry.breakBlockBase = 25` FE times the block's hardness, `moveHeadBase = 1`,
  `makeFrame = 15`. A Pitiful Generator keeps up with that.
- Create runs on rotation. Immersive Engineering, Industrial Foregoing and AE2 can use more power but nothing a
  player wants forces it.
- Mekanism, Mekanism Generators and Mekanism Tools are in the catalogue, switched off: they lost the vote.
- The Season 1 boss mods are off live until 1 December (docs/44, docs/51), so there are no boss drops either.

Five parts. Part A and Part B ship together with E1; A alone is a nerf with nothing to aim for. Part D (update
posts by themselves, tagged) ships first, on its own. Part E keeps Season 1 a fight.

## Part A · Make the quarry cost real power

**What.** Ship `modpack/server/config/quarryplus.toml` with the quarry's energy costs raised, so one Pitiful
Generator still runs a quarry but slowly, and full speed needs a real power setup.

**How.**
1. On the test server, read the `config/quarryplus.toml` the mod wrote. Confirm the keys above exist under
   `powerMap.quarry` with those defaults in this jar (21.1.164). If they differ, stop and report.
2. Measure before changing anything, on the test server, same area (a marked 16 × 16, from the top, plain
   overworld stone): blocks per minute with one Pitiful Generator; blocks per minute with no shortage of power
   (a creative energy source, or enough generators that the quarry's buffer never drops). Read the Pitiful
   Generator's FE/t from the game (Jade), do not assume it.
3. Set `breakBlockBase`, `moveHeadBase` and `makeFrame` to the defaults times a multiplier `k`, the same `k` for all
   three. Leave the other quarry keys, `powerMap.advQuarry` and everything else at the defaults. Start with `k = 4`.
4. Measure again. Target: one Pitiful Generator gives **a quarter or less** of today's Pitiful rate; with enough
   power the quarry is **as fast as today** (the cost goes up, not the ceiling down). Adjust `k` once if needed and
   report both tables.
5. The file is server side only (energy is worked out on the server). It goes in `modpack/server/config/`, where
   Sync puts it, like `corpse-server.toml`. Check whether it is part of the pack hash that Play first compares and
   say so in the report.

**Player text.** The quarry's `howTo` in `mods.json` gains one sentence: "It needs a lot of power to run at full
speed: one small generator will only crawl." No numbers.

**Done when.** Both tables are in the report, the shipped file is on test, and a quarry already running on the test
world (the copy of live) carries on at the new cost after a restart without losing its area or its frame.

## Part B · Switch Mekanism on

**What.** `mekanism`, `mekanism-generators` and `mekanism-tools` go to `enabled: true`. This gives the chain he
asked for: Heat Generator, Energy Cubes, ore processing, the Digital Miner, then fission and fusion reactors, and
the MekaSuit, a set of power armour with a jetpack and upgrades, plus the Meka-Tool. It is load H.

**Decided, Alex 2026-10-12: no vote, switch them on.** All three go on as soon as the rehearsal passes (now, not 1
December). docs/51's "mods change only at a changeover" is about the middle of a season;
October and November are plain play.

**The ore problem (blocking).** Mekanism's ores (osmium above all, also tin, lead, uranium, fluorite) and salt are
placed at world generation. The main world is pre-generated out to radius 10,176 without Mekanism, so none of it
holds osmium, and nothing in Mekanism works without osmium. Mekanism has its own fix, read from its 1.21.x source:
in `config/Mekanism/world.toml`, `enableRegeneration = true` and `userWorldGenVersion` raised from 0 to 1 make it
add its ores and salt to every chunk below that version **as the chunk is loaded**. It places ore only where its
features would (in natural stone and deepslate), so builds of stone bricks or planks are left alone; a base dug into
natural stone may gain an ore block in a wall. Do not use any other retrogen mod.

This writes to the live world, so the rules apply in full: backup, rehearsal on test, Alex's yes.

**How.**
1. Confirm the Modrinth slugs and the 1.21.1 NeoForge versions of all three, pin them in the lock, and confirm they
   load next to Create, Immersive Engineering, Industrial Foregoing, AE2, TaCZ and ServerCore on the test server: a
   clean start, no FATAL, no recipe errors from Mekanism in the log.
2. Ship `modpack/server/config/Mekanism/world.toml` with only the two keys changed. Confirm the file name and the
   keys against what the mod writes on the test server first.
3. Rehearsal, on a fresh copy of live on the test server: start with the Mekanism files; fly a route of about
   500 blocks through old chunks; with `locate` or by digging, confirm osmium appears in those chunks. Then check
   Alex's base and two other players' bases (coordinates from the AMP host's records, given to Alex as console
   teleports) for anything changed. Report chunk-load times on that route against the same route without
   Mekanism, from spark.
4. Disable the retrogen once it has done its work? **No.** Leave it on: chunks are only touched while their version
   is below 1, so a chunk is touched once. Say in docs/06 that it must stay at 1 and must never be raised again
   without a plan.
5. The Mods guide entries already exist (`topic: factories`, `howTo` filled). Add one sentence to the Mekanism
   `howTo`: "Its ores (osmium first) appear in old ground the first time anyone goes there after the update."
6. The out-of-date box and the pack version change as for any mod: Lock, Build, Sync on test, Alex tries the pack on
   his own PC through the app's Test tab, then the PR to `main`.

**Watch.** Load H: the install reports give each member's tier; LOW-tier members get the usual warning. Mekanism and
Create both do ore doubling; that is fine and not to be balanced now. TaCZ guns plus a MekaSuit is the top end and
needs no change.

**Done when.** The rehearsal report shows osmium in old chunks, untouched bases and the spark numbers; Alex has said
go; live is backed up before the restart that brings it; the first live start has no FATAL.

## Part C · Boss gear from Season 1

Nothing new is built here. docs/20 decision 6 stands: season **rewards** are trophies, titles and points, not gear.
The bosses' **own drops** are their loot by design and come back with Season 1 on 1 December, in the Frontier only
(docs/51 §2). Two checks:

1. Confirm on the test server, with the Season 1 mods loaded, that the boss mods' own loot tables are untouched by
   anything in `deepslate-tools` or the season datapacks: kill one of each tier with `/kill` near a player and list
   what drops. Report it in the Season 1 rehearsal, not as a separate run.
2. The player-facing line for the Season page, with no boss or mod names (the rule for anything players read):
   "The Frontier's big fights drop gear worth having." It goes live with the season, not before.

## Part D · Update posts go out by themselves and tag @Minecraft

Alex, 2026-10-12: whenever there is an update on Discord it has to tag @Minecraft, and the posts are automated, not
made by him. The role is the one in `DISCORD_PLAYER_ROLE_ID` (role.ts), given to everyone who has joined the game.

### D1 · The tag

Every **new** post in the forum season-updates starts with the role mention: news, polls and votes when they open,
the We're live post, and every change log entry (D2). Bot path and webhook path both. `allowed_mentions` becomes
`{ parse: [], roles: [<role id>] }` for those messages only, so nothing else in them can ping.

**Not tagged:** edits (vote counts, a closed vote), the Change log post's own opening message, the forum test post
and its test reply and edit from Admin, the game chat relay, deaths and the other feed lines, the admin channel.
Nothing on the test server tags anyone (`DISCORD_PLAYER_ROLE_ID` is already kept off test, compose-env.test.ts).

**When the role is not set** or Discord says the role is unknown, the message goes out without the tag and the
Discord card on Admin says why, in the words role.ts already uses. A post is never held back over the tag.

**Admin.** News & polls gains one tickbox on the news and poll forms, "Tag @Minecraft", ticked by default.

### D2 · Big updates get their own post

The change log (`apps/api/src/changelog.ts`) already posts by itself after a deploy, as replies in the one post
"Change log". `Change` gains an optional `title`. An entry with a `title` is posted as **its own new forum post**
with that title and the News tag, instead of a reply; an entry without one stays a reply as today. Both are tagged
(D1). Everything else about entries stands: the id never changes, nothing posts until `live: true`, and `live` is
set only after the change's live check has passed, so the deploy after that posts it. Lint: a `title` is 1 to 90
characters; no boss or mod name of the season mods in any entry (a test reads them against the season mods list).

### D3 · The two posts for this spec

Both are change log entries with a `title`, written now, posted by the bot. Alex posts nothing by hand.

1. `2026-10-12-power-and-gear-coming`, title "Power and gear update incoming". Set `live: true` once D1 and D2's live
   check has passed; the next deploy posts it. Lines:
   - "You told us there's no reason to build past a starter generator and nothing beats diamond. Fair. Here's what's coming."
   - "The quarry will need real power. A small generator will still run it, just slowly. Full speed means building a proper power setup."
   - "Mekanism is coming in: generators, energy storage, ore processing, fission and fusion reactors and the MekaSuit, a full set of power armour with a jetpack. It's heavy on weaker PCs."
   - "Its ores will appear in old ground the first time anyone goes there. No world reset."
   - "Both get tried on a test copy of the world first. We'll post here when they land."
2. `2026-10-12-power-and-gear-landed`, title "Power and gear update is live". Set `live: true` after A and B's live
   check; the next deploy posts it. Lines:
   - "The quarry now needs real power: one small generator only crawls."
   - "Mekanism is in: generators, reactors and the MekaSuit power armour. Press Play to update."
   - "Its ores (osmium first) appear in old ground the first time anyone goes there."

### D4 · Tests and done

**Tests.** News, poll opened, vote opened, We're live and both change log shapes carry the mention and `roles: [id]`
when the role is set; edits, the Change log opener and test posts carry `parse: []` and no roles; an unset role gives
no mention and no error; an entry with `title` makes a new post and one without makes a reply; the lint refuses an
over-long title and a season-mod name.

**Done when.** On live: a news post from Admin with the box ticked pings members with the role (Alex checks on his
phone), one unticked does not, a vote count edit pings nobody, and post 1 of D3 appears by itself after the deploy
that follows its `live: true`, tagged.

D is its own feature, so its own PR, and it ships before A and B.

## Part E · Keeping Season 1 a fight

docs/32 tuned Season 1 so it can be finished with iron and diamond. With Mekanism in from October, a keen player can
reach Mekanism Tools' Refined Obsidian armour (mid-game, well above diamond) and the MekaSuit (end-game) before
1 December. Three things follow.

**E1 · Armour ceiling.** Mekanism Tools sets armour per material in its own materials config (read from its 1.21.x
source: `ToolsMaterialConfig`). Ship it with every Mekanism Tools armour set capped at netherite: protection per
piece, toughness and knockback resistance no higher than netherite's. Tools and weapons stay as they are. Confirm the
file name and keys against what the mod writes on the test server, ship only the changed keys, report a table
(material, before, after). Server side if the mod reads it there; say which.

**E2 · The MekaSuit against the bosses.** Leave the MekaSuit at its defaults for now: it is end-game and costs a lot
of power to run (`mekaSuitEnergyUsageDamage` and the rest of its gear config). In the Season 1 rehearsal, fight each
Season 1 boss twice on the test server, once in full netherite and once in a full MekaSuit with its usual modules,
and report time to kill and damage taken. If the MekaSuit makes a boss trivial (under a third of the netherite fight's
time, or next to no damage taken), propose new values for its `damage_absorption` settings in the report. Alex
decides; nothing changes without his yes.

**E3 · The rehearsal and the Frontier run with Mekanism.** The Season 1 rehearsal (docs/51 §5) runs with the live pack
plus the season mods, so with Mekanism and the quarry config in it, never without. The Frontier is pre-generated with
Mekanism loaded, so it has osmium of its own; check with `locate` in the Frontier as part of docs/51 §5 B2. Any mod
clash between Mekanism and the season mods found there stops the rehearsal and is reported.

**Done when.** E1's file is on test with its table; E2's fight table is in the Season 1 rehearsal report; E3's checks
are ticked in that report. E1 ships with A and B. E2 and E3 ride with the Season 1 rehearsal.

## Order

1. Part D, its own PR, deployed and live-checked.
2. D3 post 1 set live; the next deploy posts it.
3. Part A step 1 to 4, Part B step 1 to 3 and E1, together on the test server. One report.
4. Alex tries the pack on his own PC and says go.
5. Backup of live, then the restart that brings A, B and E1. After their live check, D3 post 2 set live; the next
   deploy posts it.
6. Part C, E2 and E3 ride with the Season 1 rehearsal.

Two PRs: D on its own; A, B and E1 together (they ship as one). Both on `dev`, then `dev` to `main`.

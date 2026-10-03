# 25 · The starter kit

Planner, 2026-10-03, on Alex's "I want everyone when they first join to have a starting pack, like a small backpack and starting equipment". Input for the VPS session: read it, don't rewrite it. Report in `docs/11-status.md`.

## 1. What this is

The first time a member is let out of the entrance room into the world, they get a small backpack and a set of basic gear, once. It is for the friend who has never played modded: they can dig, eat, see and sleep on their first night without knowing a recipe.

**Decisions taken** (Alex can overrule any of these):

1. **Once per player per world.** Dying does not give it again (the Corpse mod keeps their things). A new world gives it again, because the mark is in the player's data and goes with the world.
2. **Everyone gets it, the three testers and Alex included**, the first time they are in the world after this is live. At the go-live reset their inventories are emptied, so they start like everybody else.
3. **Nobody in the entrance room gets it.** Only a player with the `verified` tag.
4. **The kit is a datapack, not a mod and not api code.** No new jar, nothing for a weak PC to load, and it works when the api is down. The list of items is in one file.

## 2. The kit

| Item | Id | Count |
|---|---|---|
| Backpack (the basic one, 27 slots) | `sophisticatedbackpacks:backpack` | 1 |
| Stone sword | `minecraft:stone_sword` | 1 |
| Stone pickaxe | `minecraft:stone_pickaxe` | 1 |
| Stone axe | `minecraft:stone_axe` | 1 |
| Stone shovel | `minecraft:stone_shovel` | 1 |
| Bread | `minecraft:bread` | 16 |
| Torch | `minecraft:torch` | 16 |
| White bed | `minecraft:white_bed` | 1 |

Stone, not iron: it is a start, not a skip. No armour. The backpack goes into the inventory, not onto their back: they open it with a right click, and the guide tells them the key once it is worn.

**Check first, on the running server:** `sophisticatedbackpacks:backpack` is the basic backpack's id in the build the server runs (`give` to nobody, or the item list the portal already has). If it is not, stop and report the id you found. Do not guess another.

## 3. How

In `modpack/datapacks/deepslate-tools/`:

- `data/minecraft/tags/function/tick.json`: `{ "values": ["deepslate:kit/tick"] }`
- `data/deepslate/function/kit/tick.mcfunction`: one line, `execute as @a[tag=verified,tag=!deepslate.kit] run function deepslate:kit/give`
- `data/deepslate/function/kit/give.mcfunction`: the vanilla `give @s …` lines of §2 in the table's order, then `function deepslate:kit/backpack`, then one `tellraw @s` line, then `tag @s add deepslate.kit` **last**.
- `data/deepslate/function/kit/backpack.mcfunction`: the one `give @s sophisticatedbackpacks:backpack 1` line.

Why the backpack has a file of its own: a function with an unknown item id does not load at all. If Sophisticated Backpacks ever leaves the pack, only that file fails and the rest of the kit is still given.

The chat line, green, plain English: "A starter kit is in your inventory: a backpack, tools, food, torches and a bed."

`pack.mcmeta`'s description gains "the starter kit". `pack_format` stays 48.

Nothing in `apps/api` changes. No console command is added, so the action registry is untouched. `link.release` and `limbo.releaseBack` already set `verified` as their last command, so the kit arrives one tick after the player stands at spawn.

## 4. The guide

`docs/18-player-guide.md` and `apps/web/src/lib/guide-default.ts`, both places that say to craft a backpack: say instead that they start with one, and that a magnet upgrade comes later. Keep the `<!-- mod: sophisticated-backpacks -->` markers. Step 2 of the first-night list becomes "Open your backpack: you start with one, with tools, bread, torches and a bed."

## 5. Tests

In `packages/modpack/tests/datapack.test.ts`:

- `tick.json` names `deepslate:kit/tick`, and each of the three functions exists.
- Every `minecraft:` id in `give.mcfunction` is in `modpack/items/vanilla-1.21.1.json`.
- `give.mcfunction`'s last command is the `tag @s add deepslate.kit` line, and the selector in `tick.mcfunction` has both `tag=verified` and `tag=!deepslate.kit`.
- `backpack.mcfunction` holds one command, and `sophisticated-backpacks` is enabled in `mods.json` (so a vote that takes the mod out fails CI and somebody decides what the kit holds instead).

## 6. Order, and the go-live reset

Build this before the go-live world work finishes, so that the first real join after "We're live" gets the kit. Steps: branch, the datapack, the guide, the tests, PR, merge, Build, Sync, restart at a moment nobody is on, `world.datapacks` lists `deepslate-tools`.

At the reset, whichever way inventories are emptied, no player may keep the `deepslate.kit` tag. Deleting player data removes it. If inventories are emptied with `clear` instead, run `tag @a remove deepslate.kit` for players online and say in the report who was offline, because their tag stays.

## 7. Acceptance

- [ ] A player released from the entrance room for the first time has the eight rows of §2 and sees the chat line, within a second of standing at spawn.
- [ ] Leaving and joining again, dying, and being held in the room for Play first and released again all give nothing more.
- [ ] A player still in the entrance room has nothing but the sign-in book.
- [ ] The server's start shows no new ERROR line, and `spark` shows no cost from the tick function worth naming.
- [ ] The guide says they start with a backpack.
- [ ] docs/11 says what was seen, with the backpack's id as checked.

Alex's part: join after the reset and look in the inventory.

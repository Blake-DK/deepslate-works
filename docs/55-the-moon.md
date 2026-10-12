# 55 · The Moon: Mekanism's ores in a world of their own

Alex, 2026-10-12, after docs/53 Part B was on the test server: the main world must not be changed to add Mekanism's
ores. Instead everyone goes through a portal to a different kind of world, like the Moon. A portal, not rockets; keep
it simple. The Frontier stays separate: it is Season 1's and stays closed until then.

This replaces docs/53 Part B's retrogen (the ores added to old chunks of the main world). The rest of docs/53 Part B
stands: Mekanism, Mekanism Generators and Mekanism Tools go on, with A (the quarry) and E1 (the armour cap).

## 1. Alex's answers (2026-10-12)

| Question | Answer |
|---|---|
| How players get there | a portal; no rockets, no new mod for it |
| What can be mined there | everything: Mekanism's ores, vanilla ores, and other mods' ores |
| Gravity | low: you jump higher, fall slowly, short falls don't hurt |
| Who builds a portal | players can build their own |
| Mobs | some hostile mobs |
| Gas (added later the same day, folded in from a separate draft) | below y 0 only; it poisons, it never kills |
| Masks | a cheap mask of our own that lasts 30 s in gas; Mekanism's hazmat mask and MekaSuit helmet count and last longer; masks wear out in gas |

## 2. What the repo and the mods already give (checked 2026-10-12)

- **The main world has no border.** ±10,176 is how far it was pre-generated, not a limit: a chunk past it is made
  when somebody first goes there. So switching retrogen off is not enough by itself: Mekanism would put its ores in
  every new chunk of the main world.
- **Mekanism places its ores and salt in the biomes of one tag**, `#mekanism:spawn_ores` (10.7.19.85, its
  `neoforge/biome_modifier/*.json`), which holds `#minecraft:is_overworld` and `#c:is_overworld`. An ore replaces
  only blocks in `#minecraft:stone_ore_replaceables` and `#minecraft:deepslate_ore_replaceables`.
- **A dimension made by a datapack** is what the entrance room already is (`modpack/datapacks/deepslate-limbo`) and
  what the Frontier will be (`deepslate-frontier-<id>`, `packages/modpack/src/seasons.ts`). A new dimension counts
  from the next restart, not a `/reload`.
- **Server Sided Portals 2.2.1** (with Cobweb) is in the pack and loads on the server. A portal is a frame of the
  blocks in `#deepslate:<dimension>_portal_frame`, lit with an item in `#deepslate:<dimension>_portal_igniter`; going
  back through it leads to the main world. It needs nothing on players' PCs. Not proven on a server yet: that the
  igniter lights the frame, which frame the mod builds on the far side, and where.
- **1.21.1 has gravity as an attribute** (`minecraft:generic.gravity`, with `generic.safe_fall_distance` and
  `generic.fall_damage_multiplier`). The server sets it and players' games follow it, so low gravity needs no mod.
- **`deepslate-tools` already runs tick functions** (`#minecraft:tick`: `deepslate:kit/tick`, `deepslate:spawn/tick`).
- **A dimension file has no seed of its own in 1.21.1** (docs/51): with the overworld's noise it would copy the main
  world's ground. The Moon has noise settings of its own, so its ground is its own.

## 3. The plan

### M1 · No retrogen

`modpack/server/config/Mekanism/world.toml` comes out of the pack, and Mekanism's defaults are written back on the
server (`enableRegeneration = false`, `userWorldGenVersion = 0`): Sync never deletes, so removing the file alone would
leave the shipped one in place. No chunk of the main world is touched. docs/06 says so where it said "keep it at 1".

### M2 · The Moon (`deepslate:moon`)

A datapack `modpack/datapacks/deepslate-moon/`, shipped like the entrance room's (Build copies it, Sync puts it in
`world/datapacks`, a restart makes the dimension).

- **dimension_type `deepslate:moon`:** the overworld's height (`min_y` -64, `height` 384), `natural: true` (so
  hostile mobs spawn), a fixed night (`fixed_time` 18000) and `effects: minecraft:overworld`, so the sky is black with
  stars. Beds don't work (`bed_works: false`); respawn anchors don't either. `coordinate_scale` 1.
- **Noise settings `deepslate:moon`:** stone below, deepslate under y 0, as in the main world, so every ore has
  something to replace. No water at all (`default_fluid` air, sea level -64, no aquifers). Low, rolling ground with
  wide flat plains and a few high ridges. A grey surface a few blocks deep (andesite, tuff and smooth basalt in
  patches, gravel in the hollows). No trees, no grass.
- **Biomes:** three of its own, `deepslate:moon_plains`, `deepslate:moon_highlands`, `deepslate:moon_craters`, no
  rain, grey sky and fog colours. Their features: every vanilla ore (coal, iron, copper, gold, redstone, lapis,
  diamond, emerald), the stone patches (granite, diorite, andesite, tuff), and geodes. No lakes, no plants, no
  structures. Their spawns: the usual night monsters (zombies, skeletons, spiders, creepers, endermen), no animals.
- **Other mods' ores** come by tag: the three biomes go in `#minecraft:is_overworld` and `#c:is_overworld`, which
  is how Create, Immersive Engineering and the rest find biomes for their ores. Anything else those mods hook to
  "every overworld biome" (a structure, a mob) comes too; the test server shows what does, and anything unwanted is
  taken off the Moon by its own tag or setting before it ships.
- **Mekanism's ores only there:** the datapack replaces `#mekanism:spawn_ores` (`"replace": true`) with the three
  Moon biomes. Osmium, tin, lead, uranium and fluorite then appear on the Moon and nowhere else, not even in new
  chunks of the main world. Salt is placed under water; the Moon has none, so there is no salt block anywhere.
  Mekanism makes brine from water in its Thermal Evaporation Plant, so nothing in its chain needs the salt block;
  the test server confirms it with JEI.

### M3 · Low gravity

A tick function in the Moon's datapack (added to `#minecraft:tick`): a player in `deepslate:moon` gets the modifier
`deepslate:moon_gravity` on `generic.gravity` (about a sixth of normal), a larger `generic.safe_fall_distance`, and
loses both the moment they are anywhere else (portal, death, `/tp`). Players only; mobs keep normal gravity. The
values are tried on the test server so that jumping feels floaty but walking up a block still works and nobody
sails off a ridge for ten seconds.

### M4 · The portal, built by players

`#deepslate:moon_portal_frame` and `#deepslate:moon_portal_igniter` in the Moon's datapack. Both must be things a
player can get before the Moon (nothing that only the Moon has, such as osmium). Proposed, for Alex to change:

- **Frame: smooth basalt** (grey, Moon-like; basalt from the Nether or from geodes, smelted). A frame like a nether
  portal's.
- **Igniter: an eye of ender.** Mid-game: blaze powder and an ender pearl. Fire does not light this frame.

Admins build the first one at spawn, inside the spawn claim, so nobody has to build one before their first trip.
Lint: not obsidian (the Nether's), not reinforced deepslate (the Frontier's), not fire.

To prove on the test server, because the mod's page does not say: that an eye of ender lights the frame; what the
mod builds on the Moon side (a frame of the same blocks, or none) and how far it searches for an existing one; where
a player comes out in the main world when they go back through a portal they built on the Moon (same x and z, as the
Moon's scale is 1, so possibly inside somebody's base). If a far-side portal could land inside another player's claim,
that is said in the guide or fixed with the mod's settings before anything ships.

### M5 · Pre-generation, map and backups

- **Pre-generation:** a square of ±3,000 around 0, 0 (as the Frontier: 140,625 chunks), on the test server with the
  final pack loaded, then the dimension's folder copied to live (docs/51 §6's way). Admin → Server → Pre-generation
  lists `deepslate:moon` beside the main world (its list of allowed worlds gains it). Past ±3,000 the Moon goes on
  and is made as players go there, ores included.
- **Map:** a BlueMap map for the Moon (`config/bluemap/maps/moon.conf`), behind the site's login like the others.
- **Backups:** the Moon is `world/dimensions/deepslate/moon/`, inside `world/`, so the backups take it already.

### M6 · What players read

No season or boss names, as always.

- The Mods guide: Mekanism's howTo says its ores are on the Moon (the docs/53 sentence about "old ground" goes). A
  new line under travel: what the Moon is, how to build a portal (frame, eye of ender), that gravity is low and the
  night never ends, that beds don't work there and that the air below y 0 needs a mask (how to craft the gas mask).
- The change log: docs/53 D3 post 2 ("Power and gear update is live") is rewritten before it goes out. Post 1 said
  the ores would appear in old ground; post 2 says they are on the Moon instead, how to get there, and that the main
  world was left as it was. It is still a reply in Change log, tagged.

### M7 · Gas below y 0 (Alex, 2026-10-12)

A function in the Moon's datapack, no mod. It runs every second (a function that reschedules itself with
`schedule function … 20t`, started from `#minecraft:load`), never every tick.

**Who:** every player not in creative or spectator, inside `deepslate:moon`, with feet below y 0 (one line in the
function, wrapped here):

```
execute as @a[gamemode=!creative,gamemode=!spectator] at @s if dimension deepslate:moon
  if entity @s[y=-64,dy=64] run function deepslate:gas/check
```

`deepslate:gas/check` looks at the helmet: a working mask (M8) wears and protects; anything else breathes the gas.

**Exposure:** a scoreboard `deepslate.gas`, +1 per second in gas without a mask, -2 per second otherwise (never
below 0). Stages (numbers tuned on test):

| Exposure (s) | What happens |
|---|---|
| 1 to 10 | actionbar "The air is thick here. You need a mask."; a vanilla haze particle around the player |
| 11 to 30 | Poison I and Slowness I for 2 s, refreshed every second |
| 31 and up | Poison II, Slowness II and Mining Fatigue I for 2 s, refreshed every second |

**The gas never kills** (Alex). Poison stops at half a heart in vanilla and nothing else in the gas does damage. At
half a heart any mob, fall or lava finishes the player, so the danger is real. Those deaths reach Discord with the
usual messages.

### M8 · The masks (Alex, 2026-10-12)

A ladder of three:

| Mask | Where it comes from | Lasts in gas | Then |
|---|---|---|---|
| **Gas mask** (our own) | crafted early, cheap | 30 s | breaks |
| Hazmat mask (Mekanism) | Mekanism crafting | about 30 min | breaks |
| MekaSuit helmet (Mekanism) | end game | never wears | never breaks |

Wear happens only while in gas. A mask outside the gas, or below y 0 outside the Moon, does not wear.

**Our gas mask**, made by the datapack and the existing resource pack, no mod:

- A crafting recipe in the datapack whose result is a `minecraft:leather_helmet` with components:
  `custom_name` "Gas mask", `custom_data` `{deepslate_mask:"basic"}`, `dyed_color` dark grey, `max_damage` 30,
  `custom_model_data` for its icon, `repair_cost` high enough that an anvil refuses it. Recipe, proposed and tuned
  on test: 1 leather, 2 string, 1 charcoal, 1 glass pane. Cheap on purpose: the cost is making new ones.
- The icon: a 16×16 texture and a model override on `leather_helmet` keyed on `custom_model_data`, added to
  `modpack/resourcepack/` (the pack every PC gets on Play). On the head it looks like a dark leather cap; 1.21.1
  cannot give it a worn model of its own without a mod. That is fine.
- Players get it from the recipe book like any recipe. JEI shows it.

**Wear:** `deepslate:gas/check` finds the mask by `custom_data` (ours) or by item id (Mekanism's, ids read from the
10.7.19.85 jar), then adds damage with `item modify` on `armor.head`:

- Gas mask: 1 point per second (30 points, so 30 s).
- Hazmat mask: as much per second as makes about 30 minutes from full. **If the hazmat mask has no durability in
  this Mekanism version, the report says so and the planner decides** (giving it durability through components
  changes a Mekanism item, so it is not done without a look).
- MekaSuit helmet: none.
- When a mask reaches its last point it is removed from the head (`item replace … with air`) with the vanilla item
  break sound and an actionbar "Your mask has given out.". Exposure starts from 0 at that moment.

Mending is left alone: putting Mending on a 30 second mask is the player's choice.

**Read from the jars on test before building M8:** the hazmat mask and MekaSuit helmet ids, the hazmat mask's
durability and its recipe (so Alex knows how early a player can have one).

## 4. Order

1. **The Moon's datapack and the tag changes** (M1 to M4), its own PR to `dev`, so it reaches the test server.
   **The gas and the masks** (M7, M8, with the mask's icon in the resource pack) are their own feature PR to `dev`
   after it.
2. **On the test server, on a fresh copy of live:** the first start (no FATAL, the dimension exists); the portal
   (lit with an eye of ender, the far side, coming back); gravity; that new chunks of the main world beyond ±10,176
   have no osmium (a few chunks forced to load out there, counted with WorldEdit) while the Moon's do; what else
   arrived on the Moon through the overworld tags; spark on the Moon. Then pre-generation on test (M5).
   **Gas and masks:** below y 0 without a mask, the warning at 1 s, poison at 11 s, the third stage at 31 s, health
   stops at half a heart; above y 0 exposure falls; creative feels nothing. The gas mask crafts, protects for 30 s,
   then breaks with the sound and the message, does not wear above y 0 or outside the Moon; an anvil refuses it.
   The hazmat mask lasts its time; the MekaSuit helmet never wears. A PC shows the mask's own icon.
3. **docs/53 A and E1 on test** (the quarry with docs/56's numbers and its tables, the armour check), in the same
   rehearsal.
4. **Alex tries it on his own PC** through the app's Test tab: through the portal, a jump, a mined osmium ore, the
   gas with and without each mask, a mask breaking.
5. **Live:** backup, then one PR from `main` with docs/53 A, B (without the retrogen), E1 and this doc's work;
   the pre-generated Moon folder copied in with the server stopped; deploy, restart; the first live start, a quarry,
   the portal at spawn, osmium on the Moon. Then post 2 goes live in the change log.

## 5. Not decided yet

- Frame block and igniter (M4's proposal).
- The gravity numbers (M3), after a try on the test server.
- The pre-generation radius (±3,000 proposed).
- Whether the Moon keeps going past its pre-generated square (proposed: yes, as the main world does).
- The gas stages and the gas mask's recipe (M7, M8), after a try on the test server.

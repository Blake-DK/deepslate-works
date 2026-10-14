# 61 · Gun balance: TaCZ damage, gun tiers and cannon damage

Planner, 2026-10-14. Players told Alex the guns are too strong. Alex: "lets do a review of the weapon powers as they
are too overpowered", then picked guns and cannons. This doc replaces docs/53's line "TaCZ guns plus a MekaSuit is
the top end and needs no change"; that was written without the numbers below.

## 1 · What the review found

Read from TaCZ 1.1.8-hotfix-r7's source (the build in the lock, `62q6mB5Q`) and its built-in gun pack
`tacz_default_gun`, and from Create Big Cannons' `create-v6-1.21.1` source. The session confirms every value against
the jars in the lock before changing anything (§6 step 1).

- **Bullets skip the hit cooldown.** `EntityKineticBullet` sets the target's `invulnerableTime` to 0 on every hit,
  so a gun's damage a second is its damage a shot times its rounds a minute over 60. A netherite sword does about 13
  a second (about 18 with Sharpness V). The default AK-47 does 90, the minigun 160, the M107 367.
- **Every gun is cheap.** All 54 recipes at the gun smith table use iron, gold, lapis, quartz, logs and at most a
  little diamond, netherite or blaze. The AK-47 is 38 iron, 6 lapis and 10 logs; the CZ75 (full auto, 75 a second)
  is 17 iron. The table itself is 4 iron, an iron block and 3 logs. Ammo is copper and gunpowder, which Create
  makes in bulk.
- **Nothing is tuned on the server.** The pack ships `modpack/config/tacz-common.toml` only. `tacz-server.toml`
  (a `SERVER` config, so per world) is at its defaults: `DamageBaseMultiplier`, `ArmorIgnoreBaseMultiplier` and
  `HeadShotBaseMultiplier` all 1.0.
- **Shotgun damage is the total of the pellets** (`applyShotgunDamageSpread`), so the table below is right for them.
- **Create Big Cannons:** damage per projectile lives in the datapack files
  `data/createbigcannons/munition_properties/projectiles/*.json` (`entity_damage`). Shells and shot do 30 to 50 and
  ignore armour, the autocannon rounds 10 to 14 and the machine gun round 8, all skipping the hit cooldown.
- **Immersive Engineering's revolver and railgun** are left alone: 10 a shot, a reload, steel and a blueprint to
  build. Alex was not asked about them.

## 2 · Alex's decisions (2026-10-14)

1. **All TaCZ damage to 35%:** `DamageBaseMultiplier = 0.35`. The other two multipliers stay at 1.0.
2. **Gun tiers:** the strong guns cost steel, the strongest netherite and refined obsidian as well (§4). Ammo
   costs more (§4.3).
3. **Create Big Cannons: every projectile's `entity_damage` halved** (§5). Block damage is not changed.

Guns already in players' hands keep working; the multiplier applies to them at once, the tiers only to new crafts.

## 3 · The multiplier

`tacz-server.toml`, section `[base_multiplier]`: `DamageBaseMultiplier = 0.35`. Every other key at the default the
mod writes. TaCZ syncs this value to clients (`SyncConfig`), so the gun tooltips show the new damage.

- Ship it as `modpack/server/defaultconfigs/tacz-server.toml`, the full file as the mod writes it on the test server
  with only that one value changed.
- `defaultconfigs` is only copied into a world that has no `serverconfig/tacz-server.toml` yet. Test's and live's
  worlds already have one. Find out how Sync treats `defaultconfigs` against a world's own `serverconfig`, then make
  the world's copy read 0.35 too, by Sync if it can, and report which way it went. No hand edits on live outside
  the live step (§7).
- Server only. No pack hash change for this part.

## 4 · Gun tiers

A world datapack overrides TaCZ's recipes. TaCZ adds its gun packs as a required pack at `Pack.Position.BOTTOM`
(`GunPackLoader`), so `deepslate-tools` wins over it. Put the files in `modpack/datapacks/deepslate-tools` at the
same paths the gun pack uses: `data/tacz/recipe/gun/<gun>.json` and `data/tacz/recipe/ammo/<ammo>.json`. Copy each
file from the jar in the lock (`assets/tacz/custom/tacz_default_gun/data/tacz/recipe/…`), never from GitHub, and
change only what this section says.

### 4.1 · The rule

- **Tier 1:** unchanged.
- **Tier 2:** half the recipe's `c:ingots/iron` (rounded up) becomes `c:ingots/steel`. A recipe with no iron gets 8
  `c:ingots/steel` added.
- **Tier 3:** tier 2's rule, then add 2 `c:ingots/netherite` (on top of any it already has) and 4
  `c:ingots/refined_obsidian`.

Steel comes from Immersive Engineering's blast furnace or Mekanism; refined obsidian from Mekanism. Before writing
the files, check in the jars in the lock that `c:ingots/steel`, `c:ingots/netherite` and
`c:ingots/refined_obsidian` are filled, and name the mods that fill each. If one is empty, stop and report.

### 4.2 · The tiers

"Per second" is damage a shot times rounds a minute over 60: before armour, misses and headshots, the gun's default
fire mode, no attachments. Melee for scale: a netherite sword about 13, with Sharpness V about 18.

| Gun | Tier | Damage a shot | Rounds a minute | Per second now | Per second at 0.35 |
|---|---|---|---|---|---|
| `tacz:hk_mk23` | 1 | 12 | 50 | 10 | 4 |
| `tacz:taurus943` | 1 | 6 | 180 | 18 | 6 |
| `tacz:lonetrail` | 1 | 21.5 | 90 | 32 | 11 |
| `tacz:rhino357` | 1 | 10.5 | 200 | 35 | 12 |
| `tacz:glock_17` | 1 | 6 | 400 | 40 | 14 |
| `tacz:m9a4` | 1 | 6 | 400 | 40 | 14 |
| `tacz:db_long` | 1 | 30 | 100 | 50 | 18 |
| `tacz:springfield1873` | 1 | 35 | 90 | 52 | 18 |
| `tacz:m16a4` | 1 | 8 | 400 | 53 | 19 |
| `tacz:db_short` | 1 | 24 | 150 | 60 | 21 |
| `tacz:m1911` | 1 | 11 | 350 | 64 | 22 |
| `tacz:m700` | 1 | 24 | 180 | 72 | 25 |
| `tacz:p320` | 1 | 10 | 450 | 75 | 26 |
| `tacz:uzi` | 2 | 6.5 | 600 | 65 | 23 |
| `tacz:deagle_golden` | 2 | 12 | 350 | 70 | 24 |
| `tacz:hk_g3` | 2 | 12 | 350 | 70 | 24 |
| `tacz:p90` | 2 | 5.5 | 810 | 74 | 26 |
| `tacz:cz75` | 2 | 5 | 900 | 75 | 26 |
| `tacz:timeless50` | 2 | 15 | 300 | 75 | 26 |
| `tacz:fn_fal` | 2 | 13 | 350 | 76 | 27 |
| `tacz:deagle` | 2 | 16 | 300 | 80 | 28 |
| `tacz:mk14` | 2 | 16 | 300 | 80 | 28 |
| `tacz:taurus500` | 2 | 40 | 120 | 80 | 28 |
| `tacz:scar_l` | 2 | 7.5 | 650 | 81 | 28 |
| `tacz:hk_mp5a5` | 2 | 6 | 820 | 82 | 29 |
| `tacz:qbz_95` | 2 | 7.5 | 660 | 82 | 29 |
| `tacz:aug` | 2 | 7 | 710 | 83 | 29 |
| `tacz:m4a1` | 2 | 6.5 | 810 | 88 | 31 |
| `tacz:ak47` | 2 | 9 | 600 | 90 | 31 |
| `tacz:g36k` | 2 | 7 | 780 | 91 | 32 |
| `tacz:sks_tactical` | 2 | 11 | 510 | 94 | 33 |
| `tacz:qbz_191` | 2 | 7.5 | 750 | 94 | 33 |
| `tacz:type_81` | 2 | 9 | 630 | 94 | 33 |
| `tacz:ump45` | 2 | 9 | 660 | 99 | 35 |
| `tacz:m16a1` | 2 | 8 | 750 | 100 | 35 |
| `tacz:hk416d` | 2 | 6.5 | 943 | 102 | 36 |
| `tacz:rpk` | 2 | 10 | 630 | 105 | 37 |
| `tacz:m870` | 2 | 36 | 180 | 108 | 38 |
| `tacz:kar98` | 2 | 26 | 250 | 108 | 38 |
| `tacz:b93r` | 2 | 7.5 | 900 | 112 | 39 |
| `tacz:spr15hb` | 2 | 10 | 700 | 117 | 41 |
| `tacz:m320` | 3 | 10 | 150 | 25 | 9 |
| `tacz:rpg7` | 3 | 20 | 150 | 50 | 18 |
| `tacz:m249` | 3 | 7.5 | 750 | 94 | 33 |
| `tacz:ai_awp` | 3 | 42 | 171 | 120 | 42 |
| `tacz:scar_h` | 3 | 14 | 570 | 133 | 47 |
| `tacz:m1014` | 3 | 40 | 200 | 133 | 47 |
| `tacz:vector45` | 3 | 7 | 1200 | 140 | 49 |
| `tacz:fn_evolys` | 3 | 12 | 750 | 150 | 52 |
| `tacz:minigun` | 3 | 8 | 1200 | 160 | 56 |
| `tacz:aa12` | 3 | 30 | 350 | 175 | 61 |
| `tacz:m95` | 3 | 75 | 151 | 189 | 66 |
| `tacz:spas_12` | 3 | 64 | 200 | 213 | 75 |
| `tacz:m107` | 3 | 55 | 400 | 367 | 128 |

The CZ75 is tier 2, not 1: it is a full-auto pistol at 900 rounds a minute.

### 4.3 · Ammo

Every ammo recipe's result count is halved (rounded up). The materials stay. Report the before and after counts.

### 4.4 · The Mods guide

TaCZ's `howTo` in `modpack/mods.json` gets one sentence after the gun smith table one: "Pistols, revolvers, double
barrels and bolt rifles take iron; most rifles, SMGs and shotguns also take **steel**; the biggest guns need
**netherite** and **refined obsidian** too." Player-facing text names no season and no boss mod.

## 5 · Create Big Cannons

Copy every file in `data/createbigcannons/munition_properties/projectiles/` from the jar in the lock (`bOiDu0LS`)
into `modpack/datapacks/deepslate-tools` at the same path, and halve `entity_damage` in each, nothing else. A file
with no `entity_damage` (for example `bag_of_grapeshot`) is not copied. Check first that the server reads these
files from datapacks (the mod's own `munition_properties` loader), so an override takes effect. Report a table:
projectile, before, after.

Block damage, `damageRestriction` and the other `CBCCfgMunitions` keys stay as they are.

## 6 · Build and test

1. **Confirm the numbers.** From the jars in the lock: TaCZ's gun table above (damage, rounds a minute, recipe) and
   Create Big Cannons' `entity_damage` per projectile. Any value that differs from this doc: report it and use the
   jar's.
2. **Write** §3's config, §4's recipes, §5's projectiles and §4.4's text on a feature branch. Lint, verify-links and
   `deploy/check.sh` green. One PR to `dev`.
3. **Test server.** Build and Sync through api-test, never jars or files by hand. Then, with the server's own log
   and the game, not unit tests:
   - The start has no new ERROR naming `tacz` or `createbigcannons`, and no recipe that fails to load.
   - `/reload` runs clean.
   - **Damage, by test:** a zombie and an iron golem summoned in a flat spot, `pvp` unchanged. Count shots to kill
     with the Glock, the AK-47, the M870 and the M95, before and after the change (the before from a copy, or the
     numbers above times 0.35 if no copy). Report a table.
   - **Tooltips:** the AK-47's tooltip damage reads about 35% of before.
   - **Recipes:** at the gun smith table, a tier 1, tier 2 and tier 3 gun each show the new materials, and one of
     each crafts from a test inventory. One ammo craft shows the halved count.
   - **Cannons:** one AP shot and one machine gun round on a summoned zombie; damage taken matches the halved value.
4. **Alex tries it on test** through the app's Test tab: fires an AK and crafts one gun. Nothing goes to `main` before
   he says it plays right.

## 7 · Live

After Alex's yes, in the usual `dev` → `main` PR (ask him first if `dev` still carries held work). Backup before the
restart. Then live's world `serverconfig/tacz-server.toml` reads 0.35, the AK's tooltip and one recipe are checked in
game, and the log has no new ERROR.

**Update post.** A change log entry (docs/53 Part D, tagged by the system, not by hand): "Guns have been rebalanced:
all gun damage is lower, and the stronger guns now need steel, the biggest ones netherite and refined obsidian.
Ammo crafts give half as many rounds. Cannon shells do half the damage to mobs." Guns players already own keep
working at the new damage.

## 8 · Season 1 rehearsal

docs/53 E2's fight table gets two more columns: each Season 1 boss fought with a tier 2 rifle (the AK-47) and a tier
3 gun (the M95), reporting time to kill and damage taken next to netherite and the MekaSuit. If a gun makes a boss
trivial (under a third of the netherite time), propose a change in the report; Alex decides.

## Done when

The PR is on `dev` with every table above filled from the jars; test shows the shot counts, tooltips, recipes and
cannon damage in the game; Alex has tried it on test and said go; live has it after a backup, checked in game.
Update docs/11-status.md and send the report.

# 06 · Modpack manifest and tooling

## `modpack/mods.json` (source of truth, hand-edited or edited by the admin UI)

```jsonc
{
  "name": "Deepslate Works",
  "version": "0.1.0",                 // bump on every change that affects clients
  "minecraft": "1.21.1",
  "loader": "neoforge",
  "neoforge": "latest",               // "latest" = newest stable 21.1.x from the NeoForged maven; or pin "21.1.xxx"
  "server_address": "mc.dsw.test",          // mc-router on the homelab hands it to the instance (docs/17); players use it with no port
  "profile": { "id": "deepslate-works", "dir": ".minecraft-deepslate-works", "icon": "Furnace" },
  "ram": { "min_gb": 3, "max_gb": 6 },
  "server_properties": { "pvp": "false", "difficulty": "normal", "white-list": "false", "max-players": "20", "…": "…" },
                                        // what the vote's settings questions decide; written to the server by hand in AMP, not by Sync
  "categories": [                       // in the order the catalogue shows them
    { "id": "base", "title": "Base pack", "blurb": "Not up for vote. …", "votable": false },
    { "id": "factories", "title": "Factories & power", "blurb": "…", "votable": true }
    // mining, guns, world; and server (not votable)
  ],
  "mods": [
    {
      "slug": "create",                 // Modrinth project slug (verify via https://api.modrinth.com/v2/project/<slug>)
      "name": "Create",
      "category": "factories",
      "side": "both",                   // both | client | server
      "enabled": true,                  // false = listed for voting but not shipped
      "load": "M",                      // L | M | H, client performance cost
      "recommended": true,
      "exclusiveGroup": null,           // e.g. "guns": at most one enabled per group
      "hidden": false,                  // true: not shown in the catalogue or on the ballot (a library another mod needs)
      "adminOnly": false,               // optional; true: the coming season's; installed as usual, listed on the site to admins only (never in a votable category)
      "description": "Cogs, belts, steam engines, trains, mechanical drills and presses.",
      "wiki": "https://createmod.net/wiki",
      "videos": [ { "title": "…", "url": "https://www.youtube.com/watch?v=…" } ],
      // "noVideosFound": "2026-10-05",  // optional, only with no videos: the day YouTube was searched and had nothing on it
      "version": "latest",              // or a Modrinth version id to pin
      "requires": []                    // slugs; auto-filled from Modrinth required deps at lock time
    }
  ]
}
```

Rules enforced by `modpack lint`:
- slug unique; category in `categories`; side/load valid.
- At most one `enabled` mod per `exclusiveGroup`.
- Every `requires` slug exists in the list (dependencies are added as `category: "base"`, `hidden: true`).
- `server` side mods never ship to clients; `client` side mods never ship to the server.
- An `adminOnly` mod is not in a votable category.
- A shown mod with no videos is a warning, unless `noVideosFound` holds the date YouTube was searched and had nothing genuine about it.

## The catalogue as it stands (2026-09-29, pack `0.1.0+1a48e8ff`)

Made from `modpack/mods.json` and `mods.lock.json`; **those files are what counts**, this table is a picture of them. 40 mods, 31 in the pack. The lock has 34 files: 25 go to the server, 31 to a PC. "on" with "suggested" is the recommended set, switched on on 2026-09-29 while the vote stays open.

| slug | name | category | side | in the pack | load | version in the lock | notes |
|---|---|---|---|---|---|---|---|
| sodium | Sodium | base | client | **on** | L | mc1.21.1-0.8.13-neoforge |  |
| lithium | Lithium | base | both | **on** | L | mc1.21.1-0.15.4-neoforge |  |
| ferrite-core | FerriteCore | base | both | **on** | L | 7.0.3-neoforge |  |
| modernfix | ModernFix | base | both | **on** | L | 5.27.24+mc1.21.1 |  |
| entityculling | Entity Culling | base | client | **on** | L | 1.11.2 |  |
| immediatelyfast | ImmediatelyFast | base | client | **on** | L | 1.6.14+1.21.1-neoforge |  |
| dynamic-fps | Dynamic FPS | base | client | **on** | L | 3.11.4 |  |
| jei | Just Enough Items | base | both | **on** | L | 19.51.0.418 |  |
| jade | Jade | base | both | **on** | L | 15.10.6+neoforge |  |
| xaeros-minimap | Xaero's Minimap | base | client | **on** | L | neoforge-1.21.1-26.5.0 |  |
| xaeros-world-map | Xaero's World Map | base | client | **on** | L | neoforge-1.21.1-1.46.0 |  |
| appleskin | AppleSkin | base | both | **on** | L | 3.0.9+mc1.21 |  |
| mouse-tweaks | Mouse Tweaks | base | client | **on** | L | 1.21-2.26.1-neoforge |  |
| corpse | Corpse | base | both | **on** | L | neoforge-1.21.1-1.1.13 |  |
| simple-voice-chat | Simple Voice Chat | base | both | **on** | L | neoforge-1.21.1-2.6.22 |  |
| fallingtree | FallingTree | base | both | **on** | L | 1.21.1-1.21.1.11 |  |
| bettertabinfo | Better Tab Info | base | client | **on** | L | 2.2.1+1.21.1-neoforge | TPS and everyone's ping in the Tab list, instead of TabTPS; pulls in craft-config (client) |
| rpl | Ritchie's Projectile Library | base | both | off | L |  | hidden (needed by another mod) |
| sophisticated-core | Sophisticated Core | base | both | **on** | L | 1.21.1-1.5.2.2343 | hidden (needed by another mod) |
| scalable-cats-force | scalable-cats-force | base | both | **on** | L | 3.7.1-build-11 | hidden (needed by another mod) |
| create | Create | factories | both | **on** | M | 6.0.10+mc1.21.1 | suggested |
| createaddition | Create: Crafts & Additions | factories | both | **on** | L | neoforge-1.21.1-1.6.0 | suggested |
| create-big-cannons | Create Big Cannons | factories | both | off | M |  |  |
| immersiveengineering | Immersive Engineering | factories | both | off | M |  |  |
| mekanism | Mekanism | factories | both | off | H |  |  |
| mekanism-generators | Mekanism Generators | factories | both | off | H |  |  |
| mekanism-tools | Mekanism Tools | factories | both | off | L |  |  |
| industrial-foregoing | Industrial Foregoing | factories | both | off | M |  |  |
| ae2 | Applied Energistics 2 | factories | both | off | M |  |  |
| veinminer | VeinMiner | mining | both | **on** | L | 2.11.2 | suggested |
| sophisticated-backpacks | Sophisticated Backpacks | mining | both | **on** | L | 1.21.1-3.26.6.2174 | suggested |
| additional-enchanted-miner | Quarry (Additional Enchanted Miner) | mining | both | **on** | M | 21.1.164 | suggested |
| tacz-1.21.1 | TaCZ (Timeless and Classics Zero) | guns | both | **on** | M | 1.1.8-hotfix-r6 | suggested; pick one: guns |
| vics-point-blank | Vic's Point Blank | guns | both | off | M |  | pick one: guns |
| waystones | Waystones | world | both | **on** | L | 21.1.46+neoforge-1.21.1 | suggested |
| farmers-delight | Farmer's Delight | world | both | **on** | L | 1.21.1-1.3.4 | suggested |
| pipez | Pipez | world | both | **on** | L | neoforge-1.21.1-1.2.31 | suggested |
| chunky | Chunky | server | server | **on** | L | 1.4.23 |  |
| spark | spark | server | server | **on** | L | 1.10.124-neoforge-1.21.1 |  |
| bluemap | BlueMap | server | server | **on** | L | 5.7-neoforge |  |

In the lock and not in the catalogue, because a mod in the pack needs them: `balm` 21.0.66+neoforge-1.21.1 (for waystones), `kotlin-lang-forge` 2.14.1-k2.4.20-3.0+neoforge (for veinminer).

Warnings Lock gives every time: `corpse` and `pipez` have no release build for 1.21.1 and are taken as betas.

The first plan's list had FTB Essentials, FTB Ultimine, Advanced Mining Dimension and Create Ultimine; none of them is in the catalogue. What takes their place: VeinMiner for mining a vein at once, the quarry (Additional Enchanted Miner), and nothing yet for homes (Phase 4).

## `mods.lock.json` (generated, committed)

```jsonc
{
  "generatedAt": "2026-09-29T18:1x:00Z",
  "minecraft": "1.21.1",
  "neoforge": "21.1.252",
  "hash": "1a48e8ff…",                             // its first eight characters end the pack's version
  "files": [
    {
      "slug": "create", "projectId": "LNytGWDc", "versionId": "…", "versionNumber": "6.0.10",
      "filename": "create-1.21.1-6.0.10.jar",
      "url": "https://cdn.modrinth.com/data/…/create-1.21.1-6.0.10.jar",
      "sha512": "…", "size": 17825792,
      "side": "both", "requiredBy": []             // slugs that pulled this in, empty = top level
    }
  ],
  "configs": [ { "path": "config/fallingtree.json", "sha256": "…" }, { "path": "config/tacz-common.toml", "sha256": "…" } ]
}
```

`hash` is the SHA-256 of these lines: the NeoForge version; `slug@versionId` for every file; `config:<path>@<sha256>` for every settings file (`packHash` in `packages/modpack/src/lock.ts`). The same mods and the same settings give the same hash, whenever the lock is made.

## `packages/modpack` CLI

`pnpm --filter modpack cli <command>`, or from the site: Admin → Modpack has Lock, Build and Sync as buttons.

**Sync and the server** (Alex, 2026-10-20: "the sync script should start the server too"; `afterSync` in `apps/api/src/modpack/sync.ts`): after copying, a running server is restarted when the mods changed; a sleeping one is woken (AMP `Core.Start`) when they changed, and on the test server always; a stopped one is started on the test server only, never on live, which is only ever stopped on purpose (2026-10-09); a starting, failed or unknown one is left alone. A start is waited for and its mods checked like a restart's. Until then a stopped or sleeping test server kept the files without loading them, and the check after Sync compared the pack with the start before.

| Command | Does |
|---|---|
| `lint` | validates `mods.json`; with the lock's jars on this machine (`dist/cache/lock-jars`, private ones also from `data/private-jars`), also what the mods need of each other (below), and says so when it could not look |
| `verify-links` | asks for every `wiki` and `videos[].url`, reports the ones that fail |
| `lock` | for each mod in the pack: `GET /v2/project/{slug}/version?loaders=["neoforge"]&game_versions=["1.21.1"]`, takes the pinned id or the newest `release` (a `beta` with a warning when there is none); adds required dependencies, and theirs; resolves `neoforge: latest` from the NeoForged maven (highest `21.1.*` without `-beta`); takes the checksums of the files under `modpack/config/`; writes the lock. **Fails, and writes nothing, when a mod has no build for NeoForge 1.21.1, or when the jars' own dependencies do not fit (below).** Says "unchanged" and writes nothing when neither a mod nor a settings file has changed; `lock --force` writes all the same |
| `check-deps` | the lock as committed: fetches each jar into `dist/cache/lock-jars` (sha512-checked; a private jar copied from `data/private-jars`) and runs Lock's dependency check on it. Exits 1 on a problem |
| `build server` | downloads the files for the server into `dist/server/mods/`, checks each against its checksum, copies `modpack/server/*`, `modpack/config/*` and `modpack/datapacks/*` |
| `build config` | `dist/config.zip` from `modpack/config/`, for the installer; with `modpack/resourcepack/` (when it has a `pack.mcmeta`) zipped in as `resourcepacks/deepslate-textures.zip` |
| `build installer` | zips `installer/` with the site's address and the pack's version stamped into `install.ps1`; writes `dist/installer.json` (the installer's version, the zip's SHA-256 and size) |
| `build`, `build all` | the three |

There is no `build client` (Windows only since 2026-09-29: the installer downloads a PC's files itself from the mod list, and a `client.mrpack` left over from before is removed by a build). There is no `sync-server` in the CLI: a sync needs the tunnel and the deploy key, which only `api` has (`POST /modpack/sync`, docs/08). It copies `dist/server/` to the instance by rsync (the mods folder made the same as the build's, settings and datapacks added to what is there, nothing of the server's own deleted) and restarts the server **if the mods changed**. Its log says so ("restarting the server to load the new mods…"), waits for the server to come back up and then checks that it loaded every mod the pack gives it (`POST /modpack/verify`); with the mods unchanged it checks the server's last start. Every start is checked the same way, and a missing mod goes into the event log.

In production Build runs inside the `api` container, under its memory limit, and never on the host itself (docs/09 "Memory limits"). Lock runs from Admin → Modpack. Jars are streamed to disk and hashed in chunks.

### What the mods need of each other (`packages/modpack/src/deps.ts`, 2026-10-20)

Modrinth's dependency lists say which projects a mod needs, not which versions. Each jar says that itself, in `META-INF/neoforge.mods.toml`, and NeoForge refuses to start when it is not met. Twice a pack passed Lock and every PC then failed: Xaero's maps 26.6.0 / 1.47.0 work with Open Parties and Claims 0.32.4 or newer only, and it was pinned at 0.31.6 (2026-10-05, docs/11); Create Aeronautics' Simulated needs Flywheel 1.0.6 and Sable takes 1.0.6 or newer, while Vanillin carries its own Flywheel 1.0.4 (2026-10-20). Lock now reads, for every jar it fetches:

- each `[[mods]]` mod id and version (`${file.jarVersion}` from the jar's manifest), and each `[[dependencies.<id>]]`: mod id, type (required, optional, incompatible, discouraged; older files' `mandatory = true/false`), `versionRange` in Maven's syntax, side (BOTH, CLIENT, SERVER);
- the jar-in-jar libraries (`META-INF/jarjar/metadata.json`: identifier `group:artifact`, range, version, path) and their own `neoforge.mods.toml`, down to three deep.

It then works out what loads, separately for PCs (everything but server-only) and for the server (everything but client-only), with no season shipped, each season on its own, and all of them. Per jar-in-jar identifier, the newest copy every carrier accepts loads; a mod in the mods folder wins over any jar-in-jar copy of it (said as a warning when the versions differ). Versions are compared as Maven compares them, as NeoForge does, and on 1.21.1 a mod that accepts Minecraft 1.21 is taken to accept 1.21.1 too, as NeoForge does (JEI and Alternate Current say `[1.21,1.21.1)`). Lock stops, writes nothing and names the mod, the dependency, the range and the version found, when:

- a required dependency is missing, or one of its versions that may load is outside the range;
- an optional one is there in a version outside the range (the Xaero case: NeoForge refuses that too);
- an incompatible one is there in range;
- one mod id comes in two versions under two jar-in-jar identifiers and a range refuses one of them. Which version loads is not certain (Flywheel 1.0.6 in Create as `dev.engine-room.flywheel:flywheel-neoforge-1.21.1`, 1.0.4 in Vanillin as `dev.engine-room.flywheel:neoforge`; PCs loaded 1.0.4), so every such version is held to each range, and the error names both sources. When every range takes each version, the two versions are a warning (Create and Vanillin alone both take `flywheel [1.0.0,2.0)`; live has run on that since October);
- two jars in the mods folder have one mod id, or no copy of a jar-in-jar library fits every carrier's range.

A discouraged dependency in range is a warning. A jar that could not be read (a private jar not on this machine) is named, and a required mod missing then is a warning, not an error. Only Lock with a jar cache runs the check: the CLI's `modpack lock` does; Admin → Modpack → Lock passes none and says in its log that nothing was looked into.

**The Extras beside the pack (2026-10-26).** Simple Voice Chat 2.6.25 and newer take Sound Physics Remastered 1.5.2 or newer only (an optional dependency, so only when the Extra is on). The Lock that moved voice chat to 2.6.26 also moved the Extra to 1.5.2, but a test PC still had the Extra at 1.4.10 and the game stopped at "Error loading mods". Lock now also holds the pack's PC side (no season, each season, all of them) beside every mod Extra switched on at once, twice: the Extras as just locked, and, when they changed, the Extras of the lock before, as PCs still have them until they update. An error there stops Lock and writes neither lock. `check-deps` does the first of the two for the lock as committed. Problems the pack has without any Extra are left to the pack's own check.

All commands can be run again without harm and print what they changed. Network failures are tried three times and then fail loudly; a half-written lockfile is never left behind (write to temp, rename).

A build makes `dist/server/config/` and `dist/server/datapacks/` afresh each time, so a settings file taken out of the pack does not stay behind (since 2026-09-29; TabTPS's lingered until then). Sync still never deletes on the server: `config/tabtps/` is on the instance, unused.

## Settings shipped with the pack (`modpack/config/`, `modpack/server/`, `modpack/datapacks/`)

| Where | What | Goes to |
|---|---|---|
| `modpack/config/fallingtree.json`, `tacz-common.toml` | see "Settings shipped with the pack (2026-09-29 evening)" below | the server and every PC |
| `modpack/server/config/bluemap/core.conf`, `webserver.conf` | BlueMap: three render threads (one until 2026-09-30, when the VM got 15 GB and the server 10 GB), the address it listens on (`0.0.0.0:8100`; the AMP host's nftables admit only the site's host to 8100). A change is applied by Build, Sync and Admin → Server → Pre-generation → "Reload BlueMap's settings" (`bluemap reload`), no restart | the server |
| `modpack/datapacks/deepslate-limbo/` | the entrance room's dimension (docs/14) | the server's world; a new dimension counts from the next restart |
| `modpack/server/config/quarryplus.toml` | the quarry's energy costs ×4 (docs/53 Part A): `[powerMap.quarry]` `breakBlockBase` 100, `moveHeadBase` 4, `makeFrame` 60; every other key the mod's default | the server (energy is worked out there); not in the pack's hash |
| `modpack/server/config/Mekanism/world.toml` | **No retrogen** (docs/55 M1, replacing docs/53 Part B's): Mekanism's own defaults, `enableRegeneration = false`, `userWorldGenVersion = 0`. The main world is never changed to add Mekanism's ores; they are on the Moon alone. The file stays in the pack because Sync never deletes: without it, a server that once had docs/53's `true` and `1` would keep them. **Do not switch regeneration on** | the server; not in the pack's hash |
| `modpack/server/config/bluemap/maps/moon.conf` | the Moon's BlueMap map (docs/55 M5), id `moon`, `deepslate:moon` in `world/`; BlueMap only makes map configs for the worlds it finds at its first start, so a dimension added later needs one shipped. Keys from BlueMap 5.7's own template | the server; not in the pack's hash |
| `modpack/datapacks/deepslate-moon-mobs/` | the horror mobs on Ashmoon only (Alex, 2026-10-14): Mutant Monsters' four `without_mutant_*_spawns` tags hold every main-world, Nether and End biome; ArPhEx's spawn rules for the main world point at Ashmoon's biomes (its own dimension's rules kept), and five of its structures generate on Ashmoon only; each ArPhEx file has a `mod_loaded` condition | the server's world |
| `modpack/server/config/ArPhEx Configurations.toml` | the file ArPhEx wrote, with `"Vanilla Replacement Mode" = 0.0` (it turned 1 in 10 ordinary mobs anywhere into its own), the full-moon sky scare and the join message off, both spawn rates at 2 (5 by default, lower = more) | the server; not in the pack's hash |
| `modpack/server/config/mutantmonsters-common.toml` | each mutant at 0.25 of the creeper's spawn weight (0.05 by default): about one Ashmoon monster in five | the server; not in the pack's hash |
| `modpack/datapacks/deepslate-moon/` | the Moon (docs/55 M2 to M4): the dimension `deepslate:moon` on noise settings of its own, its three biomes (every vanilla ore, stone patches, geodes, night monsters; no water or plants) added to `#minecraft:is_overworld` and `#c:is_overworld`; `#mekanism:spawn_ores` replaced by those three biomes, so Mekanism's ores are made there and nowhere else; low gravity for players there (a tick function); the portal's frame (smooth basalt) and igniter (eye of ender) for Server Sided Portals. M7 and M8: radiation below y 30 (Alex, 2026-10-14; docs/55 had gas below y 0), stronger below y 0 and deadly below y -25 (`deepslate:gas/*`, once a second from `#minecraft:load`; the depth in `deepslate.band`) and the protection: the gas mask's recipe (`deepslate:gas_mask`, a leather helmet with components, `custom_model_data` 5501) and its unlock, the wear modifiers, 1800 points of durability given to Mekanism's hazmat gear the first time it is worn in the radiation, `#deepslate:gas_mask_hazmat`, `#deepslate:gas_mask_sealed`, `#deepslate:hazmat_suit` and `#deepslate:radiation_suit/*` (Mekanism's, optional entries) | the server's world; a new dimension counts from the next restart, not `/reload` |
| `modpack/resourcepack/assets/minecraft/models/item/leather_helmet.json`, `assets/deepslate/` | the gas mask's icon (docs/55 M8): vanilla 1.21.1's leather helmet model (its ten armour-trim models kept) with one more override, `custom_model_data` 5501 → `deepslate:item/gas_mask` (a hood tinted by the item's colour, the glasses and filter untinted) | every PC (in `config.zip`); in the pack's hash |
| `modpack/datapacks/deepslate-animals/` | one of each animal (Alex, 2026-10-20): `naturalist:has_crab` and `naturalist:has_dragonfly` replaced with empty tags, so Naturalist adds no crab or dragonfly spawns; Friends & Foes' crab and Critters and Companions' dragonfly are the pack's | the server's world; from the next restart |
| `modpack/server/config/crittersandcompanions-common.json5` | `configVersion` 2 and `spawning.snail` empty: no Critters and Companions snails (Naturalist's is the pack's). Only those keys: YACL starts from the mod's defaults, reads what is in the file and writes the whole file back | the server; not in the pack's hash |
| `modpack/config/Mekanism/tools-materials-startup.toml` | Mekanism Tools armour no better than netherite (docs/53 E1): Refined Obsidian 3, 8, 6, 3, toughness 3, knockback 0.1 (was 6, 12, 8, 5, 5, 0.2); the Osmium helmet 3 (was 4). A STARTUP config: the server works out the protection, a PC shows it on the item | the server and every PC; in the pack's hash |

Thought of in the first plan and not shipped: Xaero's (minimap on, waypoints for each server), JEI (cheat mode off), Simple Voice Chat (push to talk on `V`), Corpse (corpses never despawn, only the owner can loot for 30 min). Each mod runs on its own defaults. To ship one: start the game or the server once, take the file the mod wrote, change what is to be changed, put it under `modpack/config/`, Lock, Build, Sync.

## TabTPS (2026-09-29): in the catalogue, switched off

**Later the same day: taken out of `mods.json` altogether** (planner). Its place is taken by **Better Tab Info** (`bettertabinfo`, base, client only, with its library `craft-config`): TPS and everyone's ping in the Tab list, worked out on each PC, nothing on the server.

Added at 09:42 UTC, taken out at 10:52 UTC the same day. With BlueMap in the pack the server does not start: `java.lang.module.ResolutionException: Modules bluemap and net.kyori.adventure.text.serializer.gson export package net.kyori.adventure.text.serializer.gson.impl to module corpse`. Both mods carry the same library. **Check a server-side mod against BlueMap before adding it** when it is by the same authors' circle (anything built on Adventure: TabTPS, MiniMOTD, squaremap and the like). The portal gets its pings from spark instead; see docs/05 "Connection".

## The recommended set is switched on (planner, 2026-09-29 16:4x UTC); the vote stays open

`enabled: true` on every mod with `recommended: true`: create, createaddition, veinminer, sophisticated-backpacks, additional-enchanted-miner, tacz-1.21.1, waystones, farmers-delight, pipez; and on what they need: sophisticated-core, scalable-cats-force (it loads as `kuma_api`). The lock added balm and kotlin-lang-forge by itself. 30 of the 40 mods in the catalogue are on; the pack was `0.1.0+b5d461ea` then (`0.1.0+1a48e8ff` since the settings files count, below), 32 files in the lock, 25 on the server, 29 on a player's PC. The mods stay votable and the vote was not closed.

Started once with all of them, nobody on (16:49:24 to `Done (1.370s)` at 16:49:40 by the server's clock, 16 s): 31 entries in the loader's list, no ERROR line, nothing switched off. VeinMiner and FallingTree load side by side; what they do to the same tree in the game has not been tried.

Settings, as shipped: `pvp=false` in `server.properties`. TaCZ has no setting for damage between players (`tacz-server.toml` has multipliers only), so `pvp=false` is what keeps guns from hurting players; `ExplosiveAmmoDestroysBlock = true` in `tacz-common.toml` was TaCZ's default and meant that explosive ammunition breaks blocks; **the pack ships it as `false` since the evening** (below). The quarry has no settings file in the pack: its speed is the mod's default. (Since docs/53 Part A it has one: its energy costs ×4, see the table above.)

**The area that was pre-generated that morning (radius 1500, 35,721 chunks) was made before these mods were on.** What they add to new terrain (Create's zinc ore, Farmer's Delight's wild crops, the villages' waystones) is missing inside it and present in every chunk made from now on. To have it near spawn the world would have to be made again; that is Alex's to decide.

## Settings shipped with the pack (2026-09-29 evening)

`modpack/config/` holds the settings files that go out with the pack, to the server (`dist/server/config`, by Sync) and to every PC (`config.zip`, by the installer). Two so far, each the mod's own file as the server had written it, with one value changed:

| File | Changed | Why |
|---|---|---|
| `fallingtree.json` | `tools.ignoreTools: true` | Alex: "it should work without an axe". A tree falls whatever is in the hand; sneaking takes one log |
| `tacz-common.toml` | `ExplosiveAmmoDestroysBlock = false` | the planner's ruling: griefing by accident |

**The settings are part of the pack's version since then.** Before, the version was made of the mods alone: a change of settings left the lock "unchanged", its list of settings stayed empty, the mod list named no `config_url`, and no PC was sent anything. Lock now counts a settings file that is new, other than it was, or gone as a change (`~ settings config/…`), and the hash takes the files' checksums in. A pack without settings has the hash it always had. The pack went from `0.1.0+b5d461ea` to `0.1.0+1a48e8ff` by this alone, so Play-first asks everyone for one more run of Play, which fetches `config.zip` and no mod.

A Sync that changes settings only does not restart the server. What is running reads its settings at start, so the change counts from the next start. (These two were synced at 17:4x and 18:20 UTC and count since the restart Alex planned for 18:27.)

## FallingTree (2026-09-29)

`fallingtree` on Modrinth. **Part of the default pack since 2026-09-29** (Alex: "tree felling is a default mod pack"): category base, switched on, not voted on. Since the evening of the same day a tree falls whatever is in the hand (`tools.ignoreTools: true`, shipped with the pack; Alex: "it should work without an axe"); sneaking takes one log. VeinMiner is the key you hold, for ore.

## Libraries inside other mods, and what waits for the next Lock (2026-09-30)

- **Sable Companion 1.6.0 (`sablecompanion`)** shows in the server's mod list but is not in `mods.json` or the lock: it travels inside **Create: Crafts & Additions 1.6.0** (`createaddition-1.6.0.jar`, `META-INF/jarjar/sable-companion-common-1.21.1-1.6.0.jar`), declared there as a required library (`dev.ryanhcode.sable-companion:sable-companion-common-1.21.1`, range `[1.6.0,)`). NeoForge loads such jar-in-jar libraries by itself, so it is not a separate download and it is not removed. The same goes for Create's own Flywheel, Ponder and Registrate, and BlueMap's BlueNBT and flow-math.
- **Pending for the next Lock** (taken together with anything else that has changed, so that everyone updates once): Simple Voice Chat 2.6.22 → 2.6.24 (the server says OUTDATED). Nothing to pin: `lock` takes the newest release of every mod that is not pinned.

## Building and decoration (planner, 2026-09-30)

A category of its own, `building`, after "Quality of life & world": "Extra blocks for making your base look good. No machines, no new mobs, nothing that changes how the game plays." Every slug and its NeoForge 1.21.1 build checked against the Modrinth API before it went in; all 17 are the planner's slugs, none differed. Side `both` for all (Modrinth: required on both sides).

| Slug | Load | Suggested and on | Needs |
|---|---|---|---|
| `create-deco` | L | yes | Create |
| `copycats` (Create: Copycats+) | L | yes | Create |
| `macaws-roofs`, `macaws-windows`, `macaws-doors` | L | yes | |
| `handcrafted` | L | yes | `resourceful-lib` |
| `macaws-furniture`, `macaws-fences-and-walls`, `macaws-bridges`, `macaws-paths-and-pavings`, `macaws-lights-and-lamps`, `macaws-trapdoors`, `macaws-stairs`, `another-furniture` | L | no, votable | |
| `supplementaries` | M | no, votable | `moonlight` |
| `rechiseled` | M | no, votable | `supermartijn642s-core-lib`, `supermartijn642s-config-lib`, `fusion-connected-textures` (client only) |
| `rechiseled-create` | L | no, votable | Rechiseled and Create |

The libraries are hidden `base` entries, switched on only while the mod that needs them is (today only `resourceful-lib`). Apply results does not touch them and needs not: Lock pulls a library in whenever a mod that needs it is on (Modrinth's required dependencies), whatever the library's own entry says. Chipped is left out (last update 2024; Rechiseled covers the same ground). No Macaw's mod needs a library on NeoForge 1.21.1. Rechiseled: Create has no video of its own; it shows the Rechiseled 1.21.1 showcase. The six suggested mods add 6 points to a ballot that has not been saved: the default ballot goes from 12 (Medium) to 18 (Heavy), so a LOW-tier member who has not saved sees the Heavy warning (flagged to the planner).

The player guide has a "Building" section tagged with all six suggested slugs (shown only while every one of them is on).


## Animals and cosy mods (Alex, 2026-10-20)

Straight into the pack, no vote, none suggested. Each is the newest **release** for NeoForge 1.21.1 on Modrinth, pinned; the jars were read for their dependencies, items and spawn rules before they went in. A new votable category, `animals` ("Animals"), after `building`, since `building` promises no new mobs; the Mods guide has a topic of the same name.

| Slug | Category, topic | Load | Needs |
|---|---|---|---|
| `naturalist` | animals | M | |
| `critters-and-companions` | animals | M | `geckolib`, `yacl`, `architectury-api` |
| `friends-and-foes-forge` (the NeoForge project; `friends-and-foes` has no NeoForge build) | animals | M | `resourceful-lib` |
| `cosy-critters` | animals, client only (particles, nothing on the server) | L | |
| `lets-do-meadow`, `lets-do-vinery` | world, farming | M | `architectury-api`; each jar carries its own Foundation library inside |
| `comforts` | world, friends | L | |
| `fairy-lights-fabric` (the lucalabs-de port, MIT; since 2026-10-27 our patched 1.2.3-dsw.1, `mods/fairylights-jei-fix/`: its JEI tooltip crashed the game) | building | M | |
| `amendments` | building | L | `moonlight` (switched on and pinned for it) |
| `twigs` | building | L | |

- **Ashmoon:** none of the new mobs is hooked to every overworld biome (biome modifiers and code read). Twigs adds rhyolite, a stone patch like granite, to `#minecraft:is_overworld`, so it comes to the Moon with the other stone patches; left in.
- **New land:** like the flowers (docs/59), the animals, the wild grapes and the pebbles come from biome spawns and worldgen, so most appear in chunks made after the mods are in.
- **Dropped the same day (Alex: "drop the duplicated mods"):** Fowl Play (9 of its 13 birds are Naturalist's songbirds and duck, Friends & Foes' penguin and Cosy Critters' crow) and Untitled Duck Mod (ducks and geese, both elsewhere), with SmartBrainLib. Fowl Play needed it on PCs although Modrinth calls it server-only, which took a `mods.json` override; that went with it.
- **Second round, the same day (Alex: "drop those unnecessary duplicates, keep the mods that have more in them"),** counted from the jars' item lists and recipes:
  - **Sleep Tight dropped** for Comforts: both make hammocks and a bag that does not move your spawn point; Comforts has 34 items (sleeping bags and hammocks in every colour, a bag from three wool), Sleep Tight 21 (hammocks, a night bag from echo shards, and things for features that were switched off). Its settings file went with it.
  - **Let's Do Farm & Charm dropped** for Farmer's Delight (already in the pack, voted in): Farmer's Delight has 226 items and 334 recipes, Farm & Charm 139 and 221, and 13 of them by the same name (cooking pot, stove, cutting board, tomato, onion …), each pot making only its own mod's dishes. Meadow stays: its Cookpot is the only overlap in 183 items.
  - **One of each animal, all three mods kept:** where two mods have the same creature, the one that does less is switched off. Friends & Foes' **crab** stays (its claw brews the potion of reaching), Naturalist's goes (crab meat only). Naturalist's **snail** stays (snail shells in 16 colours, shellstone), Critters and Companions' goes (a slime bottle). Critters and Companions' **dragonfly** stays (tamed with spider eyes, wears armour, its wings tame jumping spiders), Naturalist's goes. How: Naturalist adds a creature only in the biomes of its `naturalist:has_<mob>` tag (AddAnimalsBiomeModifier, read from the jar), so the datapack `deepslate-animals` empties `has_crab` and `has_dragonfly`; every Critters and Companions spawn, the lush caves' included, comes from the lists in its config (CACEntities.registerSpawns), so `crittersandcompanions-common.json5` on the server has `snail: []`. Both are server only and change spawns in new land; a creature already somewhere stays.

## Create add-ons and Distant Horizons (Alex, 2026-10-20)

Asked for together with Create Power Grid, The Factory Must Grow, Pollution of the Realms and Fullbright; Create and JEI were already in. Each is the newest release for NeoForge 1.21.1, pinned; jars read for their Create range, libraries and worldgen.

| Slug | Category, topic | Load | Needs | |
|---|---|---|---|---|
| `create-connected` | factories, factories | L | Create (6.0.10 or newer, the pack's) | its copycat recipes switch themselves off where Copycats+ has the same block (`feature_enabled_in_copycats`), so no copycat is there twice |
| `create-tfmg` (The Factory Must Grow 1.2.0, `uDi14nbt`) | factories, factories | M | Create (6.0.6 or newer) | added after the question below (Alex: "add it in"); its ores (lead, nickel and lithium, and its striated ore layers) and oil go to every `#minecraft:is_overworld` biome, the Moon's three included, as Immersive Engineering's do |
| `distanthorizons` | an Extra (`modpack/extras.json`), High | | | client only; the server runs no Distant Horizons |

- **Create Aeronautics and Sable: in and out the same day** (Alex: "drop Create Aeronautics but keep a checker on to see when it will work"). Every PC refused to start: Aeronautics' nested Simulated requires `flywheel [1.0.6,)` and Sable takes only 1.0.6+, but PCs load Flywheel 1.0.4, the copy Vanillin 1.1.3 carries (`dev.engine-room.flywheel:neoforge`), not Create's 1.0.6 (`…:flywheel-neoforge-1.21.1`). Both are the newest releases, and Modrinth has no Flywheel of its own for NeoForge 1.21.1. It can come back when Vanillin carries Flywheel 1.0.6 or newer (or none), or when Aeronautics and Sable accept 1.0.4; a weekly check watches for that.
- **Not taken:** Pollution of the Realms (Alex: no pollution), Fullbright (Alex: skip; it takes the dark out of caves, nights and Ashmoon). Create Power Grid: not added, Alex asked what a swap for Crafts & Additions would lose (live builds and items with it, the quarry's power plan and the guide's Electricity part rest on it); Crafts & Additions stays.
- **The Factory Must Grow and the metals it shares** (read from the three jars): TFMG, Immersive Engineering and Mekanism put their lead, nickel, aluminium and steel (ingots, nuggets, plates or sheets, ores, raw metal, blocks) in the same `c:` tags, and their recipes ask for the tags: TFMG 22 lead, 17 nickel, 67 aluminium and 73 steel inputs by tag; IE 46, 44, 56 and 74; Mekanism 28 lead and 36 steel. So any mod's ore is smelted, crushed and used by the others. The exceptions were TFMG's steel cogwheel, large steel cogwheel and steel flywheel, which named `tfmg:steel_ingot`: `deepslate-tools` carries the three with `c:ingots/steel` (and a `mod_loaded` condition). TFMG's steel mechanism takes TFMG's own lead and nickel sheets, which its press makes from any mod's ingots. There is more lead and nickel ore in new land than before (IE's and TFMG's). Not yet seen: grenades and napalm inside a claim.

## Connected textures and zoom (Alex, 2026-10-27)

| Slug | What | Load | Brings |
|---|---|---|---|
| `continuity-neoforged` (Continuity: NeoForged 3.0.9, aspctt, LGPL-3.0) | client only | L | |
| `just-zoom` (Keksuccino, DSMSL) | client only | L | `konkrete` (hidden base entry) |

- **Continuity:** the NeoForge rebuild, not `continuity` itself: that one's NeoForge build runs only through Sinytra
  Connector and Forgified Fabric API. Its connected textures are the mod's own resource pack "Default Connected
  Textures" (`mod/continuity:resourcepacks/default`), registered switched off; app 3.6.8 switches it on once per PC
  (docs/07 "3.6.8"). Its "Glass Pane Culling Fix" pack is left as the mod has it (off).
- **Just Zoom:** zoom on **C** (the mod's Z is TaCZ's attachments screen), its options key unbound (B is Xaero's new
  waypoint); both set by app 3.6.8. C stays shared with TaCZ crawl, Big Cannons' pitch mode, Cataclysm's helmet
  ability and ArPhEx's power key: Alex's choice, the key OptiFine players know. Mouse wheel while zooming.

## Render distance by PC tier (planner, 2026-09-30)

`mods.json` `render_by_tier`, next to `server_properties`: HIGH 12 / 8, MID 10 / 8, LOW 8 / 6 (render / simulation, in chunks). The mod list (`/api/modpack/manifest`) sends `render_distance` and `simulation_distance` for the caller's measured PC tier (`User.pcTier`; none known: LOW), as plain numbers every installer reads, plus `tier`. The server's own `view-distance` is 12 and `simulation-distance` stays 8 (the expected values in `server_properties`; AMP writes the file, see docs/15).

## The item catalogue (`modpack build items`, 2026-09-30)

For the admin's inventory editor (docs/13 §13): `dist/items/catalogue.json` (id, name, mod, stack size, icon) and `dist/items/icons/<namespace>/<path>.png`. Vanilla: every item and its stack size from the game's own data report (`modpack/items/vanilla-1.21.1.json`, made once with the 1.21.1 server jar's `--reports`), names, item models and textures from the client jar (downloaded from Mojang into `dist/cache`, SHA-1 checked). Mods: the item models, `en_us` names and textures in each jar of `dist/server/mods` (block items follow their model to the block texture); their stack size is not in the jar and is left empty (the server's answer tells). 2026-09-30: 2,550 items (1,332 Minecraft, 1,218 from mods), 2,524 with a picture, 11 MB. Run it after a Build of the server: Admin → Pack → Build, or `POST /modpack/build {target:"items"}`.


## The Deepslate texture pack (`modpack/resourcepack/`, 2026-10-03)

A resource pack built from the repo, not from Modrinth: vanilla texture overrides (first one: the villager skin, with the biome and profession overlays blanked so every villager looks the same). `build config` zips the folder (without its README) into `config.zip` as `resourcepacks/deepslate-textures.zip`; the installer already unpacks `config.zip` into the game folder on every Play, so the file lands in `resourcepacks\`. Lock hashes the folder into `lock.resourcepack` and the pack hash (`~ settings resourcepack`); a pack without it keeps the hash it had. Workflow: replace the PNG, push, Lock, Build. No Sync: PCs only. See `modpack/resourcepack/README.md`.

**Switched on per player, from app 3.5.0** (docs/30 §4.3): the app's Settings tab has a "Prisoner villagers" switch, off by default. On, it adds `file/deepslate-textures.zip` to `options.txt` `resourcePacks` and keeps it the last entry (on top of Fresh Animations, which Extras → Apply adds); off takes it out; the player's own packs and their order stay. Saved while Minecraft is open, it waits for the next Play. Making it the default for everyone would be one line in the engine (docs/30 §9).

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

| Command | Does |
|---|---|
| `lint` | validates `mods.json` |
| `verify-links` | asks for every `wiki` and `videos[].url`, reports the ones that fail |
| `lock` | for each mod in the pack: `GET /v2/project/{slug}/version?loaders=["neoforge"]&game_versions=["1.21.1"]`, takes the pinned id or the newest `release` (a `beta` with a warning when there is none); adds required dependencies, and theirs; resolves `neoforge: latest` from the NeoForged maven (highest `21.1.*` without `-beta`); takes the checksums of the files under `modpack/config/`; writes the lock. **Fails, and writes nothing, when a mod has no build for NeoForge 1.21.1.** Says "unchanged" and writes nothing when neither a mod nor a settings file has changed; `lock --force` writes all the same |
| `build server` | downloads the files for the server into `dist/server/mods/`, checks each against its checksum, copies `modpack/server/*`, `modpack/config/*` and `modpack/datapacks/*` |
| `build config` | `dist/config.zip` from `modpack/config/`, for the installer; with `modpack/resourcepack/` (when it has a `pack.mcmeta`) zipped in as `resourcepacks/deepslate-textures.zip` |
| `build installer` | zips `installer/` with the site's address and the pack's version stamped into `install.ps1`; writes `dist/installer.json` (the installer's version, the zip's SHA-256 and size) |
| `build`, `build all` | the three |

There is no `build client` (Windows only since 2026-09-29: the installer downloads a PC's files itself from the mod list, and a `client.mrpack` left over from before is removed by a build). There is no `sync-server` in the CLI: a sync needs the tunnel and the deploy key, which only `api` has (`POST /modpack/sync`, docs/08). It copies `dist/server/` to the instance by rsync (the mods folder made the same as the build's, settings and datapacks added to what is there, nothing of the server's own deleted) and restarts the server **if the mods changed**.

In production Build runs inside the `api` container, under its memory limit, and never on the VPS host (docs/09 "Memory limits"). Lock on the VPS: docs/11 "Where things are" has the command. Jars are streamed to disk and hashed in chunks.

All commands can be run again without harm and print what they changed. Network failures are tried three times and then fail loudly; a half-written lockfile is never left behind (write to temp, rename).

A build makes `dist/server/config/` and `dist/server/datapacks/` afresh each time, so a settings file taken out of the pack does not stay behind (since 2026-09-29; TabTPS's lingered until then). Sync still never deletes on the server: `config/tabtps/` is on the instance, unused.

## Settings shipped with the pack (`modpack/config/`, `modpack/server/`, `modpack/datapacks/`)

| Where | What | Goes to |
|---|---|---|
| `modpack/config/fallingtree.json`, `tacz-common.toml` | see "Settings shipped with the pack (2026-09-29 evening)" below | the server and every PC |
| `modpack/server/config/bluemap/core.conf`, `webserver.conf` | BlueMap: three render threads (one until 2026-09-30, when the VM got 15 GB and the server 10 GB), the address it listens on (the tunnel's). A change is applied by Build, Sync and Admin → Server → Pre-generation → "Reload BlueMap's settings" (`bluemap reload`), no restart | the server |
| `modpack/datapacks/deepslate-limbo/` | the entrance room's dimension (docs/14) | the server's world; a new dimension counts from the next restart |

Thought of in the first plan and not shipped: Xaero's (minimap on, waypoints for each server), JEI (cheat mode off), Simple Voice Chat (push to talk on `V`), Corpse (corpses never despawn, only the owner can loot for 30 min). Each mod runs on its own defaults. To ship one: start the game or the server once, take the file the mod wrote, change what is to be changed, put it under `modpack/config/`, Lock, Build, Sync.

## TabTPS (2026-09-29): in the catalogue, switched off

**Later the same day: taken out of `mods.json` altogether** (planner). Its place is taken by **Better Tab Info** (`bettertabinfo`, base, client only, with its library `craft-config`): TPS and everyone's ping in the Tab list, worked out on each PC, nothing on the server.

Added at 09:42 UTC, taken out at 10:52 UTC the same day. With BlueMap in the pack the server does not start: `java.lang.module.ResolutionException: Modules bluemap and net.kyori.adventure.text.serializer.gson export package net.kyori.adventure.text.serializer.gson.impl to module corpse`. Both mods carry the same library. **Check a server-side mod against BlueMap before adding it** when it is by the same authors' circle (anything built on Adventure: TabTPS, MiniMOTD, squaremap and the like). The portal gets its pings from spark instead; see docs/05 "Connection".

## The recommended set is switched on (planner, 2026-09-29 16:4x UTC); the vote stays open

`enabled: true` on every mod with `recommended: true`: create, createaddition, veinminer, sophisticated-backpacks, additional-enchanted-miner, tacz-1.21.1, waystones, farmers-delight, pipez; and on what they need: sophisticated-core, scalable-cats-force (it loads as `kuma_api`). The lock added balm and kotlin-lang-forge by itself. 30 of the 40 mods in the catalogue are on; the pack was `0.1.0+b5d461ea` then (`0.1.0+1a48e8ff` since the settings files count, below), 32 files in the lock, 25 on the server, 29 on a player's PC. The mods stay votable and the vote was not closed.

Started once with all of them, nobody on (16:49:24 to `Done (1.370s)` at 16:49:40 by the server's clock, 16 s): 31 entries in the loader's list, no ERROR line, nothing switched off. VeinMiner and FallingTree load side by side; what they do to the same tree in the game has not been tried.

Settings, as shipped: `pvp=false` in `server.properties`. TaCZ has no setting for damage between players (`tacz-server.toml` has multipliers only), so `pvp=false` is what keeps guns from hurting players; `ExplosiveAmmoDestroysBlock = true` in `tacz-common.toml` was TaCZ's default and meant that explosive ammunition breaks blocks; **the pack ships it as `false` since the evening** (below). The quarry has no settings file in the pack: its speed is the mod's default.

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

## Render distance by PC tier (planner, 2026-09-30)

`mods.json` `render_by_tier`, next to `server_properties`: HIGH 12 / 8, MID 10 / 8, LOW 8 / 6 (render / simulation, in chunks). The mod list (`/api/modpack/manifest`) sends `render_distance` and `simulation_distance` for the caller's measured PC tier (`User.pcTier`; none known: LOW), as plain numbers every installer reads, plus `tier`. The server's own `view-distance` is 12 and `simulation-distance` stays 8 (the expected values in `server_properties`; AMP writes the file, see docs/15).

## The item catalogue (`modpack build items`, 2026-09-30)

For the admin's inventory editor (docs/13 §13): `dist/items/catalogue.json` (id, name, mod, stack size, icon) and `dist/items/icons/<namespace>/<path>.png`. Vanilla: every item and its stack size from the game's own data report (`modpack/items/vanilla-1.21.1.json`, made once with the 1.21.1 server jar's `--reports`), names, item models and textures from the client jar (downloaded from Mojang into `dist/cache`, SHA-1 checked). Mods: the item models, `en_us` names and textures in each jar of `dist/server/mods` (block items follow their model to the block texture); their stack size is not in the jar and is left empty (the server's answer tells). 2026-09-30: 2,550 items (1,332 Minecraft, 1,218 from mods), 2,524 with a picture, 11 MB. Run it after a Build of the server: Admin → Pack → Build, or `POST /modpack/build {target:"items"}`.


## The Deepslate texture pack (`modpack/resourcepack/`, 2026-10-03)

A resource pack built from the repo, not from Modrinth: vanilla texture overrides (first one: the villager skin, with the biome and profession overlays blanked so every villager looks the same). `build config` zips the folder (without its README) into `config.zip` as `resourcepacks/deepslate-textures.zip`; the installer already unpacks `config.zip` into the game folder on every Play, so the file lands in `resourcepacks\`. Lock hashes the folder into `lock.resourcepack` and the pack hash (`~ settings resourcepack`); a pack without it keeps the hash it had. Workflow: replace the PNG, push, Lock, Build. No Sync: PCs only. See `modpack/resourcepack/README.md`.

**Switched on per player, from app 3.5.0** (docs/30 §4.3): the app's Settings tab has a "Prisoner villagers" switch, off by default. On, it adds `file/deepslate-textures.zip` to `options.txt` `resourcePacks` and keeps it the last entry (on top of Fresh Animations, which Extras → Apply adds); off takes it out; the player's own packs and their order stay. Saved while Minecraft is open, it waits for the next Play. Making it the default for everyone would be one line in the engine (docs/30 §9).

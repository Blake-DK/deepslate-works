# 06 · Modpack manifest and tooling

## `modpack/mods.json` (source of truth, hand-edited or edited by the admin UI)

```jsonc
{
  "name": "Deepslate Works",
  "version": "0.1.0",                 // bump on every change that affects clients
  "minecraft": "1.21.1",
  "loader": "neoforge",
  "neoforge": "latest",               // "latest" = newest stable 21.1.x from the NeoForged maven; or pin "21.1.xxx"
  "server_address": "mc.dsw.test",          // Pangolin publishes it on 25565 -> AMP host 25569; players use it with no port
  "profile": { "id": "deepslate-works", "dir": ".minecraft-deepslate-works", "icon": "Furnace" },
  "ram": { "min_gb": 3, "max_gb": 6 },
  "categories": ["base", "factories", "mining", "guns", "world", "server"],
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
      "description": "Cogs, belts, steam engines, trains, mechanical drills and presses.",
      "wiki": "https://createmod.net/wiki",
      "videos": [ { "title": "…", "url": "https://www.youtube.com/watch?v=…" } ],
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

## Starting list (from the planning research, Sept 2026)

Verify every slug and that a NeoForge 1.21.1 version exists before trusting this table. Slugs marked ? were not verified against the API.

| slug | name | category | side | enabled | load |
|---|---|---|---|---|---|
| sodium | Sodium | base | client | yes | L |
| lithium | Lithium | base | both | yes | L |
| ferrite-core | FerriteCore | base | both | yes | L |
| modernfix | ModernFix | base | both | yes | L |
| entityculling | Entity Culling | base | client | yes | L |
| immediatelyfast | ImmediatelyFast | base | client | yes | L |
| dynamic-fps | Dynamic FPS | base | client | yes | L |
| jei | Just Enough Items | base | both | yes | L |
| jade | Jade | base | both | yes | L |
| xaeros-minimap | Xaero's Minimap | base | client | yes | L |
| xaeros-world-map | Xaero's World Map | base | client | yes | L |
| appleskin | AppleSkin | base | both | yes | L |
| mouse-tweaks | Mouse Tweaks | base | client | yes | L |
| corpse | Corpse | base | both | yes | L |
| simple-voice-chat | Simple Voice Chat | base | both | yes | L |
| chunky | Chunky | server | server | yes | L |
| spark | spark | server | server | yes | L |
| bluemap | BlueMap | server | server | yes | L |
| tabtps | TabTPS | server | server | yes | L |
| ftb-essentials ? | FTB Essentials | server | server | phase 4 | L |
| create | Create (6.x) | factories | both | vote | M |
| createaddition | Create: Crafts & Additions | factories | both | vote | L |
| create-big-cannons ? | Create Big Cannons | factories | both | vote | M |
| immersiveengineering ? | Immersive Engineering | factories | both | vote | M |
| mekanism ? | Mekanism | factories | both | vote | H |
| mekanism-generators ? | Mekanism Generators | factories | both | with mekanism | H |
| mekanism-tools ? | Mekanism Tools | factories | both | with mekanism | L |
| industrial-foregoing ? | Industrial Foregoing | factories | both | vote | M |
| ae2 ? | Applied Energistics 2 | factories | both | vote | M |
| ftb-ultimine ? | FTB Ultimine | mining | both | vote | L |
| advanced-mining-dimension ? | Advanced Mining Dimension | mining | both | vote | L |
| sophisticated-backpacks ? | Sophisticated Backpacks | mining | both | vote | L |
| create-ultimine | Create Ultimine | mining | both | vote | L |
| tacz-1.21.1 | TaCZ (community NeoForge port) | guns | both | vote (group guns) | M |
| vics-point-blank | Vic's Point Blank | guns | both | vote (group guns) | M |
| waystones ? | Waystones | world | both | vote | L |
| farmers-delight ? | Farmer's Delight | world | both | vote | L |

Verified during planning: `create` (6.0.10 for 1.21.1 NeoForge, Apr 2026), `createaddition`, `create-ultimine`, `tacz-1.21.1` (1.1.7 hotfix line, needs the TaCZ Pack Upgrader for 1.20.1 gun packs), `vics-point-blank` (1.11.x for 1.21.1 NeoForge).

## `mods.lock.json` (generated, committed)

```jsonc
{
  "generatedAt": "2026-10-01T12:00:00Z",
  "minecraft": "1.21.1",
  "neoforge": "21.1.xxx",
  "hash": "sha256 of the sorted file list",       // shown as the pack version in the UI
  "files": [
    {
      "slug": "create", "projectId": "LNytGWDc", "versionId": "…", "versionNumber": "6.0.10",
      "filename": "create-1.21.1-6.0.10.jar",
      "url": "https://cdn.modrinth.com/data/…/create-1.21.1-6.0.10.jar",
      "sha512": "…", "size": 17825792,
      "side": "both", "requiredBy": []             // slugs that pulled this in, empty = top level
    }
  ],
  "configs": [ { "path": "config/jei/jei-client.toml", "sha256": "…" } ]
}
```

## `packages/modpack` CLI

| Command | Does |
|---|---|
| `modpack lint` | validates `mods.json` |
| `modpack lock` | for each enabled mod: `GET /v2/project/{slug}/version?loaders=["neoforge"]&game_versions=["1.21.1"]`, pick the pinned id or the newest `release` (fall back to `beta` with a warning); recursively add `required` dependencies; resolve `neoforge: latest` from `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml` (highest `21.1.*` without `-beta`); write the lockfile; print a diff against the previous one. Send a `User-Agent: deepslate-works/<version> (contact email)` header; Modrinth requires it. |
| `modpack build client` | ~~removed 2026-09-29~~ Windows only; the installer downloads client jars itself from the lockfile. |
| `modpack build server` | downloads server+both files into `dist/server/mods/`, copies `modpack/server/*` and `modpack/config/*` |
| `modpack build installer` | zips `installer/` with `manifest_url` and pack version stamped into `install.ps1` |
| `modpack sync-server` | rsync `dist/server/` into `$AMP_INSTANCE_DIR/Minecraft/` (mods dir replaced wholesale, configs merged), then `Core.Restart` via AMP if anything in `mods/` changed |
| `modpack verify-links` | HEAD every `wiki` and `videos[].url`, report failures |

In production `build` runs inside the `api` container (Admin → Modpack → Build), under its memory limit, and never on the VPS host (docs/09 "Memory limits"). Jars are streamed to disk and hashed in chunks.

All commands are idempotent and print what they changed. Network failures retry 3× with backoff and then fail loudly; a half-written lockfile is never left behind (write to temp, rename).

## Config overrides worth shipping (`modpack/config/`)
- Xaero's: minimap on, waypoints shared per server.
- JEI: cheat mode off.
- Simple Voice Chat: push-to-talk default `V`.
- Sodium: sensible defaults are fine; the installer sets render distance per tier in `options.txt` only if the file doesn't exist yet.
- Corpse: corpses never despawn, only the owner can loot for 30 min.
- TaCZ (if chosen): default gun pack only, no extra packs in season 1.

## TabTPS (2026-09-29)

Server side only; nobody installs anything. Press Tab in the game: who's on, the server's TPS and the number of people on above the list, your own ping below it. Its config is `modpack/server/config/tabtps/display-configs/default.conf` and goes to the server with every sync. The portal asks it for everyone's ping every 15 s (`pingall`); see docs/05 "Connection".

## FallingTree (2026-09-29)

`fallingtree` on Modrinth. Votable, recommended. Works next to VeinMiner: FallingTree is the axe, VeinMiner is the key you hold.

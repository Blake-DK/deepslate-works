# 37. Importing builds: check the file, see it, place it where you stand (plan, Alex 2026-10-06)

## Context

docs/34 §10 built uploads (Admin → Seasons → Builds: a `.nbt` or `.schem`, turned into a structure file by Build,
placed by typed coordinates). Alex tried it and found three problems:

1. **The builds need mods we don't have.** Nothing reads a file before it reaches the server, so a build made with
   another mod's blocks only shows that when it is placed, with holes where the missing blocks were.
2. **Nobody knows how big a build is** until Build has run, and Place wants the lowest corner typed in. Alex wants to
   stand at a corner in the game and put it there.
3. **Nothing can be seen first**, and there is no undo.

Alex's answers (2026-10-06): WorldEdit for the placing; a per-player "Builder tools" tick in the portal, for admins
only, and only the admins he ticks (not every admin); those players get WorldEdit through a creative-mode switch,
not through op.

## Facts checked (2026-10-06)

- **WorldEdit** (`worldedit`, Modrinth `1u6JkXh5`, GPL-3.0): 7.3.8 for NeoForge 1.21.1 (`WTAFvuRx`), no dependencies.
  Modrinth leaves its client and server sides unknown; it is a server mod.
- **WorldEdit's permissions on NeoForge** (source of the tag `7.3.8` and the branch `version/7.3.x`,
  `NeoForgePermissionsProvider.java`): there is only `VanillaPermissionsProvider`. A player may use WorldEdit when
  `cheat-mode` is on (everyone), when they are op, or when `use-in-creative` is on and they are in creative mode. It
  never asks NeoForge's permission API, so **a permissions mod (LuckPerms) cannot give one player WorldEdit**. This is
  why Builder mode below uses creative.
- **Forgematica** (`forgematica`, `dCKRaeBC`, LGPL-3.0): Litematica for NeoForge. 0.4.2+mc1.21.1 (`71jxaAwz`), client
  required, server unsupported. Requires **MaFgLib** (`mafglib`, `SKI34J7B`; 0.4.3+mc1.21.1 is `CgDQ0u0Q`).
- **Litematica itself** is Fabric and Forge only; **Axiom** is Fabric only; **WorldEditCUI** is not on Modrinth for
  NeoForge.
- **Spawn's adventure switch** (docs/27 §2.4) never touches creative players, so Builder mode does not fight it.
- Create, Create Crafts & Additions, Create Big Cannons, Create Deco and Rechiseled: Create are in the pack. Builds
  from createmod.com fail on the add-ons we don't run, not on Create itself.

## Step 1: the site checks a file when it is uploaded (no server change)

**Built on `dev`, 2026-10-06; "Step 1, as built" at the end says where.**

- **On upload**, web reads the file with the same code Build uses (`packages/modpack/src/builds.ts`) and shows:
  - its size ("34 by 21 by 40 blocks") and how many blocks it has;
  - **the mods it needs**: every namespace in its palette (`create:`, `minecraft:` …), with how many blocks of each;
  - **which of those the pack does not have**, with the blocks by name.
- **What the pack has** comes from the server's jars, written by Build: every `assets/<namespace>/blockstates/`
  folder in every jar in `dist/server/mods/` (and the jars inside them) → `dist/pack-blocks.json`. `minecraft` is
  always there. If Build has never run, the check says so and only lists the namespaces.
- **A build with blocks from missing mods is refused**, unless the admin ticks "place it anyway, the missing blocks
  become air". The tick is kept beside the file (`data/builds/<name>.json`). Build checks again each time, because
  the pack can change after an upload: a build with missing blocks and no tick is left out and named in
  `dist/builds.json`; with the tick, those blocks are written as air so the result never depends on what the game
  does with unknown names.
- **`.litematic` is taken** (Litematica's format): its regions are put together into one box, the
  packed block states read out, and the result written as a structure file the way a `.schem` is. Same limits: 256
  blocks a side, 500,000 blocks, 8 MB. Most builds on Planet Minecraft are offered as `.litematic`.
- The card's links say which sites tend to need mods (createmod.com: Create add-ons) and point at the check.

## Step 2: WorldEdit on the server, and Builder mode (one restart)

- **WorldEdit 7.3.8** in `mods.json`, `side: "server"`, with `config/worldedit/worldedit.properties` in
  `modpack/server/` carrying `use-in-creative=true` and `cheat-mode=false`. Lock, Build, Sync, one restart. The
  working rules hold: the server starts with it once before anything is built on it, and `check-sides` says whether
  PCs need it.
- **Builds for WorldEdit.** Build also writes each upload as a Sponge `.schem` (version 3) into
  `dist/server/config/worldedit/schematics/<name>.schem`, which Sync puts on the server. Its offset is set so the
  build's lowest north-west corner is the point you stand on: `//paste` puts that corner at your feet.
- **Builder tools tick.** A field on the user (`builderTools`, default off), set by an admin on People (a row's
  menu), only on an admin's row, audited (`user.builderTools`). Unticking also switches Builder mode off.
- **Builder mode.** A switch on the Builds card, shown only to a ticked admin with a linked Minecraft account. On:
  `gamemode creative <name>` through a registry action (`builder.on`); off: `gamemode survival <name>` (`builder.off`).
  Both audited, both refused unless the caller's own `builderTools` is on and they are online. While in creative
  they can use WorldEdit; back in survival they can't.
- **Not closed by this, and accepted:** anyone who is op still has WorldEdit (the provider checks op first), and
  anyone put in creative by other means gets it too. Creative also means flying and free blocks while it is on. Who
  is op on the server is to be checked and written in docs/11 when Step 2 goes live.
- **Lock after a paste.** The site does not know where WorldEdit pasted, so Lock gets a form of its own: a world and
  two corners, typed in.
- The site's Place (typed coordinates) stays, for exact places like the temple at spawn.

## Step 2, as built (2026-10-06, on `dev`)

- `modpack/mods.json`: `worldedit`, version `WTAFvuRx` (7.3.8, NeoForge, 1.21.1), server only, `adminOnly`, in the
  server category, two tutorial videos checked through YouTube's oEmbed. Not locked: Lock is pressed on the site.
  The real jar was looked into with `jarChannels`: its one channel (WorldEdit's CUI) is optional, so the Lock takes
  it as server-only; it has no blocks of its own.
- `modpack/server/config/worldedit/worldedit.properties`: `use-in-creative=true`, `cheat-mode=false`. WorldEdit
  writes its other settings into the file at its first start; the next Sync puts ours back, which keeps those two.
- `packages/modpack/src/builds.ts`: `structureToSchem` (Sponge version 3, Offset 0, no WorldEdit origin, every
  place the structure leaves out as air, block data kept); `build builds` writes each built upload to
  `dist/server/config/worldedit/schematics/<name>.schem` (the folder made afresh on each Build). Read from the
  source of the tag `7.3.8`: `SpongeSchematicV3Reader` sets the clipboard's origin to the metadata's origin (0 when
  there is none) and its lowest corner to Offset plus origin, so the paste's lowest corner is the player's block.
- `User.builderTools` (migration `0030_builder_tools`). People → a row's menu, on admins only: "Give Builder tools" /
  "Take Builder tools away" (audited `user.builderTools`), a "builder" badge. Made a player: the tick goes too.
  Taken away or made a player: Builder mode off.
- api: actions `builder.on` (`gamemode creative <name>`) and `builder.off` (`gamemode survival <name>`), own route
  `POST /builder/mode`: on only for the caller, with the tick, an admin, a linked name, online; off for anyone by any
  admin, nothing to do when they are offline. `POST /builds/lock`: Lock on its own, two corners, 512 a side.
- Admin → Seasons → Builds: "Place it where you stand (WorldEdit)": Builder mode on and off, the four steps, and
  "Lock its ground" for something WorldEdit placed.
- Tests: `apps/api/tests/builder.test.ts`, the lock in `builds.test.ts`, the `.schem` read back by our own reader
  in `packages/modpack/tests/builds.test.ts`.
- **Not proven** until the server runs it: that NeoForge loads WorldEdit 7.3.8 with our mods, that PCs need nothing,
  that `use-in-creative` lets a non-op in creative use it, that `//schem load` reads our files and the corner lands
  where the source says. Who is op on the server is still to be looked up (an op has WorldEdit in any mode).

## Step 3: the see-through preview on a ticked admin's PC (app 3.6.0)

- **Forgematica and MaFgLib** as an extra in `modpack/extras.json`, with a new field `builder: true`. A builder extra
  is not listed in the Extras tab: `/api/modpack/extras` (it already knows who asks, by the launcher token) hands it
  only to a user with `builderTools` on, marked as switched on. Untick, and the next Play takes it off. The pack's
  version, the server and the join check never see it, as with every extra.
- **The builds on the PC.** The app copies each uploaded build into the game's `schematics/` folder (from a new
  `/api/builds/files` list, builders only), as the file Forgematica reads best (a `.litematic` written by Build, if
  the port does not read `.schem` or `.nbt`).
- Built and tested only by `installer.yml` on the Windows runner, as always.

## How it feels in the game, once all three are in

1. Upload the file on Admin → Seasons → Builds. The site says its size and that every block is one we have.
2. Build and Sync on the Modpack page.
3. In the game: press **M**, load "castle". A see-through copy stands at your feet; move it and turn it in the menu,
   walk round it until it sits right.
4. Switch Builder mode on in the portal. Stand on the corner the preview shows, then `//schem load castle` and
   `//paste -a` (`-a` leaves the file's air out, so it doesn't dig into the ground). Wrong? `//undo`.
5. Lock its ground on the site if it is to stay; switch Builder mode off.

## Not proven

- That the game reads a structure file written by our code (still open from docs/34 §10), now for `.litematic` too.
- WorldEdit with our pack, and that PCs need nothing for it.
- Forgematica with our graphics mods (it draws its see-through blocks itself); try it on one PC first.
- Which files the Forgematica port loads (`.litematic` for certain; `.schem` and `.nbt` to check).
- That `//paste` of a `.schem` written by our code puts the corner where we say.

## Step 1, as built (2026-10-06, on `dev`)

- `packages/modpack/src/builds.ts`: `litematicToStructure` (regions into one box, negative sizes, packed states
  across longs, block data without Litematica's x, y and z; a place no region covers is left out), `structureNeeds`,
  `withoutNamespaces`, `jarBlockNamespaces` / `packBlocks` (→ `dist/pack-blocks.json`, written by `build builds`
  and so by every Build of the server), `readBuild` (one reader for Build and the site), `missingLine`.
  `buildBuilds` leaves out a build with missing mods unless `data/builds/<name>.json` says `allowMissing`, and then
  writes those blocks as air; `dist/builds.json` gains `needs`, `missing`, `airFor` per build.
- `apps/web/src/server/builds.ts`: `storeBuild` reads the file before keeping it, refuses one that does not read or
  has missing mods without the tick, and writes `<name>.json` (the tick, the check, whether the pack's list was
  there). Remove takes the `.json` with it.
- Admin → Seasons → Builds: the tick "The missing blocks become air", `.litematic` in the file picker, each upload's
  size and mods (by the mod's name from `pack-blocks.json`), the sites' notes. The upload's message carries its size.
- Admin → Modpack's out-of-date box: uploads made, replaced or removed since the last Build ask for Build and Sync
  (`uploadsSinceBuild` in `pending.ts`). Before this, an upload left the box saying "up to date".
- Tests: `packages/modpack/tests/builds.test.ts` (Litematica fixtures written with the same packing, a 3-bit palette
  whose entry spans two longs, the pack's jars, Build's refusal and air), `pending.test.ts`,
  `apps/web/tests/builds-upload.test.ts`. No real `.litematic` was at hand: the fixtures follow Litematica's layout
  as written here, and the server has to show the game takes the result.

## Order

Step 1 now, on `dev`. Step 2 needs Alex's word for the restart. Step 3 after Step 2 has run on the server, and after
Forgematica has been tried on one PC.

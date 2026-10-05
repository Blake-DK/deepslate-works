# 36. Worlds: extra worlds made from the control room (plan, Alex approved 2026-10-05)

## Context

Today an extra world exists only as the `frontier` block of a season file, with one terrain choice
(`minecraft:large_biomes`) and no seed. Alex wants to make worlds from the site: a seed, a kind of world, a mood, and
for horror worlds what spawns there, including creatures from new horror mods. A world may be a season's Frontier or
stand alone. Alex's answers (2026-10-05): horror from server-only mods **and** real mob mods; both uses; all four
kinds (normal/large biomes, one biome, strange shapes, flat/empty).

The first draft was reviewed against `main` f1f2501. The review's file references were checked and hold
(`sync.ts` copies datapacks without deleting; the five missed places exist). This version folds every point in.

Facts that shape it (Minecraft 1.21.1; none proven on our server yet):

- A dimension has no seed of its own, and no NeoForge 1.21.1 mod on Modrinth gives it one. The seed must be ours.
- A broken worldgen file can stop a dedicated server from starting.
- Terrain cannot change once chunks exist; a world's ground stays on disk after its datapack is gone.

## Step 0: prove the seed, before any page (one restart)

Two candidate ways to make a seed, tried side by side in hand-written packs:
**shift** (vanilla noise settings with a constant added to the shift of each land noise) and **rename** (docs/32
W2.1: the same settings on noises with new names).

1. **In CI first, off the live server.** New job `worldgen-boot` in `.github/workflows/`: Java 21, the vanilla
   1.21.1 server jar from Mojang, the test packs in `world/datapacks`, start with `nogui`, pass on "Done", fail on a
   registry error. Costs about two minutes. This job stays, and from Step 1 boots every pack the generator's tests
   produce (Step 1 packs reference only vanilla).
2. Test packs: overworld-shift A, overworld-shift B, overworld-rename, large-biomes-shift (its seven
   `overworld_large_biomes/*` density functions included), nether-shift, nether-rename, end-shift, caves ×1.
   `level-seed` is the live world's seed (-3899835130120818196), so the job also shows each pack differs from the
   main world at 0, 0. Per point: `forceload add`, a marker moved `positioned over world_surface`, `data get` its
   height, `forceload remove`. Heights are the measure; biome only by `execute if biome` against a short list
   (the game has no biome getter). So "differs" is a number, not an impression.
3. **Then once on the real server**, after a backup, with only the two overworld packs and the sample Frontier:
   closes docs/20's open check (large biomes differs at 0, 0) and shows Server Sided Portals accepts the dimensions.
   **Taking the test dimensions off again is by hand, and written here because nothing else can do it before
   W1.7:** nobody left inside (check `list` and that Alex was the only visitor), stop the server, delete the two
   test packs from `world/datapacks/`, delete their two folders under `world/dimensions/deepslate/`, start. Exact
   commands for Alex go with the step; the folders are named and sized before he deletes anything. The third
   dimension, the sample Frontier (`deepslate:frontier_sample`), **stays**: the 23 November rehearsal runs in it,
   and it comes off with the rehearsal's own clean-up.
4. Write the result into docs/34 and docs/32: which method is the seed; whether Nether-like and End-like can vary at
   all (the review expects not: their shape comes from a noise seeded by a fixed name); whether shift replaces W2.1.
   Correct the stale date in the heading of docs/34 §7 (the rehearsal is Monday 23 November).

Nothing below is built until Step 0 has an answer.

## Step 1: worlds from the site (no new mods)

**Where a world's definition lives: git, not the database.** `modpack/worlds/<id>.json`, committed from the web
container by the existing `commitManifest` path (Apply results, Lock extras). So CI can lint it, a restored
database dump cannot change terrain, and the season lint ("the world exists and is live") runs in CI.

- **Getting the commit to GitHub.** `commitManifest` commits on the VPS and does not push, and `deploy.sh` refuses
  to deploy over unpushed commits; the Lock has the same gap today and is pushed by hand. So: a script
  `deploy/push-local.sh`, run as ladm, pushes the checkout's unpushed commits to a branch `vps/<date>` and opens the
  PR to `main` with `gh`; the Worlds page and the Modpack page show "N changes are not on GitHub yet" with that one
  command while any exist. (`gh` and pushing as ladm work on the VPS: this session's pushes to `dev` and its PRs
  went that way.)
  - **An exception to "main moves only by a PR from dev", to be written into the working rules:** commits the site makes on
    the deploy checkout (a Lock, Apply results, a world) go to `main` by their own `vps/<date>` PR, as the Lock
    already does in practice. They carry no code.
  - **Merged with a merge commit, never squashed** (the script passes `--merge`): a squash would leave the VPS's
    commits diverged from `main` and `deploy.sh` would refuse again.
  - **Order: push, green tick, then Build.** `worldgen-boot` also builds and boots the real files in
    `modpack/worlds/`, not only the tests' packs, so the PR's check is the proof a world loads. The page says
    "wait for the green tick on the pull request before you press Build", and "Put on the server" shows the PR's
    state where it can be read.
- **A second copy beside the ground.** The definition is also written into the pack
  (`deepslate-world-<id>/world.json`), so the AMP backup that holds a world's chunks holds what made them.
- `<id>.json`: name, seed, kind, biome, mood, portal (frame, lighter), radius, arrival (x, z, and y where it is not
  taken from the surface), map on/off, state `draft | live | closed | retired`, and once live a `terrain` hash:
  sha256 over the generated worldgen files **and** the dimension type's height, ceiling and sky-light fields.
- **Freeze, enforced three times.** The web form refuses changes on a non-draft; a test in
  `packages/modpack/tests/` runs the worlds lint over the real `modpack/worlds/` and `modpack/seasons/` files (CI
  runs tests; it does not run `modpack lint`, and `pnpm lint` is ESLint only) and fails when a live world's
  generated files no longer hash to `terrain`; Build fails the same way. Generator changes are versioned (`gen: 1`
  in the file; a live world keeps its version's code path).
- **What is frozen:** seed, kind, biome, and Pitch dark (sky light on or off cannot change over existing chunks,
  nor can height or ceiling). Normal, Endless night and Endless dusk differ only in fixed time and swap freely.
  Portal, radius, map and name stay editable.
- **Closed:** the pack stays and the dimension still loads, but its portal tags are written empty, so nobody new
  gets in. Needs no deletion; if the return portal still works, whoever is inside walks out. It is the only way to shut a
  world until W1.7. Checked in Step 0: that an empty tag disables the portal in Server Sided Portals, and whether
  it also switches off the return portal inside (same frame tag). If it does, closing a world first runs a
  registry action that teleports everyone inside to the main world's spawn, and the page says that anyone who
  logged out inside must be fetched by an admin when they next join.
- **Ids are never reused.** A retired world's file stays; a new world with any id ever used is refused.
- A missing or unreadable `modpack/worlds/` means "leave the server's packs alone", never "remove all".
- Seedless kinds: the form says plainly "a Nether-like world is the real Nether's twin at the same coordinates".
  One live world each for Caves, Floating islands, Nether-like and End-like, unless Step 0 shows a way to vary
  them. Flat and Empty are identical by nature and unlimited: several arenas are a likely use.

**Generator** `packages/modpack/src/worlds.ts`: `worldDatapack(w)` → `deepslate-world-<id>`: dimension, a dimension
type of its own, noise settings and density functions for seeded kinds (templates vendored into
`modpack/worldgen/1.21.1/`: overworld, large_biomes, the nine `overworld/*` and seven `overworld_large_biomes/*`
files), portal tags as `frontierDatapack` writes them (`packages/modpack/src/seasons.ts`), and a BlueMap conf **by
kind** (overworld-shaped; roofed for Nether-like and Caves; raised ambient light for dark moods; none if map is
off). `buildWorlds` in `build server`; `cli.ts` gets `build worlds`.

**Lint** (CI and Build): frame + lighter unique across every live world and every Frontier (today only obsidian and
fire are refused); arrival set; seasons naming a world. Season files may say `frontier: { world: "<id>" }`; the
season generator then takes the dimension id from the world, including in trial criteria (Season 1's
`changed_dimension` trial names its dimension literally: add a `$frontier` placeholder rather than more literals).
Season 1's file itself is not changed.

**One place that knows what a world is.** `apps/web/src/shared/worlds.ts` (+ api copy): `EXTRA_WORLD` pattern
(`deepslate:(frontier|world)_…`), `isPregenWorld`, `isBuildWorld`, `worldLabel`, `mapIdOf`. Replaces the literals in
`apps/api/src/actions/registry.ts` (`PREGEN_WORLD`, `BUILD_DIMENSION`), `apps/api/src/status/map.ts` (`mapOf`,
`ALL_MAPS`), `apps/web/src/lib/pregen.ts`, `apps/web/src/lib/items.ts` (`DIMENSION`),
`admin/server/actions.ts:60`, `admin/seasons/actions.ts:56`, `admin/seasons/builds-card.tsx:26`,
`apps/web/src/server/season.ts` (`getFrontiers` → all extra worlds).

**Arrival.** New registry action `world.arrival`, run once the world is on the server: forceloads the arrival
chunk, lays a 5×5 platform with three blocks of air above it, claims it as `build.lock` does (OPAC server claim),
and removes the forceload again so the dimension does not stay loaded for good. In seeded worlds the height is
taken from the surface (`positioned over`), since nobody knows it before the ground exists; in Empty, Flat, Caves,
Nether-like and Floating islands the form asks for y (Empty defaults to 64). Where Server Sided Portals puts its far side in
Empty, Floating islands and Caves is unknown: tested per kind before that kind is offered on the form.

**Page** Control Room → Worlds (`apps/web/src/app/(app)/admin/worlds/`): form, list, **Put on the server** (commits
the file with its hash; ships at the next Build + Sync + restart), shortcuts to Pre-generate, Map, Builds, Arrival.
Said on the form: a Normal-mood world shares the main world's clock and weather and sleeping there does not skip
the night; in Pitch dark torches do not stop monsters. Each world's size on disk is shown, retired ones included
(docs/28 backs up all of `world/` every six hours and to S3); how the size is read through AMP is to be found out.

**Removing a world is not in this step.** It needs three things that do not exist: Sync deleting a pack (today it
only copies), the evacuation of players whose last position is there (W1.7), and a refusal while a season names
the world. It is built with the wipe (W1.7), which needs the same three. Until then a world can be **closed**
(above), not removed.

**First real use:** after a backup, one world at a time, each booted by CI on its own PR first.

## Step 2: what spawns, per world

Not copied biomes (they lose their biome tags, so no villages, no Cataclysm or Mowzie's structures, no mod ores).
Instead **In Control!** (server only; verify slug and 1.21.1 NeoForge build on the Modrinth API at build time):
per-dimension spawn rules in its config, generated from `modpack/worldgen/mobsets.json` and a world's chosen set.
Works on multi-biome worlds too. Entity ids must be in `modpack/seasons/entities.json`. It is a server-side mod, so:
start the server with it once before anything is built on it (project rule).

In Control! has one set of config files for the whole server, so the generator writes every world's rules together
into those files on each Build, from all live worlds at once; a world's set is never patched in alone. What a
change then needs (Sync and the mod's reload command as a registry action, or a restart) is found out on that
first start and written on the form.

Per-world rules to decide with Alex before this step ships: claims allowed or not (the Frontier's no-claims rule
is itself not built), waystones, and that corpses behave as everywhere.

## Step 3: horror mods

Each by the usual path (Modrinth API, pinned in `mods.json`, Lock, one server start, `server-loaded.json`,
changelog). Before any is added, a table for Alex per candidate: size, what it adds, weight on weak PCs, and
**what it does outside the game** (fake crashes, closing the game, writing files, opening windows); one that does
any of that to a player's PC is not proposed. Confinement to chosen worlds by In Control!; a mod that spawns by its
own code and cannot be confined is not added.

- Server only first: Server-Side Horror, CRYPTID.
- On every PC: The Obsessed, From The Caves, Gigeresque, Whispering Spirits as candidates.
- **Decision for Alex at that point:** whether mods that go on every PC need a vote (the portal mod did not, but it
  cost players nothing).

## Verification

- CI: typecheck, lint, tests, and `worldgen-boot` (every generated pack boots a vanilla server; seeds differ by
  measured height and biome).
- Real server, per world: backup → Build (`world datapack deepslate-world-<id>`) → Sync → restart → health all
  clear → Arrival → teleport there → Pre-generation and Map list it → a portal with its frame and lighter.
- Written into docs/34 as unproven until seen: Server Sided Portals with a custom dimension type and its far side
  per kind; BlueMap conf keys per kind; In Control! rules; reading folder sizes through AMP.

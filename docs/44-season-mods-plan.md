# 44 · Season mods: one pack, two servers (plan, 2026-10-09)

VPS session, on the planner's and Alex's word of 2026-10-09. To start after the fallback below, and to land before any
more season work goes to the test server.

## Today's fallback (in use)

The six Season 1 mods (L_Ender's Cataclysm, lionfish-api, Mowzie's Mobs, geckolib, EDF Remastered, curios) are
`enabled: false` in `modpack/mods.json`, each with its `version` still pinned and a note. The lock was trimmed by hand:
the six entries removed, nothing else re-resolved, the hash recomputed with `packHash`. So every server and every PC
built from that commit is without them. The test server keeps them only by a test-only commit that switches them back
on. Switching them back on resolves the same six files, because their versions are pinned.

## The mechanism

- **mods.json:** a mod may carry `"season": "s1"`. It stays `enabled: true`. The lock pins it like any other mod and
  records the same field on its lock entry.
- **Which seasons ship:** the same list as the season datapacks. `index.json`'s `ship` on live, and `SEASONS_SHIP` on
  the test server (docs/42 T5). Empty: no season mod ships anywhere.
- **One helper, `shippedFiles(lock, ship)`, in `packages/modpack`:** the lock's files minus the season mods whose
  season is not in `ship`. Every reader below calls it instead of reading `lock.files`.
- **The pack hash and version** are computed over the shipped files, so live and test each get their own pack version.
  The door's pack check then compares like with like.

## The nine places that read the lock today

1. `packages/modpack/src/build.ts`: the server set (`forServer`) and the jars copied to `dist/server/mods`.
2. `packages/modpack/src/sides.ts`: `clientSet`, used for the installer zip and the side checks.
3. `apps/web/src/app/api/modpack/manifest/route.ts`: the client manifest the app downloads by.
4. `apps/web/src/app/api/app/updates/route.ts`: the app's update check (hash and client files).
5. `packages/modpack/src/lock.ts`: `packHash` and the version string `0.1.0+<hash>`.
6. `apps/web/src/server/modpack/drift.ts`: "the server runs the pack main has".
7. `apps/api/src/players/pack.ts`: the mods counted as changed at a Sync, and the pack recorded as synced.
8. `apps/api/src/modpack/server-mods.ts`: the server's jars compared with the lock.
9. `apps/api/src/status/health-watch.ts`: the pack check in the health watch.

Also checked, not changed: the door (`players/limbo.ts`, `playGate`) compares pack versions only, so it follows item 5.

## Tests

- `shippedFiles` with an empty `ship`, `["s1"]`, and an unknown season.
- The pack hash differs between the two, and is stable for each.
- Every one of the nine gives the same file list for the same `ship`. One table test drives all of them, so a tenth
  reader added later must join it.

## Done when

Test ships `s1` and live ships nothing from one commit. The door holds nobody on either server. An app that Plays
against either server ends with exactly that server's set.

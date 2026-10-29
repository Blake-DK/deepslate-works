# ArPhEx 5.0.2 on Ashmoon (patched jar)

ArPhEx 5.0.2 (`arphex` on Modrinth, by Vllax, MIT) runs on Ashmoon only here: `modpack/datapacks/deepslate-moon-mobs`
moves its spawn rules and its five main-world structures, the Crawling Castle among them, to Ashmoon's biomes. But
five of its procedures do their part only when `dimension == Level.OVERWORLD`, so on Ashmoon (read in the jar,
2026-10-29):

| Procedure | What did not work on Ashmoon |
|---|---|
| `CompassTestRightclickedProcedure` | The Crawling Compass: "only works in the overworld", and the castle is not in the main world, so the Crawling could not be found |
| `RandomSpawnConfigProcedure` | The random spawn system (random ArPhEx mob, random termites, the any-dimension spawner) never ran, unless `"Spawn in other dimensions"` |
| `ArphexSpawnConfigUndergroundProcedure` | Spider Lunger and Spider Recluse never spawned |
| `TormentorSpawnConditionProcedure` | The Tormentor's first coming after the first three bosses |
| `RandomArPhExOnEntityTickUpdateProcedure` | The Spider Moth from the random system (its choice 33) |

**The patch** (`Patch.java`, ASM): in each of the five, the one comparison with `Level.OVERWORLD` compares with
`deepslate:moon` instead (`ResourceKey.create(Registries.DIMENSION, ResourceLocation.parse("deepslate:moon"))`, as the
mod builds the key of its own dimension). A swap, not an addition: none of these comes back to the main world. The
compass's message reads "Item only works on Ashmoon and in the Crawling". The version in both `mods.toml` files goes
from `5.0.2` to `5.0.2-dsw.1`. Every other entry of the jar is copied unchanged (the same 6,039 names in the same order,
the same dates). It is the same mod, so nothing in the world changes.

Left as they are, read and found fine: the castle portal (lit from any world but the Crawling), sealing at it, the
boss summoners, bosses' storms (Ashmoon has the main world's weather). The Crawling's way out lands in the main world
near 0 0; the guide says so.

**Build:** `mods/arphex-ashmoon/build.sh` (Docker, memory-capped, no network inside; the JDK image pinned by digest,
the ArPhEx jar and ASM pinned by sha512; prints the jar's sha512, the same on every run). It ships the way docs/58
ships a jar that is not on Modrinth: the file in `data/private-jars/` on the stack, pinned by sha512 in `mods.json`.

**Back to Modrinth** if ArPhEx ever learns other dimensions for these: drop `source` from the entry, pin that version
(5.0.2 is `jawvD7YZ`), Lock.

Licence: ArPhEx is MIT (declared in its `mods.toml` and on Modrinth; its jar and repository carry no licence file, so
`LICENSE` is the MIT text in its author's name); the patch is MIT too.

# Quarry pause (server-only mod)

docs/56 §3. A quarry (Additional Enchanted Miner, mod id `quarryplus`) normally keeps digging when its chest is full
and piles what it digs into an internal storage with no limit, which is lost if the quarry is broken. With this mod a
quarry, or an Adv. Quarry, stops digging while anything it dug could not be passed on, uses no power while it waits,
and carries on by itself as soon as there is room (a chest emptied, a pipe freed).

- **Only items count.** Fluids (water or lava picked up with a pump module and no tank beside it) stay inside and the
  quarry carries on digging, as before; counting them would stop such a quarry at the first water.
- **What waits inside:** in a quarry, at most the drops of the last block. An Adv. Quarry breaks more per turn and the
  push moves about six item types a tick, so it can hold more for a few ticks. None of it is dropped when the machine is
  broken (a mod that moves blocks, such as a Create contraption, would duplicate it).

How: two mixins skip the machine's `serverTick` (its dig step) while its `storage` holds items. The machine's own
push into the blocks next to it runs after the dig step every tick and is left alone. They are written against
21.1.164; the mod refuses to load with any other version of the quarry, so a quarry update means reading its
`QuarryEntity` and `AdvQuarryEntity` again and moving the version range in `neoforge.mods.toml` and `build.sh`.

Server only (`displayTest = "IGNORE_SERVER_VERSION"`, no network channels): players' games do not need it.

Build: `mods/quarry-pause/build.sh` (Docker, memory-capped, no network inside; the JDK image pinned by digest and every
jar it compiles against pinned by sha512; prints the jar's sha512). It ships the way docs/58 ships a jar that is not
on Modrinth: the file in `data/private-jars/` on the stack, pinned by sha512 in `mods.json`.

Licence: this mod is MIT (`LICENSE`). The quarry mod it changes is LGPL-3.0; no code of the quarry mod is copied here,
the mixins only name its classes, fields and methods.

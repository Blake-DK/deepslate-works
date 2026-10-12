# Quarry pause (server-only mod)

docs/56 §3. A quarry (Additional Enchanted Miner, mod id `quarryplus`) normally keeps digging when its chest is full
and piles what it digs into an internal storage with no limit, which is lost if the quarry is broken. With this mod a
quarry, or an Adv. Quarry, stops digging while anything it dug could not be passed on, uses no power while it waits,
and carries on by itself as soon as there is room (a chest emptied, a pipe freed). At most the drops of the last block
wait inside it.

How: two mixins skip the machine's `serverTick` (its dig step) while its `storage` holds items. The machine's own
push into the blocks next to it runs after the dig step every tick and is left alone. They are written against
21.1.164; the mod refuses to load with any other version of the quarry, so a quarry update means reading its
`QuarryEntity` and `AdvQuarryEntity` again and moving the version range in `neoforge.mods.toml` and `build.sh`.

Server only (`displayTest = "IGNORE_SERVER_VERSION"`, no network channels): players' games do not need it.

Build: `mods/quarry-pause/build.sh` (Docker, memory-capped, no network inside; prints the jar's sha512). It ships the
way docs/58 ships a jar that is not on Modrinth: the file in `data/private-jars/` on the stack, pinned by sha512 in
`mods.json`.

Licence: MIT (`LICENSE`).

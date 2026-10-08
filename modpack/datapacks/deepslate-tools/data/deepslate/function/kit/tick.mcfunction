# docs/25 (2026-10-08): the kit comes with the first release from the entrance room, never inside it.
# Anyone who has ever been let out (verified) is marked for good with deepslate.released. The mark is in the player's
# data, so it survives a relog and a restart and goes with the world. A hold (apps/api/src/actions/registry.ts,
# intoRoom) leaves the inventory of a marked player alone, and empties that of anybody never let out but for the book.
tag @a[tag=verified,tag=!deepslate.released] add deepslate.released
# Once per player: deepslate.kit is set last in give. Never to someone held (no verified) or in the room's dimension.
execute as @a[tag=verified,tag=!deepslate.kit] at @s unless dimension deepslate:limbo run function deepslate:kit/give

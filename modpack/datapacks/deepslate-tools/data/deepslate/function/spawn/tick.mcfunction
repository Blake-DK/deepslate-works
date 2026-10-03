# docs/27: inside the spawn claim a verified player in survival is in adventure mode, so a block hit is never sent
# and Open Parties and Claims has nothing to refuse. Survival comes back on the way out. Creative and spectator
# (admins at work) and players without `verified` (the entrance room) are never put in or out of a mode here.
#
# The area, written only here: the overworld server claim, spawnClaimArea(SPAWN_POS) in
# apps/api/src/actions/registry.ts for SPAWN_POS 107.5 126 87.5 (blocks x 32 to 159, z 16 to 143, docs/24 §7), grown
# by 5 blocks each way: x 27 to 164, z 11 to 148, every height. 5 is the smallest ring that keeps a survival player
# (reach 4.5 blocks) from hitting a claimed block. The claim itself is not grown. If spawn moves, both move.
# `in minecraft:overworld` with a volume selector looks in the overworld only.
tag @a remove deepslate.spawn_area
execute in minecraft:overworld run tag @a[x=27,y=-2048,z=11,dx=137,dy=4096,dz=137] add deepslate.spawn_area
# no tag=!deepslate.spawn here: a player who went creative and back to survival inside is put in adventure again
execute as @a[tag=verified,gamemode=survival,tag=deepslate.spawn_area] run function deepslate:spawn/enter
execute as @a[tag=deepslate.spawn,tag=!deepslate.spawn_area] run function deepslate:spawn/leave

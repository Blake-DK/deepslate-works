# docs/27: inside the spawn claim a verified player in survival is in adventure mode, so a block hit is never sent
# and Open Parties and Claims has nothing to refuse. Survival comes back on the way out. Creative and spectator
# (admins at work) and players without `verified` (the entrance room) are never put in or out of a mode here.
#
# The area, written only here: the overworld server claim, spawnClaimArea(SPAWN_POS) in
# apps/api/src/actions/registry.ts for SPAWN_POS 107.5 126 87.5 (blocks x 32 to 159, z 16 to 143, docs/24 §7), grown
# by 8 blocks each way: x 24 to 167, z 8 to 151, every height. A survival player reaches about 5 blocks, so nobody in
# survival stands within reach of a claimed block. The claim itself is not grown. If spawn moves, both move.
# `in minecraft:overworld` with a volume selector looks in the overworld only.
tag @a remove deepslate.spawn_area
execute in minecraft:overworld run tag @a[x=24,y=-2048,z=8,dx=143,dy=4096,dz=143] add deepslate.spawn_area
# no tag=!deepslate.spawn here: a player who went creative and back to survival inside is put in adventure again
execute as @a[tag=verified,gamemode=survival,tag=deepslate.spawn_area] run function deepslate:spawn/enter
execute as @a[tag=deepslate.spawn,tag=!deepslate.spawn_area] run function deepslate:spawn/leave

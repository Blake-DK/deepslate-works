# docs/55 M7, M8, as radiation (Alex, 2026-10-14): stronger the deeper you go. deepslate.band is 1 below y 30, 2 below
# y 0 and 3 below y -25 (feet, as in deepslate:gas/second).
scoreboard players set @s deepslate.band 1
execute if entity @s[y=-64,dy=64] run scoreboard players set @s deepslate.band 2
execute if entity @s[y=-64,dy=39] run scoreboard players set @s deepslate.band 3
# Below y -25 only a whole suit keeps it out: hazmat or MekaSuit in all four slots, in any mix. The hazmat pieces wear.
execute if score @s deepslate.band matches 3 if items entity @s armor.head #deepslate:radiation_suit/head if items entity @s armor.chest #deepslate:radiation_suit/chest if items entity @s armor.legs #deepslate:radiation_suit/legs if items entity @s armor.feet #deepslate:radiation_suit/feet run return run function deepslate:gas/suit
# Otherwise a mask on the head wears (twice as fast below y 0, four times below y -25) and keeps the radiation out
# above y -25. Below it, a mask only slows it down (deepslate:gas/breathe).
tag @s remove deepslate.masked
execute if items entity @s armor.head minecraft:leather_helmet[minecraft:custom_data~{deepslate_mask:"basic"}] run tag @s add deepslate.masked
execute if items entity @s armor.head #deepslate:gas_mask_hazmat run tag @s add deepslate.masked
execute if items entity @s armor.head #deepslate:gas_mask_sealed run tag @s add deepslate.masked
execute if items entity @s armor.head minecraft:leather_helmet[minecraft:custom_data~{deepslate_mask:"basic"}] run function deepslate:gas/mask/basic
execute if items entity @s armor.head #deepslate:gas_mask_hazmat run function deepslate:gas/hazmat/wear {slot:"armor.head"}
execute if score @s deepslate.band matches ..2 if entity @s[tag=deepslate.masked] run return 1
function deepslate:gas/breathe

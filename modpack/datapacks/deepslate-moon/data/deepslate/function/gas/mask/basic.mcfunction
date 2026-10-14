# Our gas mask: one point a second below y 30 (30 points, so 30 s), two below y 0, four below y -25; then it is gone.
item modify entity @s armor.head deepslate:gas/wear_basic
execute if score @s deepslate.band matches 2.. run item modify entity @s armor.head deepslate:gas/wear_basic
execute if score @s deepslate.band matches 3 run item modify entity @s armor.head deepslate:gas/wear_basic
execute if score @s deepslate.band matches 3 run item modify entity @s armor.head deepslate:gas/wear_basic
execute if items entity @s armor.head minecraft:leather_helmet[minecraft:damage~{durability:{max:0}}] run function deepslate:gas/mask/broke

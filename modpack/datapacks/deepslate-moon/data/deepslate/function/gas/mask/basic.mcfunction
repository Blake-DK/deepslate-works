# Our gas mask: one point a second in the gas (30 points, so 30 s), then it is gone.
item modify entity @s armor.head deepslate:gas/wear_basic
execute if items entity @s armor.head minecraft:leather_helmet[minecraft:damage~{durability:{max:0}}] run function deepslate:gas/mask/broke

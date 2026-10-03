give @s minecraft:stone_sword 1
give @s minecraft:stone_pickaxe 1
give @s minecraft:stone_axe 1
give @s minecraft:stone_shovel 1
give @s minecraft:bread 16
give @s minecraft:torch 16
give @s minecraft:white_bed 1
function deepslate:kit/backpack
tellraw @s {"text":"A starter kit is in your inventory: a backpack, tools, food, torches and a bed.","color":"green"}
tag @s add deepslate.kit

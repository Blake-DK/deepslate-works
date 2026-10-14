# Exposure in seconds, kept at 40 at most so that leaving the gas brings it back to 0 within 20 s.
# 1 to 10: a warning; 11 to 30: Poison I and Slowness I; 31 and up: Poison II, Slowness II and Mining Fatigue I.
# Each effect lasts 2 s and is given again every second. Poison stops at half a heart: the gas never kills.
scoreboard players add @s deepslate.gas 1
execute if score @s deepslate.gas matches 41.. run scoreboard players set @s deepslate.gas 40
tag @s add deepslate.in_gas
particle minecraft:ash ~ ~1 ~ 0.4 0.6 0.4 0 40 normal @a
execute if score @s deepslate.gas matches ..10 run title @s actionbar {"text":"The air is thick here. You need a mask.","color":"gray"}
execute if score @s deepslate.gas matches 11..30 run effect give @s minecraft:poison 2 0 true
execute if score @s deepslate.gas matches 11..30 run effect give @s minecraft:slowness 2 0 true
execute if score @s deepslate.gas matches 31.. run effect give @s minecraft:poison 2 1 true
execute if score @s deepslate.gas matches 31.. run effect give @s minecraft:slowness 2 1 true
execute if score @s deepslate.gas matches 31.. run effect give @s minecraft:mining_fatigue 2 0 true

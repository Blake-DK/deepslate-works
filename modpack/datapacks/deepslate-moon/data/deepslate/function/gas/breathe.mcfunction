# Exposure, kept at 40 at most so that leaving the radiation brings it back to 0 within 20 s. It climbs 1 a second
# below y 30, 2 below y 0 and 3 below y -25, where a mask (deepslate:gas/check) holds it to 1.
# 1 to 10: a warning; 11 to 30: Poison I and Slowness I; 31 and up: Poison II, Slowness II and Mining Fatigue I.
# Each effect lasts 2 s and is given again every second. Poison stops at half a heart, so above y -25 it never kills.
# Below y -25 it does (Alex, 2026-10-14): from 11 on, Mekanism's radiation damage, a heart a second, through armour.
scoreboard players add @s deepslate.gas 1
execute unless entity @s[tag=deepslate.masked] if score @s deepslate.band matches 2.. run scoreboard players add @s deepslate.gas 1
execute unless entity @s[tag=deepslate.masked] if score @s deepslate.band matches 3 run scoreboard players add @s deepslate.gas 1
execute if score @s deepslate.gas matches 41.. run scoreboard players set @s deepslate.gas 40
tag @s add deepslate.in_gas
particle minecraft:ash ~ ~1 ~ 0.4 0.6 0.4 0 40 normal @a
execute if score @s deepslate.band matches ..2 if score @s deepslate.gas matches ..10 run title @s actionbar {"text":"Radiation! Wear a gas mask or a hazmat mask.","color":"gray"}
execute if score @s deepslate.band matches 3 run title @s actionbar {"text":"Deadly radiation! Only a full hazmat suit keeps you alive this deep.","color":"red"}
execute if score @s deepslate.gas matches 11..30 run effect give @s minecraft:poison 2 0 true
execute if score @s deepslate.gas matches 11..30 run effect give @s minecraft:slowness 2 0 true
execute if score @s deepslate.gas matches 31.. run effect give @s minecraft:poison 2 1 true
execute if score @s deepslate.gas matches 31.. run effect give @s minecraft:slowness 2 1 true
execute if score @s deepslate.gas matches 31.. run effect give @s minecraft:mining_fatigue 2 0 true
execute if score @s deepslate.band matches 3 if score @s deepslate.gas matches 11.. run damage @s 2 mekanism:radiation

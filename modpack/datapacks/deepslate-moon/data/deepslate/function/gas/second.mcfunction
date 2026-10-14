# Every second: players in the gas get +1 exposure (deepslate:gas/check), everyone else with some loses 2.
tag @a remove deepslate.in_gas
execute as @a[gamemode=!creative,gamemode=!spectator] at @s if dimension deepslate:moon if entity @s[y=-64,dy=64] run function deepslate:gas/check
execute as @a[tag=!deepslate.in_gas,scores={deepslate.gas=1..}] run function deepslate:gas/recover
schedule function deepslate:gas/second 20t replace

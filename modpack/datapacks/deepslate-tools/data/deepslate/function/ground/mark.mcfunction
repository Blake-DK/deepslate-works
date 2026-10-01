# Clear ground items, step 1 (api status/ground.ts): every item entity's age in ticks into a score, so the api can
# select "older than 2 minutes" (Age 2400..), which an nbt={} selector cannot. Inside a function so the console
# gets one line, not one per item.
scoreboard objectives add deepslate_age dummy
execute as @e[type=minecraft:item] store result score @s deepslate_age run data get entity @s Age

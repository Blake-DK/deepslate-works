item replace entity @s armor.head with minecraft:air
playsound minecraft:entity.item.break player @a ~ ~ ~
title @s actionbar {"text":"Your mask has given out.","color":"gray"}
scoreboard players set @s deepslate.gas 0

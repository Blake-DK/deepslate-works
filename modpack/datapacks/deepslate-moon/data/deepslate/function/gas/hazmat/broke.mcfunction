$item replace entity @s $(slot) with minecraft:air
playsound minecraft:entity.item.break player @a ~ ~ ~
title @s actionbar {"text":"A piece of your hazmat suit has worn out.","color":"gray"}

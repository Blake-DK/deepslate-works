# A whole suit below y -25 keeps the radiation out. Each hazmat piece wears 4 points a second (7.5 minutes from new);
# MekaSuit pieces never wear.
execute if items entity @s armor.head #deepslate:hazmat_suit run function deepslate:gas/hazmat/wear {slot:"armor.head"}
execute if items entity @s armor.chest #deepslate:hazmat_suit run function deepslate:gas/hazmat/wear {slot:"armor.chest"}
execute if items entity @s armor.legs #deepslate:hazmat_suit run function deepslate:gas/hazmat/wear {slot:"armor.legs"}
execute if items entity @s armor.feet #deepslate:hazmat_suit run function deepslate:gas/hazmat/wear {slot:"armor.feet"}

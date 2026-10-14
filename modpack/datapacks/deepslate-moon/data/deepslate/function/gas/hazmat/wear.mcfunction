# One hazmat piece in $(slot), worn in the radiation. Mekanism 10.7.19.85 gives hazmat gear no durability (seen on the
# test server 2026-10-14), so the first second gives it 1800 points: 30 minutes below y 30, 15 below y 0, 7.5 below
# y -25 (Alex, 2026-10-14). It then wears like any armour, hits elsewhere included.
$execute if items entity @s $(slot) #deepslate:hazmat_suit[!minecraft:max_damage] run item modify entity @s $(slot) deepslate:gas/hazmat_durability
$item modify entity @s $(slot) deepslate:gas/wear_hazmat
$execute if score @s deepslate.band matches 2.. run item modify entity @s $(slot) deepslate:gas/wear_hazmat
$execute if score @s deepslate.band matches 3 run item modify entity @s $(slot) deepslate:gas/wear_hazmat
$execute if score @s deepslate.band matches 3 run item modify entity @s $(slot) deepslate:gas/wear_hazmat
$execute if items entity @s $(slot) #deepslate:hazmat_suit[minecraft:damage~{durability:{max:0}}] run function deepslate:gas/hazmat/broke {slot:"$(slot)"}

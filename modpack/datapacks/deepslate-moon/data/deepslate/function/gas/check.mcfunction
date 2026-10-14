# docs/55 M8: a working mask on the head protects (and wears, while in the gas); anything else breathes the gas.
execute if items entity @s armor.head minecraft:leather_helmet[minecraft:custom_data~{deepslate_mask:"basic"}] run return run function deepslate:gas/mask/basic
execute if items entity @s armor.head #deepslate:gas_mask_hazmat run return run function deepslate:gas/mask/hazmat
execute if items entity @s armor.head #deepslate:gas_mask_sealed run return 1
function deepslate:gas/breathe

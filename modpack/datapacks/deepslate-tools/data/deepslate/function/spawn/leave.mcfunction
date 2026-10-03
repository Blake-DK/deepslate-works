# Out of the area (walked, teleported, other dimension). Survival only for a verified player still in adventure: a
# player held in the entrance room keeps adventure, an admin who switched to creative keeps creative.
tag @s remove deepslate.spawn
execute if entity @s[tag=verified,gamemode=adventure] run gamemode survival @s

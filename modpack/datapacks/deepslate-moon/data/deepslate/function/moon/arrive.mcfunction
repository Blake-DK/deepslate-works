# A sixth of normal gravity (0.08 -> about 0.013): a jump of about 5 blocks, 30 blocks fallen in about 4.4 s.
# A fall counts from 18 blocks instead of 3. Removed first, so a value changed here replaces the old one.
attribute @s minecraft:generic.gravity modifier remove deepslate:moon_gravity
attribute @s minecraft:generic.safe_fall_distance modifier remove deepslate:moon_safe_fall
attribute @s minecraft:generic.gravity modifier add deepslate:moon_gravity -0.8333 add_multiplied_base
attribute @s minecraft:generic.safe_fall_distance modifier add deepslate:moon_safe_fall 15 add_value
tag @s add deepslate.moon

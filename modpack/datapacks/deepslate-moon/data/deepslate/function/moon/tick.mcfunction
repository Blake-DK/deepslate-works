# docs/55 M3: low gravity on the Moon, for players only. A player arriving gets the two modifiers once; a player
# anywhere else who still carries the tag (portal, death, /tp, logging in elsewhere) loses them.
execute as @a[tag=!deepslate.moon] at @s if dimension deepslate:moon run function deepslate:moon/arrive
execute as @a[tag=deepslate.moon] at @s unless dimension deepslate:moon run function deepslate:moon/leave

# docs/55 M7: the gas below y 30 on the Moon (Alex, 2026-10-14; the planner had y 0). Checked once a second (never every tick), by a function that schedules
# itself again; this starts it at every load and /reload ("replace", so there is only ever one).
scoreboard objectives add deepslate.gas dummy
schedule function deepslate:gas/second 20t replace

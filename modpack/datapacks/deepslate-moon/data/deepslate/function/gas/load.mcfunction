# docs/55 M7: the radiation below y 30 on Ashmoon (Alex, 2026-10-14: radiation, not gas, and stronger the deeper you
# go; the planner had gas below y 0). Checked once a second (never every tick), by a function that schedules itself
# again; this starts it at every load and /reload ("replace", so there is only ever one).
scoreboard objectives add deepslate.gas dummy
scoreboard objectives add deepslate.band dummy
schedule function deepslate:gas/second 20t replace

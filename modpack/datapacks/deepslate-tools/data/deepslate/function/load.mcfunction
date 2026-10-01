# Runs at every start and /reload (planner, 2026-10-01). The overworld spawn does not need to stay loaded: the
# entrance room has its own dimension and forceload. maxEntityCramming stays at the game's own 24.
gamerule spawnChunkRadius 0
scoreboard objectives add deepslate_age dummy

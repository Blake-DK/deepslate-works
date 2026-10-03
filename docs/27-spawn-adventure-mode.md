# 27 · Spawn is adventure mode, so hitting a block prints nothing

Planner, 2026-10-03. The ruling docs/26 §3.4 was waiting for. Input for the VPS session: read it, don't rewrite it. Report in `docs/11-status.md`. Small job, straight to main, no PR.

## 1. Ruling

docs/26's report stands as built, the path correction (`config/openpartiesandclaims-server.toml`) included. OPAC has no switch for its refusal lines, and a language override would only turn each line into an empty chat line, so neither is used.

Instead the click never reaches the server. In adventure mode the game client does not send a block hit at all (no tool in the pack carries `can_break`), so OPAC has nothing to refuse and nothing to say. A player standing in the spawn claim is put in adventure mode and is given survival back on the way out. Nothing breakable is lost: the claim already refuses every break and place there.

**Not covered, on purpose:** right-clicking a protected block at spawn (a chest, a door) still prints OPAC's line. Alex asked about hitting. Crafting tables, waystones, backpacks and bodies are already exceptions and stay usable in adventure mode.

## 2. What to build

In the `deepslate-tools` datapack, beside the kit: a `spawn/tick` function added to `tags/function/tick.json`, with `spawn/enter` and `spawn/leave`. The exact commands are yours; the behaviour is this.

1. **The area** is the overworld server claim, blocks x 32 to 159, z 16 to 143, every height (docs/24 §7). Overworld only: the same coordinates in the nether or the end are not spawn.
2. **Enter:** a player with tag `verified`, in survival, inside the area → adventure, tag `deepslate.spawn`.
3. **Leave:** a player with `deepslate.spawn` who is no longer inside the area (walked out, teleported, changed dimension) → tag removed, and survival **only if** they are still `verified` and still in adventure.
4. **Never touched:** creative and spectator (admins at work), and anyone without `verified`. The entrance room holds people in adventure (`limbo.hold`, `player.revoke`); a revoked player who still carries `deepslate.spawn` loses the tag and keeps adventure.
5. **Silent.** The mode change must print nothing to the player. Run `gamemode` as the player on themselves, which reports to the function and not to chat. If a line still shows, say so before trying anything else.
6. **The coordinates are written once**, in one function or one selector that the others call, with a comment that they are the server claim's and that `spawnClaimArea(SPAWN_POS)` in `registry.ts` is where they come from. If spawn ever moves, both move.

Tests in `packages/modpack/tests/datapack.test.ts`, in the manner of the kit's: the tick tag lists both functions, the area's numbers equal `spawnClaimArea` for `107.5 126 87.5`, enter and leave only act on `verified`, creative and spectator are not selected.

Guide: one line in docs/18 and `guide-default.ts`, "Spawn is protected: you can't break or build there." Keep the markers and the guide test.

## 3. On the running server

Sync, restart with nobody online, `world.datapacks` still lists both packs, no new ERROR line. Then, with whoever is first on (Alex counts: OPAC's protection applies to him unless he turns admin mode on):

- [ ] Walk into spawn: adventure, no chat line. Hit a block: no chat line.
- [ ] Walk out: survival, no chat line. Break a block outside: works.
- [ ] Use a waystone out of spawn and into spawn: the mode follows.
- [ ] Log out inside spawn, log in: still adventure, survival on leaving.
- [ ] Creative inside spawn stays creative.
- [ ] A fresh join through the entrance room is released at spawn in adventure and is in survival once outside.
- [ ] docs/26 §4's open boxes in the same visit: own body opens at spawn, another player's does not in its first 30 minutes, a body cannot be destroyed.

If hitting a block still prints a line in adventure mode, stop and report the text. Do not add a mod for it.

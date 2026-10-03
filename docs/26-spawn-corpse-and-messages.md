# 26 · Spawn: open your own corpse, no chat line when you hit a block

Planner, 2026-10-03, on Alex's "I can't interact with my corpse in spawn, I also want to get rid of the messages when I hit a block in spawn". Input for the VPS session: read it, don't rewrite it. Report in `docs/11-status.md`. Small job: no PR unless §3 ends in code.

## 1. What is wrong

Spawn protection is the Open Parties and Claims (OPAC 0.31.6) server claim, overworld chunks x 2..9, z 1..8 (docs/24 §7). `server.properties` has no vanilla spawn protection, so both faults are OPAC's.

1. **Corpse.** A body is an entity (`corpse:corpse`). A server claim protects entities from every player, so the right-click that opens a body is refused. Someone who dies inside spawn cannot get their things back.
2. **Messages.** Each refused click on a block inside the claim sends the player a line from OPAC. Punching anything at spawn fills the chat.

The claim itself stays exactly as it is. Nobody gains the right to break, place or open anything at spawn.

## 2. Corpse: an exception for the body

The planner could not read the OPAC jar from here, so the key name and the format below are from memory. **Read the real ones first** from the live `world/serverconfig/openpartiesandclaims-server.toml` (NeoForge writes every key with its comment) and use what the file says.

- Expected key: `forcedEntityProtectionExceptionList` under `[serverConfig.claims.protection]`. A bare id allows interaction with that entity in every claim; prefixes such as `kill$` allow more.
- Add `"corpse:corpse"` as a **bare id, interaction only**. No `kill$`, nothing that lets a body be destroyed.
- Confirm the entity id on the running server before writing it (`summon` with a name that does not parse, the same way docs/25 checked the backpack id, or read it from a body's data).

Who may open a body is still Corpse's own rule (`corpse-server.toml`: owner only for 30 minutes, then anyone). This exception only stops the claim from getting in the way first. It applies in players' claims too, which is wanted: a friend who dies in your base can pick up their own things.

Where it goes:

1. `modpack/server/defaultconfigs/openpartiesandclaims-server.toml`, so a new world gets it. Keep the file's manner: only what differs from the defaults.
2. The live `world/serverconfig/openpartiesandclaims-server.toml`, because the world exists and `defaultconfigs/` is only read for a new one. Server stopped through `quiesce()`, nobody online, edit that one key, start. Read the file back after "Done" and confirm NeoForge did not "correct" the line away.

If the key does not exist or takes no entity ids, stop and report what the file offers instead.

## 3. Messages: find the switch, don't invent one

1. Reproduce it: stand in the claim as a non-admin (or with OPAC's admin mode off), hit a block, right-click a block, right-click an entity. Report the **exact text** of each line and whether it lands in chat or above the hotbar.
2. Look for OPAC's own setting, in this order:
   - the live `openpartiesandclaims-server.toml`, any key about messages or notifications;
   - the player config options (`help` on OPAC's player config command on the running server, and the server claims' own config, which is a player config of its own);
   - the client config, in case the line is drawn client side.
3. **If a setting exists**, use it at the narrowest scope that does the job: the server claims' config first, the default player config second, a server-wide switch last. Ship it in `defaultconfigs/` and set it live, as in §2.
4. **If no setting exists, change nothing.** Report the text, the translation keys and what you found. The planner picks the way from there (most likely a language override in the client pack). Do not add a mod, a mixin or a datapack trick for this without that ruling.

A message that stays whatever happens: nothing from other mods, nothing from the portal. Only OPAC's refusal lines are in scope.

## 4. Acceptance

- [ ] A player who dies inside the spawn claim opens their own body there and takes their things. Seen on the running server with a real account.
- [ ] Another player still cannot open that body in its first 30 minutes.
- [ ] Nobody can break, place or open a chest inside the spawn claim: unchanged.
- [ ] The body cannot be destroyed by a player.
- [ ] Hitting a block at spawn prints nothing, or §3.4's report is in docs/11 and waiting on the planner.
- [ ] The shipped file and the live file say the same. No new ERROR line at start.
- [ ] docs/11 says what the keys really are called, since §2 was written from memory.

# 14 · Discord-gated join ("the white room")

Planner spec, 2026-09-28. Belongs to Phase 4 but the data-model bits (§4) land in Phase 1 so nothing has to migrate later.

## What Alex wants

Nobody hands out whitelist entries. A friend gets the server address, connects, and lands in a small sealed room. In chat there's one clickable link. They click it, sign in with Discord (must be in the group's server), and the game releases them to spawn. From then on they're whitelisted and linked. Leave the Discord server and you're back in the room next time you join.

## How it works (no custom mod; console commands from `api` plus vanilla mechanics)

1. **Server config**: `white-list=false`, `enforce-whitelist=false`, `spawn-protection=0`, `max-players` as normal. `server.properties` is in `modpack/server/`. Whitelist is off because the gate is the room, not the connection. Pangolin already limits who can reach the port to people who have the address.
2. **The room**: a bedrock box (10×6×10) at a fixed location in the Overworld well away from spawn, e.g. `y=250`, with a sign and nothing else. Coordinates in `.env` as `LIMBO_POS=x y z` and spawn as `SPAWN_POS=x y z`. Built once by hand (or by the api running `fill` commands from an admin button; keep that as an admin action `limbo.build`).
3. **Join detection**: `api`'s console tail already reads join lines (`<name>[/ip] logged in with entity id ... at (x, y, z)` and `UUID of player <name> is <uuid>`). On every join:
   - Look up `mcUuid` in the DB. If it belongs to a `User` whose Discord account is still in the guild (cached membership check, refreshed at most every 5 min) → do nothing, or `tag <name> add verified` if missing.
   - Otherwise → **hold**: `tag <name> remove verified`, `gamemode adventure <name>`, `tp <name> <LIMBO_POS>`, `effect give <name> minecraft:slowness 1000000 255 true`, `effect give <name> minecraft:jump_boost 1000000 250 true` (negative jump), then a `tellraw` with a clickable link (below). Create a `LinkCode` row.
4. **Keeping them in**: a repeating command block inside the room (or a 5 s tick from `api` while any unverified player is online): `execute as @a[tag=!verified] at @s unless entity @s[x=…,dx=…,dy=…,dz=…] run tp @s <LIMBO_POS>`. Belt and braces with the adventure mode + effects.
5. **The link**: `https://deepslate.dsw.test/link/<code>` where `<code>` is 8 chars, single use, 15 min expiry, bound to that UUID. `tellraw` payload:
   `tellraw <name> ["",{"text":"Welcome to Deepslate Works. Click to link your Discord: ","color":"gold"},{"text":"deepslate.dsw.test/link/<code>","color":"aqua","underlined":true,"clickEvent":{"action":"open_url","value":"https://deepslate.dsw.test/link/<code>"}}]`
   Repeat it every 60 s while they're still in the room, and show the code itself as a fallback ("or type /link is not needed, just open the site and enter <code>").
6. **Linking**: `/link/<code>` → Discord OAuth (guild check as usual, auto-join creates the User) → on success set `User.mcUuid` and `mcUsername` from the LinkCode's UUID (no Mojang lookup, no typos) → mark code used → `api` action `link.release`: `tag <name> add verified`, `effect clear <name>`, `gamemode survival <name>`, `tp <name> <SPAWN_POS>`, `whitelist add <name>` (kept for belt and braces and so an emergency `white-list=true` still works), `tellraw` welcome. If the player has logged off in the meantime, release happens on their next join (step 3 finds the link).
7. **Revocation**: the guild-membership refresh runs every 5 min for online players and on every join. A user who left the guild: `tag remove verified`, next join goes to the room, `whitelist remove`. Admin "Remove" in `/admin/users` does the same and kicks with a message.
8. **Timeout**: an unverified player idle in the room for 15 min is kicked: "Link your Discord at deepslate.dsw.test and come back."
9. ~~**Existing `/onboarding` Minecraft-username step** becomes optional~~ Superseded by Alex (2026-09-28): the username step is removed entirely, nobody types a username; only the PC question remains. The Mojang lookup survives only as the admin fallback in `/admin/users`.

## Data model additions (Phase 1)

```prisma
model LinkCode {
  code       String   @id            // 8 chars, unambiguous alphabet
  mcUuid     String
  mcUsername String
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  usedById   String?
}
```

`User.mcUuid` already exists. Add `User.verifiedAt DateTime?` and `User.guildMember Boolean @default(true)` (cache of the last membership check).

## Actions added to the registry (`apps/api`)

| name | role | commands |
|---|---|---|
| `limbo.hold` | system (join hook) | tag, gamemode adventure, tp, effects, tellraw link |
| `link.release` | system (after OAuth) / ADMIN | tag, effect clear, gamemode survival, tp spawn, whitelist add, tellraw |
| `limbo.kickIdle` | system (timer) | kick with message |
| `limbo.build` | ADMIN | `fill` commands for the bedrock box and a sign |
| `player.revoke` | system (guild check) / ADMIN | tag remove, whitelist remove, kick |

"system" actions are invoked by `api` itself, never through a web route; they still write `AuditLog`.

## Edge cases

- Cracked/offline-mode clients: not supported; `online-mode=true` stays on so UUIDs are real.
- Two people share a Discord account: second UUID linking to the same User is refused ("already linked to <name>; ask Alex").
- Player joins while `api` is down: they land at spawn unheld. Mitigation: the repeating command block still holds `tag=!verified` players (tags persist in player data), and the api reconciles everyone online when it comes back. New players without any tag: the command block treats "no tag" as unverified, so they're held too.
- Server restart wipes effects but not tags or gamemode; the command block re-holds.

## Acceptance (adds to Phase 4 "Done when")

- [ ] A fresh account joins, lands in the room, can't leave, sees the link within 5 s.
- [ ] Clicking the link, logging in with a Discord account that's in the server, releases them to spawn within 5 s, and `whitelist.json` gains their entry.
- [ ] A Discord account outside the server is refused and the player stays in the room.
- [ ] Leaving the Discord server puts the player back in the room on their next join.
- [ ] `api` down for 2 min then back: nobody unverified escaped.

## Play first (planner spec, 2026-09-29; appended by the VPS session at the planner's request)

1. Every Play run already sends an install report (mode=play) tied to the user. Record on it the pack version present after the run.
2. On join (the hook above), before release: look up the linked user's most recent mode=play report. Allow if it is newer than JOIN_WINDOW (default 30 min, settings page) AND its pack version equals the server's current pack version. Otherwise hold in the white room with: "Press Play on deepslate.dsw.test to join. That checks your mods are up to date." (tellraw with the clickable link, repeated every 60 s like the link message).
3. A player already in the world when a new pack is synced is fine until they leave; the next join applies the check. Admins are never held.
4. `/me` and Home show "Ready to join until <time>" after a Play run, so the window is visible.
5. Event kind JOIN_BLOCKED with the reason (no report / stale / wrong version) for the event log and Stats.

Acceptance: launch from the launcher without pressing Play -> held with the message; press Play, join -> released; sync a new pack version, join without Play -> held with "stale"; admins never held.

Later, if needed: a client mod that carries a one-time join token minted by Play (docs/19, not now).

### As built (2026-09-29)

- **The rule** is one function, `playGate` (`apps/web/src/shared/join-gate.ts`, the same file in `api`), used by `api` at the door and by the portal for "Ready to join until 10:35". The run that counts is the member's latest `mode=play` report with outcome `ok`; its `packVersion` is the pack that run left on the PC (it was already on the report). **Time is looked at first**, then the pack: a run from before the window is "stale" whatever its pack, which is what the acceptance case asks for; "wrong version" is a run inside the window with another pack than the server's.
- **The server's pack** is written down by `api` at every real sync (Setting `_packSynced`, from `dist/server/PACK_VERSION`), because what has been built and what has been synced differ between a Build and the Sync after it. While nothing is written down the pack is not looked at, only the time.
- **Settings → Joining**: "Play first" on or off (on by default), and the window in minutes (5 to 1440, default 30). Read by `api` within half a minute.
- **At the door.** A linked member who may not come in yet is asked where they stand (`data get entity <name> Pos` and `Dimension`, answer read from the console, six seconds at most), then held in the room like anyone who waits there, with the planner's line as a clickable link, repeated every 60 s. Every five seconds `api` looks whether they have pressed Play since; when they have, they are let out **back to where they stood**, in the dimension they were in ("Mods checked. Welcome back"). Without an answer about the place they go to spawn. After 15 minutes in the room they are disconnected ("Press Play on deepslate.dsw.test and join again.").
- **Why "back to where they stood" was added:** the room is at 0 250 0 and being let out of it means spawn. Without it, everyone who once forgets Play would find themselves at spawn instead of at their base.
- **Not held:** admins; anyone while "Play first" is off; someone being let in by the link they have just clicked (first time in: the next join is the first that is checked); anyone already in the world, whatever is synced meanwhile (item 3). After a restart of `api` only people who are not linked are put in the room.
- **Events:** `JOIN_BLOCKED` ("bramble09 was held in the entrance room: has not pressed Play on the site"), admins only in the event log (migration `0010_join_blocked`); being let in afterwards is a `LINK` row ("pressed Play and was let in, back to where they were"). Stats has "Held at the door", by reason, when there is anything to show.
- **The portal:** Home, `/install` and `/me` say "Ready to join until 10:35" (UK time), or "Press Play before you join…", "…the last time was a while ago", "The pack has changed since you pressed Play…". Admins see no such line.

### What this makes depend on what (for the planner)

- **Joining now depends on the portal.** A report that does not arrive (site down, the PC offline at that moment, more than 20 reports in an hour) means no entry. The installer's rule was "never block on the report"; the install still is not blocked, the join is. The switch in Settings → Joining is the way out, and admins can always join.
- **Installers before 1.3.0 do not say `mode=play`.** Everyone needs the current installer once.
- **A change to a server-only mod changes the pack's version** (the hash is over the whole lock), so after adding TabTPS everyone has to press Play once although nothing changes on their PC.
- **The check is "pressed Play", not "has the mods".** Someone can press Play and then start another profile. What a wrong set of mods does is the mod loader's business: it refuses the connection before the player is in the world.
- **`data get entity` is a guess at this server's wording** until a member has been held once: the patterns are the game's standard answers. If the place is not read, the member goes to spawn, nothing worse.

## The room has a dimension of its own (planner, 2026-09-29; built the same day; appended by the VPS session at the planner's request)

Until 2026-09-29 the room was a bedrock box in the overworld's sky, at 0 250 0, and showed on the map as a grey block over spawn. It is now in a dimension that holds nothing else.

**The datapack**: `modpack/datapacks/deepslate-limbo/` in the repo. Build copies `modpack/datapacks/` to `dist/server/datapacks/`; Sync carries that into `Minecraft/world/datapacks/` on the server (merged, never deleted; the world's folder name is `LEVEL_NAME`, `world` unless set).

| File | Holds |
|---|---|
| `pack.mcmeta` | `pack_format` 48 (Minecraft 1.21.1) |
| `data/deepslate/dimension_type/limbo.json` | not natural, not ultrawarm, skylight, no ceiling, `fixed_time` 18000 (always midnight), `effects` `minecraft:the_end`, no beds, no respawn anchors, no raids, not piglin-safe, no monsters at any light, `min_y` 0, `height` 256, `logical_height` 256, `coordinate_scale` 1, `ambient_light` 0.1, `infiniburn` `#minecraft:infiniburn_overworld` |
| `data/deepslate/dimension/limbo.json` | type `deepslate:limbo`; generator `minecraft:flat` with no layers, biome `minecraft:the_void`, no features, no lakes |

**What needs a restart.** A dimension from a datapack is registered when the server starts; `/reload` does not do it. Sync says so ("restart the server for them to count") and does not restart by itself: the moment is an admin's to choose. On 2026-09-29 the server was asleep with nobody on; after the start the log said "Found new data pack file/deepslate-limbo, loading it automatically" and the dimension was ticking.

**The room**: glass all round, so that the void and the stars are seen; a floor of sea lanterns; one sign with the server's name (Admin → Branding) at 0 65 -3, facing whoever arrives. The same sealed size as before: 11 by 7 by 11, blocks -5 64 -5 to 5 70 5, the inside 9 by 5 by 9. People stand at **0.5 65 0.5**. Chunks -1,-1 to 0,0 of `deepslate:limbo` are force-loaded. Built from Admin → Server → "Build the room" (`limbo.build`), with `execute in deepslate:limbo run …`; it can be pressed again at any time.

**`LIMBO_POS` names the dimension**: `deepslate:limbo 0.5 65 0.5`, where people stand (the floor is the block under it). Without a dimension it is the overworld. `SPAWN_POS` is where people are let out, in the overworld: `0.5 105 0.5`, the world's spawn, tested block by block (104 solid, 105 to 107 air).

| | Command |
|---|---|
| Hold | `tag <player> remove verified`, `gamemode adventure <player>`, `execute in deepslate:limbo run tp <player> 0.5 65 0.5`, the two effects, the line in chat |
| Keeping them in, every 5 s while anyone waits | `execute as @a[tag=!verified] at @s unless dimension deepslate:limbo in deepslate:limbo run tp @s 0.5 65 0.5` and `execute as @a[tag=!verified] at @s if dimension deepslate:limbo unless entity @s[x=-4,y=65,z=-4,dx=8,dy=4,dz=8] run tp @s 0.5 65 0.5` |
| Release | `effect clear`, `gamemode survival`, `execute in minecraft:overworld run tp <player> 0.5 105 0.5`, the greeting, `whitelist add`, `tag <player> add verified`; all but the last two only for someone who is held (`@a[name=<player>,tag=!verified]`) |
| Release of a member held for Play | the same, but `execute in <the dimension they were in> run tp <player> <where they stood>`; spawn if that was not learnt |
| Rejoin while held | they log in where they logged out, in the room; the join is a join like any other and they are held again |

**The old room** at 0 250 0 in the overworld was cleared after the new one had been checked (`limbo.clear`: 528 blocks to air; it had survived the morning's forced stop). `limbo.clear` refuses the room that is in use.

**The map.** BlueMap has three maps, `world`, `world_the_nether`, `world_the_end`, and made none for `deepslate:limbo` (it makes its map files once, at its first start). It shows the players of a map's own world, so whoever waits in the room is on none of them. **Not seen with a player in the room**: nobody has been in it yet.

## The order at the door (2026-09-29, after docs/13 §9)

1. **Known and linked?** Not linked, or no longer in the Discord server: the room, with the link.
2. **Open for them?** An admin, or the site is live, or they have early access. If not: the room, with "Not open yet. You'll be let in when the server goes live." Nothing about Play is looked at.
3. **Play first**, if it is on and they are not an admin: the room, with "Press Play on deepslate.dsw.test to join. That checks your mods are up to date."
4. In.

A member held at 2 or 3 is asked where they stand before they are moved, and is put back there. Every five seconds `api` looks again: the site may have gone live, the flag may have been given, they may have pressed Play. The line in chat changes when the reason does. `JOIN_BLOCKED` carries the reason: `not live`, `no report`, `stale`, `wrong version`.

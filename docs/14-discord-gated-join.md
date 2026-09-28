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
9. **Existing `/onboarding` Minecraft-username step** becomes optional: linked-in-game users skip it. Keep it for people who want to set the username before ever joining.

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

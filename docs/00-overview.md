# 00 · Overview

## What this is

A private website for a friends' modded Minecraft server called **Deepslate Works**. It starts as a mod catalogue and vote, becomes the place people download the one-click installer, and ends up as the control panel for the server: who is online, a live map, and self-service actions like "add me to the whitelist" or "take me home".

The server itself runs on CubeCoders **AMP** (Minecraft Java module) **on Alex's homelab**; the portal runs on the VPS in Docker. Players reach the game through Pangolin; the portal reaches AMP through a WireGuard tunnel confined to Docker (docs/13).

## Who uses it

| Role | Who | What they need |
|---|---|---|
| Admin | Alex (owner) | Everything: invite people, run votes, change the mod list, restart the server, see logs |
| Player | 8 to 20 friends | Log in, vote, install the game in one click, see the map and who's on, do simple things to their own character |

Assume the player has never installed a mod, may be on a laptop from 2017 with 8 GB RAM, and will not read more than two sentences of instructions.

## Product principles

1. **One click, or it doesn't ship.** Anything a player has to do more than once is a button in the app.
2. **Weak PCs are first-class.** The base pack is performance mods first; every optional mod carries a load rating; the installer sizes RAM automatically.
3. **The manifest is the truth.** One `mods.json` drives the catalogue, the vote, the installer and the server files. If they ever disagree, nobody can connect.
4. **Players can't break the server.** Every action they can take is a named operation with validation, permissions and an audit trail. Nobody gets a console.
5. **Boring infrastructure.** One VPS, one compose file, one reverse proxy, Postgres. No Kubernetes, no queues, no microservices.

## Fixed decisions

- **Minecraft 1.21.1 on NeoForge.** This is where Create 6, the TaCZ gun port, Mekanism, Immersive Engineering and the performance mods (Sodium, Lithium) all line up as of Sept 2026. Do not chase a newer Minecraft version; mod support lags.
- **Modrinth is the mod source.** Every mod in the pack must have a Modrinth project with a NeoForge 1.21.1 version. Mods that only exist on CurseForge are out unless the manifest gets an explicit direct-URL entry with a stated reason.
- **Login is Discord first.** The friends already use Discord. Invite-code username/password exists only as a fallback for the one person without Discord.
- **Live map is BlueMap.** It ships as a server-side NeoForge mod, renders a 3D web map with live player positions and needs nothing on the client.

## Phases (detail in 10-roadmap.md)

| Phase | Name | Outcome |
|---|---|---|
| 0 | Foundation | Repo, compose, Caddy, auth, invites, admin can log in on the VPS |
| 1 | Catalogue & vote | Players log in, read about each mod (video + wiki links), vote; admin closes and sees results |
| 2 | Modpack & installer | Manifest lockfile, client installer (Windows one-click; Windows only, decided 2026-09-29), server sync to AMP |
| 3 | Server dashboard | Status, online players, TPS, live map behind login, announcements |
| 4 | Player self-service | Whitelist self, home/teleport, stats, admin actions with audit log |
| 5 | Later | Discord bot bridge, chat relay, scheduled events |

## Out of scope

- Public sign-up. Invite only, forever.
- Hosting the Minecraft server from the app. AMP does that.
- A launcher of our own. We install into the official Minecraft launcher (Windows) or produce a Modrinth pack (everyone else).
- Mobile app. The website must work well on phones, that's enough.

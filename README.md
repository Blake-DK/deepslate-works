# Deepslate Works

A private modded Minecraft server for a group of friends, and the website that runs it.

- **The game:** Minecraft Java 1.21.1 on NeoForge, with Create, guns, quarries, backpacks, waystones, voice chat and a set of boss mods. One permanent world.
- **The site:** [deepslate.dsw.test](https://deepslate.dsw.test). Sign in with Discord, press Play, and you are in. It also shows who is on, a live map, the news and what everybody has been up to.
- **Who it is for:** the people in the group's Discord server. There is no public sign-up.

The server went live on **4 October 2026**.

## Playing

1. Join the group's Discord server (ask Alex for the invite).
2. Go to [deepslate.dsw.test](https://deepslate.dsw.test) and sign in with Discord.
3. Download **Deepslate Works** for Windows and press **Play**. It installs the right mods, sets the game up for your PC and opens the launcher. You need to own Minecraft Java Edition; nothing else.
4. The first time you join you stand in a small glass room with a link in chat. Click it, say yes, and the door opens.

After that it is one button: Play. The app updates the mods by itself when the pack changes.

Your regular Minecraft is not touched. Weak PCs are welcome: the pack is built performance first, and the app measures your PC and sets memory and view distance to suit it.

## What is coming

October and November are plain play: settle in, build a base, meet the bosses with nothing counted. Then the seasons start.

**A season is a month.** It opens on the last Monday of the month at 19:00 UK and runs until the last Monday of the next. Each has a ladder of bosses, a new trial every Friday at 19:00 UK, a zone away from the main world to explore and strip-mine, a scoreboard, and a finale on the last Saturday at 20:00 UK. When it ends, the scoreboard is frozen into the hall of fame, the zone is reset, and the next season opens. **The main world is never reset.** Rewards are trophies, titles and points, so nobody who joins late is left behind.

| Season | Dates | What it is |
|---|---|---|
| **1 · First Blood** | 30 Nov to 28 Dec 2026 | The overworld. Frostmaw, the Ferrous Wroughtnaut, the Warden, the Wither and friends, alone or in pairs. A new zone, the Frontier, with every boss dungeon in fresh ground. Finale: the remastered Ender Dragon, everybody together |
| **2 · The Drowned and the Frozen** | 28 Dec 2026 to 25 Jan 2027 | Oceans and ice. The Leviathan, Scylla, Maledictus and a ghost ship in an ice maze. |
| **3 · Fire and Iron** | 25 Jan to 22 Feb 2027 | The Nether and your factories. Ignis, the Netherite Monstrosity, four new set-piece bosses, and an arena with waves that asks for a real group |
| **4 · The Otherside** | 22 Feb to 29 Mar 2027 | The deep dark and the End. A door under the ancient cities, the Ender Guardian, and a boss rush to close the year |

After that a new season opens on the last Monday of every month. Season names and the mods for Seasons 2 to 4 are working choices: each new mod goes in only after it has been started on the server and tried on a weak PC. The full plan is [docs/32](docs/32-seasons-1-to-4-roadmap.md).

Also on the way:

- **A Season page** on the site and a season line in the app: the ladder, who beat what first, this week's trial, the scoreboard.
- **Season moments in Discord:** "Ignis has awoken", who fell to whom, a post for every new boss and trial.
- **A Hall of Fame at spawn**, filled in at the end of each season.
- **"Take me to spawn" and "unstick me"** buttons on the site, for when the game has you stuck.
- **Backups you can see:** when the last one ran and whether it is whole, on a page of its own.

[ROADMAP.md](ROADMAP.md) has everything that is live, in progress and next.

## How it is put together

| Part | Where | What |
|---|---|---|
| `apps/web` | a VPS, behind Caddy | The site (Next.js). Faces the internet; has no route to the game server |
| `apps/api` | the VPS, inside a WireGuard tunnel | The only code that talks to the game server's control panel (CubeCoders AMP). Every server action is a named, checked and logged operation; nobody gets a shell |
| `packages/modpack`, `modpack/` | the repo | One file, `modpack/mods.json`, says which mods are in. The site, the app and the server all read from it |
| `installer/` | players' PCs | Deepslate Works for Windows: installs, updates and starts the game |
| The game server | Alex's homelab | Minecraft under AMP, the live map (BlueMap), backups to a NAS and to S3 |

A picture of the whole thing is in [docs/architecture.mmd](docs/architecture.mmd).

## For whoever is building it

- Start with [docs/00-overview.md](docs/00-overview.md), then the first section of [docs/11-status.md](docs/11-status.md).
- Work lands on the `dev` branch; `main` is what is deployed.
- The review of 4 October 2026 and where each finding stands: [docs/31](docs/31-review-and-bug-list.md). The plan for building Season 1: [docs/34](docs/34-season-1-build-plan.md).

```
pnpm install
pnpm dev                 # the site on :3000
pnpm test                # vitest
pnpm lint && pnpm typecheck
```

Deploys are `deploy/deploy.sh` on the VPS and nothing else; the VPS never builds images. See [docs/09-ops.md](docs/09-ops.md).

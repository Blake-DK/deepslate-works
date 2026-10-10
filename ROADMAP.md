# Deepslate Works · Roadmap

A private modded Minecraft server (1.21.1, NeoForge) for a group of friends, with a portal at **deepslate.dsw.test** that handles voting, installing, joining and running the server. Players sign in with Discord; nobody types a Minecraft username or asks for a whitelist.

Last updated 2026-10-04: the server went live, the first review was done and its main fixes are running, and the plan for Seasons 1 to 4 is set. Detail per feature is in `docs/`; where the build actually is lives in `docs/11-status.md`.

## What's live

### Sign in and access
- Discord login, restricted to members of the group's Discord server. Membership is the invite; leave the server and you lose access.
- Email/password fallback via invite link for anyone without Discord.
- One onboarding question (roughly what your PC is like), and that's now measured by the installer instead of asked.
- Session covers the portal and the live map host.

### Mod catalogue and vote
- Every candidate mod with a Light / Medium / Heavy load rating, a "Suggested" tag, a one-line description, Modrinth page, wiki and video links. All 170+ links verified.
- Ballot with suggested mods pre-ticked, pick-one groups (guns), server-settings questions (difficulty, PvP, death rule, play times), and a live load estimate that warns weak-PC players.
- Results with per-mod percentages and a per-PC-tier breakdown; Heavy mods need a weak-PC majority.
- Apply results writes the winning set into `mods.json` and commits it.
- Building and decoration section (2026-09-30): Create Deco, Copycats+, Macaw's roofs, windows and doors, and Handcrafted suggested and on; eleven more votable (more Macaw's mods, Another Furniture, Supplementaries, Rechiseled).

### Modpack pipeline
- `mods.json` is the single source of truth; a lockfile pins exact Modrinth versions and hashes.
- Lock, Build and Sync from the admin UI: the server's mod set is rsynced to the AMP host over a WireGuard tunnel and the server restarted, with streamed logs.
- Settings files ship with the pack to the server and every PC, and count towards the pack version. Two so far: trees fall without an axe (FallingTree), and explosive ammo breaks no blocks (TaCZ).
- The recommended mods (Create, Crafts & Additions, VeinMiner, backpacks, the quarry, TaCZ, Waystones, Farmer's Delight, Pipez) are on while the vote stays open: 30 of 40 mods, pack `0.1.0+1a48e8ff`. Started once with all of them: 16 s, no errors.
- Downloads are never public: admins always, players only while the server is running or asleep.

### Windows installer
- One zip, double-click `Setup.bat`. Signs in with Discord, downloads Java 21 if needed, installs NeoForge, pulls the mods, writes a separate "Deepslate Works" launcher profile sized to the PC's RAM, adds the server to the server list. Vanilla stays untouched.
- Re-running updates only what changed and says "already up to date" otherwise.
- Refuses to run while the Minecraft Launcher is open (it would overwrite the profile), and verifies the profile after writing it.
- Sends an install report to the portal at the end of every run: outcome, failed step, full log, OS, CPU, RAM, GPU, disk, launcher and Java versions. Usernames and paths are redacted.
- Java 21 comes from the launcher's own runtime, then PATH, then a Temurin download into the pack's folder; an old Java on PATH no longer stops the install (1.4.1).

### Joining the server ("the white room")
- Whitelist is off. A first-time player lands in a sealed glass room floating in its own void dimension (`deepslate:limbo`, a small datapack) with one clickable link in chat. It never shows on the map.
- The link does the Discord login and binds their Minecraft account to their portal account. They're released to spawn and whitelisted. No usernames typed anywhere.
- Leaving the Discord server puts you back in the room on your next join. Admins can revoke from the portal.
- Play first: members join only after pressing Play on the site (30-minute window), so their mods always match the server. Admins are exempt.
- Early access: before the site goes live, admins can flag single members who then download, press Play and join exactly as a normal player would. Everyone else waits in the room with "Not open yet".
- Proven end to end on 2026-09-29: an early-access friend installed on his own PC, joined, waited in the room, linked on the site and was let in, without asking anyone.

### Server dashboard
- Home: online / asleep / offline, who's on with heads, TPS, memory, uptime, 24-hour player sparkline, news, embedded live map.
- Full-screen BlueMap behind the portal login.
- Players page, per-player page (play time, sessions, deaths, advancements, link state, hardware from their install report).
- Admin → Server: start, stop, planned restart with in-game countdown, console tail, announcements with an optional picture, backup now.
- Pre-generation as a mode: off, "when nobody's online" (pauses the moment someone joins, optional time window and hour cap) or "now". The portal turns AMP's sleep off while it runs and restores it after. The same card renders the BlueMap area afterwards (generate, render, or both) and has "Delete the map and render it again". The render pauses when someone joins, or with "now" while the server is slow for them.
- Play from the site: the Play button launches the game through a `deepslate://` handler after checking for pack updates.

### Analytics, events, files, branding
- Stats: sessions, unique and new players, play time, bounce rate, session length, peak concurrent, availability, sessions chart, countries with map view, most active players, hour-of-day heatmap.
- Event log: joins, leaves, deaths, chat, advancements, server start/stop/crash, warnings, admin and player actions, links, syncs, installs. Filters, live tail, CSV export. Players see a trimmed version.
- Download log in the same place: who fetched the installer, the pack's settings or the mod list, from the site or from the installer, and who was refused and why.
- Read-only file explorer over the server directory with previews and single-file downloads; world data blocked. Configs are changed in the repo and shipped by Sync, never edited live.
- Branding: server name, logo, banner, accent colour, rules page and Discord link editable by admins with a live preview, no redeploy.
- Settings: geo lookup, chat logging, retention, download caps, "We're live", Play first.
- Admin lists (Players, Installs, Invites) are fixed-column tables with a per-row menu; cards below 800 px.

### The site's look (docs/23)
- One dark theme, the launcher's: the deepslate ground, the pixel banner with the name, a Copper line, a tab strip in place of the sidebar, cards on the ground, a bevelled green Play block and a Copper Vote block. All four steps are live (2026-10-03): the tokens and parts, the frame, Home and Votes, and a pass over every other page. Tests keep colours in one file, the pixel face in its four places and every text pair at 4.5:1. Looked at by eye at 1360 and 390 px: still Alex's.

### Infrastructure
- Portal on the VPS (Next.js frontend, Fastify API), AMP and the Minecraft server on the homelab, joined by a WireGuard tunnel confined to Docker so the internet-facing app has no route home. Players reach the game by a direct port forward to mc-router on the homelab, which routes `mc.dsw.test`, `boys.dsw.test` and `vanilla.dsw.test` to their servers on one port.
- The AMP instance is unmanaged (its own users), so it is opened directly at its LAN address rather than through the AMP panel.
- The API is the only thing that talks to AMP, through a least-privilege AMP user that can start, stop, restart, read the console, read files, take and list backups and flip the sleep setting, nothing else. End-process (kill) exists for admins only while the server is stuck in "Stopping".
- Images built by GitHub Actions and pulled by the VPS; the VPS never builds. Memory limits, swap and earlyoom after one OOM incident.

## Since going live (4 October 2026)

- **"We're live" was pressed on 2026-10-04.** The world is the old seed with ±3,072 blocks around spawn made again for the Season 1 pack; spawn is at 107 126 87 and is an adventure-mode claim. Every new player gets a starter kit.
- **Deepslate Works 3.5.1** is the app the site hands out: the launcher's look, a Settings tab (memory, graphics, the villager skins), logs sent to Alex on request.
- **A review of everything** (docs/31, 65 findings) and its fixes, all running since the same day:
  - the site hands out the pack the server runs, and says so in its health;
  - the entrance room remembers who it holds and where they stood, across leaves and restarts; Admin shows who is in it and why, with Release;
  - a link from the room asks "Link <name> to <you>?" before it links; leaving the Discord server ends access for good; "Remove and block";
  - deploys run the commit's own images, check the api and take a dump before a migration; logs are capped; the tunnel's images are pinned;
  - the database dump leaves the VPS every night, and one has been restored as a test.
- **A health watch**: every ten minutes the portal looks at the database dump, its copy on the AMP host, the newest world backup, the pack on the site against the server's, and the last wake. What goes wrong is posted to the admin channel in Discord and shown in Admin → Overview.
- **Activity** shows everything first with chips to narrow it, and says what was written from Discord into the game.

## In progress

- **Season 1's build** (docs/34): built and waiting for a deploy: the season file and its datapack, the recording of boss kills and trials, the Season page with its scoreboard, Admin → Seasons (announce, start, end), the season's posts in Discord, the Frontier's dimension as a datapack. Still to build: the way into the Frontier (waystones, pre-generation, its map), the app's banner, the wipe at the season's end, the guide's Season section. The rehearsal on the real server is Monday 23 November.
- **The Lock night** (docs/31, PR E): the two Sophisticated mods to their fixed versions, NeoForge pinned. One quiet evening, after a backup.
- **Backups** (docs/28): the portal's own backup runs and the Admin → Backups page are on a branch; a world restore from the NAS and from S3 has not been tried yet.
- **Waiting on a person**: a weak PC in a Cataclysm dungeon (it decides whether Cataclysm's bosses count in Season 1); why the first wake after a deploy failed on 4 October (AMP's log); an outside monitor on `/api/health`.
- **Deferred from the review until Season 1 is built**: the launcher's batch (a failed download retried, "Ready" going stale, a safer self-update), the Discord feed surviving a restart without repeats, a test database in CI.
- **Admin assistant** (docs/19): not begun.
- **Bedrock** through NetherNet: forwards set, an outside join not yet tested.

## Next

### Seasons 1 to 4 (30 Nov 2026 to 29 Mar 2027), and one every month after

A season is a month: it opens at 19:00 UK on the last Monday of a month and ends on the last Monday of the next (Alex, 2026-10-04). A boss ladder, a trial every Friday at 19:00 UK, a zone off the main world that is reset at the end, a finale on the last Saturday at 20:00 UK. The main world is never reset. Rewards are trophies, titles and points.

| Season | Dates | Theme | Bosses | New in the pack | The zone |
|---|---|---|---|---|---|
| 1 · First Blood | 30 Nov to 28 Dec 2026 | The overworld; alone or in pairs | Elder Guardian, Frostmaw, Ferrous Wroughtnaut, Umvuthi, the Warden, the Wither, Cataclysm's lesser guardians; finale: the remastered Ender Dragon | nothing | The Frontier: a second overworld with every boss dungeon in fresh ground |
| 2 · The Drowned and the Frozen | 28 Dec 2026 to 25 Jan 2027 | Oceans and ice; two or three per boss | The Sculptor, Captain Cornelia, the Ancient Remnant, Scylla, Maledictus; finale: the Leviathan | Aquamirae | The Frozen Frontier, on a coast |
| 3 · Fire and Iron | 25 Jan to 22 Feb 2027 | The Nether and the factories; a group | The Night Lich, the Harbinger, the Nether Gauntlet, the Netherite Monstrosity; finale: Ignis | Bosses of Mass Destruction | The Furnace: a second Nether, with an arena of waves |
| 4 · The Otherside | 22 Feb to 29 Mar 2027 | The deep dark and the End; the hardest fights | Three Wardens in a night, the Stalker, the Ender Guardian; finale: the Rush (Wither, Ender Guardian, Dragon in 45 minutes) | Deeper and Darker | The Otherside, the mod's own dimension |

- **Every season:** a Season page with the ladder, the trials, the scoreboard and a goal everybody adds to; a line in the app; posts in season-updates for the season, each boss and each trial; "has awoken" and "has fallen" in game chat and Discord.
- **What stays on the main world:** trophies, titles, the Hall of Fame at spawn (one alcove per season, the top three as heads), and the old zone's map.
- **What leaves a zone:** whatever you carry. Builds, chests, beds and corpses left there are lost at the reset, said plainly a week before.
- **Each new mod** goes in only after the server has started with it and a weak PC has stood in its content. If it fails, the season runs on what the pack already has.
- The plan in full: `docs/32-seasons-1-to-4-roadmap.md`. The mechanism: `docs/20-seasons-bosses-trials.md`. How Season 1 is being built: `docs/34-season-1-build-plan.md`.

### Around the seasons

- **Backups you can see and trust** (docs/28): four runs a day by the portal, a page that says whether the last one is whole and where it is, and a restore that has been tried.
- **Alerts beyond the portal**: an outside monitor on the site's health, so the portal being down is noticed too.
- **The launcher's next release**: a failed download tried again with a plain message, Play that never starts an out-of-date pack, an update that can always be taken back.
- **Tests against a real database** in CI, after the Activity page showed nothing for four days and no test saw it.

### Phase 4 · player self-service
- `/me` quick actions: take me to spawn, take me home, set home, where am I, unstick me. Each rate-limited and audited. The action registry is there; it has no player actions yet.
- Whitelist self-service is already covered by the white room; this phase adds the in-game conveniences via a homes mod or equivalent on the server (FTB Essentials was the first idea and is not in the catalogue).
- Admin action log with per-action enable/disable and rate-limit editing.

### Discord, what is left
- Built and running: server status, joins, leaves and deaths in #game-chat, chat both ways, votes with buttons, slash commands, news and "We're live" in season-updates.
- Still to come: the season moments above, and a scheduled events page (build nights, resets) with reminders.

### Later ideas (not committed)
- Season archive: old worlds kept browsable on BlueMap under a different name.
- Player-visible analytics opt-in per player.
- Mod update notifications when a locked mod has a newer Modrinth release.

## Principles (unchanged since day one)
1. One click, or it doesn't ship.
2. Weak PCs are first-class.
3. The manifest is the truth.
4. Players can't break the server.
5. Boring infrastructure.

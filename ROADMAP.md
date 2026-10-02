# Deepslate Works · Roadmap

A private modded Minecraft server (1.21.1, NeoForge) for a group of friends, with a portal at **deepslate.dsw.test** that handles voting, installing, joining and running the server. Players sign in with Discord; nobody types a Minecraft username or asks for a whitelist.

Last updated 2026-09-29, 19:00 UTC: the first friend is in, and the recommended mods are on. Detail per feature is in `docs/`; where the build actually is lives in `docs/11-status.md`.

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

### Infrastructure
- Portal on the VPS (Next.js frontend, Fastify API), AMP and the Minecraft server on the homelab, joined by a WireGuard tunnel confined to Docker so the internet-facing app has no route home. Players reach the game by a direct port forward to mc-router on the homelab, which routes `mc.dsw.test`, `boys.dsw.test` and `vanilla.dsw.test` to their servers on one port.
- The AMP instance is unmanaged (its own users), so it is opened directly at its LAN address rather than through the AMP panel.
- The API is the only thing that talks to AMP, through a least-privilege AMP user that can start, stop, restart, read the console, read files, take and list backups and flip the sleep setting, nothing else. End-process (kill) exists for admins only while the server is stuck in "Stopping".
- Images built by GitHub Actions and pulled by the VPS; the VPS never builds. Memory limits, swap and earlyoom after one OOM incident.

## In progress

- **Specified by the planner on the evening of 2026-09-29, not started**: Better Tab Info in the base pack (ping per player and TPS in Tab, where TabTPS could not go); installer version on every report with an "outdated" badge and a nudge on the Me page; full logs on every run plus the previous game session's log and crash reports; the white room prompt repeated every 15 s with an on-screen title and a short join code usable at deepslate.dsw.test/join from a phone.
- **Admin assistant** (docs/19): a read-only chat in Admin that can look at status, console, events, reports and container health and explain what went wrong. Needs an API key; never acts.
- **The launcher's look** (docs/21): the Windows app goes dark with a pixel banner of spawn, a pixel display face and blocky Play and Vote buttons, everything drawn fresh in `branding/launcher/`. Not begun.
- **The map**: deleted on 2026-09-29 evening to be rendered clean from Admin → Server ("Render the map only"), about an hour.
- **Waiting on a person**: Play first with a friend who is not an admin; the mods tried in the game (guns, quarry, vein mining, trees by hand); a five-minute planned restart watched through; whether someone who has just linked should also be held for Play first.
- **Vote close**: apply results, lock, build, sync, flip "We're live".
- **Bedrock** through NetherNet (TCP 19132 + UDP 19134–19153): forwards set, external join not yet tested.
- **World terrain**: spawn's 1500 blocks were pre-generated before Create, Farmer's Delight and the rest went on, so their ores and crops only appear beyond that. One more reset after the vote closes is the clean fix.

## Next

### Phase 4 · player self-service
- `/me` quick actions: take me to spawn, take me home, set home, where am I, unstick me. Each rate-limited and audited. The action registry is there; it has no player actions yet.
- Whitelist self-service is already covered by the white room; this phase adds the in-game conveniences via a homes mod or equivalent on the server (FTB Essentials was the first idea and is not in the catalogue).
- Admin action log with per-action enable/disable and rate-limit editing.

### Phase 5 · Discord bridge
- Bot posts server status, joins and leaves to a channel; two-way chat relay.
- `/whitelist`-style slash commands for admins.
- Scheduled events page (build nights, resets) with Discord reminders.

### Later ideas (not committed)
- Season archive: old worlds kept browsable on BlueMap under a different name.
- Player-visible analytics opt-in per player.
- Mod update notifications when a locked mod has a newer Modrinth release.
- Automated world backups to off-site storage with restore from the portal.

## Principles (unchanged since day one)
1. One click, or it doesn't ship.
2. Weak PCs are first-class.
3. The manifest is the truth.
4. Players can't break the server.
5. Boring infrastructure.

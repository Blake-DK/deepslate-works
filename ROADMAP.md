# Deepslate Works · Roadmap

A private modded Minecraft server (1.21.1, NeoForge) for a group of friends, with a portal at **deepslate.dsw.test** that handles voting, installing, joining and running the server. Players sign in with Discord; nobody types a Minecraft username or asks for a whitelist.

Last updated 2026-09-29. Detail per feature is in `docs/`; where the build actually is lives in `docs/11-status.md`.

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

### Modpack pipeline
- `mods.json` is the single source of truth; a lockfile pins exact Modrinth versions and hashes.
- Lock, Build and Sync from the admin UI: the server's mod set is rsynced to the AMP host over a WireGuard tunnel and the server restarted, with streamed logs.
- Downloads are never public: admins always, players only while the server is running or asleep.

### Windows installer
- One zip, double-click `Setup.bat`. Signs in with Discord, downloads Java 21 if needed, installs NeoForge, pulls the mods, writes a separate "Deepslate Works" launcher profile sized to the PC's RAM, adds the server to the server list. Vanilla stays untouched.
- Re-running updates only what changed and says "already up to date" otherwise.
- Refuses to run while the Minecraft Launcher is open (it would overwrite the profile), and verifies the profile after writing it.
- Sends an install report to the portal at the end of every run: outcome, failed step, full log, OS, CPU, RAM, GPU, disk, launcher and Java versions. Usernames and paths are redacted.

### Joining the server ("the white room")
- Whitelist is off. A first-time player lands in a sealed room with one clickable link in chat.
- The link does the Discord login and binds their Minecraft account to their portal account. They're released to spawn and whitelisted. No usernames typed anywhere.
- Leaving the Discord server puts you back in the room on your next join. Admins can revoke from the portal.

### Server dashboard
- Home: online / asleep / offline, who's on with heads, TPS, memory, uptime, 24-hour player sparkline, news, embedded live map.
- Full-screen BlueMap behind the portal login.
- Players page, per-player page (play time, sessions, deaths, advancements, link state, hardware from their install report).
- Admin → Server: start, stop, planned restart with in-game countdown, console tail, announcements.

### Analytics, events, files, branding
- Stats: sessions, unique and new players, play time, bounce rate, session length, peak concurrent, availability, sessions chart, countries with map view, most active players, hour-of-day heatmap.
- Event log: joins, leaves, deaths, chat, advancements, server start/stop/crash, warnings, admin and player actions, links, syncs. Filters, live tail, CSV export. Players see a trimmed version.
- Read-only file explorer over the server directory with previews and single-file downloads; world data blocked. Configs are changed in the repo and shipped by Sync, never edited live.
- Branding: server name, logo, banner, accent colour, rules page and Discord link editable by admins with a live preview, no redeploy.
- Settings: geo lookup, chat logging, retention, download caps.

### Infrastructure
- Portal on the VPS (Next.js frontend, Fastify API), AMP and the Minecraft server on the homelab, joined by a WireGuard tunnel confined to Docker so the internet-facing app has no route home. Players reach the game through Pangolin, separately.
- The API is the only thing that talks to AMP, through a least-privilege AMP user that can start, stop, restart, read the console and read files, nothing else.
- Images built by GitHub Actions and pulled by the VPS; the VPS never builds. Memory limits, swap and earlyoom after one OOM incident.

## In progress

- **Play from the site**: a Play button on the portal that launches the game through a `deepslate://` handler, checking for pack updates first. Shows "update available" against your last launch.
- **Windows only**: `.mrpack` and Mac/Linux paths being removed.
- **Vote close → first real join**: apply results, lock, build, sync, start the server, first Windows test join through the white room.
- **AMP backups** from the portal once the AMP user gets the backup permission.

## Next

### Phase 4 · player self-service
- `/me` quick actions: take me to spawn, take me home, set home, where am I, unstick me. Each rate-limited and audited.
- Whitelist self-service is already covered by the white room; this phase adds the in-game conveniences via FTB Essentials or equivalent on the server.
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

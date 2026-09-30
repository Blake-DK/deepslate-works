# 05 · Features by phase

Pages are listed per phase. Every page must work on a 390px phone. What is built is described as it is; what is not yet built says so.

## Every page (2026-09-29)

| Page | For | What | Described in |
|---|---|---|---|
| `/login`, `/join/<code>`, `/join/<code>/email` | anyone | sign in; an invite for the one without Discord | docs/04 |
| `/onboarding` | a new member | one question: what is your PC like | docs/04 |
| `/` | members | Home: the server, who is on, news, the map, Play. Before the site is live and without early access: a launch page | below, Phase 3 |
| `/guide` | members | how to get in, where things are, what each mod that is switched on is for | docs/18 |
| `/mods`, `/vote`, `/vote/results` | members | the catalogue, the ballot, the results | below, Phase 1 |
| `/install` | members | the installer, the three steps, Play | below, Phase 2; docs/07 |
| `/map` | members | BlueMap, full screen | below |
| `/players`, `/players/<uuid>` | members | everyone; one player's play time, sessions, advancements, connection, and for admins their PC, last install and addresses | docs/16 |
| `/analytics` ("Stats") | members | sessions, players, play time, countries, hours of the day, connection | docs/16 §2 |
| `/events` | members | who came and went, deaths, advancements, when the server was up | docs/16 §4 |
| `/rules` | members | the rules, as written on Admin → Branding | docs/16 §5 |
| `/me` | members | one's Minecraft account, connection, PC, and (Phase 4) quick actions | below, Phase 4 |
| `/link/<code>` | members | binds the Minecraft account that was shown this link in the entrance room | docs/14 |
| `/launcher/<code>` | members | approves a sign-in of the installer | docs/07 |
| `/admin` | admins | numbers and what happened lately | |
| `/admin/votes`, `/admin/vote/results/apply` | admins | votes; applying a result to the mod list | below, Phase 1 |
| `/admin/modpack` | admins | the mod list, Lock, Build, Sync | below, Phase 2; docs/06 |
| `/admin/server` | admins | start, stop, planned restart, backups, pre-generation and map render, the entrance room, news, console | below, Phase 3 |
| `/admin/events` | admins | the whole event log, filters, live, CSV | docs/16 §4 |
| `/admin/installs`, `/admin/installs/<id>` | admins | every run of the installer, with its log | docs/07 "Install reports" |
| `/admin/files` | admins | the server's files, read only | docs/16 §3 |
| `/admin/branding` | admins | name, logo, banner, colour, rules, guide, Discord link | docs/16 §5 |
| `/admin/invites`, `/admin/users` ("Players") | admins | invites; members, roles, early access, the Minecraft link | below |
| `/admin/settings` | admins | "We're live", joining (Play first), privacy, how long things are kept, the file browser | docs/16 §6, docs/14 |

Not pages but served to members: `/downloads/installer.zip`, `/downloads/config.zip`, `/branding/<file>`, `/news-image/<file>`.

## Joining the server (docs/14, docs/13 §9; built 2026-09-28 and 29)

The whitelist is off. Whoever joins and is not known to the portal is put into the **entrance room**, a sealed room of glass in a dimension of its own (`deepslate:limbo`, a datapack that ships with the pack; env `LIMBO_POS`, default `deepslate:limbo 0.5 65 0.5`), and shown one link in chat. Opening it, signed in, binds the Minecraft account to the member, and they are let in where they would have spawned.

At the door, in this order: is the site open for them (live, or early access, or admin), else "Not open yet. You'll be let in when the server goes live."; has their last run of Play gone through within the window (30 minutes) and with the pack the server runs, else "Press Play on deepslate.dsw.test to join". Admins are never held. Whoever is held is asked where they stood first and put back there when let in. **Somebody who has just linked is let in without the second question** (2026-09-29; to be decided).

## Phase 1 · Catalogue and vote

### `/mods` Catalogue
- Sections: Base pack (locked, always on), then categories in the order Factories & power, Mining & drilling, Guns & combat, Quality of life & world.
- Card per mod: name, one-sentence description, load chip (Light / Medium / Heavy), "Suggested" chip if `recommended`, side note (client & server / server only), and three links: **Mod page** (Modrinth), **Wiki**, **Videos**.
- Videos: `mods.json` holds up to 3 real YouTube URLs per mod (`videos[]`). The building session must find them: search YouTube for `"<mod name> minecraft 1.21 showcase"` / `guide`, prefer videos under 15 minutes from the last 18 months, record the URL and title. Render as thumbnails via `https://i.ytimg.com/vi/<id>/hqdefault.jpg` linking out; do not embed players (weak PCs, and privacy). If none found, render a "Search videos" link to YouTube search and leave a TODO in the manifest.
- Wiki: `wiki` URL from the manifest. Known official wikis: Create `https://createmod.net/wiki`, Mekanism `https://wiki.aidancbrady.com/wiki/Mekanism`, Applied Energistics 2 `https://guide.appliedenergistics.org/`, Immersive Engineering and Industrial Foregoing on the FTB wiki (`ftb.fandom.com`). Everything else: the Modrinth page. Verify each URL returns 200 during the build.
- A legend explaining the load chips and a "Will my PC run it?" panel that highlights the row matching the logged-in user's `pcTier`.

### `/vote` Ballot
- Only visible while a vote is OPEN. Same cards as the catalogue with a checkbox (or radio for `exclusiveGroup`, e.g. guns: pick one).
- Suggested mods pre-ticked. Settings questions from the vote (difficulty, death rule, PvP, play times) as radio groups.
- Bottom bar: count picked, load estimate for the selection (sum of Light=1, Medium=3, Heavy=6; ≤6 Light, ≤14 Medium, else Heavy) with a warning if Heavy and the user's tier is LOW.
- Submit saves the ballot; can be edited until the vote closes. Show "Saved" and the closing date.

### `/vote/results` (admin while open, everyone once closed)
- Per mod: yes count, percentage, broken down by PC tier so the "heavy mods need weak-PC support" rule is visible.
- Per question: counts.
- Admin: **Close vote** freezes `resultJson`; **Apply results** flips `enabled` in `mods.json` for every mod above the threshold (default 50% of ballots; exclusive groups: the winner) and opens a diff to confirm before writing.

### Admin lists (2026-09-29)
Players (`/admin/users`), Installs and Invites are tables with fixed columns: one line for each row, names cut with an ellipsis and whole on hover, the actions in one "…" menu for each row, early access as a switch, cards under 800 px. Detail: docs/11-status.md "Admin lists as tables".

### Admin `/admin/votes`, `/admin/invites`, `/admin/users`
- Minimal tables. Create vote (title, questions JSON editor with sensible default), open/close. Invites as in 04-auth.md. Users: role, mcUsername, tier, last seen, remove.

## Phase 2 · Modpack and installer

### `/install` Join the server
- Detects OS from user agent. Windows: one big **Download installer** button (zip with `Setup.bat` + `install.ps1`) and three steps in plain English: 1) install the normal Minecraft launcher and open it once, 2) download and double-click Setup.bat, 3) open the launcher, pick "Deepslate Works", press Play. Screenshots for each.
- Non-Windows browsers see one line: "Deepslate Works runs on Windows only." (Mac/Linux support dropped 2026-09-29.)
- Shows the current pack version (lockfile hash, short), what changed since the last version, and "Run the installer again to update".
- Server address shown with a copy button, though the installer adds it to the server list automatically.
- **Play** card at the top, and the line "Once installed, use the Play button here to launch. It checks for updates every time." See "Play from the site" below.

### Play from the site (planner spec 2026-09-29; built the same day)
- A **Play** button on Home and on `/install`, a plain link to `deepslate://play`. Windows hands the link to the copy of `install.ps1` that `Setup.bat` left in `%LOCALAPPDATA%\DeepslateWorks\` (docs/07 "Play from the site"), which brings the mods up to date and opens the Minecraft Launcher on the Deepslate Works profile.
- On click the page waits 2.5 s. If it is still visible and focused, and never lost focus in between, nothing on the PC took the link: it shows **"Looks like the launcher isn't set up on this PC"** with the installer download. Losing focus (the browser's "Open Windows PowerShell?" question, the installer's window) counts as the link having been taken.
- Next to the button: the current pack version and "Your last launch: <version> on <date>", from the member's latest install report with outcome ok (from `Setup.bat` or from Play), and an **Update available** chip when the two differ. Home refreshes itself every 10 s, so the chip clears by itself once the run has reported.
- The button is greyed out while downloads are closed (server off, or not launched yet): the installer would be refused the mod list anyway.
- Non-Windows browsers get the one line "Deepslate Works runs on Windows only." in place of the button.
- Firefox only: the link is opened in a hidden frame, because Firefox replaces the page with an error when nothing is registered for a link.

### Admin `/admin/modpack`
- Table from `mods.json`: enabled toggle, load, side, resolved version from the lockfile, and status (OK / not found on Modrinth / no 1.21.1 NeoForge build / dependency missing).
- Buttons: **Lock** (runs `modpack lock`, shows the diff), **Build** (client + server + installer into `dist/`, served by the app under `/downloads/`), **Sync server** (copies into the AMP instance, restarts if the mod set changed, shows the console tail while it does).
- Everything writes to the repo and commits (`chore(modpack): ...`) so the manifest history lives in git.

## Phase 3 · Server dashboard

### `/` Home (after login)
- Status pill (Online / Starting / Offline), player count and names with heads (`https://mc-heads.net/avatar/<uuid>/32`), uptime, TPS with a coloured chip (≥19 good, 15–19 warning, <15 bad), memory used vs allocated.
- Pinned announcement and the last three. A news item may have a picture (2026-09-29): PNG, JPEG or WebP, 3 MB at most, uploaded with the item or added to one later on Admin → Server; kept under `data/news/`, named after its content, shown to signed-in members only (`/news-image/<file>`). No SVG.
- Two optional dates per news item (2026-09-30, Alex), set when posting or later on Admin → Server, entered in UK time: **Pinned until** (pinned until then, an ordinary item by its date after it; nobody has to unpin it) and **Hide from** (members no longer see it from then; admins still do, marked "Hidden since …"). The app works it out on every page view (`lib/news.ts`); there is no timer on the host. "Pin" by hand means pinned until unpinned.
- Big **Open live map** button and a compact embedded map (iframe to `map.<domain>`, lazy-loaded, hidden on LOW tier by default with a "show map" toggle).
- "Last 24 h" sparkline of player count from `ServerSnapshot`.
- **Play** card (once the server is visible to the member): see "Play from the site" under Phase 2.

### The download log (Alex, 2026-09-29: "add a download log on the event system")
- Event kind **Download** (`DOWNLOAD`, migration `0013_download_kind`), admins only, a filter of its own on `/admin/events`.
- Written when somebody fetches from the site: the installer (`/downloads/installer.zip`, with its version and size), the pack's settings (`/downloads/config.zip`), the mod list (`/api/modpack/manifest`, with the pack's version and how many mods it names for a PC). It says who, and whether it was the site or the installer that asked. With the pack's key there is nobody to name and the line says so.
- **Refusals are written too**: "Pabulum was refused the installer: the site is not open yet and they have no early access". Somebody who is not signed in is sent to the sign-in page and not written down.
- The same person fetching the same thing again within two minutes is counted on the line that is there (`count`), not written again.
- **The mods' own files are not in it and cannot be**: they come from Modrinth straight to the player's PC. The mod list is what names them; a run that went through is in the install reports.
- Files an admin takes from the server (Admin → Files, `files.download`) are of this kind too from now on; older ones stay under Admin.

### Admin `/admin/server` · Pre-generation (2026-09-29)
- A mode, off by default: **When nobody's online** (carries on while the server is empty, pauses when anyone joins; optional window of the day, optional hours at most) or **Now** (runs whoever is playing, for so many hours or until 100%; warns about lag). Radius editable (1500), chunks done of the total, percentage, chunky's estimate, Stop and Cancel. Ends by itself at 100%.
- While a mode is due the portal switches AMP's sleep mode off (`MinecraftModule.Limits.SleepMode`) and puts it back afterwards; it needs the permission `Settings.MinecraftModule.Limits.SleepMode` and refuses to start without it.
- **Render the map** (planner, 2026-09-29): what a mode does is *Generate, then render the map* (the default), *Generate only* or *Render the map only*. The render step asks BlueMap to bring the overworld's map up to date inside the radius (`bluemap update world <x> <z> <radius>`), keeps AMP's sleep off like the generating does, asks BlueMap every 30 s where it stands (`bluemap`, `bluemap maps`; the answers are read from the console and kept out of the portal's console page), and ends, sleep restored, when BlueMap has said in two answers running that the map `world` is updated with nothing in hand and nothing waiting. The card shows BlueMap's own figures: the percentage of the task in hand, how many tasks wait, its estimate of the time left.
- The render's pauses: with *When nobody's online*, as soon as anyone joins; with *Now*, while somebody is on **and** the server is slow (TPS under 15, until it is 18 again). A pause is `bluemap stop`. BlueMap remembers "stopped" over a restart of the server, so whatever the portal stops it starts again (`bluemap start`): when the pause is over, when the mode is turned off, or, if the server was not running then, at its next start. With sleep still on (the permission gone) the render carries on until the sleep comes: BlueMap puts its work down by itself when the server stops.
- **Delete the map and render it again** (Alex, 2026-09-29: "delete the old map and start again from the gui, not from here"): a second button on the card, which asks first. It sends `bluemap purge` for the three maps (overworld, Nether, End) when the render step begins; BlueMap then renders each anew by itself, everything that exists, and the step ends as above. The world is not touched. It runs in the mode that is chosen (when nobody's online, or now).
- **Who is on.** The card, the pauses and the ping rounds go by the console's list of players, and after a restart of `api` that list may be short of somebody who joined earlier. `api` compares it with AMP's own list every 20 s and asks the server (`list`) when they differ; the pre-generation counts the larger of the two.
- It never starts the server and never ends its process. Detail and the rules: docs/11-status.md "Pre-generation from the portal".
- **End the process**: on the same page, only while the server is stuck in "Stopping", asks first, in the event log.

### Connection: ping and server speed
(planner spec 2026-09-29; built the same day)

**In the game (since 2026-09-29, evening): Better Tab Info**, client side: Tab shows who's on, everyone's ping and the server's TPS. What follows was true before it.

**In the game: nothing, for now.** TabTPS was to put the server's speed and everyone's ping into the Tab list. **It cannot run on this server**: TabTPS and BlueMap both bring the same text library (`net.kyori.adventure.text.serializer.gson`), Java refuses to load the two, and the server stops before it has started (2026-09-29 10:50 UTC, the first start with it). It is switched off in `mods.json`; its entry stays in the catalogue and says why. What the Tab list shows is the game's own: names and signal bars. For the planner: a Tab-list mod that does not bring that library, or a BlueMap build that hides its copy, would be needed.

**The portal.** While the server is running and somebody is on, `api` asks spark for each player's ping every 15 s, one command for each player (`spark ping --player <name>`; spark has no command that lists everyone), and reads the answer from the console: `[⚡]: Player bramble09 has 116 ms ping.` as this server writes it, `[⚡] Player Bramble09 has 23 ms ping.` as spark's source has it; both are read (`events/parse.ts`; the second was taken from spark's source, `HealthModule.ping`). Nothing is sent to a server that is asleep, starting or empty. The numbers are in `/status` next to each player (`online[].ping`, dropped when 50 s old) and in every `ServerSnapshot` (`pings`, `{"<uuid>": ms}`, migration `0009_snapshot_pings`; `name:<name>` where the UUID is not known). TPS and the rest are read as before.

**Cost.** One line in the server's console and log for each player every 15 s. They are kept out of the portal's console page; AMP's own console shows them.

**Where it shows**

- **Home**: the ping next to each player who is on: green under 80 ms, amber under 150, red from there.
- **A player's page**: while they are on, "Connection" with the ping now, the line of this session and its average; in the list of sessions, each session's average ping.
- **Stats**: "Connection" (the server's speed now, its lowest in the last 24 hours, the worst ping right now and whose) and "Average ping" by player for the period.
- **Me**: "Your connection: 23 ms, server speed 20.0 TPS" while on, and the average of the last 7 days.

**How long it is kept.** With the snapshots: every reading for two days, one in five minutes after that, thirty days in all. A seven-day average is therefore made of fewer readings for the older days.

**Acceptance.** "With one player online, Tab shows TPS/ping/online count in game" cannot be met without TabTPS. "Home shows the same ping within 30 s; the player page shows a ping series after 5 minutes online" need a player on the server. State in docs/11-status.md.

### `/map` Full-screen BlueMap iframe with a back button.

### `/players` Everyone in the group: online state, Minecraft name, last seen, PC tier. Nothing sensitive. Each name leads to `/players/<uuid>` (docs/16).

### Admin `/admin/server`
- Start / Stop / Restart with a confirmation step inside the page (no `confirm()`), scheduled restart in N minutes with an in-game warning countdown (`say` every minute for the last 5).
- Console tail (read-only, last 200 lines, live), announcement composer that also runs `say` in game.
- Backup now, with AMP's own backup tool, and the list of backups with their sizes. Restoring and deleting are done in AMP; the portal can do neither.
- The entrance room: build it (once for each world), and remove somebody from the whitelist by name.

## Phase 4 · Player self-service and actions (not built)

**What is there today.** `/me` shows the member's Minecraft account and whether it is linked, their connection while they are on, their PC (the measured tier, the render distance and memory that go with it), and under "Quick actions" one line: they arrive in Phase 4. The action registry exists (`apps/api/src/actions/registry.ts`, docs/08) and every command the portal sends goes through it, but all its entries are for admins or for the portal itself: **there is no action a player can run.** Whitelisting oneself needs no button: the entrance room does it.

**The plan.**

- **Quick actions** on `/me` (each a button, each with a limit on how often, each with a result line): Take me to spawn, Take me home, Set my home here, Where am I, Unstick me. Each an entry in the registry with the role PLAYER, which the registry does not have yet.
- **My stats**: deaths, play time, blocks mined, from the server's `stats/<uuid>.json` read through AMP's file API; cached 5 min.
- Admin `/admin/actions`: for each action, on or off, and how often. (The log itself is `/admin/events`.)

Server-side mods for this phase: something that has homes (FTB Essentials was named in the first plan and is not in the catalogue). **spark** is in the pack already and is what the pings come from; the server's TPS comes from AMP.

## Phase 5 · Later (not designed yet)
Discord bot: server status in a channel, join/leave messages, chat relay both ways, `/whitelist` slash command. Scheduled events page. Season archive (old maps kept on BlueMap under a different name).

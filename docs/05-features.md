# 05 · Features by phase

Pages are listed per phase. Every page must work on a 390px phone.

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
- Pinned announcement and the last three.
- Big **Open live map** button and a compact embedded map (iframe to `map.<domain>`, lazy-loaded, hidden on LOW tier by default with a "show map" toggle).
- "Last 24 h" sparkline of player count from `ServerSnapshot`.
- **Play** card (once the server is visible to the member): see "Play from the site" under Phase 2.

### `/map` Full-screen BlueMap iframe with a back button.

### `/players` Everyone in the group: online state, Minecraft name, last seen, PC tier. Nothing sensitive.

### Admin `/admin/server`
- Start / Stop / Restart with a confirmation step inside the page (no `confirm()`), scheduled restart in N minutes with an in-game warning countdown (`say` every minute for the last 5).
- Console tail (read-only, last 200 lines, live), announcement composer that also runs `say` in game.
- Backup now (AMP backup API if available, else a scheduled task note).

## Phase 4 · Player self-service and actions

All actions are entries in `src/server/actions/registry.ts` (see 08-api.md). Player-facing page `/me`:

- **Minecraft account**: username, verified UUID, whitelist status with **Add me to the whitelist** (idempotent).
- **Quick actions** (each a button, each rate limited, each with a result line): Take me to spawn, Take me home (`/home` via FTB Essentials on the server), Set my home here, Where am I (returns dimension + coordinates from the console), Kill me (unstuck; confirms in-page).
- **My stats**: deaths, playtime, blocks mined, from the server's `stats/<uuid>.json` read through AMP's file API; cached 5 min.
- **My PC**: tier selector and the recommended render distance / RAM for it.

Admin `/admin/actions`: audit log with filters, per-action enable/disable, rate limit editor.

Server-side mods required for this phase: **FTB Essentials** (homes, tpa, spawn, server-only) and keep **spark** for TPS. Add them to `mods.json` with `side: "server"`.

## Phase 5 · Later (not designed yet)
Discord bot: server status in a channel, join/leave messages, chat relay both ways, `/whitelist` slash command. Scheduled events page. Season archive (old maps kept on BlueMap under a different name).

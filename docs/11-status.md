# 11 · Status and handover

Last updated 2026-09-29 (OOM incident and the deploy change that follows from it: CI builds the images, the VPS only pulls; before that: must-have mods synced, wait room + Discord link flow live in `api`, admin Server page). Read this before touching anything; update it at the end of every session. `docs/10-roadmap.md` stays the plan; this file records where reality is against it.

## Where things are

| Thing | Where |
|---|---|
| Repo (git, branch `main`) | `/home/ladm/Minecraft-site` on vps-01v (the folder Alex gave; the original brief files `00-overview.md`, `markdown`, `deepslate-works-design-docs.zip` stay at its root, the repo copy under `docs/` is canonical) |
| Live site | https://deepslate.dsw.test · map host https://map.deepslate.dsw.test (needs Alex's DNS A record; 401→login redirect works; 502 until BlueMap exists) |
| Compose stack `deepslate` | `/home/ladm/Minecraft-site/deploy/docker-compose.yml` → `deepslate-web`, `deepslate-api` (in the tunnel namespace), `deepslate-wg` (WireGuard, udp 51820), `deepslate-map-relay-inner`/`-outer`, `deepslate-db`, `deepslate-backups` |
| Secrets | `deploy/.env` (mode 600), `deploy/wireguard/wg_confs/wg0.conf` + `vps.key`, `deploy/keys/deploy.key` (all git-ignored; template `deploy/.env.example`, `deploy/wireguard/wg0.conf.example`) |
| Postgres data / dumps | `/root/docker/deepslate/postgres`, `/root/docker/deepslate/backups` (nightly, keep 7) |
| Reverse proxy | blocks `deepslate.dsw.test` and `map.deepslate.dsw.test` in `/root/docker/web-proxy/etc/Caddyfile` (copy in `deploy/Caddyfile.snippet`; the map block uses an explicit reverse_proxy + handle_response because `forward_auth` alone returns the 401 instead of redirecting) |
| Health | `GET /api/health` → `{ok, db, api:{ok,tunnel,amp,rsync}, missingEnv, discord, guildGate}`; `ok` is web's own health, tunnel state is reported not required |

The VPS has no Node, and **it never builds images** (see "OOM incident" below). Checks run in a throwaway container with a memory cap; images come from CI:

```
# checks (typecheck, lint, tests): in a container capped at 1.5 GB, as ladm so nothing ends up owned by root
deploy/check.sh                 # everything;  deploy/check.sh api test  for one package and step

# deploy: the only way (docs/09). Push to main, wait for CI, then:
sudo /home/ladm/Minecraft-site/deploy/deploy.sh

# Caddy reload after editing the Caddyfile
docker exec caddy sh -c 'caddy adapt --config /etc/caddy/Caddyfile --envfile /etc/caddy/caddy.env > /tmp/c.json \
  && wget -qO- --header="Content-Type: application/json" --post-file=/tmp/c.json http://127.0.0.1:2019/load'

# bootstrap invite (before any admin exists, or while Discord is unconfigured)
docker exec deepslate-web node apps/web/scripts/invite.mjs "for Alex" 14
```

Gotchas found the hard way: `CI=1` makes pnpm default to `--frozen-lockfile`; pnpm 10 needs `pnpm.onlyBuiltDependencies` (root `package.json`) for Prisma/esbuild postinstalls; ESLint plugins need the `public-hoist-pattern` lines in `.npmrc`; if you change `.npmrc`, delete `node_modules` before reinstalling.

## First real Windows install (Alex's PC, 2026-09-29)

**What worked:** sign-in, the manifest, Java 21 downloaded, NeoForge 21.1.252 installed, 15 mods in place, a second run changed nothing, the profile was written with 6 GB.

**What failed:** the Minecraft Launcher was open during the install and wrote `launcher_profiles.json` back afterwards. The file was reset to the launcher's two default profiles (dates of 1970); the NeoForge profile and ours were both gone.

**Fix (`installer/install.ps1`, docs/07 "The launcher must be closed"):** the script refuses to run while a launcher is running (checked at the first step, before the NeoForge installer and before the profile is written), reads the profile back after writing it and fails loudly with the log path if it is not there, and offers to open the launcher at the end. It also writes the file without a byte-order mark, which the first version did not; that may have been a second cause of the same symptom and has not been tested separately. `installer.zip` on the site was rebuilt with the fix.

**Since then (installer 1.2.0):** every run ends with an install report (docs/07 "Install reports"), and the PC tier is set from it (docs/07 "The PC tier is measured"). Signing in is now the first step.

**To retest:** the "Windows test checklist" in docs/07. The line that matters most: close the launcher, open it again, the profile is still there.

## Phase 3 · dashboard (2026-09-29, started on the planner's go-ahead; Phase 2's last boxes wait on the vote and Alex's first install)

Built and deployed in this order; docs/16 follows (tables and parsers, then its pages).

- **api**: status poller (`src/status/poller.ts`, 10 s), `ServerSnapshot` writer with thinning, `/status` served from memory, planned restart with the in-game countdown (`src/status/restart.ts`, lines built in the registry: `server.restartWarning`, `server.restartCancelled`), backup endpoints, console entries numbered and streamed (`/console/stream`), `lastSeenAt` stamped on join and leave.
- **web**: Home (status pill, players with heads, TPS chip, memory, uptime, 24 h sparkline, News, map), `/map` (full screen, back button), `/players`, Admin → Server (restart with a warning, call it off, backup, announcement composer with "also say it in game", announcement list, live console). Pages refresh themselves every 10 to 15 s while the tab is visible.
- **"Asleep"** is its own state on the pill. AMP puts the instance to sleep when nobody is on (states 30 and 50) and wakes it on the first connection; the portal says so instead of calling it offline. Downloads follow it since 2026-09-29 (Alex's decision): players can download while the server is running or asleep; starting, stopped or out of reach means no.
- **BlueMap** was already in the manifest (`bluemap`, server side) with `modpack/server/config/bluemap/webserver.conf` at ip `10.77.0.2`, port `8100`, from the 2026-09-29 server build; nothing to change. The map only answers while the Minecraft server runs, so Home and `/map` show it only when the state is online.
- **Backup now** is built but switched off by AMP until `webapp` has `LocalFileBackup.Backup.CreateBackup` (and `LocalFileBackup.Backup.ViewBackupsList` to show the list). The page says so and switches itself on when the permission is there. Alex's to-do 12. (An earlier version of this line named a permission that does not exist.)
- Tests: api 33, web 27, modpack 9.

### docs/16 · foundations (2026-09-29)

- **Tables** (migration `0005_events_sessions_settings`): `Session`, `Event` (with a `count` column for repeated warnings), `Setting` (key/value: `privacy`, `retention`, `files`, `branding`). The 36 `AuditLog` rows were copied into `Event`. **Deviation from docs/16:** the old table is not dropped but renamed to `AuditLog_migrated_20260929`, so the move can be undone; a later migration drops it once the event log has been looked at.
- **Every audit write is now an Event** (`audit()` in `apps/web/src/server/events.ts` and `apps/api/src/audit.ts`): kind `ADMIN_ACTION` / `PLAYER_ACTION`, or `LINK`, `REVOKE`, `SYNC`, `BACKUP`; the action name, parameters and result are in `meta`, the message is a sentence ("Bramble09 planned a restart in 5 minutes").
- **Console parsers** in one file, `apps/api/src/events/parse.ts`, tested against lines taken from the instance's own logs. They accept the log-file shape and AMP's console-entry shape (message in `Contents`, thread and level in `Source`, `Type` "Chat"). Patterns are anchored to the start of the message, so chat cannot pass for a join, a death or a server start. The mod loader's start-up warnings are filtered out.
- **Not yet seen for real: a player joining.** Nobody has joined the server since it was built, so what AMP's console entries look like for a join, chat or death is known from the log format and AMP's documentation, not from a capture. Each console entry is kept with its `source` and `kind` (`GET /console/tail`), so the first real join can be checked against the parsers. The wait room (docs/14) depends on the same join line.
- **Recorder** (`apps/api/src/events/recorder.ts`): one session per visit (the two join lines and the two leave lines are one each), events for join, leave, chat, death, advancement, start, stop, sleep, crash, warnings and errors (repeats within 60 s are one row with a count). Catches up with AMP's player list when the console tail missed something. Sessions left open when api restarts are picked up again.
- **Addresses**: kept on `Session.ip` only, cleared after 30 days; never in the event log (the raw join line is stored with the address replaced). Country from MaxMind's GeoLite2-Country file already on this host (`/root/docker/web-proxy/geoip`, mounted read-only into api); private addresses have no country. Players reach the server through Pangolin, so the address the server sees may be the tunnel's and not the player's; to be checked at the first real join.
- **Retention** once a day: chat 30 days, other events 180 days, admin actions for good, addresses 30 days; each run is an Event.
- **Players page** shows "Last played" from sessions (it showed the last visit to the website).
- Shared code: `apps/web/src/shared/` and `apps/api/src/shared/` hold identical copies of `events.ts` and `settings.ts`; a test fails if they differ.
- Tests: api 66, web 27, modpack 9.

### docs/16 · pages, part 1 (2026-09-29): settings, event log, analytics

- **Admin → Settings** gained Privacy (country lookup, chat logging, analytics visible to players), How long things are kept, and File browser (download cap, preview cap, the never-shown list). Stored in `Setting`, validated by the shared schema; api picks changes up within 30 s.
- **`/admin/events`** and **`/events`**: filters in the URL (kinds, player, from, to, words), "Older" paging, live tail (`/api/events/stream`), rows open to the console line and details for admins, CSV export (`/api/admin/events/export`, formula-safe). Players get joins, leaves, deaths, advancements and server up/down only; the kinds are cut down on the server whatever the URL asks for, and `raw` / `meta` never leave it for a non-admin.
- **`/analytics`** ("Stats" in the menu): period picker (24 h, 7 days, 30 days, all time; default 30 days), ten tiles with the change against the period before, sessions chart with a "players online" view, countries as a table or a world map, busiest hours (7 by 24, UK time), most active players (sortable), who plays together, deaths, and for admins the CSV export of sessions and events.
- **`/players/<uuid>`**: totals, minutes per day, sessions, advancements, their events, link state; addresses for admins only.
- **Deviations from docs/16, deliberate.** (1) The "Uptime %" tile is **Server available**: running or asleep. AMP puts the instance to sleep whenever it is empty, so "running" alone would read as 10 % uptime for a server that was there for everyone all month; the tile's small print gives the running share. (2) Peak concurrent takes the larger of the snapshots' figure and the one worked out from the sessions. (3) A session belongs to a period when it started in it, which is how AMP counts; play time is the whole session.
- **World map data** is generated once from Natural Earth (public domain) into `apps/web/src/lib/geo-data.ts`: land outline and country label points. Nothing is fetched at run time and there are no map tiles.
- All the arithmetic is in `apps/web/src/lib/analytics.ts` and `event-query.ts`, with tests (clock changes, open sessions, the player cut-down). Tests: api 66, web 62, modpack 9.
- **Cannot be checked yet:** the acceptance line "matches AMP's own counts within ±1 session". AMP's Analytics plugin is not readable by `webapp` and nobody has played; compare by eye after the first week of play.

### docs/16 · pages, part 2 (2026-09-29): files and branding

- **Admin → Files** (`/admin/files`): the instance's `Minecraft/` folder through AMP's file manager. Folder tree, breadcrumbs, find in folder, sort, text preview with line numbers and light colouring (2 MB shown, the head of anything larger), download up to 50 MB streamed through api. `whitelist.json`, `ops.json`, `banned-players.json` as tables; `server.properties` as settings against what is expected, differences marked. **Read only**: api calls `GetDirectoryListing` and `GetFileChunk` and nothing else, and a test fails if another file method is ever called. Every path is cleaned and checked against the never-shown list (worlds, `*.dat`, backups, `session.lock`, keys; editable in Settings) before AMP is asked. `world/level.dat` is refused with a plain message. Every download, and every refused one, is an Event.
- **Expected `server.properties`** is a new optional block in `modpack/mods.json` (`server_properties`, the values from docs/15 §4); the message of the day comes from Branding.
- **Admin → Branding** (`/admin/branding`): name, tagline, footer, Discord invite, message for the server list, accent colour for each theme, theme for a first visit, logo, sign-in banner, tab icon, rules. Live preview in both themes with a contrast reading. Stored in `Setting` (`branding`); the pictures are files under `data/branding/` (not in git, mounted into web), named after their content.
- **Uploads**: PNG, WebP or SVG by what the file is (first bytes), 2 MB at most. **SVGs are rebuilt from an allow-list** of drawing elements and attributes (`apps/web/src/lib/svg-sanitize.ts`): scripts, styles, event handlers, `foreignObject`, animation, links, anything pointing outside the file, embedded data, doctype and entities are removed; 16 attack cases in the tests. They are served with `Content-Security-Policy: default-src 'none'; sandbox` as a second fence.
- **Where branding shows**: top bar, page titles, footer, sign-in and invite pages, the rules page (`/rules`, a small Markdown subset rendered as elements, never as HTML), the welcome line in game (`linkTellraw`, name stripped to letters, digits and plain punctuation), and the pack and launcher profile name at the next Build (`PACK_NAME`). The accent is set by a style block in the root layout at request time; only a six-digit hex colour can reach it.
- **Deviation from docs/16, forced.** The message of the day is **not pushed** to the server. AMP writes `server.properties` from its own settings on every start and `webapp` may not change AMP settings (`Core.SetConfig` is refused), so a file written by the portal would be overwritten. Admin → Files shows whether the server matches; the change is made in AMP. To lift this, Alex would have to give `webapp` the right to change that one setting.
- **Not built:** the installer's launcher profile *icon* from branding (the profile icon is one of Minecraft's built-in names, `Furnace`, not a picture).
- Tests: api 83, web 97, modpack 9.

### Install reports and the measured PC tier (2026-09-29)

- Built as docs/07 describes: the installer collects, redacts and sends; the portal redacts again, stores (`InstallReport`, migration `0006_install_reports`), records an `INSTALL` event and sets the member's PC tier from the hardware. Admin → Installs, the admin card on a player's page, one line on `/me`, a line on `/rules`.
- **The PC tier is measured, not asked** (Alex). The onboarding question stays as a first answer until the installer has run.
- **Windows only** (planner commit `8c6670f`, 2026-09-29): the code follows. `modpack build` no longer makes `client.mrpack` and removes one left from an earlier build; `/downloads/client.mrpack` is gone; `/install` shows the Windows steps, and on anything else exactly one line, "Deepslate Works runs on Windows only.", and nothing more (`apps/web/src/lib/platform.ts` is the one place that decides); the "Mac or Linux" row is gone from the PC panel on `/mods`; the build target `client` is refused. Home had no operating-system branch to remove; it gets the same one line in place of the Play button (see "Play from the site").
- Tests: the redaction (names in paths, tokens, mail and network addresses; versions left readable), the cut in the middle, the schema (unknown fields such as a host name are dropped), the tier rules (two adapters, remote-desktop adapters, Intel Arc), the log marks; and in `install.ps1 -SelfTest` the same redaction on the PC side. api 85, web 116, modpack 9; installer self test 27 checks.
- **Acceptance** ("a failed run on a machine without the launcher … no username anywhere"): run end to end from a Linux container against the live site, see the session log. **Not checked there: the OS, RAM and GPU fields**, which come from Windows (`Get-CimInstance`) and are empty on Linux. They need Alex's next run on Windows.

### Play from the site (2026-09-29, planner spec; docs/05 and docs/07 "Play from the site")

- **Installer 1.3.0.** Keeps a copy of itself in `%LOCALAPPDATA%\DeepslateWorks\` and registers `deepslate://` under `HKCU\Software\Classes\deepslate` (step 9, after the profile has been saved and checked). `-Play` runs quietly and opens the launcher; its report says `mode: "play"`.
- **The link is treated as hostile input.** Only `deepslate://play` (with or without a closing slash) is accepted; started from a link the script ignores every other option on its command line. In the self test: 12 other links, all refused. Run by hand under PowerShell on Linux: three bad links refused with exit code 1; a good link with `-Root`, `-DryRun` and `-SelfTest` tacked on ran neither the self test nor touched the folder it was pointed at.
- **Site.** `PlayButton` (`apps/web/src/components/server/play-button.tsx`) on Home and `/install`; the rule for "nothing happened" and for the chip are in `apps/web/src/lib/play.ts`, tested. `InstallReport.mode` (migration `0007_install_report_mode`), "From" column in Admin → Installs, "pressed Play" in the event log.
- **Two things done beyond the spec, both small:** in play mode an open launcher no longer stops the run when the profile is already right (the file is left alone); `Setup.bat` is as strict as before. And a mod file held open by the running game gives "close Minecraft" instead of a bare error.
- **Two old faults found on the way and fixed:** the classic launcher was looked for in `C:\Program Files(x86)` (no space; `$env:ProgramFiles(x86)` inside a string), so on a PC with the classic launcher "open the launcher" fell through to the Store app and `minecraft://`; and `installed.json` recorded the version the script was built with, not the one it installed.
- ~~Known gap: the copy in `%LOCALAPPDATA%` does not update itself~~ Closed the same day on the planner's spec, see "The installer updates itself" below.
- Tests: web 128, api 85, modpack 9; installer self test 32 checks.
- **Acceptance · state.** None of the three lines can be ticked from here; all need a Windows PC and a browser. "Fresh PC → Play shows the install prompt": the rule is tested, the browser behaviour is not. "Installed PC → Play launches within 10 s and a mode=play report appears": the report path is tested end to end from a Linux container (see the session log), the registry, the copy and the launch are not. "After a pack version bump … the chip clears": the comparison is tested; not the run. The lines are in the Windows test checklist in docs/07.

### The installer updates itself (2026-09-29, planner spec; docs/07 "The installer updates itself")

- **Installer 1.4.0.** In `-Play` mode, when the mod list names a newer installer: download `installer.zip` from `/downloads` with the launcher token, check it, replace `install.ps1` and `Setup.bat` next to the running script, start the new script with the same arguments. Step title "Updating the installer 1.3.0 → 1.4.0"; `updatedFrom` and `updateProblem` in the report (migration `0008_install_report_update`).
- **The spec said the mod list already carried the installer's version. It did not.** It does now: `installer: { version, sha256, size }`, from `dist/installer.json`, which the build writes and the portal checks against the zip on disk before passing it on.
- **Never replaced on a mismatch,** and more than the checksum is checked before anything is written: the two files by exact name, the version inside the script, that it parses. The zip is never unpacked. After a refusal the run carries on with the script it has.
- **Decisions taken here, for the planner to overrule:** the address of the zip is not taken from the mod list (the script's own site, `/downloads/installer.zip`, only); a failed update does not fail the run; `Update and Play.bat` and `README.txt` are not replaced (the first may be running); the old script is kept as `install.ps1.bak`; one update per run at most; step 9 never copies an older script over a newer copy.
- **The link rule is unchanged,** as the planner confirmed.
- Tests: installer self test 46 checks (14 new: versions, wrong checksum, no checksum, wrong version inside, unparsable script, missing `Setup.bat`, other paths and spellings, strays in the zip, the report fields); web 132; modpack 12; api 85.
- **Checked from Linux against the live site:** see the session log. **Not checked:** on Windows, under Windows PowerShell 5.1, with the launcher there; the lines are in the Windows test checklist in docs/07. It can only be tried for real when the site has a newer installer than the PC.
- **A PC set up with 1.3.0 needs one fresh download**: 1.3.0 has no update step.

### Player guide (docs/18, 2026-09-29)

- `/guide`, second in the nav. Markdown like the rules page, kept in the branding settings (`branding.guide`), edited in Admin → Branding → "Guide page"; live on the next load. While nobody has saved a text of their own the page shows the guide as it ships (`apps/web/src/lib/guide-default.ts`, generated from the text between the two rules in docs/18), and goes on following it; saving the shipped text unchanged, or an empty box, keeps it that way.
- **Tags** (`apps/web/src/lib/guide.ts`, tested): `<!-- mod: slug -->` on a heading covers the section down to the next heading of the same rank or above; on a list item, that item; in a paragraph, that paragraph. Several names in one tag: all are needed. Every comment is taken out of what is shown.
- **The sign-in page** shows the numbered steps of "Getting in" (three lines), from the admin's text if it has such a section, else from the shipped guide.
- **Where the shipped guide differs from docs/18**, all in tags, not in wording: `falling-tree` is `fallingtree` (its name on Modrinth and in `mods.json`; a test checks that every tag names a mod in the list). The lines about Backpacks, Waystones and VeinMiner, and the two steps of "Your first hour" that need a backpack and a waystone, carry their mods' tags: those mods are votable, so their lines are shown while the mod is switched on and come back by themselves when Apply results switches it on (Apply writes `enabled` into `mods.json`, the guide reads the file again whenever it changes; a test does exactly that, mod by mod). "Home, spawn and getting unstuck" carries `<!-- feature: actions -->` and is hidden: the buttons it describes are Phase 4 and do not exist. Switch: `FEATURES.actions` in `guide.ts`.
- **Acceptance:** "with the current manifest the Create/Electricity/Quarry/Pipes/Guns sections show only for enabled mods" is a test against the real `mods.json` (today: none of the five is enabled, none shows). "Editing the guide in `/admin/branding` is live on the next load": checked on the live site, see the session log.
- For the planner: "Where things are on the site" says M opens the map in game and "Minimap … M opens the big map. Press B to drop a waypoint": those are Xaero's defaults, not checked in game by anyone yet. The VeinMiner key (the grave key) likewise.

### Connection stats (2026-09-29, planner spec; docs/05 "Connection")

- **Superseded the same day: TabTPS is out again, see "World reset" below.** What follows in this section is the record of what was built first. TabTPS 1.3.25 in the pack, server side (`mods.lock.json`: 19 files; nothing else moved). Config shipped with the server files. **The lock's hash changed, so the pack is now `0.1.0+9e578404`** although nothing changed for the players' PCs: everyone sees "Update available" once, and Play finds nothing to download.
- **api**: `PingWatch` (`status/ping.ts`) asks every 15 s while the server runs and somebody is on; the answer is read from the console; `/status` and `ServerSnapshot.pings` carry it. The lines of a round are kept off the portal's console page.
- **web**: Home, a player's page, Stats, Me, as docs/05 lists them. Queries in `apps/web/src/server/ping.ts`, the rules (colours, the line's slots) in `apps/web/src/lib/ping.ts`.
- **Against the spec** (docs/05 has the detail): no words of our own in the Tab list and no ping number next to each player, TabTPS does neither; the command is `pingall`.
- **Not seen yet, by anyone:** what TabTPS really prints on this server. The pattern is taken from its source (`PingCommand.pingMultiple`: ` - <name>: <n>ms`), not from a line out of the console. If the first round with a player on reads nothing, Admin → Server → Console will not show the lines either (they are filtered by the same pattern or not at all): look in AMP's console, and put the line into `apps/api/tests/ping.test.ts`.
- Tests: api 99, web 149, modpack 12.
- **Acceptance · state:** none of the three lines ticked; each needs a player on the server. What is checked: the jar and its config are on the server's disk (synced 2026-09-29 09:42 UTC). **Not checked: that the server starts with it.** The instance was asleep, AMP took the restart without waking it, and this session does not start the server by itself. The next join wakes it; if it does not come up, switch `tabtps` off in `mods.json` (`enabled: false`), Lock, Build, Sync.

### Play first (2026-09-29, planner spec; docs/14 "Play first")

- Built as docs/14 "As built" describes. **On by default**, as the spec has it; Settings → Joining switches it off.
- **Beyond the spec:** a member who is held is put back where they stood when they are let in (the room is far from anyone's base, and being let out of it meant spawn); `api` looks every five seconds whether someone in the room has pressed Play, so nobody has to leave and join again; an idle member in the room is disconnected after 15 minutes with a line about Play.
- **For the planner to weigh** (docs/14 "What this makes depend on what"): joining now depends on the portal receiving a report; installers before 1.3.0 cannot satisfy it; a server-only mod change makes everyone press Play once.
- Tests: the rule (`playGate`), the place patterns, the commands, the event wording, the line on the portal. api 112, web 151.
- **Acceptance · state:** none of the four ticked, each needs a member joining. "Admins never held" is one line of code and Alex is an admin: **Alex cannot test the first three with his own account.** They need a member who is not an admin, or Alex's role set to player for the test (Admin → Users).

### World reset (2026-09-29, planner's note pasted by Alex: "World reset, seed -3899835130120818196 … The current world may go")

| Asked for | Result |
|---|---|
| 0. AMP login as `webapp` through the ADS proxy path | `result: 10`, `success: true`, HTTP 200 in 0.4 s, 318 permissions; `GetStatus` on that session: state 0 (stopped) |
| 1. `world` to `world-backup-20260929`, nothing deleted | The rsync link cannot rename. Copied down (29 files, 16,503,894 bytes), compared by checksum, copied up as `Minecraft/world-backup-20260929/`, compared by checksum again, **then** `world/` emptied. A second copy is on the VPS: `/root/docker/deepslate/backups/world-20260929-before-reset/` (in the nightly backup) |
| 2. Start, watch for "Done" | First start **failed** (TabTPS, below). Second start, without it: `Done (12.394s)` at 10:58:17 UTC |
| 2. Seed | `server.properties`: `level-seed=-3899835130120818196` (it still said `CubeCodersPowered` until the server was started: AMP writes the file at start). `level.dat`: the same. The game, asked `seed`: `Seed: [-3899835130120818196]` |
| 2. New world folder | yes, generated at 10:58 |
| Spawn | **0 105 0** (`level.dat`), in forest |
| 3. White room | built at 0 250 0: 847 + 405 + 81 blocks, five lights, four chunks force-loaded |
| 3. `LIMBO_POS` / `SPAWN_POS` | `LIMBO_POS=0 250 0`, `SPAWN_POS=` (empty). **Not changed, because they already match:** the new spawn is at 0, 0 like the old. Empty `SPAWN_POS` means "spread around 0, 0 on the surface", which puts people on the ground whatever the ground is; `0 105 0` would put everyone on one block at a height nobody has looked at |
| 3. "Test with your own account that a fresh join lands in the room" | **Not done: this session has no Minecraft account.** Alex's to-do 20 |
| 4. Chunky, radius 1500 around spawn | **Stopped at 67.38% (24,069 of 35,721 chunks) on Alex's instruction, 11:46 UTC** ("stop doing the gen of the map"; pre-generation was getting in the way while he is still building). Paused and saved, not cancelled: "carry on" picks it up. Before that it had been interrupted once by AMP's sleep at 27%, which left the server hanging; see "What broke" and "Pre-generation from the portal" |
| 5. Map and news | The old world's map tiles were purged (`world`, `world_the_nether`, `world_the_end`) and BlueMap renders the new world as it is made. The game confirms the planner's words: plains village 203 blocks from spawn, cherry grove 278, forest at spawn. **Screenshot and news item: not done**, held with the rest when Alex stopped the pre-generation. A way to take the picture exists (headless Chromium in a capped container inside the tunnel, straight at BlueMap's own port) |
| 6. Notes | in docs/09: the `webapp` password is in the VPS `.env` only. Uptime Kuma's check for `mc.dsw.test` was red from the ADS restart until 10:58 UTC, and is red whenever the instance sleeps if it tests the game port |

**What broke**

1. **The server did not start with TabTPS** (10:50 UTC, the first start since it was added at 09:42): TabTPS and BlueMap both bring `net.kyori.adventure.text.serializer.gson`. Switched off in `mods.json`, locked, built, synced (10:52); the pack is `0.1.0+47b0b579` again, the same as before TabTPS, so nobody has anything to update. The pings come from spark now (docs/05). **This was the risk named when TabTPS went in unstarted; it should have been started once before anything was built on it.**
2. **The portal had lost AMP and did not know.** ADS was restarted; from then on AMP answered every call of the api's old session with HTTP 200 and "This method requires the Session.Exists permission", which the client took for an answer: state "Unknown" on the site, `amp: ok` in `/api/health`, and the first `start` "succeeded" without starting anything. Until that morning the health check had logged in afresh every 30 s, which hid this; the fix of the repeated welcome took that away. The client now recognises the answer, logs in again and asks once more (`sessionGone`, tested).
3. **`Core.Restart` does not start a stopped or failed instance**, so the sync that removed TabTPS left the server down; it needed `start`.
4. **AMP put the server to sleep in the middle of the pre-generation** (11:16 UTC, 27% done), and again after every wake-up. Worked around with `pregen-loop.sh`.
5. **One of the new console commands was wrong**: `world.standable` sent `execute … run if block …`; `if` belongs to `execute` itself. The game refused it, nothing happened. Corrected.

**What the reset took with it, by design:** everyone's position, inventory, advancements and the `verified` tag (they are in the world). Linked members are let in again on their next join like the first time; the whitelist and the links on the portal are not part of the world and stand. Sessions and events on the portal from before the reset are history of the old world and are kept.

### Pre-generation from the portal (Alex, 2026-09-29)

"I want an option in the GUI to turn on pregen … I want to be able to run it for hours on end, like say in the GUI run for 8 hours, or always run when no one online."

- **Admin → Server → Pre-generation.** Off unless an admin turns it on; nothing starts or continues it otherwise, not a restart of the server, not a deploy. Two ways to turn it on: **for N hours** (a quarter of an hour to 72), or **whenever nobody is on the server, until the area is done**. It waits while somebody is playing unless "also while people are playing" is ticked. What to generate: carry on where it stopped, or a new area (radius up to 10,000 blocks, centre). "Turn off" pauses and saves; "Call the area off" makes chunky forget where it got to.
- **How it runs for hours on a server that AMP puts to sleep** (`PregenKeeper`, `apps/api/src/status/pregen.ts`): in rounds. Generate; pause and `save-all flush` 100 seconds before AMP would stop the server; AMP puts the server to sleep with nothing going on; api wakes it (`Core.Start`); carry on. The first round is 3.5 minutes; from then on the length follows what AMP was seen to do (shortest wait seen, less 100 s, between 2 and 10 minutes). About two thirds of the time is spent generating. The portal cannot change AMP's sleep setting; with sleep switched off in AMP all of the time would be.
- **api starts the server by itself while this is on.** Only from sleep: a server somebody stopped is left stopped. A stop that hangs for four minutes is ended (`Core.Kill`) and the server started again; by then the pre-generation has been paused and saved.
- **Without a plan** the old safeguard holds: a pre-generation somebody started by hand is paused once the server has been empty for three minutes.
- The plan is kept in the Setting `_pregen`, so a deploy does not lose it. Events: "turned the pre-generation on: for 8 hours", "the pre-generation's time is up, at 81%", "the pre-generation is finished".
- Rough cost, measured that day (50 chunks a second, 13 KB a chunk): 1500 blocks = 12 minutes, 0.4 GB; 5000 = 2.2 hours, 5 GB; 10,000 = 8.7 hours, 19 GB. **Nobody has looked at how much disk the AMP host has.**
- Tests: what chunky says, the rounds, a whole night in one test (wake, carry on, pause, sleep, wake; nothing once it is off). api 130, web 159.
- **Not tried on the live server:** it was deployed switched off, because Alex had just asked for the generating to stop. The rounds were done by hand with a script that day and worked (51% to 67% in two rounds); the keeper does the same from inside api.

### docs/16 acceptance · state

- [ ] `/analytics` shows the ten tiles, the chart, countries with the map, most active players for every period, and matches AMP within ±1 session. *Built and rendering; the comparison needs people to have played.*
- [ ] `/players/<uuid>` works for a linked and an unlinked player. *Built; unlinked players are addressed as `name:<name>` until their UUID is seen. Needs a real player.*
- [x] `/admin/files` browses the instance, shows `server.properties` as settings, downloads a `.log`, refuses `world/level.dat`. *Checked on the live instance 2026-09-29: `logs/latest.log` came down whole (23,039 bytes), `world/level.dat` 403 with the message, `../../etc/passwd` 400, a missing file 404, a player 403; all four attempts are in the event log.*
- [ ] `/admin/events` shows a join, a death, a chat line, a restart and an admin action from a test session, live tail working; `/events` hides addresses, raw lines and admin rows. *Admin actions and the cut-down are verified; game events need a real session.*
- [ ] Accent colour and logo changed in `/admin/branding` show on the next page load; the sign-in page shows the banner. *Logo verified on the live site 2026-09-29 with an SVG full of things that should not be there: stored as a clean 248-byte drawing, shown in the top bar and on the sign-in page on the next load, served with the script-forbidding policy, removed again. A file that only claimed to be a PNG and a colour that was not a colour were both refused. Still to do by eye: a real accent change and a banner.*
- [x] Retention prune runs and is logged as an Event. *First run 2026-09-29 07:36 UK time.*

### Phase 3 acceptance · state

- [ ] Home shows Online/Offline within 20 s of a real change, names with heads, TPS and memory. *Built (10 s poll + 10 s page refresh); needs watching through a real start and stop.*
- [ ] The map loads at `map.<domain>` only when logged in; logged out redirects to login and back. *Redirect verified earlier; embedding on Home needs the server running to check.*
- [ ] Admin restart with a 5-minute countdown warns every minute and restarts on time. *Unit-tested with a fake clock; needs one real run.*
- [ ] Console tail streams live for admins; players cannot reach it. *Built; route answers 403 for non-admins.*
- [x] `/api/health` is green. Monitoring (UptimeRobot or similar) still to be set up by Alex.

## OOM incident, 2026-09-29 03:58 UTC

**What happened.** `docker compose -f deploy/docker-compose.yml up -d --build` on the VPS, to ship the wait-room audit fix. The host has 7.7 GB and had no swap. From the kernel's own process table at the moment it ran out: `dockerd` (the built-in BuildKit) 1.9 GB, the `next build` step 0.7 GB, the 41 running containers and host services about 5.1 GB. Image builds sit outside every container memory limit and inherit Docker's protection from the OOM killer (`oom_score_adj -500`), so the kernel killed bystanders instead: the tooling session, an Authentik worker and a user session manager. `authentik-db` had already been killed inside its own 256 MB limit at 03:12. The build itself finished (images stamped 03:58 and 04:00); the box was rebooted at 04:07 and all 41 containers came back by themselves. Every site answered correctly afterwards; `/api/health` was fully green again by 04:20.

**What changed, so it cannot happen the same way again.**

| Layer | Change |
|---|---|
| Deploy | CI builds `web` and `api` and pushes them to GHCR; the compose file has no `build:`; `deploy/deploy.sh` is the only way to deploy (docs/09) |
| tooling on this host | hook `/root/.tooling/hooks/mem-guard.py` refuses image builds outright, refuses `docker run` without `--memory`, refuses to start containers under 700 MB available |
| Builder | default buildx builder is `capped` (2 GB RAM, 3 CPUs, own container), for the day a local build is unavoidable; a test build that tried to take 5 GB was stopped at the cap with the host never below 2 GB available |
| Host | 4 GB swapfile, `vm.swappiness=10`; `earlyoom` (build tools and headless browsers go first; proxy, databases, Docker, SSH are spared) |
| This stack | `mem_limit` web 768m (was 1g), api 512m (was 256m, it now runs `modpack build`), postgres `shared_buffers=128MB` explicit. Applied to the running containers with `docker update`; the compose file carries them from the next deploy |
| `modpack build` | moved out of the `web` process into `api` as a child process: 256 MB heap, first to be killed if the container runs out, no secrets in its environment, output streamed line by line; jar downloads streamed to disk (they were read into memory whole). Peak 75 MB for the current pack |

**First pull-only deploy: 2026-09-29 05:09 UTC.** `deploy/deploy.sh` ran clean. `deepslate-web` and `deepslate-api` run `ghcr.io/blake-dk/deepslate-{web,api}:latest`, image revision `ba5decf` = repo HEAD. Checked afterwards: `/api/health` all green; AMP through api (login, `GetStatus`, players) answers in under 100 ms; `rsync --list-only amp@10.77.0.2:` with the deploy key lists the instance's `Minecraft/` tree and a plain shell is still refused by rrsync; Build through `POST /modpack/build` streams its lines and finishes in about a second with the jars cached (api peak 113 MB of 512); `dist/` belongs to uid 1000, web mounts it read-only. The smoke script's `SetConfig` write probe was not re-run (Alex's to run). AMP reported state 50 (`PreparingForSleep`) at the time: the instance sleeps when empty, which matters for the "downloads only while Running" rule; not changed here.

## Phase 0 · what was built

Matches `docs/10-roadmap.md` Phase 0 "Build" list. Files worth knowing:

- `apps/web/src/auth.config.ts` (edge-safe: Discord provider, cookie, session callback) and `apps/web/src/auth.ts` (full: credentials provider, invite consumption in `signIn`, `jwt` lookup). Discord provider is only registered when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set; the UI says so.
- `apps/web/src/middleware.ts`: only checks "logged in" and redirects to `/login?next=`. Role and onboarding checks read the database per request in `src/server/auth/session.ts` (`requireUser`, `requireOnboardedUser`, `requireAdmin`), so promotions apply without re-login.
- `src/server/auth/users.ts` `createUser`: first user ever, or the `ADMIN_DISCORD_ID` account, becomes ADMIN. Invite is consumed in the same transaction.
- `src/server/auth/invite-codes.ts` (pure, tested), `invites.ts` (db), `rate-limit.ts` (in-memory 10/min per IP for login and registration; Caddy here has no rate_limit module), `can.ts` (permission table from docs/03).
- `src/server/mojang.ts`: username → UUID with a 6 s timeout; onboarding refuses names Mojang doesn't know or that another member already claimed.
- Pages: `/login`, `/join/[code]`, `/join/[code]/email`, `/onboarding`, `/` (home shell), `/admin`, `/admin/invites`, `/admin/users`, and placeholders for `/mods /vote /install /map /players`. Route group `(app)` requires an onboarded user; `(public)` does not.
- API: `/api/auth/[...nextauth]`, `/api/auth/verify` (200/401 for Caddy forward_auth, phase 3), `/api/health`.
- Prisma schema is the full one from docs/03 (Vote, Ballot, Announcement, AuditLog, ServerSnapshot already exist). Migration `0001_init` applied.
- Tests (vitest, 10 passing): permissions, invite codes/state, rate limiter, Minecraft username regex and UUID formatting. CI workflow in `.github/workflows/ci.yml` (repo has no remote yet).
- UI: hand-written primitives in `src/components/ui/` in the shadcn style (same `cn()` and CSS-variable tokens), so `npx shadcn add` can be used later without a rewrite. Dark/light via `data-theme`, remembered in localStorage.

## Deviations from the design docs (deliberate)

1. **Caddy.** docs/02 and docs/09 assume a Caddy of our own. This VPS already has one (stack `web-proxy`) fronting several sites, so the app joins the external `web` network and gets a block in the existing Caddyfile. No second proxy, no published ports. `deploy/Caddyfile.snippet` is the block.
2. **Rate limiting** lives in the app, not Caddy (module not present in `caddy:2-alpine`).
3. **Resolved by docs/13.** AMP is on the homelab; `api` reaches the ADS at `10.77.0.2:8080` through the WireGuard container; no bind mount. Original note: **AMP is not on this VPS.** docs/02 and 09 assume a bind mount of the AMP instance directory. Alex: "the users will access the game server via pangolin, the vps has nothing to do with it, you only speak to amp." So: AMP is reached over Tailscale by HTTP API only; `pangolin-01v` is the players' tunnel and is out of bounds. Phase 2's `sync-server` will therefore need the AMP file API (or SSH/rsync to the AMP host) instead of a bind mount; Phase 4's stats reads likewise. Update docs/02, 06, 09 when the AMP host is known.
4. **Resolved by docs/13:** domain stays `deepslate.dsw.test`, map `map.deepslate.dsw.test`, `COOKIE_DOMAIN=.deepslate.dsw.test` is set. Original note: **Domain** is a placeholder (`deepslate.dsw.test`, wildcard already on this VPS). `COOKIE_DOMAIN` is empty until the map host exists (phase 3), so the session cookie is host-only.
5. **Prisma 6** pinned (`^6`) rather than 7; the classic migrate workflow, boring on purpose.
6. **No Dockhand registration** yet (this VPS's other stacks are managed there). Do it when the stack shape settles, or leave it git-driven.
7. **Location.** The build first went to `/opt/deepslate` (docs/09 layout); Alex wants the project in the folder he supplied, so the whole repo now lives in `/home/ladm/Minecraft-site` (owned by `ladm`) and `/opt/deepslate` no longer exists. Containers were recreated so Compose tracks the new path. Nothing is installed on the host: pnpm, Prisma, the checks and the image build all run in Docker.

## Keys for Alex to ferry to the AMP host session (docs/13 §5)

- VPS WireGuard public key: `IvQftNPCxX4H2jvwV6BYtZCkfkY7l6yb16T5PhP29ic=`
- Deploy key (`deploy.pub`, goes into `amp`'s `authorized_keys` rrsync line): `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIILAQ2zNCWgU8c2W84E7VPGhJtvCtDTm6lZF0sdT+Ueu deploy@portal`
- The AMP host's public key `D/ZFt5fGUd+8tLvS+9TbSZ7ZB0SLwmqPBsBEBjOiNg4=` is already in `wg0.conf`; the tunnel comes up as soon as the homelab side enables `wg-quick@wg0` with our key.

## `apps/api` (added this session, docs/13 §4)

Fastify 5 skeleton in the tunnel namespace: `src/env.ts` (fails fast), `src/auth.ts` (bearer service token, `X-User-*` headers parsed and re-validated), `src/amp/paths.ts` (ADS proxy path builder), `src/amp/client.ts` (`AmpClient` with login + one re-login on 401, `MockAmp` for `AMP_MOCK=1`), `src/health.ts` (tunnel = TCP to `10.77.0.2:22`, amp = login, rsync = ssh with the deploy key must be *refused by rrsync*, not unreachable; cached 30 s), routes `/health` and `/status`. Tests: 4. No Prisma in `api` yet; add it with the poller in Phase 3 (`prisma generate --schema ../web/prisma/schema.prisma` or a `packages/db` workspace). `web` talks to it only through `src/server/api-client.ts`.

## Discord server gate (added on Alex's request)

`DISCORD_GUILD_ID` set → the Discord provider requests `identify guilds`, and every Discord sign-in is refused with "You need to be in the group's Discord server" unless `users/@me/guilds` contains that id. `DISCORD_GUILD_AUTO_JOIN=1` makes membership count as the invite (no link needed for Discord users); default `0` keeps invite links required. Members who leave the server are refused on their next sign-in; existing sessions last until they expire (30 days) unless removed in `/admin/users`.

## AMP smoke test (2026-09-28 night, per planner instructions)

Run from inside `deepslate-api` through the tunnel, `AMP_URL=http://10.77.0.2:8080`, `AMP_INSTANCE_ID` (GUID) and `AMP_PASSWORD` from `deploy/.env` (verified byte-identical inside the container, no shell-special characters).

| Step | Result |
|---|---|
| 1. `Core/Login` as `webapp` **through the instance proxy path** | `result: 10, success: true`, permissions `Instances.<id>.Manage` + settings denials. (First attempt against the ADS's own `/API/Core/Login` gave `result: 0`: `webapp` is instance-local, corrected by Alex.) |
| 2. `Core/GetStatus` | 200, `State: 0` (instance stopped), Metrics `CPU Usage / Memory Usage (max 6144 MB) / Active Users`, Ports (game 25569 not listening) |
| 3. `Core/SetConfig` | **Refused**: "does not have permission to modify setting" (verified by Alex as `webapp` from the AMP host side, 2026-09-28). Smoke test complete. |

Also recorded (read-only): `GetUpdates` shape, `GetUserList` (`{}` while stopped), `FileManagerPlugin.GetDirectoryListing` works, `LocalFileBackupPlugin.GetBackups` and `GetAMPRolePermissions` are `Unauthorized Access` for webapp. Details in docs/08. `AMP_MOCK=0` now: the mock is off, `api` talks to the real instance. **The instance is stopped**, so with Alex's download rule players can't download until it runs; admins still can.

## Server build + wait room (2026-09-29)

Alex: "build the server with the must-have modpacks first and get the wait room working and the discord auth all set up".

- **Server files**: `server.properties` on the instance already matched docs/14 (online-mode on, white-list off, enforce-whitelist off, spawn-protection 0, port 25569 managed by AMP, seed `CubeCodersPowered`), so it is not synced. Shipped `modpack/server/config/bluemap/{core,webserver}.conf` (accept-download, webserver bound to `10.77.0.2:8100`). `eula=true` was already set.
- **api** (`apps/api`, now with Prisma against the shared schema): `amp/console.ts` tails `Core.GetUpdates` (2 s while running, 15 s otherwise) and parses UUID/login/leave/list lines; `actions/registry.ts` holds every console command (`limbo.hold`, `limbo.remind`, `limbo.keep`, `link.release`, `limbo.kickIdle`, `limbo.build`, `player.revoke`, `server.say`, `server.list`) with zod-validated input, `actions/run.ts` sends and audits; `players/limbo.ts` decides on every join (`decideJoin`: release only when the UUID belongs to a user with `verifiedAt` and `guildMember`), holds with a 15-min `LinkCode` (reused while valid), drags held players back every 5 s, reminds every 60 s, kicks after 15 min idle, releases on request from the portal, revokes (kick + unwhitelist), and re-checks guild membership every 5 min **only if `DISCORD_BOT_TOKEN` is set** (otherwise membership is refreshed at each Discord login). Routes: `GET /players`, `POST /link/release`, `POST /player/revoke`, `POST /actions/:name` (admin), `GET /console/tail` (admin), `POST /server/start|stop|restart` (admin).
- **Portal**: `/link/<code>` (login → Discord → guild check → onboarding keeps the return URL) binds the UUID + username from the `LinkCode` to the account (refuses a second UUID per account and a UUID already owned by someone else), marks the code used, asks api to release. Discord sign-in now sets `guildMember` (false when refused, true on success). Admin → Users "Remove" also kicks. New **Admin → Server** page: state, online/held players, Start/Restart/Stop with an in-page confirmation, "Build the room", revoke by name, `say`, console tail (last 120 lines, reload to refresh).
- Env: `LIMBO_POS` (default `0 250 0`), `SPAWN_POS` (empty = `spreadplayers` near 0,0 on the surface), `DISCORD_BOT_TOKEN` (optional), `DATABASE_URL` + `PORTAL_URL` passed to api by compose.
- Tests: api 11 (console parsing incl. a chat line that mimics a join, join decision, action builders and input refusal).
- **Done on the instance (2026-09-29 03:5x UTC):** first real Sync (11 jars + `config/bluemap`), `Core.Start` via api → `Done (1.756s)`, voice chat on 24454, BlueMap downloaded the client jar and bound its webserver to `10.77.0.2:8100`; **https://map.deepslate.dsw.test works behind the login** (anonymous → login redirect). Wait room built at `LIMBO_POS=0 250 0` (`limbo.build`: 847 + 405 + 81 blocks, 5 lights, chunks force-loaded). Spawn area is around 0,0 so `SPAWN_POS` can stay empty (`spreadplayers` near 0,0). Portal link flow exercised with a seeded `LinkCode` (bind, idempotent re-click, expired code, `/me` shows the link).
- **Not yet exercised:** a real player joining (hold → chat link → release). Needs someone to connect to `mc.dsw.test`; watch Admin → Server (held players + console).

### docs/14 acceptance · state

- [ ] A fresh account joins, lands in the room, can't leave, sees the link within 5 s. *Engine live; needs a real join.*
- [ ] Clicking the link with a Discord account in the server releases them to spawn within 5 s and `whitelist.json` gains them. *Portal side verified; release-on-online untested.*
- [ ] A Discord account outside the server is refused and the player stays in the room. *Login refusal verified earlier; room hold untested.*
- [ ] Leaving the Discord server puts the player back in the room next join. *Flag set at login; 5-min re-check needs `DISCORD_BOT_TOKEN`.*
- [ ] api down 2 min then back: nobody unverified escaped. *Tags persist; on restart api holds unknown joins again; no in-game command block yet (docs/14 §4 belt-and-braces not done).*

## Installer sign-in + "Update and Play" (Alex, 2026-09-28)

`LauncherAuth` model (migration `0004_launcher_auth`), `POST /api/launcher/start`, `GET /api/launcher/poll`, `/launcher/<code>` approval page (login required, shows the code and hostname, Yes/No), launcher tokens accepted by the manifest and downloads, "Sign out installer" per user in Admin → Users. Installer: `install.ps1` signs in (token cached a week), `-Play` opens the launcher on the selected profile; `Update and Play.bat` added; `Setup.bat` unchanged. Details in docs/07. Verified end to end with curl (start → approve → poll hands the token out once → manifest 200 with it, 401 with a wrong or revoked one) and a `pwsh` dry run of the stamped script using the token. Still untested on a real Windows PC.

## Launch switch (Alex, 2026-09-28)

`SiteSettings` row (`live`, `launchAt`; migration `0003_site_settings`), edited at **Admin → Settings**. Until `live`:
- players never see the server address (`/install`, `/me`, Home) and `/downloads/*` + the manifest refuse them (`not_live`); Home and Install show a launch banner with the date ("Launching Sat 4 Oct 2026, 19:00, in 6 days" / "to be announced");
- admins see everything, with a note that players see the launch page.
Once live, the earlier rule applies: downloads open while the server is running. The launch date is entered as UK time (`src/lib/uk-time.ts`, tested for BST/GMT). Default: not live, no date.

## docs/14 (Discord-gated join) · what landed now (2026-09-28 late night)

Per Alex's message: the Phase-1 data model bits and the onboarding change are in; the join hook, actions and `/link/<code>` are Phase 4 as scheduled.

- Prisma: `LinkCode` model, `User.verifiedAt`, `User.guildMember` (migration `0002_link_codes`).
- Onboarding is the PC question only. "Onboarded" now means `pcTier` set (`requireOnboardedUser`, nav). Nobody types a Minecraft username; the copy says the link happens in game.
- `/me`: "Linked: <mcUsername>" once linked, otherwise "Join the server to link your Minecraft account" with the address. No input box.
- Mojang lookup kept only as an admin tool: `/admin/users` has a "Link" box per unlinked member (checks with Mojang, sets `verifiedAt`) and "Unlink".
- `.env.example`: `LIMBO_POS`, `SPAWN_POS` placeholders for Phase 4.
- Alex's note on the launcher: the name people were reading is the Microsoft account name in the top left; the Minecraft name is the one to the right of the Play button. Moot now that nobody types it, but relevant for the admin fallback.

## Phase 2 · what was built (2026-09-28 late night)

- `packages/modpack`: `lock` (Modrinth resolution with required deps, newest release else beta with a warning, NeoForge latest 21.1.x from the maven, sha256 pack hash, config hashes, diff vs previous, temp+rename), `build client` (`client.mrpack` with CDN URLs + `overrides/config`), `build server` (`dist/server/mods` downloaded and sha512-checked, stale jars removed, `PACK_VERSION`), `build installer` (`installer.zip` with the manifest URL + pack version stamped into `install.ps1`), `config.zip`. `pnpm modpack <cmd>` in the node container; `MODRINTH_USER_AGENT` needed.
- `installer/`: `Setup.bat`, `README.txt`, `install.ps1` per docs/07 (launcher check, manifest fetch, Java 21 from the launcher runtime / PATH / Temurin download, NeoForge installer with `--install-client` then `--installClient` fallback, separate game dir, sha512-checked mods with stale-jar removal, options.txt per tier, uncompressed-NBT `servers.dat`, RAM by installed memory clamped to the manifest, launcher profile written with a backup, `installed.json`). Dry-run tested under `pwsh` on Linux (`-DryRun -Root <fake>`): all 8 steps pass, nothing written. **Not yet tested on a real Windows PC.**
- Web: `/install` (OS detection, Windows 3 steps / Mac-Linux 2 steps, pack version, copy address, PC hint), `GET /api/modpack/manifest`, `GET /downloads/{installer.zip,client.mrpack,config.zip}`, `/admin/modpack` (table with lock status per mod; Lock / Build / Sync (dry run) / Sync buttons streaming logs over SSE from `POST /api/admin/modpack/<cmd>`; lock commits `mods.lock.json`).
- `api`: `POST /modpack/sync` (admin header + service token): rsync `dist/server/mods/` with `--delete` (dry run first to detect changes), then `config/`, `bluemap/`, `defaultconfigs/` merged, then `Core.Restart` through the ADS proxy if mods changed. `dryRun: true` reports only. Health now reports the deploy key state: `ok` = refused by rrsync (wanted), `unrestricted` = full shell (current), `no_key`, `down`.
- **Download rule (Alex, 2026-09-28):** the manifest and `/downloads/*` are never public. Admins always; players only while the server is online (api `/status` state Running, cached 15 s); the Windows installer authenticates with `MANIFEST_KEY` (`deploy/.env`) stamped into its manifest URL at build time. With `AMP_MOCK=1` the mock reports Running, so players can download now; once the real AMP is wired, an offline server closes downloads for players.
- Current pack: `0.1.0+47b0b579`, 18 locked files (base + server-only; votable mods are off until the vote is applied), NeoForge 21.1.252. Built and served.

### Phase 2 acceptance (docs/10)

- [x] `modpack lock` resolves every enabled mod plus dependencies for NeoForge 1.21.1 and fails loudly on a mod without a compatible version.
- [ ] `client.mrpack` imports into the Modrinth App and launches to the main menu. *Built; needs a real client test.*
- [ ] Clean Windows VM: Setup.bat → launcher → profile → main menu → server in list. *Script dry-run passes on Linux; needs Windows.*
- [ ] Rerun says "already up to date"; bumping one mod replaces exactly that jar. *Logic present; needs Windows.*
- [ ] `sync-server` puts the jar set on the AMP instance; server starts; client connects. *Dry run over the tunnel works (11 jars would be copied); key restriction verified; AMP login works. Ready for a real Sync once Alex says go (the instance is stopped right now).*
- [ ] Alex's Mac or one friend's gets in via `.mrpack`.

### Mod list changes (Alex, 2026-09-28)

Added `additional-enchanted-miner` ("Quarry (Additional Enchanted Miner)", mining, M, suggested) with its library `scalable-cats-force` (hidden), and `pipez` (world, L, suggested; 1.21.1 build is a beta). 38 entries, 173 links verified. Vote was open: the ballot reads the manifest live, so both appear pre-ticked for anyone who hasn't saved; saved ballots keep their picks.

### Onboarding "no Minecraft account with that name" (Discord, 2026-09-28)

Two players hit it. The Mojang lookup was verified working from the container (Notch, jeb_, bramble09, Dinnerbone all resolve) and another player onboarded successfully minutes later, so the likely causes are a typo, an Xbox/Bedrock gamertag, or a Discord name. Failed attempts are now audited (`profile.onboard` DENIED with the name typed) and the copy spells out "Java Edition name from the launcher". Check Admin → Overview → recent activity to see what they typed.

## Phase 1 · what was built (2026-09-28)

- `modpack/mods.json`: 35 entries (33 visible + 2 hidden libraries), every slug verified against the Modrinth API for a NeoForge 1.21.1 build, every wiki and video link verified (`pnpm modpack verify-links`: 163 links, 0 failed). Dropped from docs/06: FTB Essentials and FTB Ultimine (CurseForge only, not on Modrinth; the docs rule excludes them), Advanced Mining Dimension (no NeoForge 1.21.1 build), Create Ultimine (only an addon for FTB Ultimine). VeinMiner (`veinminer`) replaces the Ultimine pair. Votable mods start `enabled: false`; base and server-only mods are on. `server_address` is the placeholder `mc.dsw.test`.
- `packages/modpack`: shared zod schema, `lint` (cross-field rules from docs/06), load estimate (docs/05 points), `verify-links` (Modrinth via API with backoff, YouTube via oEmbed where 401 = exists but not embeddable, wikis via HEAD/GET with a retry). `lock`/`build`/`sync-server` are Phase 2 stubs. Run with `pnpm modpack <cmd>` inside the node container (no Node on the host).
- Web: `/mods` (sections, cards with load/Suggested/pick-one chips, Mod page + Wiki + video thumbnails, "Will my PC run it?" with the user's row highlighted), `/vote` (client ballot form: checkboxes, radios per exclusive group with click-to-clear, suggested pre-ticked, live load estimate with the LOW-tier Heavy warning, settings questions, saves via server action, editable until close, auto-closes at `closesAt`), `/vote/results` (admins while open, everyone once closed; per-mod yes/%/per-tier bars, weak-PC-majority flag on Heavy mods, question counts; Close button), `/vote/results/apply` (diff at a chosen threshold; exclusive groups keep the winner; confirm writes `mods.json` atomically and commits `chore(modpack): apply ...`), `/admin/votes` (create draft with default questions JSON, open/close/delete; one open vote at a time). Home shows the open-vote banner.
- Tally and decision logic are pure and tested (`apps/web/tests/tally.test.ts`); manifest schema/lint tested in the package.
- Deploy: `deepslate-web` now runs as uid 1009 (= `ladm`) and mounts the live repo's `modpack/` and `.git` at `/repo` so "Apply results" can write and commit; `MODPACK_DIR=/repo/modpack`. Nothing else from the repo is mounted.

## Phase 1 acceptance (docs/10)

- [x] Every mod card has a working Mod page, Wiki and at least one real video link (`verify-links` passes).
- [ ] A player can submit a ballot on a phone in under two minutes and edit it later. *Built; a ballot was saved through the real server action in a smoke test (exclusive group and unknown answers filtered server-side). Needs a real phone click-through.*
- [x] Exclusive group (guns) allows one choice; load estimate updates live and warns LOW-tier users about Heavy sets.
- [x] Results page shows per-mod yes % and per-tier breakdown; closing freezes results (`resultJson`).
- [ ] "Apply results" produces a diff of `mods.json` and commits it on confirm. *Built; commit path not yet exercised end to end (needs a closed vote with ballots).*

Alex logged in with Discord and opened the vote; `phase-0` tagged at `0399eb0`. Player address is plain `mc.dsw.test`: Pangolin publishes it on the default 25565 and forwards to the AMP host's 25569 (voice chat 24454/udp the same way). No port in the server list.

## Phase 0 acceptance (docs/10) · current state

- [x] `docker compose up -d` on the VPS serves the site over HTTPS.
- [ ] Alex logs in with Discord and lands on an admin page. *Unblocked 2026-09-28: Discord app, `ADMIN_DISCORD_ID`, `DISCORD_GUILD_ID` and `DISCORD_GUILD_AUTO_JOIN=1` are in `deploy/.env`; the signin redirect was verified (scope `identify guilds`, correct callback). Not yet clicked through. Note: the Discord login creates a separate ADMIN user from the email account `admin@example.com`; that's fine, or remove the email one in Users afterwards.*
- [ ] Invite link lets a second account in; a third without an invite is refused. *Code paths exist; not clicked through.*
- [ ] Email/password fallback works for one invite. *Renders; not clicked through end to end.*
- [x] `/api/auth/verify` returns 401 without a session (200 with one not yet exercised).
- [ ] `/api/health` reports `tunnel: ok`. *Currently `down`: waiting on the homelab side to enable its peer with our public key.*

**Admin login (email route):** `admin@example.com`, created from the CLI; password handed to Alex in chat and recorded in `/root/HOSTING.md` (mode 600), never here. Reset any time with `docker exec deepslate-web node apps/web/scripts/admin.mjs admin@example.com Alex` (prints a new password; there is no GUI password change yet). First login lands on `/onboarding` (Minecraft name + PC tier), then Admin appears in the nav. The bootstrap invite `https://deepslate.dsw.test/join/2R97LWNC` (14 days) is still unused and can go to the first friend.

## Alex's to-do (blocking; docs/13 §7 plus what this session couldn't do)

0. ~~AMP smoke test~~ Complete: login, GetStatus, SetConfig refused. `Core.Start` gets exercised from the admin page in Phase 3.
0b. ~~Deploy key restriction~~ **Verified 2026-09-28**: with the key pinned (`IdentitiesOnly=yes`, no agent, no other identity in the container) `rsync --list-only amp@10.77.0.2:` lists the instance's `Minecraft/` (server.properties, mods/, config/, world/ …), so rrsync roots the key correctly. The earlier "unrestricted" verdict came from `ssh … true` returning exit 0 with no rrsync message on that host, which turned out to be a poor test; the health probe now lists the remote root instead and reports `ok` / `wrong_root` / `no_key` / `down`. Real Sync is therefore allowed once Build has run. Fingerprint of our key: `SHA256:5g0kW7Zo+q0CBsMiD5/42qnkFIkJe2MVw8Nod3J/xtE`.
1. ~~Host firewall UDP 51820~~ Done by Alex (in `host-firewall.sh`, survives restart).
2. DNS: `map.deepslate.dsw.test → 198.51.100.20`.
3. AMP: create instance `DeepslateWorks01`; create ADS user `webapp` with rights on that instance only; put `AMP_INSTANCE_ID` and `AMP_PASSWORD` in `deploy/.env`, set `AMP_MOCK=0`, `docker compose -f deploy/docker-compose.yml up -d api`.
4. ~~Discord OAuth app~~ Done 2026-09-28. Server gate on, auto-join on: anyone in the Discord server can sign in without an invite link; invite links are now only for the person without Discord.
5. Ferry the two keys above to the AMP host session; give this session the instance id and `webapp` password.
6. Does anyone lack Discord? (docs/10 q5.) `server_address` Pangolin publishes? (docs/10 q6.)
7. ~~Phase 0 click-through~~ done.
8. **Test the wait room** with one friend: connect to `mc.dsw.test`, confirm the room + chat link, click it, confirm release and `whitelist.json`. Then tick docs/14 acceptance.
9. Optional `DISCORD_BOT_TOKEN` (a bot in the Discord server) so api re-checks membership every 5 min; without it, leaving the server only bites at the next Discord login.
10. ~~GHCR login on the VPS~~ Done 2026-09-29: classic token, `read:packages` only, login stored in `/root/.docker/config.json`. Fine-grained tokens get 403 from GHCR.
12. **AMP: allow backups from the portal** (Alex decided yes, 2026-09-29): give the `webapp` user's role **`LocalFileBackup.Backup.CreateBackup`** and **`LocalFileBackup.Backup.ViewBackupsList`**. Those are the names AMP uses; `…Plugin.Backup.TakeBackup`, as written here before, does not exist. Do not grant `DeleteBackup` or `RestoreBackup`: the portal never uses them. Nothing to deploy afterwards, the page checks the permission each time it is opened. Until then Admin → Server → "Backup now" stays greyed out and AMP's own schedule is the backup.
14. **The first real join.** Nobody has joined the server yet, so join, chat and death lines have only been tested against the log format. After the first session: Admin → Events should show the join and the leave, `/analytics` one session; if not, Admin → Server → Console has the lines as AMP sent them.
15. ~~Map embedding~~ Done 2026-09-29 on Alex's decision: `map.deepslate.dsw.test` sends `Content-Security-Policy: frame-ancestors https://deepslate.dsw.test`. The shared Caddyfile was backed up first (`Caddyfile.bak-20260929T072306Z`), the new config validated before loading, every site checked afterwards.
13. ~~Does a sleeping server count as up for downloads?~~ **Yes** (Alex, 2026-09-29): downloads are open while the server is Running or asleep (`apps/web/src/lib/gate-rule.ts`).
17. ~~Join the server once so that it wakes with TabTPS~~ TabTPS is out (it stopped the server from starting). **Join once and look at Home:** your ping should be next to your name within half a minute (spark).
18. **Play first needs a member who is not an admin to test** (admins are never held): docs/14 acceptance.
20. **Join the new world with an account that is not linked** (or have someone new join): they must land in the entrance room at 0 251 0 with the link in chat. This session has no Minecraft account and cannot join.
21. **Sleep in AMP**: the instance goes to sleep after about six minutes empty, in the middle of anything. Fine for every day; for the next pre-generation or a long BlueMap render switch it off first.
19. ~~The world's seed~~ Done 2026-09-29, see "World reset". Was: the world's seed is AMP's default, `CubeCodersPowered`. A new one is set in AMP (the instance's settings, "Level seed"), the portal cannot write AMP's settings; the world folder has to be moved away for it to take effect, and the entrance room built again afterwards (Admin → Server). Say which seed, and whether the present world may go.
16. **Play from the site, on Windows:** download the installer again (1.4.0; it updates itself from then on), run `Setup.bat`, then work through "Play from the site" in the Windows test checklist (docs/07). Eight lines, ten minutes.
11. ~~Rotate the GitHub token~~ New token in place 2026-09-29 (expires 2026-11-28). **Alex: revoke the old one on GitHub** (Settings → Developer settings → Fine-grained tokens); replacing it on the VPS does not invalidate it.

## Session log

- **2026-09-29 10:45 to 11:4x UTC** · World reset on the planner's note: new seed, old world kept as `world-backup-20260929`, room rebuilt, pre-generated, map purged and rendering. TabTPS taken out after it stopped the server from starting; pings from spark. Table and what broke: "World reset".
- **2026-09-29 10:0x UTC** · Play first built and deployed; Player guide, FallingTree and connection stats before it, one push each (`119545d`, `3205c3e`, `970ebe8`). TabTPS synced to the server at 09:42 while it was asleep; it has not started with it yet.
- **2026-09-29 09:20 UTC** · **FallingTree added to the catalogue** (planner). Its name on Modrinth is `fallingtree`, not `falling-tree`; NeoForge 1.21.1 build `1.21.1-1.21.1.11`, no required dependencies, works server-side alone (client optional). Category world, side both, load L, recommended, **not enabled**: like VeinMiner it waits for the vote. Two videos, wiki on GitHub. Both descriptions now say that the two work together (VeinMiner is the key you hold, FallingTree is the axe); VeinMiner's old text said "sneak" and "works on trees too". `verify-links`: 177 links, everything of FallingTree's fine; the two Mekanism wiki links failed to connect (`wiki.aidancbrady.com`, a slow server that has done this before). 39 entries now.
- **2026-09-29 08:55 to 08:57 UTC** · **The first real join, and a fault in the wait room.** Alex joined (the server woke from sleep), was held in the room, linked through the chat link, was let in: docs/14 works end to end with a real player, and the join, the hold and the link are in the event log. Then he was "let in" three more times, 30 s apart, each time with the greeting and a move to spawn. **Cause:** `/health` called `ping()`, which logged in to AMP afresh; the health check runs every 30 s; AMP hands a new session its recent console lines again; the join line in them was taken for a new join. It stopped by itself when the join line had scrolled out of AMP's backlog. It had been there since the wait room was written and could not show before a real player joined. **Fixed, four ways:** `ping()` uses the session there is; the console tail drops lines it has already read when AMP starts a session from its backlog, and reads the backlog after a restart of api as history (shown, used for who is online, not acted on; the recorder no longer records them twice either); the wait room takes the two lines of one join ("logged in with entity id", "joined the game") for one join, which is why he was held twice at the start; and `link.release` moves, resets and greets only a player who has no `verified` tag, so a member who comes back stays where they logged out instead of being sent to spawn on every join. After old lines have been read, anyone online who should be in the room and is not held is held; members are left alone. Tests: `apps/api/tests/replay.test.ts`. **Known gap:** someone who joined before api restarted and whose join line is no longer in AMP's backlog is not looked at until they join again.
- **2026-09-29 08:51 to 09:00 UTC** · **No report from the Play button.** Alex ran `Setup.bat` (report at 08:51:29, installer 1.3.0, all good) and then started the game; nothing came from the installed copy afterwards: the proxy's log has no request from PowerShell from his address after 08:51:29. Either Play was pressed in the Minecraft Launcher and not on the site, or the link did not start the script. Open; see Alex's to-do 16.
- **2026-09-29 08:54 UTC** · The installer's own update, run end to end from a Linux container (`/root/.config/deepslate/update-test.sh` on the VPS; throwaway account, removed afterwards). **A, against the live site:** a script calling itself 1.3.9, started with `deepslate://play`, showed "Updating the installer 1.3.9 → 1.4.0", replaced `install.ps1` and `Setup.bat` with the site's (byte for byte), kept the old script as `install.ps1.bak`, left no `.new` file, started the new script, and **one** report arrived: `mode=play installer=1.4.0 updatedFrom=1.3.9`, its log beginning with the update step. A second run from the same folder did not update again. **B, against a stand-in site naming a checksum the zip does not have:** "The installer was not updated: the checksum of the download (0590ac365934...) is not the one the site gave (ffffffffffff...). Nothing was replaced. Carrying on with installer 1.3.9."; both files unchanged, nothing else in the folder; the report said `updateProblem=…`, `updatedFrom` empty. Both runs then stopped at "Installing NeoForge", as they must on a machine without Java. The zip and the mod list were fetched with the launcher token; without one the site answers 401 and 307.
- **2026-09-29 08:51 UTC** · **First install report from a real Windows PC** (Alex, `Setup.bat`, installer 1.3.0, 12 s, all good). What could not be checked from Linux is now seen to work on Windows 11: the OS, memory and graphics fields are filled (Windows 11 Pro, 63.7 GB, Intel Arc A380; tier measured HIGH), the path in the log reads `C:\Users\~\…`, "Launcher found, and closed", the profile "saved and checked", and step 9: the copy in `%LOCALAPPDATA%\DeepslateWorks\` was made and the Play link registered and read back. Not yet seen: a run from the Play button itself. **That PC has 1.3.0, which cannot update itself: one more download and `Setup.bat` to get 1.4.0.**
- **2026-09-29 late morning** · Windows only (`baa691d`), then Play from the site: installer 1.3.0, `deepslate://play`, Play button on Home and `/install`, `InstallReport.mode`.
- **2026-09-29 06:38 UTC** · **Deleted, outside this project:** `/root/docker/pangolin-dsw.test/config/db/db.sqlite` (19.76 GB) and the 17 files in `/root/docker/pangolin-dsw.test/config/db/backups/` (115.6 GB), 135.3 GB in all. Alex asked for it in the VPS session ("delete the pangolin backups and db to clean up space on the disk"); the session listed what it found and deleted it in the same turn, without waiting for a yes to that list. This was the **stopped copy on the VPS** (stack `vps-pangolin`, shut down at the move to Caddy on 2026-09-27; no container of it exists), **not** the live Pangolin on `pangolin-01v`, which was not touched. **Recoverable:** Duplicati's nightly job "docker VPS" backs up all of `/root/docker`, keeps 7 versions, and its version of 2026-09-29 00:00 UTC holds all 18 files. That version is dropped by the run of 2026-10-06 00:00 UTC. Not recoverable from the disk itself (deleted with `rm`, the volume is mounted with `discard`). No restore has been tried. The session had told Alex this was "the only copy"; that was wrong, it had not looked at the backups. Rule added to the working rules.
- **2026-09-29 07:11 UTC** · Live checks of the file explorer and the branding upload, with throwaway admin accounts (`smoke-…@test.invalid`, removed afterwards). Their actions are in the event log under the name "Smoke Test": about twenty rows on 2026-09-29, kept like any admin action.
- **2026-09-29 07:10 to 07:14 UTC** · `rsync: no_key` in `/api/health` for four minutes after a deploy: a recursive `chown` over `deploy/` (done by the VPS session while committing) had given the deploy key and the WireGuard config to `ladm`, and api (uid 1000) could not read its key. Ownership restored; `deploy.sh` now checks and corrects it on every run. The tunnel and the sites were not affected; a mod sync in those minutes would have failed.
- **2026-09-29 morning** · docs/16 pages: settings, event log, analytics, player page, files, branding, rules. Pangolin's old database and backups (127 GB) deleted from the VPS at Alex's request.
- **2026-09-29 morning** · docs/16 foundations: tables, parsers, recorder, retention, audit log moved into the event log (see "docs/16 · foundations").
- **2026-09-29 morning** · Phase 3 dashboard built (see "Phase 3 · dashboard"); `deploy/check.sh` runs the checks in a capped container.
- **2026-09-29 05:22** · Stack registered in Dockhand as pull-only (`deploy/dockhand-sync.py`, mirror in `/data/stacks/deepslate`); compose host paths now built from `DEEPSLATE_DIR` so a redeploy from Dockhand mounts the same directories. GitHub token rotated (new fine-grained token, expires 2026-11-28); to-do 11 done.
- **2026-09-29 05:09** · First deploy from GHCR images via `deploy/deploy.sh`; images, AMP smoke, rsync listing and the in-api Build verified (see "OOM incident"). Planner specs 15, 15a, 16 arrived by push (`ba5decf`); read, not started.
- **2026-09-29 early morning** · OOM at 03:58 during `up --build`, reboot 04:07. Recovery check of every site, guardrails on the host (swap, earlyoom, capped builder, tooling hook), deploy moved to CI + GHCR + `deploy/deploy.sh`, `modpack build` moved into `api`, memory limits adjusted, `fetchJar` streams. api tests 21, modpack 9, web 20. Wait-room audit helper (`apps/api/src/audit.ts`: an audit row from a caller id that is not a user is kept with no user instead of failing the request) committed; it was already in the running image.

- **2026-09-28** · Phase 0 built and deployed (commit `374ea10`), handover doc added (`94471be`), repo moved into `/home/ladm/Minecraft-site` with the brief files kept at the root (`19d7abb`). Bootstrap invite issued.
- **2026-09-28 late night** · Phase 2: modpack lock/build/installer, `/install`, `/admin/modpack` with SSE runner, api sync (dry run verified), download gate (admin / online-only), MANIFEST_KEY, AMP smoke test (login refused), `phase-0` tagged, Quarry + Pipez added, onboarding audit.
- **2026-09-28 night** · Phase 1 built: `packages/modpack`, `modpack/mods.json` (verified), `/mods`, `/vote`, `/vote/results` (+apply), `/admin/votes`; web container now uid 1009 with `modpack/` + `.git` mounted for the apply-and-commit step.
- **2026-09-28 late** · Planner docs 12 and 13 applied: doc edits (00/02/04/08/09/10, the working rules); `COOKIE_DOMAIN=.deepslate.dsw.test`; map host Caddy block; `wireguard` + `api` + two map relays in compose; VPS WireGuard keys and deploy key generated (public halves above); `api` skeleton with tests; web `api-client.ts`, health now reports the tunnel; Discord server gate. Firewall line left for Alex (permission refused). Tunnel `down` until the homelab enables its peer. Map-host 401→login redirect verified. Admin email account created via `scripts/admin.mjs`. Alex added the Discord app values and the server id (auto-join on) and restarted `web`; OAuth redirect verified.

## Suggested plan updates for the next session

- When the tunnel is up: confirm AMP method names against `http://10.77.0.2:8080/API` through `api` (docs/08 "AMP methods used"), then set `AMP_MOCK=0`.
- Tick the Phase 0 boxes with Alex, tag `phase-0`; tick Phase 1 (phone click-through, one real apply-and-commit), tag `phase-1`; then Phase 2 (`modpack lock|build|sync-server`, `/install`, `/admin/modpack`, `installer/`). Phase 2 needs `server_address` from Alex (what Pangolin publishes) and the AMP instance for `sync-server`.
- docs/06 `sync-server` still describes a bind mount; rewrite it for rsync over the tunnel when Phase 2 starts (docs/13 §4 has the command).
- ~~GitHub remote~~ done 2026-09-29: `Blake-DK/deepslate-works` (private), CI builds the images. Dockhand: added 2026-09-29 as a pull-only stack (`deepslate`, environment VPS-01V); the repo stays the source of truth and `deploy/deploy.sh` refreshes Dockhand's mirror (docs/09 "Dockhand").
- Phase 3 prep: the map host needs a DNS name under the chosen domain and `COOKIE_DOMAIN` set; the Caddy block needs `forward_auth deepslate-web:3000 { uri /api/auth/verify }` and a `reverse_proxy` to BlueMap on the AMP host over Tailscale.

# 03 · Data model

The schema is `apps/web/prisma/schema.prisma` (`apps/api/prisma/schema.prisma` is a link to it). This page says what each table is for and what is not obvious about it; the columns are in the schema, with a comment on each that needs one. Migrations `0001` to `0013` are in `apps/web/prisma/migrations/` and run when `web` starts. **Before a migration the database is dumped** to `/root/docker/deepslate/backups/pre-00NN-<name>.sql.gz`.

Keep it this small; add columns when a phase needs them.

## Tables

| Table | One row is | Worth knowing |
|---|---|---|
| `User` | a member | `role` ADMIN or PLAYER. `discordId`, or `email` + `passwordHash` for the one without Discord. `mcUsername` and `mcUuid` are **not typed by anyone**: they are set when the member clicks the link they were shown in the entrance room (docs/14), and `verifiedAt` says when. `guildMember` is the last answer to "are they in the Discord server". `pcTier` with `pcTierSource` ("self" from the one question at sign-up, "measured" from the installer's report), `pcTierWhy`, `pcTierAt`. `earlyAccess`: uses the site as if it were live while it is not (docs/13 §9) |
| `Invite` | an invite link | for the person without Discord; members of the Discord server need none |
| `Vote`, `Ballot` | a vote; one member's ballot in it | one ballot for each member and vote, editable until the vote closes. `modIds` are slugs from `mods.json`. `resultJson` is the tally, frozen at closing |
| `LinkCode` | a code shown in the game to somebody who is not linked | binds their UUID to the account that opens `/link/<code>`. One live code for each UUID |
| `LauncherAuth` | a sign-in of the installer | the script shows a code, the member approves it in the browser, the script is handed a token (kept here as a checksum only). Ten minutes to approve, then seven days of use |
| `InstallReport` | one run of the installer | `mode` install or play, `outcome`, `failedStep`, the log and the description of the PC, both with names and paths taken out on the PC and again here. `updatedFrom`, `updateProblem` (docs/07). Kept 90 days. **The door reads this table**: "Play first" looks for the member's last run of Play that went through |
| `SiteSettings` | the site (one row, `site`) | `live`, the launch switch |
| `Setting` | a group of settings | `branding`, `privacy`, `retention`, `files`, `joining`, edited on the admin pages; and what the portal keeps for itself: `_pregen` (the plan of the pre-generation), `_packSynced` (the pack the server was last given, which a join is held against) |
| `Announcement` | a news item | `image` is a file name under `data/news/` |
| `Session` | one stay on the Minecraft server | `mcUuid` is `name:<name>` until the UUID is known. `ip` is for admins and is removed after 30 days; `country` is worked out once, from a database on the VPS |
| `Event` | a line in the event log | see below |
| `ServerSnapshot` | what the server was like at a moment | state, players, TPS, CPU, memory, `pings`. Every 15 s while it runs, every five minutes while it does not; after 48 hours thinned to one in five minutes; kept 30 days |

## The event log

`Event` is everything the portal has seen or done, in one table: `at`, `kind`, `actor` (a Minecraft UUID for what happened in the game, a user id for what somebody did on the site, nothing for what the portal did by itself), `message` (the line as a person reads it), `raw` (the console's line, admins only), `meta`, `count` (the same warning within a minute, or the same download within two, is one row counted up).

| Kind | What |
|---|---|
| `JOIN`, `LEAVE`, `DEATH`, `CHAT`, `ADVANCEMENT` | from the console |
| `SERVER_START`, `SERVER_STOP`, `CRASH` | from the console and AMP's state |
| `WARN`, `ERROR` | from the console, the usual noise of a start left out |
| `ADMIN_ACTION`, `PLAYER_ACTION` | what somebody did on the site, or the portal by itself. `meta` has `action`, `params`, `result` (OK, DENIED, FAILED, TIMEOUT), `detail` |
| `LINK`, `REVOKE` | the entrance room: held, linked, let in; removed |
| `SYNC`, `BACKUP` | mod sync, backup |
| `INSTALL` | a report from the installer |
| `JOIN_BLOCKED` | held at the door for Play first |
| `DOWNLOAD` | the installer, the settings or the mod list fetched from the site, or refused; a file an admin took from the server |

Players see `JOIN`, `LEAVE`, `DEATH`, `ADVANCEMENT`, `SERVER_START` and `SERVER_STOP` on `/events`, without addresses and raw lines. The sentences are made in one place, `src/shared/events.ts`, which `web` and `api` share.

**There is no `AuditLog`.** Migration `0005` copied its rows into `Event` and renamed the table to `AuditLog_migrated_20260929`; nothing reads it and nothing has dropped it.

## Not in the database

- **Mods.** They live in `modpack/mods.json` and `mods.lock.json`. Ballots reference mods by slug so a mod removed from the manifest still shows up in old results as "removed".
- **Map data.** BlueMap owns it.
- **Player inventories, homes, stats.** Read live from the server when a feature needs them; don't mirror.
- **Uploaded pictures.** `data/branding/`, `data/news/` on the VPS; the tables hold the file names.
- **Who is held in the entrance room right now.** In `api`'s memory; after a restart it is worked out again from who is on and what tags they carry.

## Roles and permissions

Two roles, in `src/server/auth/can.ts`, which is the only place they are defined:

| Permission | PLAYER | ADMIN |
|---|---|---|
| view catalogue, dashboard, map (`catalogue.view`) | ✓ | ✓ |
| submit and edit one's own ballot while the vote is open (`ballot.submit`) | ✓ | ✓ |
| one's own profile (`profile.editSelf`) | ✓ | ✓ |
| actions on oneself in the game (`player.actionSelf`) | ✓ | ✓ |
| create, open, close votes (`vote.manage`) | | ✓ |
| invites (`invites.manage`); members, roles, early access (`users.manage`) | | ✓ |
| server start, stop, restart, announcements, pre-generation, backups (`server.control`) | | ✓ |
| mods, lock, build, sync (`modpack.manage`) | | ✓ |
| the event log in full, install reports, files (`audit.read`) | | ✓ |

`player.actionSelf` has nothing behind it yet: taking oneself home or to spawn is Phase 4. Whether a PLAYER may use the site at all before it is live is not a permission but a rule of its own, `src/shared/access.ts` (docs/13 §9).

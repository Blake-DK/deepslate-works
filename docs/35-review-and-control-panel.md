# 35 · Code review and the control panel's layout

Session of 2026-10-05, against `dev` `7651d08` (same code as `main` but for two docs commits). Review only: nothing was fixed, deployed, synced or restarted. It follows docs/31 and does not repeat it: a finding already in docs/31 is named here only where its fix turned out to be incomplete.

## How it was done

- Five read-throughs in parallel (api core; api seasons and Discord; web server side; web player pages; installer, modpack tooling, deploy and CI), each told to skip what docs/31 already lists. Then the findings marked "checked" below were read again by hand against the files.
- **Nothing was run.** No tests, no docker, nothing against AMP, Discord or the database. CI on `dev` and `main` is green on this code (typecheck, lint, tests).
- "Traced" means the path was followed in the code. "Plausible" means the code path is there but it depends on something not checked (AMP's or Discord's answer, timing).
- Not read: `installer/app/src/Ui/*` and most of `DeepslateWorks.ps1`; `status/pregen.ts` first half; the tests; a handful of small `lib/` files. The admin pages were read for layout (part 2), not line by line for bugs.

## What was looked for and found sound

- Every server action and every `/api/admin/*` route checks the admin role itself; member actions take the user id from the session (no acting on someone else's id).
- Every api route needs the service token; every console command goes through `runAction`; no player's free text reaches the console unescaped; the advancement pattern cannot be spoofed from chat.
- Launcher tokens (random, stored hashed, expiring, revoked on leave), invite redeem race, TOTP replay, CSV export, uploads and SVG, `safeHref` in the markdown, zip slip in the installer, hash checks of mods and the self-update.
- Season day and week arithmetic across the clock change; the advisory lock; `ship` is empty so no season datapack reaches the server early.
- Marked fixed in docs/31 and confirmed in code: B-02, B-03, B-05, B-16, B-33, B-34, B-37, B-39, B-41. **Only partly fixed: B-04, B-08, B-19, B-20, B-35, B-36, B-43** (R-05, R-20, R-09, R-08, R-17, R-25, R-21 below).

No critical or high finding. Sizes: S under a day, M one to three days.

## Part 1 · Findings

### Fix first

| ID | Sev | Where | What is wrong | How it shows | Fix | Size |
|---|---|---|---|---|---|---|
| R-01 | medium | `apps/web/src/auth.ts:162-172`, `server/auth/invites.ts:24`, `schema.prisma:112` | **A member who has used an invite once can never use another.** `Invite.usedBy` is unique; the "exempt" path writes the same user id on a second invite, the transaction throws, and the catch refuses them as `invite-invalid`. The refusal also sets `guildMember` false, ends their sessions and denies their launcher tokens. Checked. | A member who came in by an invite leaves the Discord server (or is taken off the "Outside Discord" list); Alex sends a new invite, as docs/04 describes. It never works. | Drop the unique on `usedBy` (migration), or mark the exemption without writing `usedBy` again. Test: "existing member with an earlier invite". | S |
| R-02 | medium | `apps/api/src/players/limbo.ts:308-313`, `:425-428` | **A release whose commands fail leaves the player in the entrance room, forgotten.** `releaseBack` and `release` take the player out of `held` before the commands and do not put them back on failure (`adminRelease` at `:450` does). `tick` only looks at `held`. Checked. | Member presses Play; one command meets an AMP timeout. They stand in the room in adventure mode with no prompt, never looked at again until they relog. | On `!r.ok`, `this.held.set(name, h)` in both places. | S |
| R-03 | medium | `apps/api/src/actions/run.ts:39-42`, `status/ping.ts:62`, `events/retention.ts:17` | **An AMP or tunnel outage writes a FAILED row every 15 seconds, kept for good.** Quiet actions are quiet only on success; the failure is audited as `ADMIN_ACTION`, which retention never deletes. Checked. | Tunnel down with two people playing (they stay on through mc-router): about 5,760 rows a day, and "What admins did lately" is nothing else. | Do not audit failures of quiet actions (one row per outage at most); watchers also need `poller.fresh()`. | S |
| R-04 | medium | `apps/api/src/actions/run.ts:32`, `routes/players.ts:79`, `status/wake.ts:35` | **A refusal from AMP that comes as HTTP 200 counts as success.** The answers to `SendConsoleMessage`, `Core.Start/Stop/Restart` are not read. Plausible: the shape of AMP's refusal for these calls was not checked on the live instance. | The `webapp` role loses a permission, or Start answers `{Status:false}`: every action is audited OK, the door believes its hold happened, a wake shows "waking" for three minutes and fails with no reason. **Worth reading beside B-66** (the wake that failed on 2026-10-04). | One helper in `amp/client.ts` that throws on `{Status:false}` and `{Title, Message}`; check the real answers on AMP first. | S |
| R-05 | medium | `apps/api/src/players/limbo.ts:161-185` | **B-04 is half fixed: a member who joins during an api restart never meets the door.** `resync` acts on "hold" or an existing row only. Traced. | Join in the 10 to 30 s of a deploy: Play first, not-live and must-vote are skipped for that visit. Or: linked on the site while offline, rejoins in that window, stands in the room unverified with no prompt. | In `resync`, a "release" decision runs the same branch as `onJoin`. | S |
| R-06 | medium | `apps/api/src/discord/wire.ts:155`, `announcer.ts:114-120,549` | **Crash and problem alerts are dropped while the bot's gateway reconnects**, though sending needs only REST. The cursor moves on; no retry. Traced. | A crash during a gateway resume: the admin channel hears nothing. A vote opened then is posted without buttons, for good. | Gate REST sends on "in the guild" only; `retry: true` when the bot is set up but not usable this second. | S |
| R-07 | medium | `apps/web/src/components/server/play-button.tsx:53-72` | **The wake line under Play freezes on Home.** The effect's cleanup clears the interval but leaves `poller.current` set, so polling never starts again; `wake` never follows new props. Checked. | Server asleep, member presses Play: "Waking the server…" stays for ever, never "Server ready" or the failure. | `poller.current = null` in the cleanup; take `wake` from `initialWake` when it changes. | S |
| R-08 | medium | `deploy/backup-loop.sh:23-27` | **B-20's gap: gzip's exit is never checked.** Only pg_dump's exit and "not empty" are. Checked by reading. | Disk full: a cut-off dump is kept as today's, the oldest good one is deleted, api copies the bad one to the AMP host. Fourteen such days and no good dump is left. | `gzip -t "$f.part"` before the `mv`. And see R-19: the container will not get the new script by itself. | S |
| R-09 | medium | `deploy/deploy.sh:57-61,72` | **B-19's gap: the dump before a migration is skipped when a deploy is run twice.** "Before" is read from the checkout, which the first try already moved. Traced. | Deploy before CI has pushed the images: the script says "deploy again"; the second run sees no new migration and takes no dump. | Compare with what is running (`PORTAL_COMMIT` of the web container), or check the images before `git pull`. | S |
| R-10 | medium | `installer/app/src/Home/Uninstaller.cs:185`, `:128-130` | **Uninstall deletes the player's own worlds, and writes the launcher's profile file unsafely.** The whole game folder goes (only screenshots are moved out) while the box says "your other profiles and worlds" are kept; `launcher_profiles.json` is deleted and then moved, not replaced. Checked. | A single-player test world or Create schematics in the Deepslate profile are gone without a word. A kill between delete and move leaves the launcher with no profiles. | Move `saves` and `schematics` out as screenshots are; `Engine.MoveOver` for the write (also `Core/Json.cs:62`). Goes with the next exe release. | S |

### Medium, not urgent

| ID | Where | What is wrong | Fix |
|---|---|---|---|
| R-11 | `apps/web/src/app/api/auth/verify/route.ts`, `middleware.ts` | The map's check only decodes the cookie; a removed or blocked member keeps the live map for as long as they visit once a month (the cookie rolls). The no-database part is traced; the rolling is from Auth.js's known behaviour. | `verify` calls `loadCurrentUser()`. |
| R-12 | `apps/web/src/auth.ts:35-48,132` | A Discord hiccup (429, 5xx, 6 s) at sign-in is read as "left the server": sessions ended on every device, launcher tokens denied, held in game. | Three answers: yes, no, unknown; on unknown refuse this sign-in and touch nothing. |
| R-13 | `apps/api/src/routes/status.ts:15-20` | With the tunnel down each `/status` waits 10 s on AMP while web gives up at 8 s: every page hangs 8 s and gets an error, not "unreachable". | Answer from the poller's last error; one shared call. |
| R-14 | `apps/api/src/seasons/store.ts:62`, `recorder.ts:92-118` | "First on the server" goes by arrival order. A group member whose kill comes by the safety net (no UUID yet, a restart) is not first: half the points, and "B beat X" instead of sharing. | Decide `first` by the kill's time against the earliest clear, inside the lock. **Before the rehearsal.** |
| R-15 | `apps/api/src/routes/seasons.ts:89-101` | End season freezes the result (written once) without waiting for the recorder's 5-second batch or a last safety-net pass. The finale's kill can be lost. | End calls `fromFiles()` and flushes first. **Before the rehearsal.** |
| R-16 | `apps/web/src/app/api/admin/modpack/[cmd]/route.ts:8` | The only admin POST with no same-origin check (console, inventory, wake and poll votes have one). Needs a foothold on another `dsw.test` host. Checked. | The same Origin check, as one shared helper. |
| R-17 | `admin/users/actions.ts:15-25`, `server/auth/session-check.ts` | B-35's gap: an email-and-password session becomes an admin session when its member is promoted. | Refuse `via === "email"` with role ADMIN in `sessionProblem`. |
| R-18 | `shared/season.ts:145`, Home, `/api/season/current` | The season's line names the next trial or boss before it opens ("Next: The Engineer, Fri 11 Dec"), against the page's own rule that what has not opened keeps its name hidden. A test pins the text, so **Alex decides**. | "Next: a new trial, Fri 11 Dec"; no `title` in the route for unopened items. |
| R-19 | `deploy/docker-compose.yml:192` | `backup-loop.sh` is mounted as one file: after a deploy the container still runs the old script until it is restarted. | Mount the folder, or restart `backups` when the script changed. |
| R-20 | `.github/workflows/ci.yml:38`, `installer.yml:92`, `deploy.sh:93` | B-08's gap: `latest` can still land on the older of two close pushes; the installer image is pulled by `latest`. | Concurrency on the workflow; pull the installer by version. |
| R-21 | `apps/api/src/events/recorder.ts:143-153` | B-43's gap: a join during an api restart gets no session, so no play time for that visit. | Open a session for listed names without one. |

### Low

| ID | Where | What is wrong |
|---|---|---|
| R-22 | `components/launch-banner.tsx:5` | The countdown counts 24-hour blocks: launch today at 19:00 reads "tomorrow" at 10:00. Checked. (We are live; matters only if the switch goes off again.) |
| R-23 | `play-button.tsx:160`, `me/page.tsx:65,71`, `launcher/[code]/page.tsx:32` | Players are told to "unzip and double-click Setup.bat" while the button hands them `DeepslateWorks.exe`. |
| R-24 | `vote/results/section.tsx:28` | The Results tab is a 404 until a vote has closed; while a new vote is open players cannot see the last one's results. |
| R-25 | `players/[uuid]/page.tsx:132-193` | B-36's gap: with "Players can see the Stats tab" off, a member still sees another's ping, time played and 30-day chart. |
| R-26 | `lib/analytics.ts:116-123` | "Minutes played per day" counts a session in two bars; slots are off the hour by up to 59 minutes. |
| R-27 | `vote/ballot-form.tsx:58`, `lib/event-query.ts:12` | Two times not in UK time: the ballot's "closes" (browser's zone, and a hydration mismatch); Activity's From/To (UTC days). |
| R-28 | `launcher/[code]/page.tsx:40`, `join/[code]/email/page.tsx` | No pending state: a double click on "Yes, that's me" can show "expired" after it worked. |
| R-29 | `app/(app)/map/page.tsx:11` | No check of its own (leans on the middleware and the layout), and no "We're live" check: a not-yet-live member sees the map. |
| R-30 | `server/link.ts:51-64`, `players/limbo.ts:209` | A stale duplicate `mcUsername` (someone renamed, another took the name) makes linking or every join of the new owner throw. |
| R-31 | `status/ground.ts:93`, `players/editor.ts:63,114`, `amp/console.ts:93` | Extends B-44: the reply matchers accept chat lines. "Killed 999999 entities" typed at the right moment is reported as the clear's count; a chat line of dashes hides itself from the console page. |
| R-32 | `routes/wake.ts:33-42` | Two wake requests milliseconds apart both send `Core.Start`. Also worth ruling out for B-66. |
| R-33 | `players/limbo.ts:104,374` | `tick` has no overlap guard: with AMP slow, two ticks can release the same player twice. |
| R-34 | `routes/modpack.ts:53-62`, `modpack/busy.ts:22` | The build lock can be released by a stream that no longer holds it: a Build beside a Sync, with unlucky timing. |
| R-35 | `discord/announcer.ts:592-602`, `:677-705`, `:646-664` | Discord posts: a vote with no stored post gets no reminder and no result; a change-log entry Discord refuses (over 2,000 characters) is retried every minute for ever and blocks the later ones; a database error after a send posts twice. A test that every `CHANGES` entry is at most 2,000 characters would catch the second. |
| R-36 | `seasons/recorder.ts:168-185` | Clock lines can be said up to 24 h late ("tonight at 20:00" the day after). |
| R-37 | `seasons/advancements.ts:50` | The safety net skips an advancement file over 2 MB without a word; on this pack a long-time player's file can pass that. |
| R-38 | `seasons/store.ts:96`, `discord/gateway.ts:102-163`, `discord/lines.ts:73` | A double click on Announce is a 500; a malformed gateway frame throws outside any catch; a server name with "discord" in it gets every server line refused. |
| R-39 | `server/vote/tally.ts:46,92` | The ballot threshold compares a rounded percentage (59.52% passes 60%). Not reachable at 50% with this group. |
| R-40 | `admin/server/actions.ts:233`, `server/polls.ts:134` | Deleting a news item can remove a picture a poll option still uses; poll pictures are never removed. |
| R-41 | `api/app/updates/route.ts:14`, `auth.ts:68`, `routes/players.ts:34`, `players/polls.ts:53` | Four small ones: the app's update list skips the not-live gate; the email sign-in's timing tells whether an email is registered; `/link/release` does not ask `decideJoin`; the chat line for a new poll is audited with no admin. |
| R-42 | `installer/app/src/Engine/Engine.cs:182,210` | Java and the NeoForge installer are run with no checksum (mods and the exe have one). |
| R-43 | `packages/modpack/src/seasons.ts:122-187`, `cli.ts:87`, `build.ts:105,235` | Season lint does not check item ids against the catalogue or a boss entity used twice; Lock renames the pack's lock before the extras lock is made; Build writes `dist` files in place while web serves them. |

### Suggested order

1. One api PR: R-02, R-05, R-03, R-33 (the door and the audit; all small, all in files PR C touched).
2. One web PR: R-01 (with its migration), R-07, R-16, R-17, R-23.
3. One deploy PR: R-08, R-19, R-09.
4. Before the Season 1 rehearsal (23 November): R-14, R-15, R-06, R-35, R-37.
5. With the next exe: R-10, R-42. R-04 and R-32 when B-66 is looked into on the AMP host.

---

## Part 2 · The control panel

### What is there now

The admin strip: **Control Room · Server · Pack · Seasons · People · News · Site settings**.

| Page | Tabs | What each holds |
|---|---|---|
| Control Room | (none) | Players list, last console lines, health, power, who is in the entrance room, restart with a warning, back up now, what admins did lately |
| Server | Power & restarts · Settings · Backups · Pre-generation · Entrance room · Console · Files | "Settings" is view and simulation distance, the entity counts and the ground-item clear. "Entrance room" is Build the room, Server-claim, and "Kick + unwhitelist". "Pre-generation" also holds the map's buttons (reload BlueMap, delete and render again) |
| Pack | Build & sync · Votes · Apply results | "Votes" is three things on one page: New poll, the polls, and the season's mod vote |
| Seasons | (none) | Announce, Start, End, reload datapacks, give or take back a tick |
| People | Members · Invites · Installs | Members has the Early access switch per row and the Blocked list |
| News | (none) | Post news, the announcements |
| Site settings | Launch · Joining · Privacy · Kept for · File browser · Branding · Discord | Seven tabs, most of them one card. Branding holds the logo, name, tagline, footer, Discord invite link, the server-list description, the sign-in banner, **the Rules page and the Guide page**. Discord holds the feed, the bot and every switch |

### What is wrong with it

**1. "Who gets in" is spread over five places.** This is the setting most likely to be needed in a hurry (someone cannot join), and the worst to find:

| Rule | Where it is now |
|---|---|
| We're live, launch date | Site settings → Launch |
| Play first, the window, minimum installer | Site settings → Joining |
| Early access, per member | People → Members, a column |
| In without the Discord server, per member | People → Members, a row's menu and a filter |
| Blocked Discord accounts | People → Members, foot of the page |
| Who is held now, and Release | Control Room only (the Server → Entrance room tab names them but has no Release) |
| Build the room, Server-claim | Server → Entrance room |
| Must vote before playing | Pack → Votes, a button on a vote's row |

**2. Things filed under the wrong page.**

- **Polls are under Pack.** A poll ("how long is a season?") has nothing to do with the mod pack. Members have "Votes" and "Mods & vote" as two tabs; the admin side has both under Pack → Votes.
- **The Rules and Guide pages are under Branding**, below the footer text. They are the site's content, not its look, and the Guide is the longest text on the site.
- **The server-list description (MOTD) is under Branding** although it sets a setting on the game server.
- **The Discord invite link is under Branding**, not Discord.
- **Discord is a tab of Site settings**, the seventh, though it is the largest settings page there is (feed, bot, three channels, seventeen switches, the send log).
- **The file browser's limits are in Site settings**; the file browser is in Server → Files.
- **"Kick + unwhitelist" is in Server → Entrance room.** It acts on a person, takes a name typed by hand, and belongs in the member's menu. The whitelist is off since docs/14, so the label is also out of date: what it does today is kick and take the "verified" tag away.
- **The map's buttons are inside Pre-generation.** Reloading BlueMap or rendering the map again is not pre-generation.
- **"Reload datapacks" is only on Seasons**, though it reloads all of them (it was the step after the placard fix).

**3. Labels that do not say what is behind them.**

| Now | Problem | Proposed |
|---|---|---|
| Server → **Settings** | It is three performance cards; the server's other settings are elsewhere | **Performance** |
| Site settings → **Kept for** | Reads as half a sentence | merged into **Privacy & data** |
| **Pack** (admin) and **Mods & vote** (members, `/pack`) | Two pages called pack | admin: **Modpack** |
| Pack → **Build & sync** | The tab is also the mod list and has Lock | **Mods & build** |
| People → Members, heading **Players**; invites say "Players → Outside Discord" | Three names for one tab | **Members** everywhere |
| **Site settings** | Holds game rules (Play first), server settings (MOTD), Discord | **Site**, and only the site |
| **Early access** column | Dead since We're live was pressed; still a column on every row | moves to Joining; shown only while not live |
| **Revoke** / "Kick + unwhitelist" | Whitelist is off | **Kick and unverify**, in the member's menu |
| Control Room: **Back up now**, **Restart with a warning** | Fine, but the same cards under Server carry the detail | keep; add "More in Server → Backups" |

**4. Smaller things.** Site settings' tabs are one card each, so seven clicks to read seven cards. News is a top-level page for two cards. The Seasons page tells Alex to edit a file in the repo to pick the season, with no link to anything.

### Proposed layout

The strip: **Control Room · Server · Joining · People · Modpack · Seasons · News & polls · Discord · Site**. Nine, two more than now; each name answers "where would I look for…".

| Page | Tabs | Holds | Comes from |
|---|---|---|---|
| **Control Room** | (none) | As now | unchanged |
| **Server** | Power & restarts · Performance · Backups · World & map · Console · Files | Performance: distances, entity counts, ground clear. World & map: pre-generation, the map's buttons as a card of their own, Reload datapacks, the server-list description. Files: the browser, with its limits in a "Limits" fold at the foot | Settings renamed; map split out of Pre-generation; MOTD from Branding; limits from Site settings |
| **Joining** (new) | Who's waiting · Rules · Entrance room | **Who's waiting:** everyone held now with why, and Release; the last refusals (from Activity). **Rules:** We're live and the launch date; Play first with its window and minimum installer; the open vote's "must vote before playing"; then three short lists with a way to change each: early access (only while not live), in without the Discord server, blocked. **Entrance room:** Build the room, Server-claim, how it works | Site settings → Launch and Joining; Control Room's held card (kept there too); People's column, filter and Blocked list; Server → Entrance room |
| **People** | Members · Invites · Installs | Members loses the Early access column once live; a row's menu gains "Kick and unverify". The per-member switches stay in the menu as well | Revoke from Server → Entrance room |
| **Modpack** | Mods & build · Mod vote · Apply results | The mod vote only | Polls leave |
| **Seasons** | (none) | As now | unchanged |
| **News & polls** | News · Polls | Post news, announcements; new poll, the polls | News page; polls from Pack → Votes |
| **Discord** (top level) | Connection · Channels & bot · What is posted | Connection: the feed's state, the three tests, pause, the invite link, last messages sent. Channels & bot: the three pickers and the bot's switches. What is posted: the thirteen switches | Site settings → Discord; invite link from Branding |
| **Site** | Look · Pages · Privacy & data | Look: logo, name, tagline, footer, sign-in banner, with the preview. Pages: Rules, Guide. Privacy & data: the three privacy switches and the four "kept for" numbers on one page | Branding split in two; Privacy and Kept for merged; Launch, Joining, File browser and Discord leave |

Rules used to draw it:

- **A setting lives with the thing it changes.** Limits of the file browser are beside the file browser; the server-list line is under Server.
- **One question, one page.** "Why can't X get in?" is Joining. "What does Discord post?" is Discord.
- **A per-person switch may show in two places** (the member's menu and Joining's lists), the same switch both times. That is finding it twice, not keeping it twice.
- **Where one setting depends on another, the card says so with a link**, as Discord already does for chat ("off because chat logging is off").

### What it takes to build

Every card is already a component (`server/cards.tsx`, the `section.tsx` files), so this is moving cards between `TabbedPage`s, not rewriting them. No change to api, to the database or to any action.

1. **Labels and moves inside a page** (S): Performance, Members, Modpack, Mods & build, Privacy & data as one page, the map card out of Pre-generation, limits into Files, "Kick and unverify" into the member's menu.
2. **Joining** (M): the new page, its three lists, Release on it. The largest piece and the most useful.
3. **Discord, News & polls, Site** (S to M): Discord to the strip with three tabs; polls beside News; Branding's form split into Look and Pages (it is one form and one save today, so the split touches `branding/form.tsx` and its action).
4. **Old addresses keep working**: `/admin/site?tab=joining`, `/admin/pack?tab=votes`, `/admin/news` and the rest redirect, since docs and Discord's own lines ("Open Admin → Server") point at them. The wording of those lines and of `HowThisWorks` texts that name a place ("Site settings → Joining and Launch") changes with the move.
5. Tests that pin tab names (`data-testid`, the tab keys) move with them.

It is an admin-only change, so no change-log entry for players.

### Decided and built (Alex, 2026-10-05; on `dev`, not deployed)

Alex's answers: the top bar keeps its one Control Room button and the second bar carries every page; Joining is a page of its own; the polls are a page of their own called Votes; the server-list description moves to Server; build it now.

The strip as built, ten pages: **Control Room · Server · Joining · People · Modpack · Seasons · News · Votes · Discord · Site**.

| Page | Tabs | Address |
|---|---|---|
| Server | Power & restarts · Performance · Backups · World & map · Console · Files | `/admin/server` |
| Joining | Who's waiting · Rules · Entrance room | `/admin/joining` (new) |
| People | Members · Invites · Installs | `/admin/people` |
| Modpack | Mods & build · Mod vote · Apply results | `/admin/pack` |
| Votes | (the polls) | `/admin/votes` (was a redirect; now the page) |
| Discord | Connection · Channels & bot · What is posted | `/admin/discord` (new) |
| Site | Look · Pages · Privacy & data | `/admin/site` |

- **Joining → Who's waiting:** who is held and Release, the last ten times the door held somebody, and "Kick a player back to the door" (the old "Kick + unwhitelist", by name, with a reason of its own). **Rules:** Launch, Play first, which open votes hold people, early access (only while not live), the outside-Discord list, Blocked. **Entrance room:** Build the room and Server-claim.
- **Old addresses are sent on** by the page they pointed at (`MOVED` in `admin/server`, `admin/pack` and `admin/site`): `?tab=settings`, `pregen`, `room`, `votes`, `launch`, `joining`, `kept`, `files`, `branding`, `discord`.
- **The branding save takes one part of the form at a time** (`from` names the page; a field that was not sent is left as it is), because its fields now sit on four pages: Site → Look, Site → Pages, Server → World & map (the server list's lines), Discord → Connection (the invite link).
- No change to api, to the database or to what any action does.

Where it differs from the proposal above:

- **News stays a page by itself**; the polls are Votes (Alex).
- **"Kick and unverify" is not in the member's menu.** It takes a name because it is also for somebody who is not a member, so it is a card on Joining → Who's waiting.
- **"Delete the map and render it again" stays inside Pre-generation's form**: it runs in the mode picked there. Only "Reload BlueMap's settings" moved to the Map card under it.
- **"Reload datapacks" stays on Seasons only**: api's reload is part of the season's route and refuses when no season is current.
- **The early-access column on People** is hidden once the site is live (its two filters still show it); the per-member switch on a player's own page is unchanged.

**Not proven:** nothing here ran in a browser. CI's typecheck, lint and tests are the check; the pages want a click-through after the deploy (each tab, one save on each form, Release, an old address).

### The questions as asked


1. **Nine items on the strip, or fewer?** Fewer means Discord back under Site, and News & polls under Site as well; the strip scrolls sideways on a phone either way.
2. **Joining as its own page**, or only the lists gathered under People? Its own page is the proposal.
3. **Polls beside News**, or a page of their own named Votes to match the members' tab?
4. **The server-list description**: Server → World & map as proposed, or stay with the name and tagline it is usually changed with?
5. Whether this is pulled forward now. It belongs to no phase in docs/10; it is upkeep on Phase 3's pages.

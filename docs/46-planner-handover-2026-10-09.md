# 46 · Planner handover, 2026-10-09

Written by the planner at 14:00 UTC on 2026-10-09 for the next planner session. It covers everything since the audit
(docs/43). Read docs/11-status.md first, then this, then docs/43 and docs/44. Placeholders are used throughout. Real
names, addresses and ids stay in `deploy/.env`.

## 1. Where things stand in one paragraph

The live server is stopped on purpose for a maintenance window that Alex has extended. The job in progress is taking
the Season 1 boss mods off live until the season opens and trimming the world chunks that hold their structures.
Nothing has been changed on the live world or the live pack yet. The whole change is being rehearsed on the test
server, on a copy of the live world, through the launcher. The removal half of the rehearsal has passed. The trim half
is prepared and waiting for Alex.

## 2. State of each system

### Live

- Minecraft server: stopped since the morning of 2026-10-09. Fully stopped, not asleep. Alex decides when it comes
  back. Do not set cut-offs for him.
- Stack: web and api on the PR #22 commit. Health was green at the last check.
- Pack: unchanged. Full lock, 77 files, hash `f652ffca`. The six season mods are still in it.
- Launcher handed to players: 3.5.5, held there by deploying with `INSTALLER_TAG=3.5.5`.
- "We're live" is on. Play first is off.
- The new kit and book code (PR #19) is deployed but not yet in the live world. It needs Build and Sync. All 8 players
  carry the kit tag, so the new hold rule cannot clear anyone's inventory.
- The book exception is already in the live claims config.
- Backups: a pre-removal backup was taken from the AMP panel on 2026-10-09 and must not be pruned. The nightly backups
  go to the NAS and to S3. Alex confirmed eight files in the bucket matching AMP's list.
- The live server was started by accident at 13:15 UTC. It went to sleep at 13:20, was woken by the site's Play link
  at 13:20, and was stopped at 13:22 (AMP showed it Stopped at 13:23). Nobody joined.

### Test

- Instance `DeepslateTEST01` on the AMP host. The VM was raised to 20 GB. Test heap 2048 min and 3072 max. Game port
  25573. Its own route on mc-router as `lab.dsw.test`. No backups. Start on boot off. Sleeps after 5 minutes.
- Whitelist is off so the door works like live. "Enforce Whitelist" is still ticked and should be unticked.
- The test stack (web-test, api-test, its own database) is up behind the live admin check at
  `test.deepslate.dsw.test`.
- The test server is silent on Discord by code: only an api marked `DISCORD_TALKS=1` gets the bot and the players'
  webhooks.
- The test checkout is held on purpose at the trimmed commit `86bdcc5c` (lock hash `d44eb2ba`, 71 files) while the
  test images move ahead. `test-pull.sh` refuses to move it.
- The test world is a byte-for-byte copy of the live world taken on 2026-10-09 with live stopped. The small original
  test world is kept beside it under a dated name.
- Starts and stops of the test instance go through the test site so they are logged.

### Launcher

- 3.6.0 is on Alex's PC only, from the CI artifact. It adds a Test tab for admins, with its own game folder
  (`.minecraft-deepslate-works-test`) and its own launcher profile (Deepslate Works TEST). It includes the 3.5.6
  readability fix.
- 3.6.0 has known faults, listed in section 8. It must not go to any player or tester until 3.6.1 is built and Alex
  has checked it.

### Repo

- PRs #18 to #22 are merged to `main` and deployed: test server, kit and book, Discord gate, launcher Test routes with
  the Minecraft role feature and the change log guard, and the middleware fix.
- `dev` currently carries the full pack. The removal was reverted on `dev` so that deploying the launcher routes could
  not push the removal to players early. On Alex's go the removal is re-applied from commit `89099a8d`, never trimmed
  by hand again. It must give lock object `8650125f`, 71 files, hash `d44eb2ba`.

## 3. Decisions made since the audit

| Date | Decision |
| --- | --- |
| 10-08 | The AMP VM goes to 20 GB, not 32. Memory was taken from the reverse proxy VM. The media VM was left alone. Test heap is 3 GB. |
| 10-08 | The test server needs no backups of any kind. |
| 10-09 | Season 1 boss mods come off live and off players' PCs until the season opens. They stay available for the test server. |
| 10-09 | The removal set is six mods: L_Ender's Cataclysm, lionfish-api, Mowzie's Mobs, geckolib, EDF Remastered and curios. Cobweb and Server Sided Portals stay. |
| 10-09 | The trim is every chunk that holds or references a boss-mod structure and has under 2 minutes of player time: 21,773 overworld chunks and 28 Nether chunks. Not the wider ice biome sweep (93,844 chunks). |
| 10-09 | A square of 512 blocks each way around spawn is excluded from the trim. |
| 10-09 | The 29 sites players have spent time at stay as ruins. None is touched today. Alex will look at the Frosted Prison near x 6672, z 2832 and the Abandoned Spire near x 7792, z 2464 later. |
| 10-09 | The rehearsal runs on a copy of the live world and through the launcher, not by moving jars by hand. |
| 10-09 | After the live trim the server reopens, and the holes are refilled by the portal's pre-generation while nobody is online. |
| 10-09 | One player (KaneFinch) lost three earned items to the removal and gets a diamond chestplate, a diamond sword and a totem of undying from the console when next online. Nobody else is owed anything. No boss has been beaten legitimately. |
| 10-09 | The launcher's Test section is for admins only in version one. A tester tick for non-admins comes later. |
| 10-09 | The Play and Test tabs must look and behave the same. Each loads its own version. |
| 10-09 | Alex wants a Maintenance button: server online, only admins with a tick on their profile can join. Until it exists, "We're live" off plus the Early access tick does the same job. |
| 10-09 | Alex wants a Discord role given automatically to everyone who has joined the game. Built and deployed, off until the role id is set. The Discord admin has been asked to create the role and give the bot Manage Roles. |
| 10-09 | Change log entries post only once a change is really live for players. |

## 4. The rehearsal

### Done and passed

- The live world copy on test is proven identical: 5,287 files, same `level.dat` hash, same seed and spawn.
- Sync of the trimmed pack to test removed exactly the six jars.
- The test server starts unattended with the mods missing and runs at 20 TPS.
- Nothing left in the pack requires any of the six mods. No visual extra requires them either.
- Launcher 3.6.0 Play test installed the trimmed pack (61 mods) into the test folder and joined.
- Alex's inventory came through intact apart from his three season items. He gained the released tag and got no
  second kit.
- Relog, a chat line and a death were logged. Nothing reached Discord.
- A PC that still has the old jars is refused with a clear "incompatible client" message, not a crash. Pressing Play
  in the app fixes it.
- The trim was dry-run on a copy: 21,773 chunks gone from terrain, entity and point of interest files and nothing else,
  in 109 seconds.
- A trimmed copy of the test world is ready on the AMP host at `/home/ladm/rehearsal/test-world-20261009-103336`.

### Still to do

1. Unlink and rejoin on test: the entrance room with the book, sign in, everything kept.
2. A restart with Alex rejoining: no second kit.
3. Stop the test instance, run the copy-back script for the trimmed world, start it.
4. Alex tours the six sites below. They should be clean terrain. Bases and spawn should be untouched.
5. Chunky refill on test (overworld radius 10200 from 0 0, then the Nether patch). Record the time and what the map
   does.
6. Final report from the AMP host session with true numbers for live.
7. After live is done: put the season mods back on test with a test-only commit and confirm the same six files return.

Sites from `locate`, run from spawn on the copied world:

| Structure | x | z |
| --- | --- | --- |
| `cataclysm:frosted_prison` | -1184 | -5104 |
| `cataclysm:abandoned_spire` | 4848 | 5296 |
| `cataclysm:abandoned_temple` | -1920 | -5184 |
| `cataclysm:abandoned_village` | -3744 | -5648 |
| `mowziesmobs:frostmaw_spawn` | -1104 | 4112 |
| `mowziesmobs:monastery` | 1696 | -1840 |

### What the rehearsal taught

- Removed items vanish only when a player logs in or a backpack is opened. The right after-check on live is each
  player's file after their first login.
- Items in chests are lost too, one log line per stack. Count the "Tried to load invalid item" lines by item.
- A player who logs in standing on a removed mod's block will fall.
- The extras were not exercised with the trimmed pack, because 3.6.0 only writes extras to the live folder.

## 5. Live removal, in order

Only on Alex's go, after he has seen the trimmed world on test.

1. Tell players in Discord. Do not name the mods or the season.
2. "We're live" off. Live stays stopped.
3. Confirm the pre-removal backup is present, or take a fresh one from the AMP panel.
4. VPS session: re-apply the removal from `89099a8d` on `dev`, state the lock hash, PR to `main`, deploy with
   `INSTALLER_TAG=3.5.5`. Confirm the build folder still says 3.5.5.
5. State what the door's mods check, the pack hash and the app's update check will each see, so nobody is held as
   missing mods.
6. Alex: Build and Sync on the live site. No Lock. Do not Start. This Sync also carries the new kit code.
7. AMP host session: fresh copy of the live world, recount the trim set, read the 8 logout positions, show Alex the
   count and region list, delete on his yes, copy back. Keep the list of trimmed chunks for the day the mods return.
8. Check each player's logout position for removed-mod blocks under or around them.
9. Alex: Start from the live site. Confirm the world loads clean and the new kit code loaded.
10. Alex: press Play in the app and join. Confirm the app removed exactly the five client jars, his extras are still
    on and the game started. Check his base and spawn.
11. Turn off the "We're live" Discord post switch, turn "We're live" on, turn the switch back on.
12. Post the change log entry: "A small pack update and a tidy-up of the world. Press Play as usual."
13. Give KaneFinch the three replacement items when online.
14. Run the refill through the portal's pre-generation while nobody is online. Let the map re-render.
15. Watch the first few players' install reports. Players are on 3.5.5 and Alex tested on 3.6.0, so their removal path
    is proven by code and by his run, not by a 3.5.5 run.

The way back: revert `89099a8d` on `dev`, merge, deploy pinned, Build, Sync, Start. If a failed start saved the world
without the items, restore the pre-removal backup first.

## 6. Still undecided

- Play first: back on, or staying off.
- View distance: 12 as the docs say, or 20 as live runs.
- The MOTD: three different values exist.
- Whether the sample Frontier and the three worldgen test packs come off the live world in the same restart. The
  planner's advice is yes.

## 7. Queue once live is back, in order

1. Launcher 3.6.1, as one reworked build. See section 8.
2. The season mods mechanism (docs/44): one `mods.json` for both servers, season mods shipped only where that season is
   in the ship list. It must land before more season work goes to test.
3. The deploy key can still delete the live world. Build the staging-folder apply step, then reopen and close I4 in
   docs/38 properly. Slow the 30 second health login.
4. Backups: one restore test into scratch, the encrypted database dump, the portal's own four-a-day runner, "Back up
   now" working while the server is stopped or asleep, backup progress on the dashboard, a list-only S3 key for the
   status script.
5. The Maintenance button and the tester tick.
6. NeoForge 21.1.253 on the server, the AMP memory registry value, view distance and MOTD, in one quiet restart.
7. AMP host noise: the failing reverse proxy agent, logrotate, pending updates.
8. File docs/41 (Season 1 rewards and finale rule) and docs/42a (AMP host half of the test server). The planner
   reissues 41. The AMP host has the 42a brief and its final report.
9. Housekeeping: old copies of `deploy/.env` and the Caddyfile, leftover tables, rotate the test secrets set on
   2026-10-08.
10. Small items: the test api asking AMP for a backup list it may not see, the test instance's "Enforce Whitelist"
    tick, the wording "Not open yet" during maintenance.
11. Everything else from docs/43 sections 3, 4 and 7.

Dates to watch: three must-vote polls close 2026-10-11 at 19:00 UTC and hold members who have not voted. Season 1
opens 2026-11-30.

## 8. Launcher 3.6.1

Known faults in 3.6.0, all found by Alex using it:

- Play test is disabled whenever a live run is waiting for Play, which is always. Workaround: press Play on the Play
  tab, close the Minecraft Launcher, wait ten seconds, then Play test.
- The Test tab is a bare panel. It must be the Play tab pointed at the test server: one shared component with a target,
  same status card, same steps, same Play button and countdown.
- Each tab must show only its own server's state and its own run's results. The footer too.
- The game check reports Custom Window Title, KotlinLangForge, scalable-cats-force and Sodium as not loaded when they
  are. It must count library and locator-loaded jars. It is also broken by the date handling in the game log.
- Extras are written only to the live folder, so the test game has none while the app says "8 on".
- The test folder does not inherit settings such as render distance.
- The test run logs "wake: not started (unreachable)" while the test server is online.
- The profile log line prints the pack name, not the profile it wrote.
- The test run leaves the test profile selected in the Minecraft Launcher.
- Start and Stop must name the server they act on and confirm. Alex started live by accident.
- The door re-admits a player it has already let in.

Delivery rules: CI builds only. Real-window tests for the app opened from the desktop, from the site's Play link and
with the live server off, with screenshots of both tabs side by side. A short plan and estimate first. Alex checks it on
his own PC before anyone else gets it.

## 9. How this project is run

- The planner writes specs and complete pastes. Alex carries them to the VPS session and the AMP host session and
  brings back their reports.
- Every paste is complete text, never "add this line". Commands for Alex are given one at a time.
- The VPS session never builds images. Deploys go `dev` to `main` by PR. Commits are authored as Alex. The repo is
  public: placeholders only, no tool attribution anywhere.
- The AMP host session has no passwordless sudo. Root steps go to Alex as numbered scripts, each backing up what it
  changes.
- Nothing touches the live world without a backup, a rehearsal and Alex's yes.
- Alex decides when live comes back.
- Three faults today passed their unit tests and failed in real use. Ask how a thing was checked in its real state
  before accepting "tests pass".

## Filing notes

Filed on `dev` as 46: number 45 was already `45-launcher-test-section.md`. Checked against docs/11 on filing:

- §2 Live, the accidental start: the paste said "started for a few minutes at 13:15 UTC and stopped at 13:22". docs/11
  records more: online 13:15:29, asleep 13:20:01, woken by the site's Play link 13:20:19, stopped 13:22:56, AMP state
  Stopped at 13:23:22, no join. The line above now says so.
- Everything else in §2 and §4 that docs/11 records agrees with it. Not recorded in docs/11, so taken as written: the
  pre-removal backup, the 5,287-file copy check, the "incompatible client" refusal, the trim dry run (21,773 chunks,
  109 s) and the trimmed copy's path. docs/42 §3 still says the test instance has `white-list=true`; the line above is
  the newer state.

## Correction note, 2026-10-09 evening (Alex and the planner)

Corrections to the rehearsal record in §4, from the AMP host session's reports and Alex's checks. The body above is
left as written.

- **The copy-back is done.** The trimmed world was copied back onto the test instance at 13:33:19 UTC on 2026-10-09 and
  again at 14:01:19, by the AMP host's script 21. §4 lists it under "Still to do". Everything Alex checked on test from
  13:37 was on the trimmed world.
- **The trim ran on the copy at 13:18 UTC**, not at 10:33. The copy's name (`…-103336`) carries the time it was copied
  out, not the time of the trim.
- **The trim also drops 25 overworld poi files:** the tool removes a file when it deletes its last chunk. They come back
  on their own as the server refills those regions.
- **Passed on the trimmed world, checked by Alex in the game:** unlink and sign in again through the entrance room with
  everything kept; a restart with no second kit; a tour of the six structure sites in §4, all normal ground with no
  structure. Spawn and his base untouched.
- **A start on the trimmed world** logs new errors only from the six removed mods, none about chunk, region or poi files.
- **The refill was not rehearsed on test** (Alex's decision). On live it runs through the site's pre-generation after
  reopening: the overworld centre 0 0, radius 10176; the Nether centre 80 576, radius 432. §4's radius 10200 would also
  generate a ring of new chunks beyond the edge of the world. The rounding of 10176 is unverified, so a check runs after
  the live refill.
- **Removed-mod structures inside the kept 512-block square** stay as ruins; their mod blocks turn to air.

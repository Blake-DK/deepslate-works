# 28 · Backups

Planner, 2026-10-03, on Alex's "I need a proper backup schedule. I have set up S3 backup and backups to my NFS server but I need it to integrate with the site portal". Input for the VPS session and the AMP host session: read it, don't rewrite it. Report in `docs/11-status.md`. This is a big update: one PR per step of §9 is fine, nothing smaller.

**Amended 2026-10-03 by Alex (schedule):** local backups to the NAS every 6 hours, at 04:00, 10:00, 16:00 and 22:00 UK time; the 04:00 run also goes to S3, every night, and is the only run that pushes the database dump. Local retention 28 backups (7 days); S3 retention 30 days by a lifecycle rule on the bucket, set by Alex. Every rule below applies to every run, not only the nightly one. Backups are expected to be about 18 GB once the map tiles are excluded (§3 C); the AMP host's report gives the real figure.

**Amended 2026-10-03 by the planner (catch-up, off-site hand-on, verdict defaults, limits, load):** a missed time is caught up only when the next one is more than 60 minutes away (§4.4); a scheduled run waits for one in progress (§4.3 step 1); a missed, waited-out or failed off-site run is handed on once to the next run (§4.3, §4.4); `warnAfterH` 13 and `offsiteWarnDays` 2 (§4.4); `times` and `offsiteTime` validated (§4.4); AMP's count limit 32 and a warning at it (§3 D, §4.5); TPS measured during a run with players online (§10).

It closes `docs/10-roadmap.md` P0 item 1 (the backup route), the BACKUP half of P1 item 9 and the ROADMAP line "Automated world backups to off-site storage".

## 1. What exists and what is wrong with it

| Thing | Today | Fault |
|---|---|---|
| World backup | AMP's `LocalFileBackupPlugin`. The portal has one button (`POST /server/backup`, Admin → Server) | Fixed title, does not wait for AMP to list the backup, says "ok" when AMP later drops it. On 2026-10-03 AMP accepted three requests over its size limit and listed none of them |
| NFS | The NAS shares (10.0.10.122) are mounted on the AMP host. Alex has pointed backups at one of them | The planner does not know how (AMP's backup folder on the share, or a copy job). Nothing checks that the share is mounted when a backup is written |
| S3 | Alex has set it up | The planner does not know where (AMP's own S3 settings is the guess). The portal's call sends `S3: false`, so a portal backup never goes there |
| Schedule | Not checked. AMP may have a trigger of its own | Nobody knows when the last good backup was without opening AMP |
| Database | `deepslate-backups` dumps nightly to `/root/docker/deepslate/backups` on the VPS, 14 kept | The dumps never leave the VPS. If the VPS is lost, so are the accounts, links, votes and the event log |
| Telling anyone | Nothing | A backup that stops working is noticed on the day it is needed |

The world is about 36.7 GB after the ±3072 pre-generation and a backup takes about 17 minutes to appear in AMP's list.

## 2. The design in one page

**The portal owns the schedule. AMP does the work. The AMP host says what really exists.**

1. **`api` is the only scheduler.** It already knows who is online, whether pre-generation runs, whether a restart is planned and whether a Sync is in progress. AMP's own backup trigger, if there is one, is switched off once the portal's schedule has run for two days (§3 E), so that there is one schedule and one place to change it.
2. **AMP stays the engine.** A backup is `LocalFileBackupPlugin.TakeBackup`, as today, with a real title and with `S3: true` on the 04:00 run, which goes off site every night. No second backup tool, no Duplicati, no new container.
3. **The local copy lands on the NFS share**, because that is where AMP's backup folder is (or will be after §3 B). The S3 copy is AMP's own upload.
4. **AMP's word is not trusted.** A small script on the AMP host looks at the share and at the bucket every 15 minutes and writes what it sees to `_backup/status.json` inside the instance. `api` reads that file through AMP's file manager, which it may already do. A backup counts as good when the file on the share is there with a size, not when AMP said yes.
5. **The database rides along.** Before the 04:00 world backup (or the run standing in for it, §4.3 step 2) `api` copies the newest database dump into `_backup/db/` in the instance over the rsync link it already has. It is then inside the world backup (so on the share and in S3) and the AMP host script also keeps the last 30 dumps as plain files on the share.
6. **One page, one verdict.** Admin → Backups shows the three places, the schedule, the runs and one line that is green, amber or red. The same verdict is in `/api/health` and a red one goes to the Discord admin channel.

The portal still cannot delete or restore a backup. `webapp` keeps exactly the two backup permissions it has. Restoring is done in AMP by a person, from the runbook in §8.

```
04:00 10:00 16:00 22:00 UK
           api: anything changed since the last good backup?  no → SKIPPED, done
           api (04:00 only): newest db dump  ──rsync──►  instance/_backup/db/
           api: save-all flush (if running) → TakeBackup {Title, Local:true, S3: 04:00 run?}
           AMP: archive → backup folder (on the NFS share) → upload to S3 (04:00 run)
           api: polls GetBackups until the title is listed with a size (or fails loudly)
every 15'  AMP host: looks at the share and the bucket → instance/_backup/status.json
           api: reads status.json → BackupRun row, verdict, health, Discord if red
```

## 3. The AMP host session

Rules for this part: nothing is deleted, the server is not stopped or restarted while anybody is online, no key or password is written into a report, a status file or this repo. Anything that needs the instance stopped is named first and waits for Alex's yes.

### A. Report first (read only)

Write the answers into the report (§3 H). The VPS session needs them before it builds.

1. **The shares.** `findmnt -t nfs,nfs4`, the `/etc/fstab` lines, the mount options, free and total space of each. Which share is meant for backups.
2. **Where AMP writes backups for `DeepslateWorks01`.** The real path on disk. Is it on the share? By what means (a symlink, a bind mount, an AMP setting, a copy job)? What the files are called and what format they are (zip or tar.gz).
3. **AMP's backup settings for the instance**, from the instance's own config (`LocalFileBackupPlugin.kvp` or what this version calls it): the size limit of one backup, the total size limit, the count limit, compression, the S3 endpoint, region and bucket. **Never the access key or the secret.**
4. **AMP's schedule.** Is there a trigger that takes backups? When and with which options (local, S3, sticky)?
5. **What is in the bucket and on the share now**: count, newest, total size.
6. **What a backup contains.** `du -sh` of each top-level folder of the instance and of `bluemap/web/maps` (or wherever the map tiles are) by itself. Whether a `.backupExclude` file exists in the instance root.
7. **The file manager's root and the rsync root.** `api` reads files through AMP's file manager and writes through rrsync as `amp`. Confirm both see the same folder (the one with `mods/` and `world/`) and give its path on disk.
8. **Tools on the host**: `aws`, `rclone`, `mc`, `jq`, `python3`. Nothing is installed without saying so.
9. **Upload speed** to the bucket if it is known from an upload that already ran (size and time). Do not run a speed test.

### B. The share must be mounted, or the backup must fail

A backup written while the share is not mounted would land on the AMP host's own disk under the empty mount point, fill it and look fine.

1. fstab options for the backup share: `nofail,_netdev,hard` plus what is there, no automount. `nofail` so that the host still boots when the NAS is off; `hard` so that a NAS that drops out mid-backup makes the write wait rather than writing a short file (the portal's give-up timer catches a wait that never ends). Automount is left out because it hides the mount point folder that the next step works on.
2. Make the empty mount point refuse writes: with the share unmounted, `chattr +i` on the mount point folder. Unmounting needs the instance not writing a backup; do it with nobody online and say so first.
3. If AMP's backup folder is not on the share yet, say what it would take and wait. Do not move existing backups without Alex's yes.

### C. What goes into a backup

AMP reads `.backupExclude` in the instance root (from the planner's memory, one pattern a line; **confirm against this AMP version before relying on it**). If it works:

- Exclude the rendered map tiles if they are larger than 2 GB. They can be rendered again from the world (a few hours for ±3072).
- Exclude `logs/` and `crash-reports/`.
- **Never exclude** `world/`, `_backup/`, `config/`, `defaultconfigs/`, `mods/`, `server.properties`, `whitelist.json`, `ops.json`.

Report the size of a backup before and after. If the file is not supported, change nothing and report that.

### D. Limits and how many are kept

Pruning is AMP's job, not the portal's.

- One backup must fit: the single-backup limit at least **three times** the size of today's backup. The count limit **32**: the **28** scheduled backups (7 days at four a day) plus room for backups taken by hand and `BEFORE` runs, so that they do not push the week short. The total size limit fits 32 at today's size with one more to spare. If the share cannot hold that, report how many it can and stop.
- S3: kept **30 days** by a lifecycle rule on the bucket, which Alex sets. If AMP prunes the bucket itself, report by what rule, so that it does not cut the bucket below 30 days.
- Write the three limits into `status.json` (§3 F) so the portal can warn before a backup outgrows them.

### E. One schedule

Leave AMP's own backup trigger as it is for now. When the VPS session reports two good days of scheduled runs from the portal, switch AMP's trigger off (do not delete it) and report the time it was switched off.

### F. The status script

`/usr/local/bin/deepslate-backup-status`, run by a systemd timer every 15 minutes (`deepslate-backup-status.timer`, `OnCalendar=*:0/15`, `Persistent=true`), as root (it reads a root-only env file and AMP's config) and it `chown`s what it writes to the user that owns the instance's files. Shell or Python, whichever is on the host; no new packages unless one is named in the report.

It does three things:

1. **Looks.** Is the share mounted (compare the device of the mount point with its parent, or `findmnt`)? Free and total bytes. The backup files in AMP's backup folder: name, bytes, modified time. The bucket: object count, total bytes, newest object (key, bytes, time).
2. **Copies the database dumps.** Everything in `<instance>/_backup/db/*.sql.gz` that is not yet in `<share>/deepslate-db/` is copied there; the newest 30 are kept in that one folder. This is the only place the script may delete and only files matching `deepslate-20??-??-??.sql.gz`.
3. **Writes** `<instance>/_backup/status.json`, to a temporary name first and then renamed, mode 644.

For the bucket the script needs to list, nothing more. In order of preference: a key of its own that may only list the bucket (Alex makes it, kept in `/etc/deepslate-backup-status.env`, mode 600, root); or AMP's own S3 settings read from its config each run and never written anywhere else; or `"checked": false`. The script must not fail when the bucket cannot be reached: it writes the error and carries on.

The file, version 1. Field names are fixed; the VPS session parses exactly this:

```json
{
  "v": 1,
  "at": "2026-10-04T03:45:00Z",
  "host": "amp-01v",
  "nfs": { "mounted": true, "source": "10.0.10.122:/mnt/…", "path": "/mnt/…", "freeBytes": 0, "totalBytes": 0 },
  "local": {
    "dir": "/…/Backups", "onNfs": true, "count": 7, "totalBytes": 0,
    "files": [ { "name": "…", "bytes": 0, "mtime": "2026-10-04T03:47:10Z" } ]
  },
  "s3": {
    "checked": true, "endpoint": "s3.example.com", "bucket": "…", "count": 4, "totalBytes": 0,
    "newest": { "key": "…", "bytes": 0, "mtime": "2026-10-01T04:10:00Z" },
    "error": null
  },
  "db": { "dir": "/mnt/…/deepslate-db", "count": 12, "newest": { "name": "deepslate-2026-10-04.sql.gz", "bytes": 0, "mtime": "…" } },
  "limits": { "maxBackupBytes": 0, "maxTotalBytes": 0, "maxCount": 0 },
  "errors": []
}
```

`local.files` is the newest 20, newest first. Times are UTC, ISO 8601. A value that is not known is `null`, never left out. No secret in the file, ever.

### G. Nothing new for `webapp`

`webapp` keeps `LocalFileBackup.Backup.CreateBackup` and `…ViewBackupsList`. No delete, no restore, no settings. If `TakeBackup` with `S3: true` is refused for `webapp`, report the permission AMP names and wait.

### H. The report

One block of text for Alex to carry to the VPS session: the answers to A in order, what was changed in B to D with the time of each change, the path of every file created or edited with a copy of the old one (`/root/deepslate-backup-<date>/`), the output of one run of the script (the JSON, as written) and anything refused or not done.

## 4. The VPS session: `api`

### 4.1 Before any code

With the AMP host's report in hand, on the running instance (the working rules: verify AMP against the live instance):

1. Record in `docs/08-api.md` the real shape of one row of `GetBackups` (which field says it is stored locally, which says it is in S3, the id, the size, the time) and what `TakeBackup` answers.
2. **One backup with the server asleep**, title "Test, asleep". Does AMP list it? If yes, a sleeping server is backed up as it is and never woken. If no, the runner holds sleep off for the length of the run with the switch pre-generation already uses (`status/pregen.ts`, `SLEEP_NODE`) and hands it back afterwards, also when the run fails.
3. **One backup with `S3: true`**, title "Test, S3". Listed and the object in the bucket by `status.json`?

Write the three results into docs/11 before step 2 of §9.

### 4.2 `BackupRun`

A new table (migration `00NN_backup_run`, a `pre-00NN` dump first as always):

| Column | |
|---|---|
| `id`, `startedAt`, `finishedAt` | |
| `trigger` | `SCHEDULE`, `MANUAL`, `BEFORE` (asked for by another job: a Sync, a season wipe) |
| `byUserId` | null for the schedule |
| `title` | as sent to AMP |
| `wantS3` | boolean |
| `state` | `RUNNING`, `OK`, `WARN`, `FAILED`, `SKIPPED` |
| `reason` | one line a person can read; always set for `WARN`, `FAILED`, `SKIPPED` |
| `ampId`, `sizeBytes` | from AMP's list, once listed |
| `onShare`, `inS3` | null until `status.json` has been read after the run; then what it showed |
| `dbDump` | file name of the dump pushed, null if none |

Kept for 180 days, pruned with the events.

### 4.3 A run (`apps/api/src/backup/run.ts`)

One at a time: a second request while one runs gets 409 `busy`. A row left `RUNNING` by an `api` restart (a deploy, say) is picked up again at start-up: AMP carries on with the backup whatever the portal does, so the runner goes back to step 6 with the row's title and the give-up window counted from `startedAt`. Only a row older than that window is closed as `FAILED` "the portal restarted during the backup".

1. **Refuse or wait.** A Build or Sync in progress, a planned restart inside the next 30 minutes, pre-generation in phase `generate` or `render`, the last `status.json` saying `nfs.mounted` false or being older than an hour, or players online while AMP says `BackupWillStopServer`: a scheduled run tries again every 10 minutes for 2 hours, then `SKIPPED` with the reason; a manual run is refused with the reason at once. For a scheduled run, another backup run in progress is a wait condition too: it tries again every 10 minutes for 2 hours, then `SKIPPED` "the previous backup was still running". When it gets its turn it goes through steps 1 and 2 again from the top, so a run that follows straight after another is normally `SKIPPED` "nothing changed". A manual request while a run is in progress still gets 409 `busy` at once. (On 2026-10-03 AMP backed the world up with Alex online and the server stayed up, so the last one should not bite; it is there for the day AMP's setting changes.)
2. **Skip when nothing changed** (schedule only). If no player has been online since the last `OK` run started (`JOIN` events), no Sync has run since and no pre-generation has finished since, the run is `SKIPPED` "nothing changed since <date>". The 04:00 run (S3) is skipped only if the last `OK` run with `inS3` is also newer than the last player.

   **The off-site run is handed on.** If the `offsiteTime` run was missed, waited out or ended `FAILED`, the next scheduled run that starts takes its place: `S3: true`, the dump push (step 3) and the "(off site)" title. Once only: the duty ends with the first run that starts carrying it, whatever that run's result, and the next `offsiteTime` starts afresh. A run that was `SKIPPED` "nothing changed" hands nothing on. The run's row says why it went off site ("standing in for the 04:00 run").
3. **Push the database dump** (the 04:00 run only, or the run standing in for it; the other three runs push nothing and their backups carry the dump already in `_backup/db/`). The newest `deepslate-20??-??-??.sql.gz` from `/dbdumps` (new read-only mount of `/root/docker/deepslate/backups` in `api`) is copied into an empty staging folder in `api` and that folder is rsynced to `_backup/db/` **with `--delete`**, so the instance (and every world backup) holds exactly one dump: the night's. The AMP host script has already copied earlier ones to the share. Older than 26 hours: carry on, the run ends `WARN`. Push fails: carry on, `WARN`. The dumps are written by the `deepslate-backups` container; check once that `api` (uid 1000) can read them and fix the mode in the compose command if not.
4. **Save.** Server running: `save-all flush` through the registry (an action `world.saveFlush` if none fits) and wait up to 60 s for "Saved the game". Asleep or stopped: nothing.
5. **Ask.** `TakeBackup` with `Title` = the run's title, `Local: true`, `S3: wantS3`, `Sticky: false`, `WasCreatedAutomatically` true for the schedule. Titles: "Scheduled 2026-10-04 10:00", "Scheduled 2026-10-04 04:00 (off site)", or what the admin typed (1 to 60 characters, letters, digits, spaces and `-_.,()` only), default "Portal backup <date time>".
6. **Wait until it is real.** Poll `GetBackups` every 30 s for a row with that title and a size above zero. Give up after the longer of 45 minutes and three times the last `OK` run's duration: `FAILED` "AMP accepted the backup and never listed it. Check AMP's size limit and the space on the share."
7. **Check the places.** Wait for a `status.json` written after the row appeared (at most 20 minutes). `onShare` = a file in `local.files` within 2% of AMP's size and modified during the run, with `nfs.mounted` and `local.onNfs` true. `inS3` (only when wanted) = `s3.newest` modified during the run, or AMP's row saying so if §4.1 found a field for it. S3 uploads can outlast step 6: keep looking for up to 6 hours in the background, the run stays `OK` with `inS3` null until then and turns `WARN` "not seen in the bucket after 6 hours" if it never shows.
8. **End.** `OK` when listed and on the share (and in S3 if wanted, once seen). `WARN` when listed but something beside it is off (dump stale or not pushed on the 04:00 run, not on the share, `status.json` older than an hour). `FAILED` otherwise. One `BACKUP` event per run with the state, size, duration and places; a manual one names the admin.

### 4.4 The schedule (`apps/api/src/backup/schedule.ts`)

A tick every minute. Nothing is held only in memory: whether a scheduled time's run happened is read from `BackupRun`. If `api` was down at the time (a deploy), a missed scheduled time is run when `api` comes back only if the next scheduled time is more than 60 minutes away. Otherwise it is not run and gets a `SKIPPED` row, "missed while the portal was down; the next run is at <time>". So a catch-up never starts in the hour before the next run. A missed `offsiteTime` run is handed on as in §4.3 step 2.

A new Setting section `backups` (edit `apps/web/src/shared/settings.ts`, copy to `api`, as the file's header says):

| Field | Default | |
|---|---|---|
| `on` | `true` | the schedule; "Back up now" works either way |
| `times` | `["04:00", "10:00", "16:00", "22:00"]` | UK times, through the same rule as `uk-time.ts` (moved to `shared/` if `api` needs it) |
| `offsiteTime` | `"04:00"` | the one of `times` that also goes to S3, every night, and pushes the database dump; `null` for none (the dump then goes with the first run of the day) |
| `skipUnchanged` | `true` | §4.3 step 2 |
| `warnAfterH` | `13` | no good backup for this long while people have played: red (two scheduled runs gone) |
| `offsiteWarnDays` | `2` | no S3 copy for this long while people have played: amber |

Validation: `times` holds 1 to 8 entries, each `HH:MM`, no duplicates, each at least 3 hours from the next (the 2-hour wait plus room for the run), counted round midnight. `offsiteTime` is one of `times`, or null. A form that breaks a rule says which one in a line a person can read. `warnAfterH` and `offsiteWarnDays` stay editable in the form.

### 4.5 The verdict (`apps/api/src/backup/verdict.ts`, pure, tested)

One of `ok`, `warn`, `bad`, with one line each.

- **bad**: the last run `FAILED`; or people have played and the last `OK` run is older than `warnAfterH`; or `nfs.mounted` is false; or the share has less free space than 1.2 times the last backup (AMP prunes after it writes, so the share must hold one more than it keeps).
- **warn**: the last run `WARN`; the share has less free space than twice the last backup; `status.json` missing or older than an hour; the last S3 copy older than `offsiteWarnDays` while people have played; the newest database dump older than 36 hours; the last backup above 80% of `limits.maxBackupBytes`; `local.count` at or above `limits.maxCount`, "AMP is at its backup count limit and is dropping the oldest"; the schedule off.
- **ok**: none of those. "Last backup 4 Oct 04:47, 36.7 GB, on the NAS and in S3. Next: today 10:00."

### 4.6 Routes

| Method | Path | Does |
|---|---|---|
| GET | `/backups` | admins: the verdict, the settings, the next run's time and whether it goes to S3, the run in progress (step and seconds so far), the last 30 runs, AMP's list, `status.json` as read with its age |
| POST | `/backups/run {title?, s3?}` | admins: starts a manual run, 202 with the run's id; 409 `busy`; 403 as today when AMP's permission is missing |
| GET, POST | `/server/backup` | kept so nothing breaks: GET as today; POST starts a manual run exactly as `/backups/run` |

`GET /health` gains `backups: { verdict, lastOkAt, lastOffsiteAt, line }`, reported and not required, like `pack`: `ok` does not change. `docs/19`'s `amp_backups` tool reads `GET /backups`.

### 4.7 Files and the dump folder

- `_backup/db/` is never shown or downloaded by Admin → Files. Refuse it in code next to the denied list, not only as a new default, because a saved list does not pick up a new default.
- `api` reads `_backup/status.json` by its own reader (`backup/status.ts`), size capped at 256 KB, parsed with zod; a file that does not parse is treated as missing and said so.
- `deploy/docker-compose.yml`: `- /root/docker/deepslate/backups:/dbdumps:ro` on `api`. Nothing else changes in compose; no new container, no new memory.

### 4.8 Discord

To the admin channel only, by the path crashes already take (`announcer.ts`, setting `problems`), never to #game-chat:

- a run that ends `FAILED`: at once, with the reason;
- the verdict turning `bad`: once, then once a day at 09:00 UK while it stays `bad`;
- the verdict back to `ok` after `bad`: one line.

## 5. The VPS session: `web`

**Admin → Backups** (`/admin/backups`, admins only, in the admin tab strip after Server). The backup card on Admin → Server becomes one line with the verdict and a link.

1. **The verdict**, across the top, green, amber or red, in the words of §4.5.
2. **Three cards**: "On the NAS" (count, newest with size and age, free space, "the share is not mounted" in red when it is not), "Off site (S3)" (count, newest, total, "not checked" when the script cannot list), "Database" (newest dump on the VPS, newest on the NAS). Each says how old its information is ("checked 6 minutes ago").
3. **Back up now**: a title box, a tick "also send to S3", a confirmation inside the page (no `window.confirm`). While a run is in progress the button is replaced by its step and a timer, refreshed every 5 seconds: "Saving the world", "AMP is writing the backup (11 min)", "Checking the NAS", "Uploading to S3".
4. **Schedule**: the fields of §4.4 as a form, with the next run spelled out ("Today at 10:00 UK time, NAS only", "Tomorrow at 04:00, NAS and S3").
5. **Runs**: the last 30, newest first: when, what asked for it, state, size, how long, where it is (NAS, S3), the reason.
6. **Restoring**: three sentences and a link to the runbook. "Restoring is done in AMP, not here, so that nobody can roll the world back with one click."

Admin overview (`/admin`) shows the verdict as one chip. Players see nothing of this.

Copy in plain English, British spelling. "NAS" and "off site" in the page, not "NFS" and "S3 bucket", except on the Off site card where S3 is named once.

## 6. Other jobs that want a backup first

`BEFORE` runs use the same runner and wait for it:

- **Sync with a changed mod set**: when the last `OK` run is older than 24 hours and people have played since, Admin → Modpack offers "Back up first" (ticked). Not forced.
- **The season wipe** (docs/20): its "backup taken in the same run" is this runner, with S3 and the wipe does not start unless the run ends `OK` with `onShare` true.

Build these two only after §9 step 6. They are small.

## 7. Tests

- `verdict.ts`: every rule of §4.5, both sides of each threshold, "nobody has played" turning a late backup into `ok`.
- The schedule: the UK times across both clock changes, the 04:00 run going to S3 and pushing the dump while the other three do neither, a missed run picked up after a restart, never two runs for one scheduled time; a missed time with the next one 61 minutes away is run, with 59 minutes it is `SKIPPED` "missed while the portal was down; the next run is at <time>"; a scheduled time arriving while a run is in progress waits, then runs or is `SKIPPED` after 2 hours; the off-site duty handed on after a missed, a waited-out and a `FAILED` 04:00 run, handed on once only, not handed on after "nothing changed"; the validation of `times` and `offsiteTime`, both sides of the 3-hour rule and round midnight.
- The verdict at 12 and 14 hours since the last `OK` run and at 1 and 3 days since the last S3 copy, with people playing.
- The runner against a mocked AMP: listed at once; listed after 17 minutes; never listed (`FAILED` with the size-limit line); refused by permission; `api` restarted mid-run; busy; skip when unchanged; the dump stale; the share not mounted in `status.json`.
- `status.json`: the example of §3 F parses; a missing field, a wrong type, an oversized file and a secret-looking extra field are all handled (extra fields dropped).
- Files: `_backup/db/` refused with a saved denied list that does not name it.
- The title rule: what is allowed, what is refused.

## 8. Restoring (goes into `docs/09-ops.md`, "Runbook")

Written by the VPS session from what the two sessions saw and **tried once** (§10):

- **The world, AMP still there**: AMP → the instance → Backups → the backup → Restore, with the server stopped. From S3: the same list, AMP fetches it first.
- **The world, AMP's list gone**: the archive on the share, unpacked over a stopped instance by the AMP host session, owner and mode kept.
- **The database**: `gunzip -c deepslate-YYYY-MM-DD.sql.gz | docker exec -i deepslate-db psql -U deepslate -d deepslate` into an empty database, from the VPS's own dumps, the NAS (`deepslate-db/`) or `_backup/db/` inside a world backup.
- **Both together**: the database dump inside a world backup is the one taken the same night. Use the pair.
- **Not backed up anywhere by this**: `deploy/.env`, the WireGuard keys and the deploy key. Alex keeps a copy of those in his password manager. They do not go to S3.

## 9. Order of work

1. **AMP host**: §3 A (report), then B, C, D, F, with Alex's yes where §3 asks for it. Report to Alex.
2. **VPS**: §4.1, the three checks on the live instance. Written into docs/11.
3. **VPS**: `BackupRun`, the runner, the routes, `status.json` reader, the dump mount and push, the file refusal. Tests. PR, deploy. A manual run from `curl` ends `OK` with `onShare` true.
4. **VPS**: the schedule, the settings section, the verdict, health. PR, deploy.
5. **VPS**: Admin → Backups, the chip, the Server page's line. PR, deploy.
6. **VPS**: Discord lines. Two days of scheduled runs watched. Then the AMP host switches AMP's own trigger off (§3 E).
7. **Both**: the restore test (§10). The runbook. Docs 02, 03, 05, 08, 09, 10, 11 and `ROADMAP.md` brought in line.
8. **VPS**: §6.

## 10. Acceptance

- [ ] The AMP host's report answers every point of §3 A and names every change with its time.
- [ ] With the share unmounted, a backup fails and nothing is written to the AMP host's own disk.
- [ ] `status.json` is rewritten every 15 minutes, matches §3 F and holds no secret.
- [ ] A manual backup from the page ends `OK`, is in AMP's list under the title typed and is on the NAS by `status.json`.
- [ ] A backup with "also send to S3" is seen in the bucket by `status.json` and the run says so.
- [ ] A request AMP accepts and never lists ends `FAILED` with the size-limit line, on the page and in the admin channel. (Tried with the mock; not by breaking the real limit.)
- [ ] Over two days every scheduled run either ran by itself at its time or was `SKIPPED` "nothing changed", and both 04:00 runs are seen in the bucket by `status.json`.
- [ ] A deploy at 03:55 does not lose the 04:00 run and does not make two.
- [ ] The newest database dump is on the NAS and inside the night's 04:00 world backup.
- [ ] Admin → Files refuses `_backup/db/`.
- [ ] `/api/health` carries `backups`; with the schedule switched off the verdict is amber and says why.
- [ ] A scheduled run with at least one player online: TPS from the poller during the run, the lowest figure and the median and the run's length, in docs/11. Below 18 TPS for more than a minute is reported to the planner before step 6 is called done.
- [ ] **Restore, tried**: the AMP host session unpacks last night's archive from the NAS into a scratch folder (not the instance), `level.dat` is there, the region file count matches the live world's within the night's difference and the archive passes its own integrity test. The VPS session loads last night's dump into a throwaway `postgres:16-alpine` (`--memory=256m`) and counts the users. The scratch folder and the container are removed afterwards. Times and sizes in docs/11.
- [ ] AMP's own backup trigger is off, with the time it was switched off in docs/11.
- [ ] docs/11 says what was seen for each line above.

## 11. Rules that are not negotiable

- The portal never deletes or restores a backup and `webapp` never gets the permission to.
- No S3 key, NAS password or bucket secret in the repo, in `deploy/.env`, in `status.json`, in a report or in the event log. `api` never talks to S3 or to the NAS; it talks to AMP and reads one file.
- No backup tool beside AMP's, no new container on the VPS, no image built on the VPS.
- Nothing outside the deepslate stack is deleted. On the AMP host nothing is deleted at all except old dumps in `deepslate-db/` by the script's own rule.
- A backup is never reported as good on AMP's "ok" alone.

## 12. For Alex to decide (the defaults above hold until he says otherwise)

1. **S3**: decided by Alex 2026-10-03: the 04:00 run, every night, about 18 GB once the map tiles are excluded; the bucket keeps 30 days by its lifecycle rule.
2. **The times**: decided by Alex 2026-10-03: 04:00, 10:00, 16:00 and 22:00 UK (04:00 UK is 07:00 in Dubai during British Summer Time, 08:00 from 25 October).
3. **The database dump in S3** sits inside the world backup, not encrypted beyond what the bucket does. It holds members' email addresses, Discord ids and password hashes. The bucket must be private. If that is not good enough, say so and the dump stays on the NAS only.
4. **A list-only key for the bucket** for the status script (§3 F), or let the script read AMP's own S3 settings.

## Amendments 2026-10-04 (planner, after the AMP host's report)

1. Sizes. BackupRun gets rawBytes beside sizeBytes: sizeBytes is the zip (CompressedSizeBytes), rawBytes is TotalSizeBytes. The "above 80% of limits.maxBackupBytes" rule of §4.5 uses rawBytes, because AMP's limit applies to the raw size. The onShare match of §4.3 step 7 uses sizeBytes. §4.1 step 1 records which GetBackups field is which.
2. BackupWhileRunning. The route sends null today. §4.1 records what null does on this version; the runner sends true unless that check gives a reason not to, which is then written into docs/11.
3. inS3 while s3.checked is false. inS3 is taken from AMP's StoredRemotely, the run's row and the Off site card say "by AMP's word, the bucket has not been listed", and the verdict is warn with that line for as long as s3.checked is false. This is the one place AMP's word is used and it is said on the page.
4. status.json errors. Any entry in errors that §4.5 does not already cover makes the verdict warn with the first entry as its line. "share not mounted", "share mounted but not responding", "backup folder is not on the share" and the two "restart the instance" lines are bad. A run is refused or waits (§4.3 step 1) on any bad one.
5. The share and starting. With the share unmounted the instance cannot start. When POST /server/start fails and the last status.json says nfs.mounted false, the reason shown is "The NAS share is not mounted, so the server cannot start", on Admin → Server and in the admin channel.
6. §3 C: logs/ and crash-reports/ stay in the backup. world-backup-20260929 and tacz_backup are excluded.
7. §3 D: S3 is pruned by AMP by count (40), not by the bucket's lifecycle rule. offsiteWarnDays and the Off site card are unchanged.
8. §3 E and its acceptance line: AMP's trigger was switched off at 2026-10-03 19:43:05 UTC and runs as an interim nightly backup until two good days of portal runs, then off again. Both times go into docs/11.
9. §10 restore test: AMP skips zero-byte region files (532 of 5,251 on 2026-10-03), so the count compared is the non-empty .mca files.
10. §10, new line: a boot of the AMP host with the NAS blocked, run by the AMP host session on Alex's yes, with what the portal showed during it (verdict, health, the start reason of point 5) in docs/11.

# Read-only check of amp-01v, 2026-10-04 12:50–12:55 UTC

Written by the tooling session on the AMP host, in answer to the check list from the VPS review of
2026-10-04 (docs/31-review-and-bug-list.md, docs/32-seasons-1-to-4-roadmap.md).

Nothing on the instance, AMP, the NAS or the host was changed. The only writes were temporary copies of the game logs in the session's scratch folder, deleted afterwards.

Things that most need attention:
- **Server is asleep.** AMP stopped the Java server at 11:21 UTC, 5 minutes after the portal turned sleep mode back on at 11:16:40. There is no Java process, and BlueMap (8100) and voice chat (24454) are not listening.
- **The last backup of the old world is incomplete.** The portal backup of 2026-10-03 22:07 was still staging when the world was removed at 22:15:23; AMP skipped 2,184 files.
- **The deploy key can delete.** `rrsync` runs without `-ro`, so the portal's key has write and delete rights on the whole `Minecraft/` tree.
- **No list-only S3 key.** Both values in `/etc/deepslate-backup-status.env` are empty, so no S3 upload has been verified from this host.
- **`webapp` has more than the brief expects.** It holds the wildcards `Settings.MinecraftModule.Game.*` and `Settings.MinecraftModule.Minecraft.*`.

## 1. The pack on the instance

Instance root is `/home/amp/.ampdata/instances/DeepslateWorks01`, game folder `Minecraft/`.

- **Mods:** 62 jars in `Minecraft/mods`, 305 MB (`sha1sum` + `stat`). There is no lock file on this host to compare against `0d33a462` or `d7521da9`.

```
sha1                                          bytes  jar
17debf7846d5d3b287a2920449154d85e5b9541e     733289  AdditionalEnchantedMiner-1.21.1-neoforge-21.1.164.jar
1201c14362f2bad7062d315f8a9b26afbabd2c9c      50425  alternate_current-mc1.21-1.9.0.jar
36e2b147d86c31262bf8f7c571aeea683d71173d    2422436  another_furniture-neoforge-4.0.3.jar
81cf0e668f991f83ac8820c386fbd6c9c3602246      75804  appleskin-neoforge-mc1.21-3.0.9.jar
bcd04bc7f181b2ffa314625f284c8eca6fee7fe4    8236552  appliedenergistics2-19.2.18.jar
287ec5c76bf9f7f8493e789f70759ab993784f5e     299325  async-locator-refined-neoforge-1.21.1-1.6.0.jar
dd3606a349f4a3c8fb5bd0ab22905675c02b0d74     783793  balm-neoforge-1.21.1-21.0.66.jar
49675ada6be555e6f8393f49aff91750028e1239    5414670  bluemap-5.7-neoforge.jar
ab0c74743a653020fe2dfc4986b43e893947f3e9     340572  Chunky-NeoForge-1.4.23.jar
fa2576297c7bd12b28aa7070e8141792bd66da4c      18382  Clumps-neoforge-1.21.1-19.0.0.1.jar
74de17876c43f5f780bac478b9f9eb11e687b8d7    1799381  copycats-3.0.9+mc.1.21.1-neoforge.jar
a735362c4e5ef705956f1fcbac01fb9f1aae5b8e     253694  corpse-neoforge-1.21.1-1.1.13.jar
0e97e49837bed766e6f28a4c95b04885d6acc353   19123767  create-1.21.1-6.0.10.jar
87b539d41ed238e98b26c607c0c81a973323147e    1661802  createaddition-1.6.0.jar
c90ee0b2142e2c58d233e150cb3a24c7cb07eb2d    3771506  createbigcannons-5.11.7+mc.1.21.1.jar
93d9eff58b46c6953e907d071e6be4e3ce07be38    3328498  createdeco-2.1.3.jar
418fcd42e3a7844c9bdc71c9b6401fdb3894e0c4     410690  curios-neoforge-9.5.1+1.21.1.jar
01badac01410bca4624fed803d9c777a43162c3d    6841557  edf-remastered-5.0.2.jar
7e1b3ee0ba89b556d5a468797bb1b5f4e2b8ccb7     496356  FallingTree-1.21.1-1.21.1.11.jar
27675ddfcb8cc37e6ea1ab6c15051c7949d94657    3160490  FarmersDelight-1.21.1-1.3.4.jar
cb77b3bc40bb598cfc50773d491c9e1af06d3833       4622  FastFurnace-1.21.1-9.0.1.jar
cfe55dc815979028d2a2211e26115dbd02273f87      28636  FastWorkbench-1.21.1-9.1.3.jar
9563692efb708b6b568df27a01ec52f6311928ef     121559  ferritecore-7.0.3-neoforge.jar
5cfe835472a5c5457ae9ac192d9d7b317454d5ac     634531  geckolib-neoforge-1.21.1-4.9.3.jar
ead940a50f69313802960c497e252acd3956334f       8825  getittogetherdrops-neoforge-1.21.5-1.4.jar
e85cd4c266f974dd360c46e8dad7ecf4c7ee96c6    9311992  guideme-21.1.19.jar
8ecd27f1d66f9b742cfae3c8ffa773765f574b52    7132842  handcrafted-neoforge-1.21.1-4.0.3.jar
a4e90c2df8009040f6d022433c5d76635944dd59   14232121  ImmersiveEngineering-1.21.1-12.4.2-194.jar
88ff21e4fa6e5c4cfb7cd5626cbcfdf424e704b5    4747295  industrialforegoing-1.21-3.6.27.jar
88ee316e68900080b017f60c12162e2731924cf8     726853  Jade-1.21.1-NeoForge-15.10.6.jar
d19552586f686eae4ef5e7199f31604d1d3cfca7    1804792  jei-1.21.1-neoforge-19.51.0.418.jar
1a68ab7829e03b2f9ef59d4d2d58ac4c5be74ffc    8214901  KotlinLangForge-2.14.1-k2.4.20-3.0+neoforge.jar
f0310277167c82fd16a5c2bab220b5c5c262f133   73375667  L_Ender's Cataclysm 1.21.1-3.33.jar
353ca00ed118eb67cf11085abbbd699884722326      91596  lionfishapi-3.1.jar
97212e45c963730bbfc7c44780df99317814c21b     774220  lithium-neoforge-0.15.4+mc1.21.1.jar
71ece28129789a2123cf07e79938f488d8675bb2     661387  mcw-bridges-3.1.2-mc1.21.1neoforge.jar
c127904f23db1a641dd9e065ec51c5c177cb4cd7    1190404  mcw-doors-1.1.5-mc1.21.1neoforge.jar
3dccc819f14bcc60b3683edd82ca8c5e64964229    2080436  mcw-furniture-3.4.1-mc1.21.1neoforge.jar
13c1107caf26b2c60d8626b3658b26cc7f634b38     525744  mcw-lights-1.1.5-mc1.21.1neoforge.jar
b5580c3fc521ed8bf4db3e407bd590efc317f74d     673871  mcw-mcwfences-1.2.1-mc1.21.1neoforge.jar
4bb7e1d28eef19f87438881b0f582a15297b95ae     777742  mcw-mcwpaths-1.1.1-mc1.21.1neoforge.jar
1ee43d693c821efc955a74e551f94372af90a140     529082  mcw-mcwstairs-1.0.2-mc1.21.1neoforge.jar
eb1d3c118acb450cc2fe14c2ce7ce247a1bca60c    1261268  mcw-mcwwindows-2.4.2-mc1.21.1neoforge.jar
05806ff152fab56f7c1b4b215d772ea73611283d    1784829  mcw-roofs-2.3.2-mc1.21.1neoforge.jar
1fe7f8b4176e86507cc8ed5460b6acdd3dac5529     604333  modernfix-neoforge-5.27.24+mc1.21.1.jar
d64475cd77444b056ece6472c79d40293dc63c6c   36042925  mowziesmobs-1.21.1-1.8.2.jar
1bea6b61378ba80f038256c4345d9ff3b67928c4      60296  noisium-neoforge-2.3.0+mc1.21-1.21.1.jar
6d0ebc84bbb75322cb0ab45ffef6a54d3bc6adef    1826827  open-parties-and-claims-neoforge-1.21.1-0.31.6.jar
a5671f7e8d38dfc092ace4091250e8f9e1245e1e     456599  pipez-neoforge-1.21.1-1.2.31.jar
d44335094cf2db64998cb3ee31e58d8c01e80b4a     324058  Placebo-1.21.1-9.9.2.jar
24389c8e48ff0e8594e4686b750c494c66a5f8df     484332  resourcefullib-neoforge-1.21-3.0.12.jar
ec2e4996f8bee8714173e603e379fef8a6901765      76369  ritchiesprojectilelib-2.1.2+mc.1.21.1-neoforge.jar
b96d133a016dde480458d6102d66353c7eeacf6a   16872119  ScalableCatsForce-NeoForge-3.7.1-build-11-with-library.jar
62ce692654e09271b5c55cbb3a1ef7606d067132    1462674  servercore-neoforge-1.5.19+1.21.1.jar
c4f240d4071835631da9b698481ec607b9f1f8be    1239554  sophisticatedbackpacks-1.21.1-3.26.6.2174.jar
86a5cf18608b3feec76c17a8ccac4de36d660fbc    1809363  sophisticatedcore-1.21.1-1.5.2.2343.jar
9430cc2ab64ff89d698be593769fb9f9ee4efae6    3642581  spark-1.10.124-neoforge.jar
c6ef4976de69a46c4e267bd7f91c730d2dc43a4e   57247579  tacz-neoforge-1.21.1-1.1.8-hotfix-r7.jar
c57a545f81104c5ee87bf1e0af55a6e87598573b     607012  titanium-1.21-4.0.50.jar
19f67a98cf5e7cfeefb089b5ec31450ac6d5bd53     616301  veinminer-neoforge-2.11.2+1.21.1.jar
436ee200d5192ffda65fcf70c42c086fcdc00826    4934688  voicechat-neoforge-1.21.1-2.6.24.jar
75718161662d9ec957ba22e10e497788ec1687ba    1223229  waystones-neoforge-1.21.1-21.1.46.jar
```

- **NeoForge: 21.1.252.** `libraries/net/neoforged/neoforge/` holds only `21.1.252`, `run.sh` points at it, and every one of the eight 3 October logs plus `debug.log` shows `--fml.neoForgeVersion, 21.1.252`. `latest.log` has no launch line because it was rotated at midnight. There is no 21.1.253 on disk.
- **PACK_VERSION:** no such file in the instance root or in `Minecraft/`.
- **Resource pack:** there is no `resourcepacks/` folder. In `server.properties`, `resource-pack=`, `resource-pack-sha1=` and `resource-pack-id=` are empty and `require-resource-pack=false`. No file with "villager" in its name exists outside `world/`, `bluemap/`, `libraries/` and the old world copy.

## 2. The game's log since go-live

Sources: `logs/latest.log` (4 Oct 00:00–11:21, 6,101 lines) and `2026-10-03-1…8.log.gz` (6,129 lines). No rotated log for 4 October exists yet.

| Pattern | 3 Oct | 4 Oct |
|---|---|---|
| ERROR | 25 | 104 |
| Can't keep up | 1 | 6 |
| Exception | 58 | 0 |
| moved too quickly | 1 | 0 |
| lost connection | 16 | 1 |
| Disconnecting (voice chat) | 12 | 1 |
| channels | 0 | 0 |
| wrong version | 0 | 0 |

Most common lines, grouped (the per-thread variants collapse to these):

- **4 Oct**
  - 87× `Block-attached entity at invalid position` at five fixed positions: (-67,5,289) 54×, (-245,5,155/156) 24×, (-103,5,298) 7×, (-103,6,307) 3×.
  - 13× `Detected setBlock in a far chunk`, from `large_dripstone` during pre-generation.
  - 2× `MonsterRoomFeature: Failed to fetch mob spawner entity`.
  - 6× `Can't keep up`.
- **3 Oct**
  - 48× mixin `Error loading class … ClassNotFoundException` at start-up: six optional-mod classes × 8 starts.
  - 10× `Parsing error loading recipe createdeco:placard`.
  - 10× Curios `example is not a registered slot type`.
  - 5× `Block-attached entity at invalid position`.
  - 1× `Can't keep up`, 1× `bramble09 moved too quickly`.
- **Warnings on 4 Oct outside the patterns**
  - 102× ModernFix `Skipped emitting ENTITY_MOUNT … Drowned Host`.
  - 79× each `Ignoring unknown attribute 'forge:step_height_addition'` and `'forge:entity_gravity'`.
  - 1× spark `Timed out waiting for world statistics`.

`Can't keep up` times:
- 3 Oct 22:18:22: 4.9 s behind.
- 4 Oct 03:06:50: 19.1 s behind, during the 03:00 backup with Chunky running.
- 4 Oct 10:39:43, 10:52:08, 10:52:32, 10:58:14 and 11:06:58: 2.4–9.0 s behind, with Chunky running.
- The once-a-minute TPS line never dropped below 19.5 across 681 samples on 4 October.

Disconnects per player, both days:

| Player | In game | Before joining | Since 4 Oct 00:00 |
|---|---|---|---|
| bramble09 | 8 (7 Disconnected, 1 Timed out) | 0 | 1 |
| samoyedx | 3 | 1 (configuration phase, 21:54:21) | 0 |
| plasticsporky | 2 | 3 (login phase, 21:51:57–21:52:19) | 0 |

- **Sessions:** 12 joins on 3 October, 1 on 4 October (bramble09, 10:39:32–10:40:07).
- **crash-reports/:** one file, `crash-2026-10-02_05.00.38-server.txt` (103,791 bytes). Nothing is dated 3 or 4 October, so nothing is printed.
- **Pre-generation:** Chunky finished the overworld at 11:14:53 (1,565,001 chunks, 12:39:18 total).
- **spark:** only `config/spark/config.json` and `tmp-client/about.txt`; no profile or health report on disk.

Start times (first launcher line to `Done`):

| Launch (UTC, 3 Oct) | Done | Seconds to Done | `Done (…)` figure |
|---|---|---|---|
| 20:04:23 | 20:04:45 | 22.1 | 1.054 s |
| 20:25:28 | 20:25:51 | 23.1 | 1.119 s |
| 20:39:15 | 20:39:38 | 22.7 | 1.039 s |
| 20:53:08 | 20:53:29 | 21.4 | 1.045 s |
| 21:34:16 | 21:34:39 | 23.0 | 0.969 s |
| 21:39:17 | 21:39:37 | 20.2 | 0.981 s |
| 22:15:40 | 22:16:16 | 35.8 | 13.720 s (new world) |
| 22:23:14 | 22:23:36 | 21.9 | 1.561 s |

No start has happened on 4 October; the 22:23 run lasted until 11:21:00.

## 3. Memory and CPU

- **Java process:** none running (asleep), so resident memory now is not checked. The AMP process in the container uses 854 MiB.
- **Configured flags** (`MinecraftModule.kvp`): max heap 10240 MB, min heap 4096 MB, Temurin 21, `UseContainerMemoryLimits=True`. GC options: `-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1`. The literal command line is not in AMP's log, so not checked.
- **Host:** 15,468 MB total, 1,658 used, 13,809 available; swap 943 MB of 8,191 in use; load 0.29 / 0.18 / 0.17 on 6 cores.
- **OOM kills:** `journalctl -t kernel --since "7 days ago"` has 0 lines matching "Killed process" or "Out of memory"; `dmesg` likewise. The journal goes back to 28 September.

## 4. Disk

| Path | Size | Used | Free |
|---|---|---|---|
| `/` (instance disk) | 489 G | 213 G (46%) | 256 G |
| `/nfs/filezilla` | 82 T | 53 T (65%) | 30 T |
| `/nfs/SharkDrive` | 913 G | 602 G (66%) | 312 G |

| Folder | `du -sh` |
|---|---|
| Instance | 83 G |
| `Minecraft/` | 50 G |
| `world/` | 18 G |
| `world/dimensions/` | 3.2 M |
| `bluemap/` | 32 G (all of it the overworld map) |
| Instance's own `Backups/` | 33 G (three zips AMP no longer lists) |
| NAS `DeepSlate-MC/Backups` | 41 G |

**Room for one season dimension:** a radius-3,000 square is about 141,000 chunks. The overworld (1,565,001 chunks) takes 18.5 G, about 11.8 KB per chunk, so a season dimension is about 1.7 GB of world. Its map would be about 3 GB if the 32 G overworld map is complete, which could not be confirmed: the portal sent `bluemap update world 0 0 10000` at 11:15, six minutes before the server slept. So roughly 5 GB per season against 256 G free. Each backup zip grows by about 1.4 GB per season.

## 5. NFS

- **`findmnt`:** both shares are NFS 4.2 from 10.0.10.122, mounted `rw,hard,proto=tcp,timeo=600,retrans=2`.
- **fstab:**
  - `/nfs/filezilla nfs4 defaults,vers=4.2,rw,hard,nofail,_netdev,x-systemd.mount-timeout=30`
  - `/nfs/SharkDrive nfs4 defaults,vers=4.2,rw,nofail,_netdev,x-systemd.mount-timeout=30` (no explicit `hard`, but it mounts hard by default)
- **Backup folder on the share now:** yes. `/nfs/filezilla` is a mount point, and the container sees `/nfs/filezilla/DeepSlate-MC` as the NFS export with 5 files in `Backups/`.
- **If the share were not mounted:** the container binds only `/nfs/filezilla/DeepSlate-MC`. The 3 October report says the underlying mount point was made immutable and the container then fails to start. The immutable flag could not be verified: `lsattr` cannot read it through the mount, and looking underneath needs an unmount or a bind mount.
- **Ordering:** drop-in `ampinstmgr.service.d/backup-share-order.conf` has `After=nfs-filezilla.mount` (order only).
- The kernel log has no "nfs: server not responding" lines.

## 6. AMP's backups

**Backups.json** (on the NAS, written 03:12:50 on 4 October), 5 entries:

| Time (UTC) | Name | Total / zip | Local | Remote | Mark |
|---|---|---|---|---|---|
| 10-03 19:23 | Scheduled Backup (by deepslate-adm) | 36.68 / 32.65 GB | false | true | none |
| 10-03 20:14 | Host check 2026-10-03 | 19.08 / 15.01 GB | true | true | 54% smaller; first with exclusions |
| 10-03 20:59 | Portal backup 20:59:27 | 19.05 / 14.98 GB | true | false | none |
| 10-03 22:07 | Portal backup 22:07:58 | 19.07 / 10.41 GB | true | false | 30% smaller, and incomplete |
| 10-04 03:00 | Scheduled Backup, "Nightly Backup (interim)" | 7.47 / 5.91 GB | true | true | 43% smaller; new world, mid pre-generation |

- No entry is under 1 GB.
- **The 22:07 backup:** AMP logged 2,184 `Skipping file that disappeared during staging` warnings at 22:15:23–24 (1,600 in `world/entities`, 502 in `world/region`, 6 in `world/playerdata`, the rest in `world/data`, `serverconfig` and limbo). Its zip has 1,115 region files and no playerdata; the 20:59 zip has 1,617 region files and 2 playerdata files. The recorded total of 19.07 GB does not reflect what is inside.
- So the last complete copy of the pre-reset world is the 20:59 zip, which is local only; the 20:14 one is also in S3 according to AMP.

**NAS folder** (`ls -la --time-style=full-iso`):

```
15009530342 2026-10-03 20:33:56 20261003-201413-0d98d46b2c764ec08aa7e4dfe2d88fc8.zip
14983101881 2026-10-03 21:18:41 20261003-205927-013fb5617c1144bf886bd1c24e5b6338.zip
10414363489 2026-10-03 22:22:41 20261003-220758-c608514ec6dd410495f9128711fd7dc6.zip
 5912091732 2026-10-04 03:10:49 20261004-030000-71f13703696645c583b29bb6b03abbe6.zip
       2747 2026-10-04 03:12:50 Backups.json
.staging/ (empty)
```

- **Orphans:** none on the NAS; all four zips are named in Backups.json.
- **The 22-byte zip from 21:21:** not there now. AMP logged `Creating Backup: Test, asleep` by webapp at 21:21:26. The folder's own modification time is 2026-10-04 08:33:10, which fits something being removed then; AMP's log has no line for it.
- **Unlisted zips on the local disk:** the instance's own `Backups/` holds 1.06 GB and 1.24 GB (29 September) and 32.65 GB (3 October 18:39), plus an old Backups.json.
- **`unzip -tq` on the newest zip:** "No errors detected", 1 min 1 s. It has 5,442 entries, 646 of them region files.

**Triggers** (`scheduleTimes.json`):
- There is exactly one trigger, id `6db1e248-1d88-4a47-867c-59ab9fd5c1b4`. It is still named "Hourly Backup", with description "Nightly Backup (interim)".
- It is enabled, every day, `MatchHours [1]`, `MatchMinutes [0]`; the task is `TakeBackup` with `Local=true, S3=true, BackupWhileRunning=true, DirtyOnly=false, Sticky=false`.
- The old hourly run is this same trigger, converted, so no separate hourly trigger exists.
- The hour was changed from 3 to 1 at 08:35:45 on 4 October by `deepslate-adm`.
- **03:00 run on 4 October:** started 03:00:00, zip finished 03:10:49, `Uploading backup … to S3` at 03:10:50, entry written 03:12:50 with `StoredRemotely: true`. AMP's log has no explicit "upload finished" line.
- **01:00 run on 5 October:** not yet happened at the time of this check.

**S3:** no list-only key exists, so the bucket was not listed and the newest object's size is not confirmed. AMP's own key was not used.

**Exclusions** (`backupExclusions.conf`): `bluemap/web|maps`, `.|world-backup-20260929`, `.|tacz_backup`, `.|bluemap`. The newest zip confirms it: no `bluemap/`, no `world-backup-20260929/`, no `tacz_backup/`; `logs/` (45 files) and `crash-reports/` (1) are in.

**Restores:** no AMP log of any instance on this host contains a restore, and the 3 October report lists the restore test as still waiting. Scratch room outside the instance: 256 G on `/` and 312 G on `/nfs/SharkDrive`. `/tmp` is a 7.6 G tmpfs and too small.

**status.json:** exists at `Minecraft/_backup/status.json`, rewritten every 15 minutes by `deepslate-backup-status.timer`; it was 7.5 minutes old when read. It holds host name, NFS state, the four zip names with sizes, limits, and `s3.checked: false` with the error "no list key". No key, password or token is in it. `db.count` is 0 and the NAS `deepslate-db/` folder is empty.

## 7. The deploy key and rsync

- **authorized_keys** (one key line): `command="/usr/bin/rrsync /home/amp/.ampdata/instances/DeepslateWorks01/Minecraft",restrict,from="10.77.0.1" ssh-ed25519 <key> deploy@portal`. This matches the expected form.
- **Modes:** `.ssh` is 700 amp:amp, `authorized_keys` 600 amp:amp, `/home/amp` 755.
- **`sshd -T -C user=amp,addr=10.77.0.1`:** `passwordauthentication no`, `permitrootlogin prohibit-password`, `allowtcpforwarding yes`. Forwarding is blocked for this key only by its `restrict` option, not by sshd.
- For the same user from a LAN address, `passwordauthentication` is `yes`.
- The portal logs in with this key about every 30 seconds.

## 8. WireGuard

- **`wg show`:** peer endpoint 198.51.100.20:51820, allowed IPs `10.77.0.1/32`, last handshake 55 seconds ago, keepalive 25 s, 660 MiB received and 17.3 GiB sent. This side is 10.77.0.2/24.
- **`net.ipv4.ip_forward = 1`** (also on for wg0). The iptables FORWARD policy is DROP with only the Docker and Tailscale chains; those chains were not expanded.
- **Tunnel rules** (table `inet deepslate`, input hook):
  - accept established traffic on wg0;
  - accept 10.77.0.1 to tcp 22, 8080, 8100;
  - accept ping from 10.77.0.1;
  - drop everything else arriving on wg0 (counter: 0 packets).
- No iptables rule names wg0 or 10.77.0.0/24.

Listeners the VPS could address, and what the rules allow from wg0:

| Listener | Allowed from wg0 |
|---|---|
| sshd :22 | yes |
| AMP ADS :8080 | yes |
| BlueMap 10.77.0.2:8100 | yes, but not listening while the server sleeps |
| nginx :80, rpcbind :111, glances :61208 | no |
| AMP SFTP :2223, :2225, :2226 | no |
| AMP game port :25569, mc-router :25565, Bedrock :19132 | no |
| Instance UI 10.0.10.8:8083 | no (LAN address) |

## 9. mc-router

- **Image:** `itzg/mc-router:1.47.1`, host network, restart policy `unless-stopped`.
- **Mappings:** `mc.dsw.test=127.0.0.1:25569`, `boys.dsw.test=127.0.0.1:25567`, `vanilla.dsw.test=127.0.0.1:25571`, `--connection-rate-limit=20`, no default.
- **Uptime:** since 2026-09-30 05:26:30 (host boot), restart count 0.
- **Last 50 log lines:**
  - normal relays for bramble09 and samoyedx;
  - 18 errors between 01:04 and 01:08 on 4 October (`Failed to read packet` EOF or timeout, `Unexpected packetID`), which look like a scanner;
  - one `Unable to find registered backend` at 06:47 for a raw IP;
  - no backend errors for `mc.dsw.test` in those lines.
- **Whole log:** 301 warning or error lines, including 87 `connection refused` for `mc.dsw.test`.
- Only the DeepslateWorks01 and Bedrock containers are running, so `boys.dsw.test` and `vanilla.dsw.test` have no backend right now.
- **Voice chat 24454/udp:** nothing listens now because the server is asleep. When it runs, it binds `0.0.0.0:24454` (log of 3 October 22:23:36). No host firewall rule blocks 24454. The forward itself is on the UniFi router and is not checkable from this host.

## 10. The AMP users

Read from `UserData.json` and `RoleData.json`, credentials masked. Two users: `deepslate-adm` (super admin) and `webapp`.

**webapp** has role `webapp` (12 granted, 214 denied) plus its hidden per-user role with only `Instances.<id>.Manage`. Granted:
- `Core.AppManagement.StartApplication`, `StopApplication`, `RestartApplication`, `SendConsoleInput`, `ReadConsole`
- `FileManager.FileManager.BrowseFiles`, `DownloadFiles`
- `LocalFileBackup.Backup.CreateBackup`, `ViewBackupsList`
- `Settings.MinecraftModule.Limits.SleepMode`
- `Settings.MinecraftModule.Game.*` and `Settings.MinecraftModule.Minecraft.*`

- **"Cannot do more than…":** not quite. The two wildcards give it every setting under `Game.` and `Minecraft.`, not just three.
- **ViewDistance, SimulationDistance, ServerMOTD:** yes, it has all three through the `Minecraft.*` wildcard; there are no explicit nodes. They are `Minecraft.ViewDistance=20`, `Minecraft.SimulationDistance=8` and `Minecraft.ServerMOTD` in the kvp.
- **File delete rights in AMP:** none. `TrashFiles`, `TrashDirectories`, `EmptyTrash`, `UploadFiles`, `RenameFiles`, `ConnectViaSFTP`, `DeleteBackup` and `RestoreBackup` are all explicitly denied.
- **"Nobody but Alex":** true for AMP users, not true for the portal as a whole, because of the read-write deploy key. The old world disappeared at 22:15:23 on 3 October while only webapp and the deploy key were active. That the key did it is an inference; no rsync log was found to prove it.

## 11. Server files the repo should own

- **Open Parties and Claims:**
  - The repo is not on this host, so the comparison is against the copy in the instance's `defaultconfigs/` (2,061 bytes, 3 October 21:53).
  - The live file is `config/openpartiesandclaims-server.toml` (49,595 bytes, 3 October 19:32).
  - `world/serverconfig/` holds only OPAC's four player-config files, no server config.
  - All 12 keys in the shipped file have the same value in the live file: parties on, 2,160 h expiry, 200 claims, 0 forceloads, `ALL_BUT ["deepslate:limbo"]`, and the three exception lists.
- **Waystones** (`config/waystones-common.toml`, 29 September; no `waystones-server.toml`):
  - There is no `dimensionalWarp` key.
  - Travel between dimensions is governed by `warpRequirements`, which includes `[is_interdimensional] add_xp_cost(27)` and `max_xp_cost(27)`, so it is allowed at a cost.
  - `transportPets = "DISABLED"`, `transportLeashed = "ENABLED"`, `entityDenyList = ["minecraft:wither"]`.
  - `wildWaystonesDimensionAllowList = ["minecraft:the_end", "minecraft:overworld", "minecraft:the_nether"]`.
- **ServerCore** (`config/servercore/config.yml`): activation range is enabled; `excluded-entity-types` are `minecraft:ghast`, `minecraft:warden`, `minecraft:hopper_minecart`.
- **server.properties:**
  - `view-distance=20`, `simulation-distance=8`
  - `function-permission-level=2`, `spawn-protection=0`
  - `level-name=world`
  - `white-list=false` (and `enforce-whitelist=false`), `enforce-secure-profile=true`
  - `max-players=20`, `motd=Modded Minecraft with friends`
- **BlueMap:** `config/bluemap/maps/` has `world.conf`, `world_the_end.conf` and `world_the_nether.conf`, all dated 29 September. No BlueMap config names `deepslate:limbo`.
- **world/datapacks:** `deepslate-limbo/` and `deepslate-tools/`, both 2026-10-03 21:53.

## 12. The world's shape on disk

- **`world/dimensions/`:** `ae2/spatial_storage` 20 K; `deepslate/limbo` 3.2 M (4 region files). No `frontier_s1` or other season dimension exists.
- **Overworld:** `world/region` has 1,600 files, 18 G, none zero-byte; `entities` 1,600 files, 375 M; `poi` 1,600 files, 84 M (81 zero-byte).
- **Nether and End:** `world/DIM-1` and `world/DIM1` have no region files.
- **playerdata:** 2 `.dat` files (plus 2 `.dat_old`), newest 2026-10-04 10:40:07. That matches the log: two players (bramble09, samoyedx) have joined since the 22:15 reset; plasticsporky has not. `whitelist.json` has 5 entries.

## 13. Anything else

- **`logrotate.service` is failed** (the system reports "degraded"). It has failed daily since at least 3 October: `cloud-init-base:1 duplicate log entry for /var/log/cloud-init.log`.
- **View distance 20** is high for a modded server.
- **Minecraft01 and TheBoysareback01 are not running**; their hostnames refuse connections.
- **Kernel update waiting:** 7 packages are upgradable, including `linux-image-generic` 7.0.0-38 (running 7.0.0-34). There is no reboot-required flag.
- **AMP:** 2.8.0.8 on all instances; AMP's own check at 11:56 says "AMP is up to date" and apt shows no newer candidate.
- **Clock:** UTC, synchronised, offset +0.8 ms.
- **Certificates:** none on this host; nginx serves port 80 only.
- **Disk and inodes:** fine (46% and 3%). Docker has 5.5 GB of unused images.

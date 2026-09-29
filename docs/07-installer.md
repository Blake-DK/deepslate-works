# 07 · Client installer (Windows only)

## Goal

A friend downloads one zip, double-clicks `Setup.bat`, waits, opens the normal Minecraft launcher and sees a **Deepslate Works** profile with the server already in the server list. Running it again later updates the mods. It never touches their vanilla installation.

## Sign-in and "Update and Play" (Alex, 2026-09-28)

The installer authenticates every run. `install.ps1` asks the portal for a code (`POST /api/launcher/start`), opens `https://deepslate.dsw.test/launcher/<code>` in the browser, where the user logs in with Discord (guild check, auto-join) and presses "Yes, that's me"; the script polls `GET /api/launcher/poll?token=…` and receives a launcher token (7 days, stored hashed server-side, kept in `%APPDATA%\.minecraft-deepslate-works\launcher.json`). The manifest and `config.zip` are fetched with `Authorization: Bearer <token>`; the portal applies the same gate as the site (admin always; players only when live and the server is online). `Update and Play.bat` runs `install.ps1 -Play`: sign in if needed, update mods, set the profile as `selectedProfile`, open the Minecraft Launcher (classic install paths, then the Store app id, then `minecraft://`) and exit. `Setup.bat` is the first-run variant that pauses so people read the ticks. Admins can sign a member's installers out from `/admin/users` ("Sign out installer"); removing a member revokes them too. The old shared `MANIFEST_KEY` is no longer stamped into the script (the server still accepts it for admin testing).

## The launcher must be closed (2026-09-29, after the first real install)

The Minecraft Launcher reads `launcher_profiles.json` when it starts, keeps it in memory, and writes it back later. Anything written to the file while the launcher is open is thrown away. On Alex's PC the launcher was open during the install: afterwards the file held only the launcher's two default profiles (with their 1970 dates), and both the NeoForge profile and ours were gone. Everything else had worked.

So `install.ps1`:

1. **Checks for a running launcher three times**: at the first step (so nobody waits through the downloads to hear it), before the NeoForge installer, and before writing `launcher_profiles.json`. It looks for a process named `MinecraftLauncher` or `Minecraft Launcher`, for `Minecraft` when its path has "Launcher" in it or cannot be read (the Store and Xbox launcher; Bedrock runs as `Minecraft.Windows` and is left alone), and for any window titled "Minecraft Launcher". If one is found it prints **"Close the Minecraft Launcher (including the tray icon) and run this again"** and exits 1. Nothing has been changed at that point.
2. **Reads the file back after writing it**, and again two seconds later, and checks that the profile is there and points at the right NeoForge version. If not, it stops with "THE LAUNCHER PROFILE WAS NOT SAVED", what is wrong, and the path of the log file.
3. **Offers to open the launcher** at the end of `Setup.bat` ("Open the Minecraft Launcher now? [Y/n]", Enter means yes), only when the profile was saved and checked. `Update and Play.bat` opens it without asking, as before. `-NoPrompt` never asks.
4. **Writes the file without a byte-order mark**, to a temporary file that is then moved into place. The first version used `Set-Content -Encoding UTF8`, which on Windows PowerShell 5.1 puts a byte-order mark at the start. Whether the launcher minds has not been tested; a launcher that did mind would also fall back to its defaults, so this may have been a second cause of the same symptom. Without the mark is what the launcher writes itself.

`install.ps1 -SelfTest` runs the profile code against a scratch copy of a fresh launcher's file (18 checks: written, no byte-order mark, the launcher's own profiles and settings kept, `.bak` kept, a second run updates in place, a launcher that rewrote the file is noticed, a broken or missing file is reported, a running launcher is found). It touches nothing else and runs under Windows PowerShell 5.1 and under `pwsh` on Linux.

## Install reports (planner spec 2026-09-29; built the same day)

At the end of every run, whether it went well, failed or was stopped, `install.ps1` sends a report to `POST /api/installer/report`, signed in with the launcher token it already holds. Before sending it prints: **"Sending the install log to deepslate.dsw.test so Alex can help if something went wrong."** If the upload fails it says so and leaves the local log where it is; a report never holds the install up (20 s at most).

**What is sent**

| Field | Holds |
|---|---|
| `packVersion`, `installerVersion` | what was being installed, and by which version of the script |
| `outcome` | `ok`, `failed` or `cancelled` (the window was closed or Ctrl+C pressed part-way) |
| `failedStep` | the title of the step in hand when it stopped, e.g. "Checking the Minecraft Launcher" |
| `durationSec` | how long the run took |
| `log` | this run's lines of `%TEMP%\deepslate-install.log`, 512 KB at most, cut in the middle if longer |
| `system.os` | Windows edition, version, build, display version (24H2), 64-bit or not |
| `system.cpu` | name, cores, threads |
| `system.ramGb` | total memory |
| `system.gpus` | each graphics adapter: name, driver version, memory (Windows reports at most 4 GB here) |
| `system.disk` | free and total space on the drive the pack is installed on |
| `system.launcher` | classic or Store, its version (from `launcher_profiles.json`, else the exe, else the Store package), the profile file's format number |
| `system.java` | where Java came from (the launcher's own, PATH, downloaded), the path, the version line |
| `system.neoforge` | the version, whether it was there before the run and after |

**What is never sent.** The Windows user name, the PC's name, anything about the Microsoft account (the script never reads it), launcher tokens, e-mail addresses, network addresses. In every string, `C:\Users\<name>\` becomes `C:\Users\~\`. The redaction is done twice: on the PC before sending (`Redact` in `install.ps1`) and again by the portal before storing (`apps/web/src/lib/install-report.ts`), so an edited or buggy script cannot put a name into the database. Version numbers are left readable.

**Order of the steps.** Signing in is now the first step and the launcher check the second. A report needs to know who it is from, and the acceptance case (no launcher installed) fails at the launcher check: with the old order that failure came before anyone had signed in and could not have been reported. A failure while signing in itself (site unreachable, sign-in refused) cannot be reported and is only in the local log.

**Stored** as `InstallReport {id, userId, at, packVersion, installerVersion, outcome, failedStep, durationSec, system, log, tierBefore, tierMeasured}` (migration `0006_install_reports`), kept 90 days (Admin → Settings → "Install reports, days"), cleared by the nightly retention run. Each report is also one `INSTALL` row in the event log ("m1owl installed 0.1.0+47b0b579: all good"). At most 20 reports per member per hour.

**Where it shows**

- **Admin → Installs** (`/admin/installs`): "The group's PCs" (each member's latest report: measured tier, processor, memory, graphics) and every run (who, when, outcome, pack, Windows, memory, graphics), filtered by outcome. A run opens to the PC's details and the log, with the failed step and what followed it marked.
- **A player's page** (`/players/<uuid>`), admins only: their last install and their PC.
- **`/me`**: the member's own last result in one line ("Installed 0.1.0 on 29 Sep, all good") and nothing else.
- **`/rules`** lists install reports under "What the site keeps".

**No heartbeat.** Nothing is sent from the launcher profile or from the game; the report at install time is all there is.

## The PC tier is measured (Alex, 2026-09-29)

"The 'your PC' should be decided by a script too, so we get a real view of the power and capabilities of people's PCs." Every install report that says enough about the hardware sets the member's tier (`suggestTier` in `apps/web/src/lib/install-report.ts`):

| Tier | When |
|---|---|
| LOW ("Older PC") | under 8 GB of memory, or built-in graphics only (Intel HD/UHD/Iris, Radeon Graphics, Vega) |
| HIGH ("Gaming PC") | 16 GB or more **and** a strong card: RTX, GTX 1060/1070/1080/1660/970/980, RX 5500 and up, Intel Arc |
| MID ("Decent PC") | everything between, e.g. a GTX 1050 Ti, or an RTX card with 8 GB of memory |

Remote-desktop and virtual adapters (Parsec, Microsoft Basic Display, Hyper-V) are ignored; on a laptop with two adapters the real card counts. `User.pcTierSource` is `measured` from then on, `pcTierWhy` says what it was worked out from ("32 GB of memory, NVIDIA GeForce RTX 3070"), and the change is an event ("their PC was measured by the installer: LOW (they had chosen HIGH)"). Once measured, the choice on the onboarding page is replaced by what was measured; it is measured again at every install, so a new PC or graphics card is picked up by running the installer. The question is still asked at sign-up, as a first rough answer, and stays the answer for people on Mac or Linux, who have no installer.

**Limits of the measurement.** It reads what Windows says is installed: memory and the names of the graphics adapters. It does not run a benchmark, so an old high-end card and a new one of the same name count the same, and thermal or driver trouble does not show. The processor is recorded and shown but does not move the tier.

## Files

- `Setup.bat`: `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"` then `pause`. Exists so nobody has to know what an execution policy is.
- `Update and Play.bat`: the same with `-Play`; pauses only on failure.
- `install.ps1`: PowerShell 5.1 compatible (ships with Windows 10/11). No modules, no admin rights.
- `README.txt`: three lines, same as the `/install` page.

## `install.ps1` behaviour, in order

*(Since installer 1.2.0 signing in comes first and the launcher check second; see "Install reports". The numbering below is the original design.)*

1. **Config block at the top**, stamped by `modpack build installer`: `$PortalUrl`, `$PackName`, `$PackVersion`. Then the sign-in step above.
2. **Console output**: friendly, numbered steps, green ticks, no stack traces. On any failure: one plain sentence saying what to do ("Install the Minecraft Launcher from minecraft.net, open it once, then run this again") and a log file path `%TEMP%\deepslate-install.log` with the details.
3. **Check the Minecraft launcher**: `%APPDATA%\.minecraft\launcher_profiles.json` must exist. If not: stop with the message above and open `https://www.minecraft.net/download` in the browser.
4. **Fetch the manifest** from `$ManifestUrl` (the app's `/api/modpack/manifest`, which is the lockfile plus profile settings). TLS 1.2 forced (`[Net.ServicePointManager]::SecurityProtocol`).
5. **Java 21**: try in order: the launcher's bundled runtime `%APPDATA%\.minecraft\runtime\java-runtime-delta\windows-x64\java-runtime-delta\bin\java.exe` (present after the launcher has run 1.21 once), `java` on PATH if `-version` reports 21+, otherwise download the Adoptium Temurin 21 JRE zip from `https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse` into `<gameDir>\runtime\` and use that. Never install system-wide.
6. **NeoForge**: if `%APPDATA%\.minecraft\versions\neoforge-<ver>` is missing, download `https://maven.neoforged.net/releases/net/neoforged/neoforge/<ver>/neoforge-<ver>-installer.jar` and run `java -jar … --install-client "%APPDATA%\.minecraft"` (the newer installer flag; fall back to `--installClient` on a non-zero exit). Log installer output.
7. **Game directory**: `%APPDATA%\<profile.dir>` with `mods\`, `config\`, `resourcepacks\`. Separate from `.minecraft` so vanilla is untouched.
8. **Mods**: for every lockfile entry with side `client` or `both`: skip if the file exists and its sha512 matches; else download to a temp name and rename. Delete any `.jar` in `mods\` that is not in the lockfile (the installer owns that folder; say so in the README). Show a progress bar; TaCZ alone is 50 MB.
9. **Configs**: extract the manifest's `configs` (or a `config.zip` URL) into the game dir, overwriting. Never overwrite `options.txt` if it exists; if it doesn't, write one with `renderDistance` and `simulationDistance` from the user's tier (default 8/6) and `fullscreen:false`.
10. **Server list**: if `servers.dat` doesn't exist, write an uncompressed NBT file with one entry (name = pack name, ip = `server_address`). Format: `TAG_Compound "" { TAG_List "servers" [ TAG_Compound { TAG_String "name", TAG_String "ip" } ] }`. About 20 lines of byte-writing; there's no need for a library.
11. **RAM**: read total RAM via `Get-CimInstance Win32_ComputerSystem`. Allocate: ≥16 GB → 6G, 12 GB → 5G, 8 GB → 4G, less → 3G, clamped to `ram.min_gb..max_gb` from the manifest. JVM args: `-Xmx<n>G -Xms1G -XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:MaxGCPauseMillis=50 -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20`.
12. **Launcher profile**: only with the launcher closed (see above). Read `launcher_profiles.json`, set `profiles.<profile.id>` = `{ name, type: "custom", lastVersionId: "neoforge-<ver>", gameDir, javaArgs, javaDir, icon, created, lastUsed: now }` (update in place if present, keeping `created`), set `selectedProfile`, back the file up to `launcher_profiles.json.bak`, write it without a byte-order mark, then read it back and check.
13. **Done**: print the server address and offer to open the launcher (`Setup.bat`), or open it (`Update and Play.bat`). Write `installed.json` in the game dir with the pack version for the `/install` page's "you're up to date" check (the page can't read it, but the script can compare on the next run and say "already up to date").

## Non-goals
- No custom launcher, no Prism install, no CurseForge app.
- No editing anything inside `.minecraft` except `launcher_profiles.json` and the NeoForge version the installer adds.
- No uninstaller in v1; the README says "delete the Deepslate Works profile and the `.minecraft-deepslate-works` folder".

## Mac / Linux
Not supported (decided 2026-09-29). Non-Windows browsers get a one-line notice on `/install`.

## Windows test checklist

Run on a real Windows 10 or 11 PC with the normal Minecraft Launcher installed. Tick each line; the log is `%TEMP%\deepslate-install.log`.

Before anything:
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -SelfTest` says "All checks passed."

Install report:
- [ ] Every run ends with "Sending the install log to deepslate.dsw.test so Alex can help if something went wrong." and "Sent."
- [ ] Admin → Installs shows the run with Windows, memory and graphics filled in; opening it shows the log. Search the page for your Windows user name and your PC's name: neither is there.
- [ ] `/me` shows "Installed … all good"; "My PC" says "Measured by the installer" with your memory and graphics card.
- [ ] Rename `%APPDATA%\.minecraft\launcher_profiles.json` for a moment and run `Setup.bat`: it fails at step 2, and Admin → Installs shows a failed run at "Checking the Minecraft Launcher". Rename the file back.
- [ ] Pull the network cable after signing in: the install says the log could not be sent and carries on; the local log is still there.

Launcher open (the bug of 2026-09-29):
- [ ] With the launcher open: `Setup.bat` stops at step 1 with "Close the Minecraft Launcher (including the tray icon) and run this again". `launcher_profiles.json` has the same date and size as before.
- [ ] With the launcher window closed but its icon still next to the clock: the same.
- [ ] Close it completely (right-click the icon, Quit): `Setup.bat` runs through.

A clean run:
- [ ] Green ticks to the end, "saved and checked" on the profile line, then "Open the Minecraft Launcher now? [Y/n]".
- [ ] Enter opens the launcher; **Deepslate Works** is there next to Play, selected.
- [ ] `launcher_profiles.json` still has the launcher's own profiles; `launcher_profiles.json.bak` is the file as it was.
- [ ] Press Play: NeoForge loads, 15 mods, the server is in the list.
- [ ] Close the launcher, open it again: the profile is still there. (This is the line that failed on 2026-09-29.)

Again and updates:
- [ ] `Setup.bat` a second time: "Already up to date", nothing downloaded, the profile's `created` date unchanged.
- [ ] `Update and Play.bat`: no question asked, launcher opens on the profile.
- [ ] After a mod changes on the site: exactly that jar is replaced.

Edges:
- [ ] A PC with 8 GB of RAM gets a 4 GB profile; under 8 GB gets 3 GB.
- [ ] No launcher installed: step 1 says to install it and opens minecraft.net.
- [ ] Open the launcher while the mods are downloading: the run stops before the profile is written, with the close-the-launcher message. Nothing is lost; close it and run again.

## Testing
- A Windows VM (or a friend's PC over a call) for: fresh launcher, existing NeoForge, rerun-is-noop, rerun-updates-one-mod, low-RAM machine gets 3G.
- `install.ps1 -SelfTest` and the launcher-running case run under `pwsh` on Linux in a container (`mcr.microsoft.com/powershell`, with a memory limit); the rest needs Windows.
- Unit-test the manifest parsing and the NBT writer by running the script under `pwsh` on Linux with `-WhatIf`-style dry run flags (`-DryRun` skips downloads and writes to a temp dir).

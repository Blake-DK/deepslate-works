# 07 · Client installer (Windows) and `.mrpack`

## Goal

A friend downloads one zip, double-clicks `Setup.bat`, waits, opens the normal Minecraft launcher and sees a **Deepslate Works** profile with the server already in the server list. Running it again later updates the mods. It never touches their vanilla installation.

## Sign-in and "Update and Play" (Alex, 2026-09-28)

The installer authenticates every run. `install.ps1` asks the portal for a code (`POST /api/launcher/start`), opens `https://deepslate.dsw.test/launcher/<code>` in the browser, where the user logs in with Discord (guild check, auto-join) and presses "Yes, that's me"; the script polls `GET /api/launcher/poll?token=…` and receives a launcher token (7 days, stored hashed server-side, kept in `%APPDATA%\.minecraft-deepslate-works\launcher.json`). The manifest and `config.zip` are fetched with `Authorization: Bearer <token>`; the portal applies the same gate as the site (admin always; players only when live and the server is online). `Update and Play.bat` runs `install.ps1 -Play`: sign in if needed, update mods, set the profile as `selectedProfile`, open the Minecraft Launcher (classic install paths, then the Store app id, then `minecraft://`) and exit. `Setup.bat` is the first-run variant that pauses so people read the ticks. Admins can sign a member's installers out from `/admin/users` ("Sign out installer"); removing a member revokes them too. The old shared `MANIFEST_KEY` is no longer stamped into the script (the server still accepts it for admin testing).

## Files

- `Setup.bat`: `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"` then `pause`. Exists so nobody has to know what an execution policy is.
- `Update and Play.bat`: the same with `-Play`; pauses only on failure.
- `install.ps1`: PowerShell 5.1 compatible (ships with Windows 10/11). No modules, no admin rights.
- `README.txt`: three lines, same as the `/install` page.

## `install.ps1` behaviour, in order

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
12. **Launcher profile**: read `launcher_profiles.json`, set `profiles.<profile.id>` = `{ name, type: "custom", lastVersionId: "neoforge-<ver>", gameDir, javaArgs, icon, created, lastUsed: now }` (update in place if present), write back with the original indentation. Back the file up first to `launcher_profiles.json.bak`.
13. **Done**: print "Open the Minecraft Launcher, choose Deepslate Works, press Play." and the server address. Write `installed.json` in the game dir with the pack version for the `/install` page's "you're up to date" check (the page can't read it, but the script can compare on the next run and say "already up to date").

## Non-goals
- No custom launcher, no Prism install, no CurseForge app.
- No editing anything inside `.minecraft` except `launcher_profiles.json` and the NeoForge version the installer adds.
- No uninstaller in v1; the README says "delete the Deepslate Works profile and the `.minecraft-deepslate-works` folder".

## Mac / Linux
`client.mrpack` from `modpack build client`, imported into the Modrinth App (or Prism Launcher). The `/install` page shows a two-step guide. The server address must be added by hand; the guide shows it with a copy button.

## Testing
- A Windows VM (or a friend's PC over a call) for: fresh launcher, existing NeoForge, rerun-is-noop, rerun-updates-one-mod, low-RAM machine gets 3G.
- Unit-test the manifest parsing and the NBT writer by running the script under `pwsh` on Linux with `-WhatIf`-style dry run flags (`-DryRun` skips downloads and writes to a temp dir).

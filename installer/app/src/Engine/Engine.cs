using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace DeepslateWorks
{
    /// <summary>
    /// The install steps (2.0.x ran them as "-Engine" in a hidden child process; 3.0 runs them on a thread of the app).
    /// In order: the lock, what the site has (and this app brought up to date), the sign-in, the launcher, Java 21,
    /// NeoForge, the mods, the settings, the extras, the server list, the launcher profile, the Play link and the
    /// shortcuts, installed.json, the report, the game. Docs: docs/07.
    /// </summary>
    public static partial class Engine
    {
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        static bool IsControl(Exception e) => e is RunFailed || e is NeedAnswer || e is StepDeclined || e is AlreadyRunning || e is UpdateDeferred;

        /// <summary>Is the game running (seam: the tests say so). 3.3.0: Update leaves mods\ alone while it is.</summary>
        public static Func<bool> GameRunningNow = () => Extras.GameRunning();
        /// <summary>3.3.0: where Update puts what it downloaded while the game was running (moved in when it has closed).</summary>
        public const string WaitingFolder = ".waiting";

        public static string Execute(Run run)
        {
            // ---- a. the lock ----------------------------------------------------------------------------------------
            var mutex = EnterLock(Env.LockName);
            if (mutex == null)
            {
                run.Mode = "already_running";
                Log.Line("another copy holds the lock: nothing was touched");
                run.Token = ReadToken(run);
                Report.Send(run, "skipped");
                throw new AlreadyRunning();
            }
            LogBundle.Opened(run);   // 3.4.2: a run that never reports is sent with the next one
            try
            {
                return Steps(run, ref mutex);
            }
            catch (Exception e) when (!IsControl(e))
            {
                Log.Line(e.ToString());
                throw run.Fail("Something went wrong. Press Send to Alex on the Log tab and he'll sort it.");
            }
            finally
            {
                // Reached without a report having gone: the window was closed or the run was stopped part-way.
                if (!run.Reported) { Log.Line("stopped before the end"); Report.Send(run, "cancelled"); }
                LogBundle.Closed();   // reported, or not to be (a self-update's hand-off, a question waiting): never "unfinished"
                ExitLock(ref mutex);
            }
        }

        static string Steps(Run run, ref Mutex mutex)
        {
            object prev = null;
            if (File.Exists(Env.InstalledFile)) { try { prev = Json.Parse(File.ReadAllText(Env.InstalledFile)); } catch { } }
            run.Mode = GetRunMode(prev, "");
            if (run.Mode == "first_install") run.Quiet = false;
            Log.Line(string.Format("=== {0} {1} ({2}) start, {3} ===", Env.PackName, Env.Version, run.PackSeen, run.Mode));
            if (!string.IsNullOrEmpty(run.UpdatedFrom))
            {
                Show(run, string.Format("Updated to {0}", Env.Version));
                Log.Line(string.Format("STEP Updating Deepslate Works {0} {1} {2}", run.UpdatedFrom, '→', Env.Version));
                Log.Line(string.Format("OK {0} fetched, checked and started by {1}", Env.Version, run.UpdatedFrom));
            }
            // 2.0.0: what this PC's person allowed (the window asked). The window normally hands its answers in; a run
            // started without them reads consent.json as the 2.0.x engine did.
            if (run.Consent == null || run.Consent.Count == 0) run.Consent = Consents.Read(Env.ConsentPath);
            run.ReportsOff = !run.RequestConsent("reports");
            if (run.ReportsOff) Log.Line("install reports are switched off: only 'pressed Play' and the pack version are sent");

            ClearLeftovers(Env.DataDir);

            // ---- b. what the site has, and this app brought up to date --------------------------------------
            var token = ReadToken(run);
            run.Token = token;   // the site's calls carry it (Http.Token)
            object manifest = null;
            var wake = new Wake();
            if (token != null)
            {
                if (!run.DryRun && !run.UpdateOnly) wake.Waking = wake.Request(run, Wake.Call) == "waking";   // 3.3.0: Update never wakes it
                run.Step("Checking for updates");
                manifest = GetManifest(run, wake, out var unauthorized);
                if (unauthorized) { manifest = null; token = null; run.Token = null; run.Note("Your sign-in expired; signing in again"); }
                else run.Tick("Signed in");
            }

            // ---- c. sign in, only when not signed in --------------------------------------------------------------
            if (token == null)
            {
                run.RequestConsent("signin");
                token = SignIn(run);
                if (!wake.Waking && !run.UpdateOnly) wake.Waking = wake.Request(run, Wake.Call) == "waking";
                manifest = GetManifest(run, wake, out var unauthorized);
                if (unauthorized) throw run.Fail("The site did not take the new sign-in. Press Play again.");
            }
            run.Token = token;
            var packVersion = J.Str(manifest, "version");
            if (!string.IsNullOrEmpty(packVersion)) run.PackSeen = packVersion;
            run.Emit(J.O("t", "versions", "app", Env.Version, "pack", run.PackSeen ?? ""));   // the window's footer: this exe's version (new after a self-update)

            // A newer app on the site: fetched, checked, put in place and started with what this one was started with.
            if (string.IsNullOrEmpty(run.UpdatedFrom) && !run.DryRun && (run.PretendRunning == null || run.PretendRunning.Length == 0))
            {
                var u = SelfUpdate.Check(run, manifest, run.RestartArgs);
                if (u == "updated")
                {
                    run.Reported = true;   // the report is the new copy's to send
                    ExitLock(ref mutex);
                    return "updated";
                }
                if (u == "failed")
                {
                    Log.Line("UPDATE NOT APPLIED: " + run.UpdateProblem);
                    Show(run, string.Format("Deepslate Works could not update itself ({0}). Carrying on with {1}.", run.UpdateProblem, Env.Version));
                }
            }

            var neo = J.Str(manifest, "neoforge");
            var mc = J.Str(manifest, "minecraft");
            var profile = J.Obj(manifest, "profile");
            var gameDir = Path.Combine(Env.Root, J.Str(profile, "dir"));
            var files = J.Arr(manifest, "files").Where(f => !Eq(J.Str(f, "side") ?? "", "server")).ToList();
            run.Mode = GetRunMode(prev, J.Str(manifest, "hash") ?? "");
            if (run.Mode == "update") run.Note(string.Format("Pack {0} {1} {2}", J.Str(prev, "version"), '→', run.PackSeen));
            Log.Line(string.Format("{0} mods for Minecraft {1} / NeoForge {2}; this run: {3}", files.Count, mc, neo, run.Mode));

            // ---- 3.3.0, Update with the game running: the app is done (above); the changed mods go into .waiting\ and the
            // rest waits until the game has closed (the window starts the same run again then, and it moves them in) ----
            if (run.UpdateOnly && !run.DryRun && GameRunningNow())
            {
                run.Step("Downloading for when the game closes");
                var n = PrefetchWaiting(Path.Combine(gameDir, "mods"), Path.Combine(gameDir, WaitingFolder), files, (url, outFile) => Http.Download(url, outFile));
                run.Tick(n == 0 ? "Nothing to download" : string.Format("{0} file{1} downloaded, waiting for the game to close", n, n == 1 ? "" : "s"));
                Log.Line("update: the game is running; the rest finishes when it closes");
                run.Reported = true;   // the run that finishes reports
                throw new UpdateDeferred(n);
            }

            // ---- the launcher: there? Open is fine until something it would overwrite has to be written -------------
            run.RequestConsent("launcher");
            run.Step("Checking the Minecraft Launcher");
            if (!File.Exists(Env.Profiles))
            {
                run.Facts["launcher"] = J.O("kind", "not found", "version", null, "profilesFormat", null);
                if (!run.DryRun) { try { OpenUrl("https://www.minecraft.net/download"); } catch { } }
                throw run.Fail("Install the Minecraft Launcher from minecraft.net, open it once, close it, then press Play again.");
            }
            run.Facts["launcher"] = GetLauncherFacts();
            if (FindLauncher(run).Count > 0) Log.Line("the launcher is open; it only has to be closed if NeoForge or the profile has to be written");
            run.Tick("Launcher found");

            // ---- Java 21: the launcher's own, then one on PATH that is 21 or newer, then one downloaded for us -------
            run.Step("Finding Java 21");
            var bundled = Path.Combine(Env.Minecraft, @"runtime\java-runtime-delta\windows-x64\java-runtime-delta\bin\java.exe");
            var onPath = FindJavaOnPath();
            var runtimeDir = Path.Combine(gameDir, "runtime");
            var chosen = SelectJava(bundled, onPath, runtimeDir);
            // A Java download is more than the answer may have covered (planner: "something bigger than before"): asked again.
            run.RequestConsent("java", chosen.Path != null ? 1 : 2);
            run.MarkUsed("java", chosen.Path != null && !Regex.IsMatch(chosen.Source ?? "", "downloaded", RegexOptions.IgnoreCase) ? 1 : 2);
            var java = chosen.Path;
            var javaSource = chosen.Source;
            var javaPassedOver = chosen.PassedOver;
            if (!string.IsNullOrEmpty(javaPassedOver)) run.Note(string.Format("The Java on this PC ({0}) is not Java 21. It is left as it is; Minecraft gets its own.", javaPassedOver));
            if (java != null) run.Tick(chosen.Say);
            if (java == null)
            {
                if (run.DryRun) { java = "java"; run.Note("(dry run) would download Temurin 21"); }
                else
                {
                    run.Note("Downloading Java 21 (about 45 MB), one time only");
                    Directory.CreateDirectory(runtimeDir);
                    var zip = Path.Combine(Env.Temp, "temurin21.zip");
                    Http.Download("https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse", zip, 600);
                    ExtractZip(zip, runtimeDir);
                    Log.RemoveTemp(zip);
                    var found = FirstJavaIn(runtimeDir);
                    if (found == null) throw run.Fail("Java download didn't work. Press Play again, or ask Alex.");
                    java = found;
                    javaSource = "downloaded on this run";
                    run.Tick("Java 21 downloaded");
                }
            }
            string javaVersion = null;
            if (!run.DryRun) javaVersion = GetJavaVersionText(java);
            run.Facts["java"] = J.O("source", javaSource, "path", java ?? "", "version", javaVersion, "passedOver", javaPassedOver);

            // ---- NeoForge ---------------------------------------------------------------------------------------------
            run.RequestConsent("neoforge");
            run.Step(string.Format("Installing NeoForge {0}", neo));
            var versionId = "neoforge-" + neo;
            var versionDir = Path.Combine(Env.Minecraft, "versions", versionId);
            var neoBefore = Exists(versionDir);
            var neoFacts = J.O("version", neo ?? "", "before", neoBefore, "after", neoBefore);
            run.Facts["neoforge"] = neoFacts;
            if (neoBefore) run.Tick("Already installed");
            else if (run.DryRun) run.Note("(dry run) would run the NeoForge installer");
            else
            {
                RequireLauncherClosed(run, "the NeoForge installer");
                var jar = Path.Combine(Env.Temp, string.Format("neoforge-{0}-installer.jar", neo));
                Http.Download(string.Format("https://maven.neoforged.net/releases/net/neoforged/neoforge/{0}/neoforge-{0}-installer.jar", neo), jar);
                var output = RunNeoForgeInstaller(java, jar, "--install-client", out var code);
                if (code != 0) output = RunNeoForgeInstaller(java, jar, "--installClient", out code);
                foreach (var line in Lines(output)) Log.Line("neoforge: " + line);
                Log.RemoveTemp(jar);
                if (!Exists(versionDir)) throw run.Fail("NeoForge didn't install. Open the Minecraft Launcher, make sure vanilla 1.21.1 has been run once, close it, then press Play again.");
                neoFacts["after"] = true;
                run.Tick("NeoForge installed");
            }

            // ---- mods: downloaded into .downloading\, checked, then moved into mods\ ----------------------------------
            run.RequestConsent("mods");
            run.Step("Setting up the mods");
            foreach (var d in new[] { "mods", "config", "resourcepacks" }) Directory.CreateDirectory(Path.Combine(gameDir, d));
            var modsDir = Path.Combine(gameDir, "mods");
            run.PackCheckDir = modsDir; run.PackCheckFiles = files.Cast<object>().ToList();   // 2.1.0: for the report of a run that stops part-way
            var staging = Path.Combine(gameDir, ".downloading");
            var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // the extras switched on in the Extras tab are the app's, not the pack's: left where they are
            foreach (var x in Extras.AppliedJars() ?? new List<string>()) if (!string.IsNullOrEmpty(x)) keep.Add(x);
            int fetched = 0, dropped = 0;
            var gotNames = new List<string>(); var goneNames = new List<string>();   // 3.4.0: what changed, by name
            foreach (var f in files)
            {
                var name = J.Str(f, "filename");
                var sha = J.Str(f, "sha512") ?? "";
                var dest = Path.Combine(modsDir, name);
                keep.Add(name);
                if (File.Exists(dest) && string.Equals(Sha512Hex(dest), sha, StringComparison.OrdinalIgnoreCase)) continue;
                if (run.DryRun) { run.Note(string.Format("(dry run) would download {0}", name)); continue; }
                // 3.3.0: already downloaded by an Update while the game was running: moved in, not fetched again
                if (TakeWaiting(Path.Combine(gameDir, WaitingFolder), name, sha, dest)) { fetched++; gotNames.Add(name); Log.Line("moved in from .waiting: " + name); continue; }
                var r = SaveModFile(J.Str(f, "url"), dest, sha, staging, (url, outFile) => Http.Download(url, outFile));
                if (r == "wrong") throw run.Fail(string.Format("{0} downloaded wrong. Press Play again.", name));
                if (r == "in use") throw run.Fail(string.Format("{0} is in use. Close Minecraft (the game, not only the launcher), then press Play again.", name));
                fetched++; gotNames.Add(name);
                Log.Line("downloaded " + name);
            }
            foreach (var jarPath in Directory.GetFiles(modsDir, "*.jar"))
            {
                var gone = Path.GetFileName(jarPath);
                if (keep.Contains(gone)) continue;
                Log.Line("removing " + gone);
                dropped++; goneNames.Add(gone);
                if (!run.DryRun)
                {
                    try { File.SetAttributes(jarPath, FileAttributes.Normal); File.Delete(jarPath); }
                    catch (Exception e)
                    {
                        Log.Line("could not remove " + gone + ": " + e.Message);
                        throw run.Fail(string.Format("{0} is in use. Close Minecraft (the game, not only the launcher), then press Play again.", gone));
                    }
                }
            }
            run.Tick(string.Format("{0} mods in place ({1} downloaded)", files.Count, fetched));
            ClearWaiting(Path.Combine(gameDir, WaitingFolder));
            // "Updated 3 mods" on the Play tab, in place of asking about routine updates (planner)
            if (run.Mode != "first_install" && fetched + dropped > 0)
            {
                var what = new List<string>();
                if (fetched > 0) what.Add(string.Format("Updated {0} mod{1}", fetched, fetched == 1 ? "" : "s"));
                if (dropped > 0) what.Add(string.Format("removed {0}", dropped));
                run.Emit(J.O("t", "changed", "text", string.Join(", ", what), "detail", ChangedDetail(gotNames, goneNames)));
            }

            // ---- settings: the pack's config files (zip from the site) and, the first time, options.txt ---------------
            run.Step("Settings");
            var configUrl = J.Str(manifest, "config_url");
            if (!string.IsNullOrEmpty(configUrl) && !run.DryRun)
            {
                var cz = Path.Combine(Env.Temp, "deepslate-config.zip");
                try
                {
                    Http.Download(configUrl, cz);
                    ExtractZip(cz, gameDir);
                    run.Tick("Config files updated");
                }
                catch (Exception e) { run.Note("The config files could not be updated this time: " + e.Message); }
                finally { Log.RemoveTemp(cz); }
            }
            var options = Path.Combine(gameDir, "options.txt");
            // 3.5.0 (docs/30 §4.2): what the Settings tab kept for this Play (saved while Minecraft was open), first
            if (!run.DryRun)
            {
                try { var applied = GameSettings.ApplyPending(options, GameRunningNow()); if (applied != null) run.Tick(applied); }
                catch (Exception e) { run.Note("Your settings from the Settings tab could not be applied this time: " + e.Message); }
            }
            int rd = 8, sd = 6;
            try
            {
                if (J.Get(manifest, "render_distance") != null && J.Long(manifest, "render_distance") is long rdl && rdl != 0) rd = checked((int)rdl);
                if (J.Get(manifest, "simulation_distance") != null && J.Long(manifest, "simulation_distance") is long sdl && sdl != 0) sd = checked((int)sdl);
            }
            catch { }
            object prevOurs = J.Has(prev, "renderDistance") ? J.Get(prev, "renderDistance") : null;
            object ourRender = prevOurs;
            if (run.DryRun) run.Note(string.Format("(dry run) render distance for this PC: {0}", rd));
            else
            {
                try
                {
                    var r = SetRenderDistance(options, prevOurs, rd, sd);
                    ourRender = r.Ours;
                    run.Tick(r.Text);
                    var cl = SetChatLinks(options);
                    if (cl != null) run.Tick(cl);
                }
                catch (Exception e) { run.Note("The render distance was left as it is: " + e.Message); }
            }

            // ---- extras (2.0.0): every extra downloaded into extras\, nothing switched on; the Extras tab switches them -----
            if (!run.DryRun && run.RequestConsent("extras"))
            {
                try { Extras.SyncForRun(run); }
                catch (Exception e) when (!IsControl(e)) { run.Note("The visual extras could not be fetched this time: " + e.Message); }
            }

            // ---- the logo: the .ico for the window, shortcuts and Settings -> Apps (planner, 2026-10-01; 2.1.1) ---------
            var brandChanged = false;
            var branding = J.Get(manifest, "branding");
            if (!run.DryRun && Env.OnWindows && !Env.CustomRoot && branding != null)
            {
                var b = Brand.Save(branding, Env.AppHome, url =>
                {
                    var tmp = Path.Combine(Env.Temp, "deepslate-logo.ico");
                    try { Http.Download(url, tmp, 30); return File.ReadAllBytes(tmp); } finally { Log.RemoveTemp(tmp); }
                });
                if (b == "saved") { brandChanged = true; run.Tick("New logo in place"); }
                else if (b.StartsWith("failed")) run.Note("The logo could not be updated this time: " + b.Substring(8));
            }

            // ---- the server list (servers.dat: uncompressed NBT, one entry), the first time --------------------------
            run.RequestConsent("profile");
            var serversDat = Path.Combine(gameDir, "servers.dat");
            var serverAddress = J.Str(manifest, "server_address");
            if (!Exists(serversDat) && !run.DryRun)
            {
                File.WriteAllBytes(serversDat, ServersDat(Env.PackName, serverAddress));
                run.Tick(string.Format("Server added to your list: {0}", serverAddress));
            }

            // ---- the launcher profile ---------------------------------------------------------------------------------
            run.Step("Adding the launcher profile");
            // 3.5.0 (docs/30 §4.1): the memory chosen on the Settings tab, kept within what this PC may give; automatic
            // otherwise. Memory works the bounds out for the tab's slider too.
            var totalGb = Memory.TotalGb();
            var ram = Memory.FromManifest(manifest, totalGb);
            var ramChosen = AppSettings.RamGb();
            var xmx = Memory.Xmx(ramChosen, ram, out var ramClamped);
            if (ramClamped) run.Note(string.Format("You chose {0} GB in Settings; this PC can give the game {1} GB at most, so it gets {1} GB.", ramChosen, xmx));
            var xmxText = xmx.ToString(Inv);
            var javaArgs = "-Xmx" + xmxText + "G -Xms1G -XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:MaxGCPauseMillis=50 -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20";
            var now = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", Inv);
            var profileId = J.Str(profile, "id");
            var entry = J.O("name", Env.PackName, "type", "custom", "lastVersionId", versionId, "gameDir", gameDir, "javaArgs", javaArgs,
                            "javaDir", java, "icon", Brand.ProfileIcon(branding, J.Get(profile, "icon")), "created", now, "lastUsed", now);   // 2.1.1: the logo
            bool profileLeft = false;
            if (!run.DryRun && FindLauncher(run).Count > 0 && TestLauncherProfile(Env.Profiles, profileId, versionId) == "" && ProfileJavaArgs(Env.Profiles, profileId) == javaArgs)
            {
                // Launcher open, profile already there, pointing at the right NeoForge and with this memory (3.5.0: a
                // memory chosen in Settings is a change to write, so the launcher has to be closed for it): nothing to write.
                profileLeft = true;
                Log.Line("the launcher is open and the profile is right: launcher_profiles.json left as it is");
            }
            if (run.DryRun) run.Note("(dry run) would write the profile to launcher_profiles.json");
            else if (!profileLeft)
            {
                RequireLauncherClosed(run, "launcher_profiles.json is written");
                SetLauncherProfile(Env.Profiles, profileId, entry);
                // Read it back. Then once more after a moment: a launcher that was just starting would have written over it by now.
                var problem = TestLauncherProfile(Env.Profiles, profileId, versionId);
                if (problem == "")
                {
                    Sleep(2);
                    problem = TestLauncherProfile(Env.Profiles, profileId, versionId);
                }
                if (problem == "" && FindLauncher(run).Count > 0) problem = "the Minecraft Launcher was opened while the profile was being written, and will overwrite it when it closes";
                if (problem != "")
                {
                    Log.Line("PROFILE NOT SAVED: " + problem);
                    // 2.0.x said this on the console and the window only knew the run had failed: now the window shows it.
                    run.Emit(J.O("t", "fail", "text", "The launcher profile was not saved."));
                    Show(run, string.Format("What is wrong: {0}.", problem));
                    Show(run, "Close the Minecraft Launcher completely (also its icon next to the clock), then press Play again.");
                    Show(run, "The mods are in place; only the profile is missing.");
                    Log.Line("FAIL the launcher profile was not saved");
                    Report.Send(run, "failed");
                    throw new RunFailed("The launcher profile was not saved.");
                }
            }
            if (profileLeft) run.Tick(string.Format("Profile '{0}' is already in the launcher", Env.PackName));
            else run.Tick(string.Format("Profile '{0}' with {1} GB of RAM ({2}your PC has {3} GB), saved and checked", Env.PackName, xmxText, ramChosen.HasValue ? "chosen in Settings; " : "", totalGb.ToString(Inv)));
            if (!run.DryRun) { try { run.Settings = GameSettings.ReportBlock(ramChosen, xmx, options); } catch (Exception e) { Log.Line("settings: not in the report: " + e.Message); } }

            // ---- the Play link and the shortcuts: put right when missing (setup made them; this keeps them) ------
            if (!run.DryRun && !Env.CustomRoot && Env.OnWindows && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("LOCALAPPDATA")))
            {
                try
                {
                    var links = run.RequestConsent("shortcuts");
                    var rh = Home.RepairHere(run, links, brandChanged);   // 2.1.1: a new logo makes the shortcuts again
                    if (rh != null)
                    {
                        if (rh.Fixed) run.Tick("Play button set up on this run");
                        foreach (var said in rh.Said) if (said.Key != "ok") run.Note(said.Value);
                    }
                }
                catch (Exception e) when (!IsControl(e)) { Log.Line("could not check the Play link and the shortcuts: " + e.Message); }
            }

            // ---- 2.1.0: every mod checked once more before anything can start the game ------------------------------
            // (kanefinch, 2026-10-01: a game without TaCZ was refused at the server's handshake.) What is missing or
            // wrong is fetched again and checked again; still not right, and this run stops here: no launcher, no "installed".
            if (!run.DryRun)
            {
                run.Step("Checking every mod before the game starts");
                run.ModsCheck = RepairPackMods(modsDir, run.PackCheckFiles, (f, dest) =>
                {
                    var r = SaveModFile(J.Str(f, "url"), dest, J.Str(f, "sha512") ?? "", staging, (url, outFile) => Http.Download(url, outFile));
                    if (r != "") throw new IOException(r);
                });
                if (!run.ModsCheck.Ok) throw run.Fail(MissingText(run.ModsCheck));
                run.Tick(string.Format("All {0} mods checked", run.ModsCheck.Checked));
                try { SavePackList(PackListPath, manifest); } catch (Exception e) when (!IsControl(e)) { Log.Line("could not keep the mod list for the game check: " + e.Message); }
            }
            if (!run.DryRun)
                Json.WriteFile(Env.InstalledFile, J.O("version", run.PackSeen, "installedAt", now, "hash", J.Get(manifest, "hash"), "installer", Env.Version, "renderDistance", ourRender));
            if (!run.DryRun) run.Emit(J.O("t", "installed", "pack", run.PackSeen ?? ""));   // the window's footer: the pack on this PC now

            // ---- d. the report, e. the game -------------------------------------------------------------------------
            // 3.1.0 (planner B8): a run that ends with the game sends its report, the "pressed Play" that Play first
            // counts from, when the game is started: after the countdown, or after Play is pressed in the window. A run
            // that ends without the game (dry run, the Extras download) reports here.
            Log.Line("=== done ===");
            run.StepName = "";
            var launching = !run.DryRun && !run.NoLaunch;
            if (!launching) Report.Send(run, "ok");
            ExitLock(ref mutex);
            run.Emit(J.O("t", "done", "mode", run.Mode, "pack", run.PackSeen ?? ""));
            if (run.DryRun) Show(run, "(dry run) Nothing was changed.");
            else if (run.NoLaunch) Log.Line("not opening the launcher (asked not to)");
            else if (!WaitForGo(run)) return "not_launched";
            else
            {
                if (profileLeft) { run.Emit(J.O("t", "launched", "opened", false)); Show(run, string.Format("The Minecraft Launcher is already open. Choose {0} next to Play, then press Play.", Env.PackName)); }
                else if (!OpenLauncherChecked(run, modsDir, run.PackCheckFiles))
                {
                    if (run.ModsCheck != null && !run.ModsCheck.Ok) throw run.Fail(MissingText(run.ModsCheck));
                    Show(run, string.Format("Open the Minecraft Launcher from the Start menu, choose {0}, press Play.", Env.PackName));
                }
                if (run.Mode == "first_install") Show(run, string.Format("From now on, press Play on {0} or open {1} from your desktop. It keeps itself up to date.", Env.PortalUrl.Replace("https://", ""), Env.PackName));
                if (wake.Waking) wake.Watch(run, Wake.Call, Sleep);
            }
            return "done";
        }

        /// <summary>
        /// 3.1.0: the game is ready. With a window (run.WaitForGo set) this waits for it: the countdown reaching 0, Play
        /// pressed, or the setting "start straight away". Then the report goes ("pressed Play", for Play first) and the
        /// game starts. Closed without starting: the report says so ("cancelled", at "Waiting for you to press Play").
        /// </summary>
        public static bool WaitForGo(Run run)
        {
            if (run.WaitForGo != null)
            {
                run.StepName = UiText.WaitingForPlayStep;
                run.Emit(J.O("t", "ready", "mode", run.Mode, "pack", run.PackSeen ?? ""));
                Log.Line("ready: waiting for the window to start the game");
                bool go;
                try { go = run.WaitForGo(); } catch (Exception e) { Log.Line("ready: " + e.Message); go = false; }
                if (!go)
                {
                    Log.Line("ready: the game was not started (the window was closed)");
                    // 3.2.0: opening the app and closing it again, with nothing updated, is not a press of Play
                    if (run.OpenedOnly && run.Mode == "play") { Log.Line("ready: opened without playing, nothing changed: no report"); run.Reported = true; }
                    else Report.Send(run, "cancelled");
                    return false;
                }
                run.StepName = "";
                Log.Line("ready: starting the game");
            }
            Report.Send(run, "ok");
            return true;
        }

        /// <summary>java -jar installer.jar --install-client "%APPDATA%\.minecraft": no window; what it printed comes back.</summary>
        static string RunNeoForgeInstaller(string java, string jar, string how, out int exitCode)
        {
            var psi = new ProcessStartInfo(java, string.Format("-jar \"{0}\" {1} \"{2}\"", jar, how, Env.Minecraft))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,   // 2.0.x left stderr on the console, where nobody read it; it is drained, as before not logged
                WorkingDirectory = Env.Temp,
            };
            using (var p = Process.Start(psi))
            {
                var outp = p.StandardOutput.ReadToEndAsync();
                var err = p.StandardError.ReadToEndAsync();
                p.WaitForExit();
                exitCode = p.ExitCode;
                try { err.Wait(); } catch { }
                return outp.Result;
            }
        }

        /// <summary>The lines of a text as Get-Content gives them (no empty last line for a trailing newline).</summary>
        static IEnumerable<string> Lines(string text)
        {
            if (string.IsNullOrEmpty(text)) yield break;
            var parts = Regex.Split(text, "\r?\n");
            int n = parts.Length;
            if (n > 0 && parts[n - 1].Length == 0) n--;
            for (int i = 0; i < n; i++) yield return parts[i];
        }

        /// <summary>3.4.0 (docs/21 §4): the line under "Updated 3 mods" on the Play tab: the files by name, ".jar" left off,
        /// removed ones marked, at most max of them and "and N more".</summary>
        public static string ChangedDetail(IList<string> updated, IList<string> removed, int max = 6)
        {
            string Bare(string f) => f != null && f.EndsWith(".jar", StringComparison.OrdinalIgnoreCase) ? f.Substring(0, f.Length - 4) : f ?? "";
            var all = (updated ?? new List<string>()).Select(Bare).Concat((removed ?? new List<string>()).Select(f => Bare(f) + " (removed)")).ToList();
            if (all.Count == 0) return "";
            var shown = string.Join(", ", all.Take(max));
            return all.Count > max ? string.Format("{0} and {1} more", shown, all.Count - max) : shown;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using Microsoft.Win32;

namespace DeepslateWorks
{
    /// <summary>
    /// Uninstall (docs/07 "Uninstall", planner 2026-09-30): removes what Deepslate Works put on the PC and nothing else.
    /// Started from Settings -> Apps or "Uninstall Deepslate Works" in the Start Menu (-Uninstall). There is no console:
    /// the question and the answer are message boxes (2.0.3's hidden-mode words). Every path is in UninstallTargets, so
    /// the tests run the whole thing against scratch folders; a registry key is "HKCU:\..." on a PC and a folder in the
    /// tests, and KeyExists / RemoveKey treat both the same way.
    /// </summary>
    public static class Uninstaller
    {
        public class Targets
        {
            public string GameDir, Profiles, HomeDir, HandlerKey, UninstallKey, Pictures;
            public List<string> Shortcuts = new List<string>();
        }

        public class Result
        {
            public List<string> Removed = new List<string>();
            public List<string> Kept = new List<string>();
            public List<string> Problems = new List<string>();
            /// <summary>The home folder that holds the running exe: removed by cmd.exe once this process has ended.</summary>
            public string RemoveLater;
        }

        /// <summary>Tests: process names to treat as running.</summary>
        public static string[] PretendRunning = new string[0];
        /// <summary>Tests: how launcher_profiles.json is written (a write that fails half-way).</summary>
        public static Action<string, object> WriteProfiles = WriteProfilesFile;

        const string HomeText = "Deepslate Works itself, in your AppData, with your answers to its questions and your extras choices";

        /// <summary>Where everything is. hkcu is "HKCU:" on a PC, a scratch folder in the tests.</summary>
        public static Targets GetTargets(string root, string homeDir, string desktop, string programs, string pictures, string hkcu)
        {
            var t = new Targets
            {
                GameDir = Path.Combine(root, ".minecraft-deepslate-works"),
                Profiles = Path.Combine(Path.Combine(root, ".minecraft"), "launcher_profiles.json"),
                HomeDir = homeDir,
                HandlerKey = hkcu + @"\Software\Classes\deepslate",
                UninstallKey = hkcu + @"\Software\Microsoft\Windows\CurrentVersion\Uninstall\" + Env.UninstallKeyName,
                Pictures = string.IsNullOrEmpty(pictures) ? null : Path.Combine(pictures, Env.PackName + " screenshots"),
            };
            if (!string.IsNullOrEmpty(desktop)) t.Shortcuts.Add(Path.Combine(desktop, Home.ShortcutName));
            if (!string.IsNullOrEmpty(programs)) { t.Shortcuts.Add(Path.Combine(programs, Home.ShortcutName)); t.Shortcuts.Add(Path.Combine(programs, Home.UninstallShortcutName)); }
            return t;
        }

        // ---- registry keys or folders --------------------------------------------------------------------------
        const string Hkcu = "HKCU:\\";
        public static bool KeyExists(string key)
        {
            if (string.IsNullOrEmpty(key)) return false;
            if (key.StartsWith(Hkcu, StringComparison.OrdinalIgnoreCase))
            {
                try { using (var k = Registry.CurrentUser.OpenSubKey(key.Substring(Hkcu.Length))) return k != null; } catch { return false; }
            }
            return Directory.Exists(key);
        }
        public static void RemoveKey(string key)
        {
            if (key.StartsWith(Hkcu, StringComparison.OrdinalIgnoreCase)) Registry.CurrentUser.DeleteSubKeyTree(key.Substring(Hkcu.Length), false);
            else DeleteTree(key);
        }

        public static bool TestOurProfile(string path)
        {
            if (!File.Exists(path)) return false;
            try { return J.Obj(Json.Parse(File.ReadAllText(path)), "profiles")?.ContainsKey(Env.ProfileId) == true; } catch { return false; }
        }

        /// <summary>Is anything of ours on this PC?</summary>
        public static bool TestFootprint(Targets t)
        {
            if (TestOurProfile(t.Profiles)) return true;
            foreach (var d in new[] { t.GameDir, t.HomeDir }) if (!string.IsNullOrEmpty(d) && Directory.Exists(d)) return true;
            if (KeyExists(t.HandlerKey) || KeyExists(t.UninstallKey)) return true;
            return t.Shortcuts.Any(File.Exists);
        }

        static string Others(JObj profiles, string id)
            => string.Join("\n", profiles.OrderedKeys.Where(k => k != id).Select(k => k + "=" + Json.Write(profiles[k])));

        /// <summary>Takes our profile out of launcher_profiles.json and nothing else. Backed up first; read back; the other
        /// profiles must come back exactly as they were, or the backup is put back and the error goes up. "none" | "removed".</summary>
        public static string RemoveLauncherProfile(string path, string id)
        {
            if (!File.Exists(path)) return "none";
            var json = Json.Parse(File.ReadAllText(path)) as JObj;
            var profiles = J.Obj(json, "profiles");
            if (profiles == null || !profiles.ContainsKey(id)) return "none";
            var others = Others(profiles, id);
            var backup = path + ".deepslate-backup";
            File.Copy(path, backup, true);
            try
            {
                profiles.Remove(id);
                if (J.Str(json, "selectedProfile") == id) json.Remove("selectedProfile");
                WriteProfiles(path, json);
                var after = J.Obj(Json.Parse(File.ReadAllText(path)), "profiles");
                if (after == null || after.ContainsKey(id) || Others(after, id) != others) throw new IOException("the other profiles did not read back the same");
            }
            catch
            {
                File.Copy(backup, path, true);
                Log.RemoveTemp(backup);
                throw;
            }
            Log.RemoveTemp(backup);
            return "removed";
        }

        /// <summary>Write-Json: no byte-order mark (a launcher that does not expect one starts again from its defaults),
        /// written next to the file and moved into place, so a half-written file is never what the launcher finds.</summary>
        static void WriteProfilesFile(string path, object json)
        {
            var tmp = path + ".deepslate-tmp";
            File.WriteAllText(tmp, Json.Write(json, true), new System.Text.UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        /// <summary>Screenshots taken in the game go to Pictures\Deepslate Works screenshots before the game folder goes
        /// (never overwriting). How many.</summary>
        public static int MoveScreenshots(string from, string to)
        {
            if (string.IsNullOrEmpty(to) || !Directory.Exists(from)) return 0;
            var files = Directory.GetFiles(from);
            if (files.Length == 0) return 0;
            Directory.CreateDirectory(to);
            foreach (var f in files)
            {
                var dest = Path.Combine(to, Path.GetFileName(f));
                int n = 1;
                while (File.Exists(dest) || Directory.Exists(dest)) { dest = Path.Combine(to, string.Format("{0} ({1}){2}", Path.GetFileNameWithoutExtension(f), n, Path.GetExtension(f))); n++; }
                File.Move(f, dest);
            }
            return files.Length;
        }

        /// <summary>The launcher open means no (it would write our profile back). Null when it may go ahead.</summary>
        public static string GetRefusal(string[] pretendRunning)
        {
            if (Home.FindLauncher(pretendRunning).Count > 0) return "Close the Minecraft Launcher (including the tray icon) and run this again. While it is open it would put the Deepslate Works profile back.";
            return null;
        }

        /// <summary>Does it. report / revoke may throw (no internet). me: the running exe; when it is in the home folder,
        /// everything else there goes now and the folder itself once this process has ended (Result.RemoveLater).</summary>
        public static Result Invoke(Targets t, string token, Action<string> report, Action<string> revoke, string me)
        {
            var r = new Result();
            try
            {
                if (RemoveLauncherProfile(t.Profiles, Env.ProfileId) == "removed") r.Removed.Add("the Deepslate Works profile in the Minecraft Launcher (your other profiles are as they were)");
            }
            catch (Exception e) { r.Problems.Add("the launcher profile could not be taken out, so the file was left as it was (" + e.Message + ")"); }
            try
            {
                int moved = MoveScreenshots(Path.Combine(t.GameDir, "screenshots"), t.Pictures);
                if (moved > 0) r.Kept.Add(string.Format("{0} screenshot(s), moved to {1}", moved, t.Pictures));
            }
            catch (Exception e) { r.Problems.Add("the screenshots could not be moved, so the game folder was kept (" + e.Message + ")"); return r; }
            if (!string.IsNullOrEmpty(token))
            {
                try { report?.Invoke(token); } catch (Exception e) { Log.Line("uninstall report not sent: " + e.Message); }
                bool signedOut = false;
                try { revoke?.Invoke(token); signedOut = true; } catch (Exception e) { Log.Line("sign-in not revoked on the site: " + e.Message); }
                r.Removed.Add(signedOut ? "this PC's sign-in, also signed out on the site" : "this PC's sign-in (the site could not be reached; it expires by itself within 7 days)");
            }

            var gameText = "the game folder (mods, the extras downloaded for the Extras tab, settings, the Java it downloaded, logs, the server list)";
            if (!string.IsNullOrEmpty(t.GameDir) && Directory.Exists(t.GameDir))
            {
                try { DeleteTree(t.GameDir); r.Removed.Add(gameText); }
                catch (Exception e) { r.Problems.Add(string.Format("{0} could not be removed completely: is Minecraft still running? ({1})", gameText, e.Message)); }
            }
            if (!string.IsNullOrEmpty(t.HomeDir) && Directory.Exists(t.HomeDir))
            {
                if (Inside(me, t.HomeDir))
                {
                    // 3.0: this program is in there, and Windows does not let a running program delete itself. Everything
                    // else goes now; the folder (with the exe) goes a few seconds after this process has ended.
                    var why = DeleteAllBut(t.HomeDir, me);
                    if (why != null) r.Problems.Add(string.Format("{0} could not be removed completely: is Minecraft still running? ({1})", HomeText, why));
                    else r.Removed.Add(HomeText + " (the last of it goes a few seconds after this message is closed)");
                    r.RemoveLater = t.HomeDir;
                }
                else
                {
                    try { DeleteTree(t.HomeDir); r.Removed.Add(HomeText); }
                    catch (Exception e) { r.Problems.Add(string.Format("{0} could not be removed completely: is Minecraft still running? ({1})", HomeText, e.Message)); }
                }
            }
            if (KeyExists(t.HandlerKey))
            {
                try { RemoveKey(t.HandlerKey); r.Removed.Add("the Play button's link to this PC (deepslate://)"); }
                catch (Exception e) { r.Problems.Add("the deepslate:// link: " + e.Message); }
            }
            int links = 0;
            foreach (var l in t.Shortcuts)
            {
                if (string.IsNullOrEmpty(l) || !File.Exists(l)) continue;
                try { File.SetAttributes(l, FileAttributes.Normal); File.Delete(l); links++; } catch (Exception e) { r.Problems.Add("a shortcut: " + e.Message); }
            }
            if (links > 0) r.Removed.Add(string.Format("the shortcuts on the desktop and in the Start Menu ({0})", links));
            // last: the entry in Settings -> Apps
            if (KeyExists(t.UninstallKey))
            {
                try { RemoveKey(t.UninstallKey); r.Removed.Add("its entry in Settings -> Apps"); }
                catch (Exception e) { r.Problems.Add("the Settings -> Apps entry: " + e.Message); }
            }
            r.Kept.Add("Java (the Minecraft Launcher's own, or one you installed yourself)");
            r.Kept.Add("the Minecraft Launcher, your other profiles and worlds, and NeoForge's shared files in .minecraft");
            r.Kept.Add("your account on the site and your link to Minecraft: your things on the server are safe");
            return r;
        }

        /// <summary>The words of the last message box (2.0.3's hidden-mode summary).</summary>
        public static string Summary(Result r)
        {
            var msg = new List<string>();
            if (r.Removed.Count > 0) { msg.Add("Removed:"); msg.AddRange(r.Removed.Select(x => "  - " + x)); }
            msg.Add("Kept:"); msg.AddRange(r.Kept.Select(x => "  - " + x));
            if (r.Problems.Count > 0) { msg.Add("Not done:"); msg.AddRange(r.Problems.Select(x => "  - " + x)); }
            msg.Add("");
            msg.Add(r.Problems.Count == 0 ? "Deepslate Works is off this PC. To play again, download it from the site." : "Most of it is gone. Close Minecraft and run the uninstall again for the rest.");
            return string.Join("\r\n", msg);
        }

        // ---- one copy at a time (docs/07 "The lock") -----------------------------------------------------------
        // 2026-09-29: m1owl pressed Play while Setup.bat was still downloading; both wrote the same file in mods/. A named
        // mutex is held for the whole run; a copy that was killed leaves it "abandoned", which the next run takes over.
        public static Mutex TakeLock(string name)
        {
            Mutex m;
            try { m = new Mutex(false, name); }
            catch (Exception e) { Log.Line("could not make the lock " + name + ": " + e.Message); return null; }
            bool got;
            try { got = m.WaitOne(0); }
            catch (AbandonedMutexException) { got = true; Log.Line("the last run did not end properly; carrying on"); }
            if (!got) { m.Dispose(); return null; }
            return m;
        }
        public static void ReleaseLock(Mutex m)
        {
            if (m == null) return;
            try { m.ReleaseMutex(); } catch { }
            try { m.Dispose(); } catch { }
        }

        /// <summary>The window holds Local\DeepslateWorks.App while it is open, and it runs the exe this removes. A window
        /// that is closing (it may have started this) gets a few seconds.</summary>
        static bool WindowOpen(int waitMs)
        {
            var until = DateTime.UtcNow.AddMilliseconds(waitMs);
            while (true)
            {
                bool open = false;
                try { if (Mutex.TryOpenExisting(Env.AppMutexName, out var m)) { open = true; m.Dispose(); } } catch { }
                if (!open || DateTime.UtcNow >= until) return open;
                Thread.Sleep(250);
            }
        }

        // ---- -Uninstall ----------------------------------------------------------------------------------------
        /// <summary>A message box, or with -Yes (2.x's -Quiet: tests, scripts) only the log: nothing may wait for a click then.</summary>
        static void Say(bool yes, string text, bool warn)
        {
            if (yes) { Log.Line("uninstall: " + text.Replace("\r\n", " / ").Replace("\n", " / ")); return; }
            Native.Box(text, false, warn);
        }

        public static int Run(bool yes)
        {
            var run = new global::DeepslateWorks.Run { Mode = "uninstall", Quiet = false };
            global::DeepslateWorks.Run.Current = run;
            var me = Env.MePath;
            // the home folder is about to go: never be "in" it (a shortcut starts the exe there)
            try { Environment.CurrentDirectory = Path.GetTempPath(); } catch { }
            Targets t;
            if (Env.CustomRoot || !Env.OnWindows)
            {
                // a test run keeps everything, the "registry" too, inside Root
                var root = Env.Root;
                t = GetTargets(root, Env.AppHome, Path.Combine(root, "Desktop"), Path.Combine(root, "Programs"), Path.Combine(root, "Pictures"), Path.Combine(root, "registry"));
            }
            else
            {
                t = GetTargets(Env.Root, Env.AppHome, Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs), Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "HKCU:");
            }
            Log.Line(string.Format("=== {0} {1} uninstall start ===", Env.PackName, Env.Version));

            var lk = TakeLock(Env.LockName);
            if (lk == null)
            {
                Say(yes, "Deepslate Works is already running in another window. Let it finish, then run the uninstall again.", true);
                return Env.ExitAlreadyRunning;
            }
            Result res;
            try
            {
                if (WindowOpen(5000))
                {
                    Say(yes, "Close the Deepslate Works window first, then run the uninstall again.", true);
                    Log.Line("uninstall refused: the window is open");
                    return 1;
                }
                var no = GetRefusal(PretendRunning);
                if (no != null) { Say(yes, no, true); Log.Line("uninstall refused: the launcher is open"); return 1; }
                if (!TestFootprint(t))
                {
                    Say(yes, "Deepslate Works isn't on this PC. There is nothing to remove.", false);
                    return 0;
                }
                if (!yes)
                {
                    var q = "Remove Deepslate Works from this PC? Your worlds on the server are safe; this only removes the mods and files on this computer.";
                    if (Native.Box(q, true) != "yes") { Log.Line("uninstall: the answer was no"); return 0; }
                }
                string tok = null;
                try { tok = J.Str(Json.ReadFile(Path.Combine(t.GameDir, "launcher.json")), "token"); } catch { }
                res = Invoke(t, tok,
                    token => { run.Token = token; run.Reported = false; Report.Send(run, "ok"); },
                    token => { Http.Token = token; Http.Call("POST", Env.PortalUrl + "/api/launcher/revoke", 15); },
                    me);
                run.Reported = true;
                Say(yes, Summary(res), res.Problems.Count > 0);
                Log.Line(string.Format("uninstall done: {0} removed, {1} problems", res.Removed.Count, res.Problems.Count));
            }
            finally { ReleaseLock(lk); }

            if (res.RemoveLater != null) RemoveWhenGone(res.RemoveLater);
            if (res.Problems.Count == 0 && !Env.CustomRoot) Log.RemoveTemp(Env.LogFile);   // the last trace: this run's log
            return res.Problems.Count == 0 ? 0 : 1;
        }

        /// <summary>The home folder with this exe in it: a hidden cmd.exe waits 3 s (this process has ended by then) and
        /// removes it.</summary>
        static void RemoveWhenGone(string dir)
        {
            try
            {
                var cmd = Path.Combine(Environment.SystemDirectory, "cmd.exe");
                var psi = new ProcessStartInfo(cmd, "/c \"timeout /t 3 /nobreak >nul & rmdir /s /q \"" + dir + "\"\"")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetTempPath(),   // never inside the folder it removes
                };
                Home.StartProcess(psi);
                Log.Line("removing " + dir + " once this process has ended");
            }
            catch (Exception e) { Log.Line("could not start the removal of " + dir + ": " + e.Message); }
        }

        // ---- folders -------------------------------------------------------------------------------------------
        static bool Inside(string file, string dir)
        {
            if (string.IsNullOrEmpty(file) || string.IsNullOrEmpty(dir)) return false;
            try { return Path.GetFullPath(file).StartsWith(Path.GetFullPath(dir).TrimEnd('\\', '/') + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        /// <summary>Remove-Item -Recurse -Force: read-only files too.</summary>
        public static void DeleteTree(string dir)
        {
            try { Directory.Delete(dir, true); return; }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }
            ClearAttributes(dir);
            Directory.Delete(dir, true);
        }
        static void ClearAttributes(string dir)
        {
            try
            {
                foreach (var f in Directory.GetFiles(dir)) { try { File.SetAttributes(f, FileAttributes.Normal); } catch { } }
                foreach (var d in Directory.GetDirectories(dir)) { try { File.SetAttributes(d, FileAttributes.Directory); } catch { } ClearAttributes(d); }
            }
            catch { }
        }

        /// <summary>Everything in dir but keep. The first error, or null.</summary>
        static string DeleteAllBut(string dir, string keep)
        {
            string first = null;
            try
            {
                foreach (var f in Directory.GetFiles(dir))
                {
                    if (Home.SamePath(f, keep)) continue;
                    try { File.SetAttributes(f, FileAttributes.Normal); File.Delete(f); } catch (Exception e) { first = first ?? e.Message; }
                }
                foreach (var d in Directory.GetDirectories(dir))
                {
                    if (Inside(keep, d)) { var w = DeleteAllBut(d, keep); first = first ?? w; continue; }
                    try { DeleteTree(d); } catch (Exception e) { first = first ?? e.Message; }
                }
            }
            catch (Exception e) { first = first ?? e.Message; }
            return first;
        }
    }
}

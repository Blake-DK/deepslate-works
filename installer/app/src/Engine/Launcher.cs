using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace DeepslateWorks
{
    // ---- the launcher and its profile file -----------------------------------------------------------------
    // The Minecraft Launcher keeps launcher_profiles.json in memory while it is open and writes it back
    // later, which throws away whatever was written underneath it. On the first real install (2026-09-29)
    // that wiped the NeoForge profile and ours: the file was back to the two defaults. So nothing is
    // installed or written while the launcher runs, and what was written is read back and checked.
    public static partial class Engine
    {
        const string StoreLauncherPackage = "Microsoft.4297127D64EC6";

        static string[] LauncherExes()
        {
            var x86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "";
            var pf = Environment.GetEnvironmentVariable("ProgramFiles") ?? "";
            var local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
            return new[]
            {
                x86 + @"\Minecraft Launcher\MinecraftLauncher.exe",
                pf + @"\Minecraft Launcher\MinecraftLauncher.exe",
                local + @"\Programs\Minecraft Launcher\MinecraftLauncher.exe",
            };
        }

        /// <summary>The names of the launcher's processes that run (run.PretendRunning first: tests).</summary>
        public static List<string> FindLauncher(Run run)
        {
            var found = new List<string>();
            foreach (var n in run?.PretendRunning ?? new string[0]) if (!string.IsNullOrEmpty(n)) found.Add(n);
            Process[] procs;
            try { procs = Process.GetProcesses(); } catch { procs = new Process[0]; }
            foreach (var p in procs)
            {
                try
                {
                    string n;
                    try { n = p.ProcessName ?? ""; } catch { continue; }
                    if (Eq(n, "MinecraftLauncher") || Eq(n, "Minecraft Launcher")) { found.Add(n); continue; }
                    if (Eq(n, "Minecraft"))
                    {
                        // The Store / Xbox launcher runs as Minecraft.exe. (Bedrock is Minecraft.Windows; the game itself is javaw.)
                        string path = "";
                        try { path = p.MainModule?.FileName ?? ""; } catch { }
                        if (path == "" || path.IndexOf("Launcher", StringComparison.OrdinalIgnoreCase) >= 0) found.Add(n);
                        continue;
                    }
                    string title = "";
                    try { title = p.MainWindowTitle ?? ""; } catch { }
                    if (Eq(title, "Minecraft Launcher")) found.Add(n);
                }
                finally { try { p.Dispose(); } catch { } }
            }
            return found.Distinct(StringComparer.Ordinal).ToList();
        }

        public static void RequireLauncherClosed(Run run, string before)
        {
            var running = FindLauncher(run);
            if (running.Count > 0)
            {
                Log.Line(string.Format("launcher is running ({0}), stopping before: {1}", string.Join(", ", running), before));
                throw run.Fail("Close the Minecraft Launcher (including the tray icon) and run this again");
            }
        }

        /// <summary>Reads with or without a byte-order mark.</summary>
        public static object ReadJson(string path) => Json.Parse(File.ReadAllText(path));

        /// <summary>
        /// No byte-order mark: Windows PowerShell's "Set-Content -Encoding UTF8" added one, and a launcher that does not
        /// expect it treats the file as broken and starts again from its defaults. Written next to the file and moved
        /// into place, so a half-written file is never what the launcher finds.
        /// </summary>
        public static void WriteJson(string path, object obj)
        {
            var tmp = path + ".deepslate-tmp";
            File.WriteAllText(tmp, Json.Write(obj, true), new UTF8Encoding(false));
            MoveOver(tmp, path);
        }

        /// <summary>Move-Item -Force: the file takes the place of the one there, in one step where Windows can. 3.5.1: also
        /// what options.txt is written with (docs/31 B-63), so a stop half-way never leaves the game without it.</summary>
        internal static void MoveOver(string from, string to)
        {
            if (!File.Exists(to)) { File.Move(from, to); return; }
            try { File.Replace(from, to, null, true); }
            catch (Exception)
            {
                if (!File.Exists(from)) throw;
                File.SetAttributes(to, FileAttributes.Normal);
                File.Delete(to);
                File.Move(from, to);
            }
        }

        public static void SetLauncherProfile(string path, string id, JObj entry)
        {
            var json = ReadJson(path) as JObj ?? new JObj();
            if (!(json["profiles"] is JObj profiles)) { profiles = new JObj(); json["profiles"] = profiles; }
            if (profiles.ContainsKey(id))
            {
                if (profiles[id] is JObj was && was.ContainsKey("created")) entry["created"] = was["created"];
                profiles.Remove(id);
            }
            profiles[id] = entry;
            json["selectedProfile"] = id;
            File.Copy(path, path + ".bak", true);
            WriteJson(path, json);
        }

        /// <summary>"" when the profile is there and points at the right version; otherwise what is wrong, in words.</summary>
        public static string TestLauncherProfile(string path, string id, string versionId)
        {
            if (!File.Exists(path)) return "launcher_profiles.json is gone";
            object json;
            try { json = ReadJson(path); } catch (Exception e) { return string.Format("launcher_profiles.json can't be read ({0})", e.Message); }
            var profiles = J.Obj(json, "profiles");
            if (profiles == null || !profiles.ContainsKey(id)) return string.Format("the profile '{0}' is not in launcher_profiles.json", id);
            var got = J.Str(profiles[id], "lastVersionId") ?? "";
            if (!Eq(got, versionId)) return string.Format("the profile '{0}' points at '{1}', not at '{2}'", id, got, versionId);
            return "";
        }

        /// <summary>3.5.0: the profile's javaArgs as launcher_profiles.json holds them now; null when it can't say.</summary>
        public static string ProfileJavaArgs(string path, string id)
        {
            try { return File.Exists(path) ? J.Str(J.Obj(J.Obj(ReadJson(path), "profiles"), id), "javaArgs") : null; } catch { return null; }
        }

        /// <summary>
        /// 3.5.1 (docs/31 B-62): what the profile step does. "write" (the launcher is closed, or the profile is missing or
        /// points elsewhere: the launcher has to be closed for it, as always); "leave" (the launcher is open and the profile
        /// is right); "leave, memory waits" (the same, but its memory is not the one this Play would give: the game still
        /// starts, and the window says the choice needs a Play with the launcher closed).
        /// </summary>
        public static string ProfileDecision(bool launcherOpen, string profileProblem, string currentArgs, string wantArgs)
        {
            if (!launcherOpen || profileProblem != "") return "write";
            return currentArgs == wantArgs ? "leave" : "leave, memory waits";
        }

        /// <summary>The -Xmx of a javaArgs line in whole GB ("-Xmx6G ..." gives 6); null when it has none in G.</summary>
        public static int? XmxOf(string javaArgs)
        {
            var m = Regex.Match(javaArgs ?? "", @"(?:^|\s)-Xmx(\d{1,3})[gG](?:\s|$)");
            return m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : (int?)null;
        }

        /// <summary>For the report: which launcher (classic, store), its version, the profile file's format.</summary>
        public static JObj GetLauncherFacts()
        {
            var f = J.O("kind", "unknown", "version", null, "profilesFormat", null);
            try
            {
                var j = ReadJson(Env.Profiles);
                if (J.Has(j, "version")) f["profilesFormat"] = J.Int(j, "version");
                if (J.Obj(j, "launcherVersion") is JObj lv && lv.ContainsKey("name")) f["version"] = J.Str(lv, "name");
            }
            catch { }
            foreach (var exe in LauncherExes())
            {
                try
                {
                    if (File.Exists(exe))
                    {
                        f["kind"] = "classic";
                        if (f["version"] == null) f["version"] = FileVersionInfo.GetVersionInfo(exe).ProductVersion;
                        return f;
                    }
                }
                catch { }
            }
            // Get-AppxPackage in 2.0.x; without PowerShell, the package's entry in the user's app repository.
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages"))
                {
                    var name = k?.GetSubKeyNames().FirstOrDefault(n => n.StartsWith(StoreLauncherPackage + "_", StringComparison.OrdinalIgnoreCase));
                    if (name != null)
                    {
                        f["kind"] = "store";
                        if (f["version"] == null) { var parts = name.Split('_'); if (parts.Length > 1) f["version"] = parts[1]; }
                    }
                }
            }
            catch { }
            return f;
        }

        /// <summary>The launcher's exe, then the Store launcher, then minecraft://. false: none of them would start.</summary>
        public static bool OpenLauncher()
        {
            Log.Line("launching");
            if (Env.StandIn) { Log.Line("test run: the Minecraft Launcher is not opened (the stand-in site)"); return true; }
            foreach (var exe in LauncherExes())
            {
                if (File.Exists(exe)) { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true }); return true; }
            }
            try { Process.Start(new ProcessStartInfo(@"shell:AppsFolder\" + StoreLauncherPackage + "_8wekyb3d8bbwe!Minecraft") { UseShellExecute = true }); return true; } catch { }   // Microsoft Store launcher
            try { Process.Start(new ProcessStartInfo("minecraft://") { UseShellExecute = true }); return true; } catch { }
            return false;
        }
    }
}

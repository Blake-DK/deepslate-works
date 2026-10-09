using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>What Home.RepairHere found and did (Repair-Home's answer).</summary>
    public class HomeResult
    {
        public string Exe;                 // the copy that the link and the shortcuts start
        public bool Linked;                // the deepslate:// handler reads back as pointing at Exe
        public bool Fixed;                 // the handler was put right on this call
        public List<JObj> Problems = new List<JObj>();   // {part: copy|link|shortcuts|apps|setup, code: in_zip|copy_denied|link_failed|shortcut_blocked|other, message}
        public List<KeyValuePair<string, string>> Said = new List<KeyValuePair<string, string>>();   // (tone ok|note|problem, text)
    }

    /// <summary>
    /// Where it lives, the Play link and the shortcuts (docs/07 "Setup"). One copy, %LOCALAPPDATA%\DeepslateWorks\
    /// DeepslateWorks.exe. Windows is told, for this user only (HKCU, no admin rights), to run it for deepslate:// links,
    /// and a "Deepslate Works" shortcut on the desktop and in the Start Menu runs it too. 3.0: the exe is started
    /// straight (it is a WinExe, so there is no console window to hide: no wscript shim, no conhost, no icon file).
    /// </summary>
    public static partial class Home
    {
        public const string ShortcutDescription = "Opens Deepslate Works: updates the game and starts the Minecraft Launcher on it";
        public const string UninstallShortcutDescription = "Removes Deepslate Works from this PC";
        public static string ShortcutName => Env.PackName + ".lnk";
        public static string UninstallShortcutName => "Uninstall " + Env.PackName + ".lnk";

        // The files a copy of 1.3.x / 1.4.x left in the same folder ($OldFiles in the script).
        static readonly string[] OldFiles = { "install.ps1", "install.ps1.bak", "install.ps1.new", "Setup.bat", "Setup.bat.new", "play.ps1", "Update and Play.bat" };
        // 3.0: what 2.0.x / 2.1.x left there: the script, its .bak from a self-update, the wscript shim and its icon.
        static readonly string[] Old2Files = { "DeepslateWorks.ps1", "DeepslateWorks.ps1.bak", "DeepslateWorks.vbs", "DeepslateWorks.ico" };

        /// <summary>Tests: how this module reads and writes the registry and the shortcuts. Null: the real ones on Windows,
        /// files under Root on a test run (-Root) or off Windows, so nothing outside Root is touched.</summary>
        public static IHomeIo Io { get; set; }
        /// <summary>Starts a process (tests swap it to see what would have been started). May return null.</summary>
        public static Func<ProcessStartInfo, Process> StartProcess = psi => Process.Start(psi);
        /// <summary>"3.0.0" from a file's ProductVersion ("3.0.0+abc" cut at the +); "" when it has none. Tests swap it.</summary>
        public static Func<string, string> ProductVersionOf = ReadProductVersion;

        public static IHomeIo DefaultIo()
        {
            if (Io != null) return Io;
            if (Env.CustomRoot || !Env.OnWindows) return new FileHomeIo(Path.Combine(Env.Root, "registry and shortcuts"));
            return new WindowsHomeIo(Env.LiveDataDir);
        }

        // ---- the stub's API ------------------------------------------------------------------------------------

        public static bool IsHomeCopy() => SamePath(Env.MePath, Env.HomeExe);

        public static bool InstallFromDownload(List<JObj> problems)
        {
            var me = Env.MePath;
            var dir = Env.AppHome;
            var io = DefaultIo();
            Log.Line("first start from a download: " + me);
            // Started from inside a zip (Explorer runs it from %TEMP%\Temp1_<zip>\ and throws that folder away later) or
            // straight from the browser's temporary folder: nothing is copied or registered from a folder Windows will
            // empty (1.5.6's refusal, for the exe).
            if (TestInsideZip(me, Env.Temp))
            {
                AddSetupProblem(problems, "setup", "in_zip", "DeepslateWorks.exe was started from inside the zip. Right-click the zip, choose Extract All, then open DeepslateWorks.exe from the new folder.");
                return false;
            }
            if (TestUnderTemp(me, Env.Temp))
            {
                AddSetupProblem(problems, "setup", "in_zip", "DeepslateWorks.exe was started from a temporary folder, which Windows empties. Save it first (to Downloads, say), then open it from there.");
                return false;
            }
            var copy = CopyHome(me, dir, io);
            if (!copy.Ok) { AddSetupProblem(problems, "copy", copy.Code, copy.Message); return false; }
            // Settings -> Apps is always made, so it can be removed; the Play link and the shortcuts wait for their
            // permission (2.0.0: the "Shortcuts and Play button" card), RepairHere at the end of the run.
            try { if (!io.Listed(copy.Exe)) { io.List(copy.Exe); Log.Line("listed in Settings -> Apps"); } }
            catch (Exception e) { AddSetupProblem(problems, "apps", "other", "Could not list it in Settings -> Apps: " + e.Message); }
            try
            {
                Native.GrantForeground();
                StartProcess(new ProcessStartInfo(copy.Exe, "-From download") { UseShellExecute = false, WorkingDirectory = dir });
                Log.Line("started the copy in " + dir + "; this one ends");
                return true;
            }
            catch (Exception e)
            {
                AddSetupProblem(problems, "copy", "other", string.Format("Could not start the copy in {0}: {1}", dir, e.Message));
                return false;
            }
        }

        public static HomeResult RepairHere(Run run, bool links) => RepairHere(run, links, false);

        /// <summary>force: the shortcuts and the Apps entry are made again (2.1.1: a new logo).</summary>
        public static HomeResult RepairHere(Run run, bool links, bool force)
        {
            if (run != null && run.DryRun)
            {
                Log.Line("(dry run) the Play link, the shortcuts and Settings -> Apps were not checked");
                return new HomeResult { Exe = Env.MePath };
            }
            var r = Repair(Env.MePath, Env.AppHome, DefaultIo(), force, !links);
            if (run != null) SetSetupState(run, r);
            return r;
        }

        // ---- setting up each part on its own (1.5.6, planner) ----------------------------------------------------
        // Setup on Rowan's PC (2026-09-30) said "Could not set up the Play button and the shortcuts (Access to the path
        // '...\DeepslateWorks\DeepslateWorks.ps1' is denied.)": the home copy failed, and because the copy, the link, the
        // shortcuts and the Apps entry were in one try, nothing after it was done either. Each part has its own try, its
        // own line, and a reason code in the report: in_zip, copy_denied, link_failed, shortcut_blocked, other.

        public static void AddSetupProblem(List<JObj> list, string part, string code, string message)
        {
            message = message ?? "";
            list.Add(J.O("part", part, "code", code, "message", message.Substring(0, Math.Min(500, message.Length))));
            Log.Line(string.Format("setup: {0} {1}: {2}", part, code, message));
        }

        /// <summary>Under %TEMP%: never the place the Play link or the shortcuts point at, it is emptied.</summary>
        public static bool TestUnderTemp(string path, string temp)
        {
            if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(temp)) return false;
            var t = temp.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
            return path.StartsWith(t, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Started from inside the zip: Explorer runs it from %TEMP%\Temp1_installer.zip\ and throws that folder away later.</summary>
        public static bool TestInsideZip(string path, string temp)
        {
            if (!TestUnderTemp(path, temp)) return false;
            string parent;
            try { parent = Path.GetDirectoryName(path) ?? ""; } catch { return false; }
            var t = temp.TrimEnd('\\', '/');
            if (parent.Length < t.Length) return false;
            var rel = parent.Substring(t.Length);
            return rel.Split('\\', '/').Any(s => s.EndsWith(".zip", StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Access denied, or the file in use: what antivirus scanning a new program looks like.</summary>
        public static bool TestDenied(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (e is UnauthorizedAccessException) return true;
                if (e is IOException && ((e.HResult & 0xFFFF) == 32 || (e.HResult & 0xFFFF) == 33)) return true;
                if (Regex.IsMatch(e.Message ?? "", "is denied|being used by another process", RegexOptions.IgnoreCase)) return true;
            }
            return false;
        }

        public class CopyResult { public bool Ok; public string Exe; public string Code; public string Message; }

        /// <summary>Puts this exe in place (never an older one over a newer one). Returns the path of the copy to run.</summary>
        public static string InstallHome(string me, string dir, IHomeIo io)
        {
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, Env.ExeName);
            if (!SamePath(me, target))
            {
                bool there = File.Exists(target);
                bool same = there && Sha256(me) == Sha256(target);
                if (!same && there)
                {
                    var ours = ProductVersionOf(me);
                    if (string.IsNullOrEmpty(ours)) ours = Env.Version;
                    if (Ver.IsNewer(ProductVersionOf(target), ours)) { same = true; Log.Line("the copy in " + dir + " is newer than this one; left as it is"); }
                }
                if (!same)
                {
                    io.Copy(me, target);
                    Log.Line("put " + Env.ExeName + " in " + dir);
                }
            }
            return target;
        }

        /// <summary>The home copy, tried again once after 2 s when it was refused.</summary>
        public static CopyResult CopyHome(string me, string dir, IHomeIo io)
        {
            for (int attempt = 1; ; attempt++)
            {
                try { return new CopyResult { Ok = true, Exe = InstallHome(me, dir, io) }; }
                catch (Exception e)
                {
                    var why = e.Message;
                    bool denied = TestDenied(e);
                    if (denied && attempt == 1)
                    {
                        Log.Line("copying the installer to " + dir + " was refused (" + why + "); trying again in 2 s");
                        io.Sleep(2);
                        continue;
                    }
                    if (denied)
                    {
                        string attrs = "";
                        try { var f = Path.Combine(dir, Env.ExeName); if (File.Exists(f)) attrs = File.GetAttributes(f).ToString(); } catch { }
                        Log.Line("refused again: " + why + (attrs != "" ? " (the file there: " + attrs + ")" : ""));
                        return new CopyResult
                        {
                            Code = "copy_denied",
                            Message = string.Format("Your antivirus or Windows stopped the installer copying itself to {0}. The game is installed and works from the Deepslate Works launcher profile; the Play button on the site won't work on this PC until this is fixed.", dir)
                        };
                    }
                    return new CopyResult { Code = "other", Message = string.Format("Could not copy the installer to {0}: {1}", dir, why) };
                }
            }
        }

        /// <summary>The real copy: next to it first, then moved over, so a copy cut off half-way never leaves half an exe
        /// where the Play link points.</summary>
        public static void CopyFile(string from, string to)
        {
            var tmp = to + ".copy";
            try
            {
                File.Copy(from, tmp, true);
                if (File.Exists(to)) File.Delete(to);
                File.Move(tmp, to);
            }
            catch { Log.RemoveTemp(tmp); throw; }
        }

        static void Say(HomeResult r, string tone, string text) => r.Said.Add(new KeyValuePair<string, string>(tone, text));

        /// <summary>
        /// The home folder, the Play link, the shortcuts and the Settings -> Apps entry, each on its own (Repair-Home):
        /// at the end of every run (RepairHere). force: the shortcuts are made again. noLinks: the person said Not now to
        /// "Shortcuts and Play button". What could not be done is in Problems (reason codes), the lines to show in Said,
        /// and Fixed when the link was not right before and is now.
        /// </summary>
        public static HomeResult Repair(string me, string dir, IHomeIo io, bool force = false, bool noLinks = false)
        {
            var r = new HomeResult();

            // 1. the copy in the home folder
            var copy = CopyHome(me, dir, io);
            var target = me;
            if (copy.Ok) { target = copy.Exe; Say(r, "ok", "Installed in " + dir); }
            else { AddSetupProblem(r.Problems, "copy", copy.Code, copy.Message); Say(r, "problem", copy.Message); }
            r.Exe = target;
            bool fromTemp = !copy.Ok && TestUnderTemp(me, io.Temp);

            // 2. the Play link: to the home copy, or to the exe where it ran, never to a temporary folder
            bool linked = false, wasLinked = false;
            if (noLinks) Say(r, "note", "No Play button link or shortcuts: you said Not now (Review permissions changes that)");
            else if (fromTemp)
            {
                var why = "Could not set up the Play button: the installer ran from a temporary folder and could not copy itself anywhere lasting";
                AddSetupProblem(r.Problems, "link", "link_failed", why); Say(r, "problem", why);
            }
            else
            {
                var want = HandlerCommand(target);
                try
                {
                    wasLinked = string.Equals(io.Handler(), want, StringComparison.OrdinalIgnoreCase);
                    if (!wasLinked) { if (io.SetHandler(target)) Log.Line("the Play link was set up again"); }
                    linked = string.Equals(io.Handler(), want, StringComparison.OrdinalIgnoreCase);
                    if (linked) Say(r, "ok", "The Play button on the site now starts Deepslate Works on this PC");
                    else { var why = "Could not set up the Play button: Windows did not keep it"; AddSetupProblem(r.Problems, "link", "link_failed", why); Say(r, "problem", why); }
                }
                catch (Exception e) { var why = "Could not set up the Play button: " + e.Message; AddSetupProblem(r.Problems, "link", "link_failed", why); Say(r, "problem", why); }
            }

            // 3. the shortcuts: not to a temporary folder either. "There" only when target AND arguments are what this
            // version makes (2.0.3), so a 2.0.x PC's wscript / powershell shortcuts are made again.
            if (!noLinks && !fromTemp)
            {
                try
                {
                    if (force || !io.ShortcutsThere(target))
                    {
                        var sc = io.MakeShortcuts(target);
                        var failed = sc.Failed;
                        if (failed.Count == 0) { Say(r, "ok", "Shortcuts made"); if (!force) Log.Line("the shortcuts were made again"); }
                        else if (failed.All(f => f.Key == "desktop") && io.ControlledFolderAccess())
                        {
                            var why = "Windows' ransomware protection blocked the desktop shortcut. The Start Menu entry and the Play button still work.";
                            AddSetupProblem(r.Problems, "shortcuts", "shortcut_blocked", why); Say(r, "note", why);
                        }
                        else
                        {
                            var why = "Could not make the shortcuts: " + failed[0].Value;
                            AddSetupProblem(r.Problems, "shortcuts", "other", why); Say(r, "problem", why);
                        }
                    }
                }
                catch (Exception e) { var why = "Could not make the shortcuts: " + e.Message; AddSetupProblem(r.Problems, "shortcuts", "other", why); Say(r, "problem", why); }
            }

            // 4. Settings -> Apps
            try { if (!io.Listed(target)) { io.List(target); Log.Line("listed in Settings -> Apps"); } }
            catch (Exception e) { AddSetupProblem(r.Problems, "apps", "other", "Could not list it in Settings -> Apps: " + e.Message); }

            // What 1.x and 2.x left goes once the Play link points at the exe in its home: until then the link may still
            // name the .ps1 / .vbs, and removing them would leave the Play button starting nothing.
            if (linked && copy.Ok) RemoveOldLayout(dir); else Log.Line("the old files are kept: the Play link does not point at the installed copy");
            r.Linked = linked;
            r.Fixed = linked && !wasLinked;
            if (r.Fixed && !force) Log.Line("Play button set up on this run");
            return r;
        }

        /// <summary>The setup problems a run reports: the ones found now, replacing what an earlier step found.</summary>
        public static void SetSetupState(Run run, HomeResult r)
        {
            run.SetupChecked = true;
            run.SetupProblems.Clear();
            foreach (var p in r.Problems) run.SetupProblems.Add(p);
        }

        /// <summary>What 1.3.x/1.4.x and 2.x left in the home folder (Remove-OldLayout, plus 3.0's 2.x clean-up: the
        /// script, its .bak and any *.ps1.new, the shim, the icon). The names removed.</summary>
        public static List<string> RemoveOldLayout(string dir)
        {
            var removed = new List<string>();
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return removed;
            var names = new List<string>(OldFiles);
            names.AddRange(Old2Files);
            try
            {
                foreach (var f in Directory.GetFiles(dir))
                {
                    var n = Path.GetFileName(f);
                    if (n.EndsWith(".ps1.new", StringComparison.OrdinalIgnoreCase) && !names.Contains(n, StringComparer.OrdinalIgnoreCase)) names.Add(n);
                }
            }
            catch (Exception e) { Log.Line("could not look through " + dir + ": " + e.Message); }
            foreach (var old in names)
            {
                var p = Path.Combine(dir, old);
                if (!File.Exists(p)) continue;
                string was = old.Equals("DeepslateWorks.ps1", StringComparison.OrdinalIgnoreCase) ? ScriptVersion(p) : "";
                try { File.SetAttributes(p, FileAttributes.Normal); } catch { }
                Log.RemoveTemp(p);
                if (File.Exists(p)) continue;
                removed.Add(old);
                Log.Line("removed the old " + old + (was != "" ? " (" + was + ")" : ""));
            }
            return removed;
        }

        /// <summary>The $InstallerVersion written in a 2.x script (Get-ScriptVersion); "" when there is none.</summary>
        public static string ScriptVersion(string path)
        {
            try
            {
                var m = Regex.Match(File.ReadAllText(path), "(?m)^\\$InstallerVersion = \"([0-9.]+)\"");
                if (m.Success) return m.Groups[1].Value;
            }
            catch { }
            return "";
        }

        // ---- what the link, the shortcuts and Settings -> Apps start --------------------------------------------

        public class Shortcut
        {
            public string Target, Arguments, WorkingDirectory, Description, IconPath, AppUserModelId;
            public int IconIndex;
            /// <summary>"target" arguments: what the file-based io writes in place of a .lnk.</summary>
            public string Line => "\"" + Target + "\" " + Arguments;
        }

        public class ShortcutsMade
        {
            public int Made;
            public List<KeyValuePair<string, string>> Failed = new List<KeyValuePair<string, string>>();   // (desktop|menu|uninstall, message)
        }

        /// <summary>What deepslate:// runs: "&lt;exe&gt;" "%1".</summary>
        public static string HandlerCommand(string exe) => "\"" + exe + "\" \"%1\"";
        /// <summary>2.1.1: the chosen logo (logo.ico next to the exe) wins over the exe's own icon.</summary>
        public static string IconLocation(string exe) => "\"" + Brand.IconFile(exe) + "\",0";

        public static Shortcut ShortcutSpec(string exe, string where = "desktop") => new Shortcut
        {
            Target = exe,
            Arguments = "-From " + where,
            WorkingDirectory = ParentOf(exe),
            Description = ShortcutDescription,
            IconPath = Brand.IconFile(exe),   // 2.1.1: the chosen logo when there is one
            IconIndex = 0,
            AppUserModelId = Env.AppUserModelId,   // a pinned shortcut and the window share one taskbar button
        };

        public static Shortcut UninstallShortcutSpec(string exe)
        {
            var s = ShortcutSpec(exe, "startmenu");
            s.Arguments = "-Uninstall -From startmenu";
            s.Description = UninstallShortcutDescription;
            return s;
        }

        /// <summary>What Settings -> Apps shows, and what its Uninstall button runs. Ints are DWORDs.</summary>
        public static JObj UninstallEntry(string exe, string gameDir, int sizeKb) => J.O(
            "DisplayName", Env.PackName,
            "DisplayVersion", Env.Version,
            "Publisher", "Deepslate Works",
            "DisplayIcon", IconLocation(exe),
            "UninstallString", "\"" + exe + "\" -Uninstall -From apps",
            "InstallLocation", gameDir,
            "EstimatedSize", sizeKb,
            "NoModify", 1,
            "NoRepair", 1);

        public static int FolderSizeKb(string path)
        {
            if (string.IsNullOrEmpty(path) || !Directory.Exists(path)) return 0;
            long sum = 0;
            SumFiles(path, ref sum);
            return (int)Math.Min(int.MaxValue, (long)Math.Ceiling(sum / 1024.0));
        }
        static void SumFiles(string dir, ref long sum)
        {
            try
            {
                foreach (var f in Directory.GetFiles(dir)) { try { sum += new FileInfo(f).Length; } catch { } }
                foreach (var d in Directory.GetDirectories(dir)) SumFiles(d, ref sum);
            }
            catch { }
        }

        // ---- the Minecraft Launcher open? (Find-Launcher, for the uninstall) ---------------------------------------
        // The launcher writes launcher_profiles.json when it closes; open, it would put the Deepslate Works profile back.

        public static List<string> FindLauncher(string[] pretendRunning = null)
        {
            var found = new List<string>();
            foreach (var n in pretendRunning ?? new string[0]) if (!string.IsNullOrEmpty(n)) found.Add(n);
            Process[] all;
            try { all = Process.GetProcesses(); } catch { all = new Process[0]; }
            foreach (var p in all)
            {
                try
                {
                    string n = "";
                    try { n = p.ProcessName ?? ""; } catch { continue; }
                    if (n == "MinecraftLauncher" || n == "Minecraft Launcher") { found.Add(n); continue; }
                    if (n == "Minecraft")
                    {
                        // The Store / Xbox launcher runs as Minecraft.exe. (Bedrock is Minecraft.Windows; the game itself is javaw.)
                        string path = "";
                        try { path = p.MainModule?.FileName ?? ""; } catch { }
                        if (path == "" || path.IndexOf("Launcher", StringComparison.OrdinalIgnoreCase) >= 0) found.Add(n);
                        continue;
                    }
                    string title = "";
                    try { title = p.MainWindowTitle ?? ""; } catch { }
                    if (title == "Minecraft Launcher") found.Add(n);
                }
                finally { try { p.Dispose(); } catch { } }
            }
            return found.Distinct().ToList();
        }

        // ---- small helpers -------------------------------------------------------------------------------------

        public static bool SamePath(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            try { return string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase); }
            catch { return string.Equals(a, b, StringComparison.OrdinalIgnoreCase); }
        }

        static string ParentOf(string path)
        {
            try { return Path.GetDirectoryName(path) ?? ""; } catch { return Regex.Replace(path ?? "", @"[\\/][^\\/]*$", ""); }
        }

        public static string Sha256(string file)
        {
            using (var sha = SHA256.Create())
            using (var s = File.OpenRead(file))
                return BitConverter.ToString(sha.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
        }

        static string ReadProductVersion(string file)
        {
            try
            {
                var v = FileVersionInfo.GetVersionInfo(file).ProductVersion ?? "";
                int cut = v.IndexOfAny(new[] { '+', ' ' });
                return (cut > 0 ? v.Substring(0, cut) : v).Trim();
            }
            catch { return ""; }
        }

        /// <summary>One command line from separate arguments, quoted the way the C runtime and .NET split them again.</summary>
        public static string QuoteArgs(IEnumerable<string> args) => string.Join(" ", args.Select(QuoteArg));
        public static string QuoteArg(string a)
        {
            a = a ?? "";
            if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
            var sb = new StringBuilder("\"");
            int slashes = 0;
            foreach (var c in a)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { sb.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
                sb.Append('\\', slashes).Append(c); slashes = 0;
            }
            sb.Append('\\', slashes * 2).Append('"');
            return sb.ToString();
        }
    }
}

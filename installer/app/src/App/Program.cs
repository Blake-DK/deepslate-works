using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Management;
using System.Text.RegularExpressions;
using System.Threading;

namespace DeepslateWorks
{
    public static class Program
    {
        static readonly string[] EntryPoints = { "desktop", "startmenu", "apps", "download", "update", "window", "fallback" };

        /// <summary>Which entry point started this run, for the log (2.0.3, planner).</summary>
        public static string EntryPoint(Args a)
        {
            if (a.Link != "") return "play-link";
            var f = (a.From ?? "").ToLowerInvariant();
            if (EntryPoints.Contains(f)) return f;
            return Home.IsHomeCopy() ? "unknown (a shortcut made by hand, or started from the folder)" : "a download";
        }

        [STAThread]
        public static int Main(string[] argv)
        {
            Args a;
            try { a = Args.Parse(argv); } catch { return 2; }
            if (a.Link != "" && !Args.IsPlayLink(a.Link)) { Log.Line("started by a link it does not know; nothing done: " + Shorten(a.Link)); return 1; }

            if (a.Root != "") { Env.Root = a.Root; Env.CustomRoot = true; }
            if (a.WaitFor > 0) WaitForExit(a.WaitFor);

            var run = new Run
            {
                DryRun = a.DryRun, AllowAll = a.AllowAll || a.Console, NoLaunch = a.NoLaunch, PretendRunning = a.PretendRunning,
                RestartArgs = a.ForRestart(), EntryPoint = EntryPoint(a),
            };
            Run.Current = run;
            // Set when an older copy fetched this one and started it in its place (SelfUpdate), or when the 2.x bridge
            // handed over (-MigratedFrom): through the environment or a switch, which a link cannot reach (it resets them).
            var up = Environment.GetEnvironmentVariable("DEEPSLATE_UPDATED_FROM");
            if (Ver.Valid(up)) run.UpdatedFrom = up;
            Environment.SetEnvironmentVariable("DEEPSLATE_UPDATED_FROM", null);
            if (Ver.Valid(a.MigratedFrom)) { run.UpdatedFrom = a.MigratedFrom; run.MigratedFrom = a.MigratedFrom; run.HandOver = true; }
            // 3.1.0: a move from the old launcher that has not finished (handover.json): the guided setup opens again,
            // whichever way this was started (planner A4)
            try { if (!run.HandOver && !a.Uninstall && !Env.CustomRoot && HandOverState.Pending(Env.AppHome)) { run.HandOver = true; run.MigratedFrom = HandOverState.Read(Env.AppHome)?.From; } } catch { }

            LogStart(a, run);
            try { SelfUpdate.CleanOld(); } catch (Exception e) { Log.Line("could not remove the old exe: " + e.Message); }
            try { Extras.Wire(); } catch (Exception e) { Log.Line("extras: " + e.Message); }

            try
            {
                if (a.Uninstall) return Uninstaller.Run(a.Yes);
                if (a.VerifyExtras) { Native.UseParentConsole(); return Extras.VerifyCommand(); }
                if (a.Screenshots != "") return AppWindow.Screenshots(a.Screenshots);
                if (a.Console) return ConsoleRun.Go(run);
                // The first start from a download: into %LOCALAPPDATA%\DeepslateWorks, then that copy carries on as the app.
                if (Env.OnWindows && !Env.CustomRoot && !a.DryRun && !Home.IsHomeCopy())
                {
                    var problems = new List<JObj>();
                    if (Home.InstallFromDownload(problems)) return 0;
                    foreach (var p in problems) { run.SetupProblems.Add(p); Log.Line("first start: " + J.Str(p, "part") + " " + J.Str(p, "code") + ": " + J.Str(p, "message")); }
                    run.SetupChecked = problems.Count > 0;
                    var inZip = problems.FirstOrDefault(p => J.Str(p, "code") == "in_zip");
                    if (inZip != null) { Native.Box(J.Str(inZip, "message"), warn: true); return 2; }
                }
                return AppWindow.Run(run, a);
            }
            catch (Exception e)
            {
                // Never a silent nothing (2.0.3): the error, and where the log is.
                Log.Line("the window could not open: " + e);
                Native.Box(string.Format("Deepslate Works could not open its window:\r\n{0}\r\n\r\nThe log is here:\r\n{1}\r\n\r\nSend it to Alex, or press Play again.", e.Message, Env.LogFile), warn: true);
                return 1;
            }
        }

        static string Shorten(string s) => s.Length > 120 ? s.Substring(0, 120) + "..." : s;

        /// <summary>-WaitFor: the copy this one replaces (an update, the 2.x window) closes first, so its window is gone
        /// and this one is the only one. At most 30 s.</summary>
        static void WaitForExit(int pid)
        {
            try
            {
                var p = Process.GetProcessById(pid);
                if (!p.WaitForExit(30000)) Log.Line("the copy this one replaces (process " + pid + ") is still running after 30 s; carrying on");
            }
            catch (ArgumentException) { }   // already gone
            catch (Exception e) { Log.Line("could not wait for process " + pid + ": " + e.Message); }
        }

        static void LogStart(Args a, Run run)
        {
            string parent = "?", ppid = "?";
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT ParentProcessId FROM Win32_Process WHERE ProcessId=" + Process.GetCurrentProcess().Id))
                    foreach (ManagementBaseObject o in q.Get())
                    {
                        ppid = Convert.ToString(o["ParentProcessId"]);
                        try { parent = Process.GetProcessById(Convert.ToInt32(o["ParentProcessId"])).ProcessName + ".exe"; } catch { }
                    }
            }
            catch { }
            var what = a.Uninstall ? ", uninstall" : a.VerifyExtras ? ", verify extras" : a.Screenshots != "" ? ", screenshots" : a.Console ? ", console" : "";
            Log.Line(string.Format("started: {0} {1}, process {2}, from {3}, by {4} ({5}){6}{7}", Env.PackName, Env.Version, Process.GetCurrentProcess().Id, run.EntryPoint, parent, ppid, what,
                run.UpdatedFrom != null ? ", updated from " + run.UpdatedFrom : ""));
            if (a.Unknown.Count > 0) Log.Line("ignored on the command line: " + string.Join(" ", a.Unknown.Select(Shorten)));
        }
    }

    /// <summary>-Console: the install steps in a console window, every permission taken as given (tests; a PC where the
    /// window will not open). A WinExe has no console of its own: the one it was started from, or a new one.</summary>
    public static class ConsoleRun
    {
        public static int Go(Run run)
        {
            if (!Native.UseParentConsole()) Native.AllocConsole();
            run.Sink = l =>
            {
                var t = J.Str(l, "t"); var text = J.Str(l, "text");
                if (text == null) return;
                if (t == "step") System.Console.WriteLine("\n" + text + " ...");
                else if (t == "tick") System.Console.WriteLine("   [OK] " + text);
                else if (t == "fail") System.Console.WriteLine("\n   " + text + "\n   Details are in " + Env.LogFile);
                else System.Console.WriteLine("   " + text);
            };
            System.Console.WriteLine(Env.PackName + " " + Env.Version);
            try { Engine.Execute(run); return 0; }
            catch (AlreadyRunning) { System.Console.WriteLine("Deepslate Works is already running in another window. Let it finish, then press Play again."); return Env.ExitAlreadyRunning; }
            catch (RunFailed) { return 1; }
            catch (Exception e) { System.Console.WriteLine(e.Message); return 1; }
        }
    }
}

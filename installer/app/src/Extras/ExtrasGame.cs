using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Management;
using System.Text.RegularExpressions;
using System.Threading;

namespace DeepslateWorks
{
    /// <summary>The game's processes as the restart flow sees them: real on Windows (GameControl), made up in tests.</summary>
    public interface IGameControl
    {
        /// <summary>The ids of the Deepslate game's java processes (Find-GameProcess over Get-JavaProcesses).</summary>
        List<int> Find();
        /// <summary>Send-GameClose: WM_CLOSE to each (its own X button).</summary>
        void Close(IList<int> ids);
        /// <summary>Test-GameGone: none of them is running any more.</summary>
        bool Gone(IList<int> ids);
        /// <summary>Stop-GameForce: ended.</summary>
        void Force(IList<int> ids);
    }

    /// <summary>The real game: java(w).exe whose command line names the game folder (Env.DataDir).</summary>
    public sealed class GameControl : IGameControl
    {
        public string GameDir;
        public GameControl(string gameDir = null) { GameDir = gameDir; }
        public List<int> Find() => Extras.FindGame(GameDir ?? Env.LiveDataDir, Extras.JavaProcesses()).Select(p => p.Id).ToList();
        public void Close(IList<int> ids) => Extras.SendGameClose(ids);
        public bool Gone(IList<int> ids) => Extras.GameGone(ids);
        public void Force(IList<int> ids) => Extras.StopGameForce(ids);
    }

    public static partial class Extras
    {
        // ---- the game: running? closing it nicely, and starting it again -------------------------------------------

        /// <summary>Find-GameProcess: the java(w) processes whose command line names the game folder (not another
        /// Minecraft, not a browser).</summary>
        public static List<GameProcess> FindGame(string gameDir, IEnumerable<GameProcess> procs)
        {
            var needle = (gameDir ?? "").TrimEnd('\\', '/').ToLowerInvariant();
            return (procs ?? new GameProcess[0]).Where(p => Regex.IsMatch(p.Name ?? "", @"^javaw?(\.exe)?$", RegexOptions.IgnoreCase)
                                                        && (p.CommandLine ?? "").ToLowerInvariant().Contains(needle)).ToList();
        }

        /// <summary>Get-JavaProcesses: java.exe and javaw.exe with their command lines (Win32_Process); none when WMI fails.</summary>
        public static List<GameProcess> JavaProcesses()
        {
            var r = new List<GameProcess>();
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT ProcessId, Name, CommandLine FROM Win32_Process WHERE Name='javaw.exe' OR Name='java.exe'"))
                using (var all = q.Get())
                    foreach (ManagementBaseObject p in all)
                        using (p)
                            r.Add(new GameProcess { Id = Convert.ToInt32(p["ProcessId"], CultureInfo.InvariantCulture), Name = Convert.ToString(p["Name"]) ?? "", CommandLine = Convert.ToString(p["CommandLine"]) ?? "" });
            }
            catch { return new List<GameProcess>(); }
            return r;
        }

        /// <summary>Is the Deepslate game running now (the window looks every 2 s)?</summary>
        public static bool GameRunning() => FindGame(Env.LiveDataDir, JavaProcesses()).Count > 0;

        static Process Alive(int id)
        {
            try { var p = Process.GetProcessById(id); if (p.HasExited) { p.Dispose(); return null; } return p; } catch { return null; }
        }

        /// <summary>Send-GameClose: WM_CLOSE to the game's window, the way its X button closes it (Minecraft saves what it
        /// has to).</summary>
        public static void SendGameClose(IEnumerable<int> ids)
        {
            foreach (var id in ids ?? new int[0])
            {
                var p = Alive(id);
                if (p == null) { XLog(string.Format("restart: the game (process {0}) is already gone", id)); continue; }
                using (p)
                {
                    bool ok;
                    try { ok = p.CloseMainWindow(); } catch { XLog(string.Format("restart: the game (process {0}) is already gone", id)); continue; }
                    XLog(string.Format("restart: WM_CLOSE sent to the game (process {0}){1}", id, ok ? "" : ", it has no window to close"));
                }
            }
        }

        /// <summary>Test-GameGone: none of these processes is running.</summary>
        public static bool GameGone(IEnumerable<int> ids)
        {
            foreach (var id in ids ?? new int[0]) { var p = Alive(id); if (p != null) { p.Dispose(); return false; } }
            return true;
        }

        /// <summary>Stop-GameForce: ends what did not close within 30 s.</summary>
        public static void StopGameForce(IEnumerable<int> ids)
        {
            foreach (var id in ids ?? new int[0])
            {
                var p = Alive(id);
                if (p == null) continue;
                using (p)
                {
                    try { p.Kill(); XLog(string.Format("restart: the game (process {0}) did not close within 30 s: ended", id)); } catch { }
                }
            }
        }

        /// <summary>Stop-Game: blocking (for -VerifyExtras and tests): WM_CLOSE, up to waitSec, then force. "closed" | "forced".</summary>
        public static string StopGame(IList<int> ids, int waitSec = 30, IGameControl game = null, Action<int> sleep = null)
        {
            game = game ?? new GameControl();
            sleep = sleep ?? (ms => Thread.Sleep(ms));
            game.Close(ids);
            var t0 = DateTime.Now;
            while ((DateTime.Now - t0).TotalSeconds < waitSec)
            {
                if (game.Gone(ids)) { XLog(string.Format(CultureInfo.InvariantCulture, "restart: the game closed after {0:0} s", (DateTime.Now - t0).TotalSeconds)); return "closed"; }
                sleep(500);
            }
            game.Force(ids);
            return "forced";
        }

        // ---- a weak PC -------------------------------------------------------------------------------------------

        /// <summary>Test-WeakPc: a weak PC, the way the site measures one (lib/install-report.ts suggestTier: LOW): under 8 GB
        /// of memory, or no graphics card of its own. Only a warning next to the heavier extras; nothing is blocked.</summary>
        public static bool IsWeakPc(double? ramGb, IEnumerable<string> gpuNames)
        {
            const RegexOptions I = RegexOptions.IgnoreCase;
            var real = (gpuNames ?? new string[0]).Where(g => !string.IsNullOrEmpty(g) && !Regex.IsMatch(g, "microsoft basic|parsec|virtual|remote|hyper-v|citrix|displaylink", I)).ToList();
            if (ramGb != null && ramGb.Value < 7.5) return true;
            if (real.Count == 0) return true;   // memory known, no graphics card seen: built-in graphics
            const string strong = @"rtx\s*\d{4}|gtx\s*(10[678]0|1660|9[78]0)|rx\s*(5[5-9]00|[6-9]\d00)|arc\s*\(?(tm)?\)?\s*[ab]\d{3}";
            const string dedicated = @"geforce|rtx|gtx|quadro|radeon\s+(rx|pro|hd)|\brx\s*\d{3,4}|arc\s*\(?(tm)?\)?\s*[ab]\d{3}";
            const string integrated = @"intel\b.*\b(u?hd|iris|graphics)\b|radeon(\(tm\))?\s+(r[2-7]\s)?graphics|vega\s*\d|microsoft basic";
            var card = real.Where(g => Regex.IsMatch(g, dedicated, I) && (!Regex.IsMatch(g, integrated, I) || Regex.IsMatch(g, strong, I))).ToList();
            return card.Count == 0;
        }

        /// <summary>Get-LocalWeakPc: IsWeakPc for this PC (WMI); false when nothing could be measured.</summary>
        public static bool LocalWeakPc()
        {
            double? ram = null; var gpus = new List<string>();
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem"))
                    foreach (ManagementBaseObject c in q.Get()) { ram = Math.Round(Convert.ToDouble(c["TotalPhysicalMemory"], CultureInfo.InvariantCulture) / (1024.0 * 1024 * 1024), 1); break; }
            }
            catch { }
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT Name FROM Win32_VideoController"))
                    foreach (ManagementBaseObject g in q.Get()) gpus.Add(Convert.ToString(g["Name"]) ?? "");
            }
            catch { }
            if (ram == null && gpus.Count == 0) return false;
            return IsWeakPc(ram, gpus);
        }
    }

    /// <summary>
    /// Yes with the game running (Start-Flow / Step-Flow): close it, install, check, start it again. One stage per call of
    /// Step (the window calls it on its timer), so the window never freezes while the game takes its time to close.
    /// Stages: closing -> installing -> checking -> starting (only when relaunching) -> done -> (Finished).
    /// </summary>
    public sealed class RestartFlow
    {
        public string Stage { get; private set; } = "closing";
        /// <summary>The flow is over: the window enables Apply again and redraws the tab (Show-Extras).</summary>
        public bool Finished { get; private set; }
        public List<int> Ids { get; private set; }
        public ExtrasState State { get; private set; }
        public ExtrasChoice Pick { get; private set; }
        public bool Relaunch { get; private set; }
        public ApplyResult Result { get; private set; }
        public List<ExtrasCheck> Checks { get; private set; }
        /// <summary>The tab's status line after the install (Get-AfterRestartInstall's say); null until then.</summary>
        public string Say { get; private set; }
        /// <summary>Progress lines so far: "Closing the game...", "Installing...", "Checking...", "Starting the game...".</summary>
        public readonly List<string> Progress = new List<string>();

        readonly IGameControl game;
        readonly ExtrasManifest manifest;
        readonly ExtrasPaths paths;
        readonly string statePath;
        readonly Func<DateTime> now;
        readonly DateTime t0;

        RestartFlow(ExtrasManifest m, ExtrasPaths p, string statePath, ExtrasState st, ExtrasChoice pick, bool relaunch, IGameControl game, Func<DateTime> now)
        {
            manifest = m; paths = p; this.statePath = statePath; State = st; Pick = pick; Relaunch = relaunch;
            this.game = game ?? new GameControl(); this.now = now ?? (() => DateTime.Now);
            t0 = this.now();
        }

        /// <summary>Start-Flow: finds the game, logs it, says "Closing the game..." and sends it WM_CLOSE. st.Queued is
        /// cleared (the pick is what installs). paths/statePath default to the game folder and extras.json.</summary>
        public static RestartFlow Start(ExtrasManifest m, ExtrasState st, ExtrasChoice pick, bool relaunch, IGameControl game = null,
                                        ExtrasPaths paths = null, string statePath = null, Func<DateTime> now = null)
        {
            st.Queued = null;
            var f = new RestartFlow(m, paths ?? Extras.GetPaths(Env.LiveDataDir), statePath ?? Env.ExtrasStatePath, st, pick, relaunch, game, now);
            f.Ids = f.game.Find();
            Extras.XLog(string.Format("restart: game {0}", f.Ids.Count > 0 ? "found (process " + string.Join(", ", f.Ids) + ")" : "not found: nothing to close"));
            f.Progress.Add("Closing the game...");
            if (f.Ids.Count > 0) f.game.Close(f.Ids);
            return f;
        }

        /// <summary>Step-Flow: one stage. Returns the progress line to show now, or null. openLauncher: Open-Launcher (true
        /// when the Minecraft Launcher was started).</summary>
        public string Step(Func<bool> openLauncher)
        {
            switch (Stage)
            {
                case "closing":
                    if (game.Gone(Ids))
                    {
                        Extras.XLog(string.Format(CultureInfo.InvariantCulture, "restart: the game closed after {0:0} s", (now() - t0).TotalSeconds));
                        return Next("installing", "Installing...");
                    }
                    if ((now() - t0).TotalSeconds >= 30) { game.Force(Ids); return Next("installing", "Installing..."); }
                    return null;
                case "installing":
                    {
                        var prevC = State.Choices; var prevS = State.Shader;
                        State.Choices = Pick.Choices; State.Shader = Pick.Shader;
                        Result = Extras.Apply(paths, manifest, State);
                        if (!Result.Ok) { State.Choices = prevC; State.Shader = prevS; }
                        State.Save(statePath);
                        Extras.XLog("restart: install done: " + (Result.Ok ? "OK" : "failed, the previous set is back"), !Result.Ok);
                        return Next("checking", "Checking...");
                    }
                case "checking":
                    {
                        Checks = Extras.Verify(paths, manifest, State);
                        var bad = Checks.Count(c => c.Ok == false);
                        Extras.XLog(string.Format("check after install: {0} check(s), {1} failed", Checks.Count, bad), bad > 0);
                        var after = Extras.AfterRestartInstall(Result);
                        Say = after.Say;
                        if (Relaunch) return Next("starting", "Starting the game...");
                        Stage = "done"; return null;
                    }
                case "starting":
                    {
                        var ok = false;
                        try { ok = openLauncher != null && openLauncher(); } catch { }
                        Extras.XLog("restart: relaunch " + (ok ? "started (the Minecraft Launcher on Deepslate Works)" : "failed: the Minecraft Launcher was not found"), !ok);
                        Stage = "done"; return null;
                    }
                case "done":
                    Finished = true; Stage = "finished"; return null;
                default:
                    return null;
            }
        }

        string Next(string stage, string line) { Stage = stage; Progress.Add(line); return line; }
    }
}

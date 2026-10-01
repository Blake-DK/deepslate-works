using System;
using System.Collections.Generic;

namespace DeepslateWorks
{
    /// <summary>Fail(): the run stopped with a message the person reads. Already logged, shown and reported.</summary>
    public sealed class RunFailed : Exception { public RunFailed(string m) : base(m) { } }
    /// <summary>A step needs an answer the window has to ask for (2.0.x: engine exit 20). The run starts again after.</summary>
    public sealed class NeedAnswer : Exception { public string StepId { get; } public int Level { get; } public NeedAnswer(string id, int level) : base("needs an answer: " + id) { StepId = id; Level = level; } }
    /// <summary>A step needed to play was answered Not now (2.0.x: engine exit 21).</summary>
    public sealed class StepDeclined : Exception { public string StepId { get; } public StepDeclined(string id) : base("declined: " + id) { StepId = id; } }
    /// <summary>Another copy holds the lock (2.0.x: exit 3).</summary>
    public sealed class AlreadyRunning : Exception { public AlreadyRunning() : base("already running") { } }

    /// <summary>
    /// One run of the install steps (the 2.0.x "engine"): what it is, how far it got, and the lines the window shows.
    /// The status lines are the same shapes 2.0.x wrote to its status file: {t:"step"|"tick"|"note"|"fail"|"ask"|
    /// "declined"|"used"|"changed"|"extras"|"done", ...}.
    /// </summary>
    public class Run
    {
        public static Run Current { get; set; }

        /// <summary>first_install | update | play | already_running | uninstall (docs/07).</summary>
        public string Mode = "play";
        public bool Quiet = true;
        public int StepNo;
        public string StepName = "";              // the step in hand: what a report calls "the step that failed"
        public DateTime Started = DateTime.Now;
        public string Token { get => Http.Token; set => Http.Token = value; }
        public bool Reported;
        public string PackSeen = "dev";
        public string UpdatedFrom;                  // set when an older copy fetched this one and started it
        public string UpdateProblem;                // why an update that was due was not applied
        public string MigratedFrom;                 // 3.0: the 2.0.x version this PC came from, on the first run after
        public readonly List<JObj> SetupProblems = new List<JObj>();
        public bool SetupChecked;
        public readonly JObj Facts = J.O("java", null, "neoforge", null, "launcher", null);
        public bool ReportsOff;
        public bool DryRun;
        public bool AllowAll;                       // tests and --console: every permission taken as given
        public bool NoLaunch;                       // the Extras tab's download: do not open the launcher at the end
        public ModsCheck ModsCheck;                 // 2.1.0: the last check of mods\ in this run (the report's `mods`)
        public string PackCheckDir;                 // 2.1.0: mods\ and the PC set, for the report of a run that stops part-way
        public List<object> PackCheckFiles;
        public string[] PretendRunning = new string[0];   // tests: process names to treat as running
        /// <summary>What this process was started with that a restart after a self-update passes on (never a link's
        /// extra words: a link run passes only the link).</summary>
        public string[] RestartArgs = new string[0];
        /// <summary>The entry point that started this process (Program: desktop, startmenu, apps, play-link, download, update...).</summary>
        public string EntryPoint = "";
        public Dictionary<string, ConsentAnswer> Consent = new Dictionary<string, ConsentAnswer>();
        /// <summary>What a run used, per consent step: the level it really did (planner: "bigger than before").</summary>
        public readonly Dictionary<string, int> Used = new Dictionary<string, int>();
        /// <summary>Where the status lines go: the window (on its own thread) or the console.</summary>
        public Action<JObj> Sink;

        public void Emit(JObj o) { try { Sink?.Invoke(o); } catch { } }

        public void Step(string msg)
        {
            StepNo++; StepName = msg ?? "";
            Log.Line("STEP " + msg);
            Emit(J.O("t", "step", "text", msg));
        }
        public void Tick(string msg) { Log.Line("OK " + msg); Emit(J.O("t", "tick", "text", msg)); }
        public void Note(string msg) { Log.Line(msg); Emit(J.O("t", "note", "text", msg)); }

        /// <summary>Usage: throw run.Fail("..."). Logs, shows, sends the report "failed".</summary>
        public RunFailed Fail(string msg)
        {
            Log.Line("FAIL " + msg);
            Emit(J.O("t", "fail", "text", msg));
            Report.Send(this, "failed");
            return new RunFailed(msg);
        }

        /// <summary>
        /// true: go ahead. false: an optional step that was declined. A step that needs asking, or a needed step that was
        /// declined, ends the run here (NeedAnswer / StepDeclined): the window asks (or says why it stopped) and starts
        /// it again (Request-Consent).
        /// </summary>
        public bool RequestConsent(string id, int level = 1)
        {
            if (AllowAll) return true;
            var d = Consents.Decision(Consent, id, level);
            var s = Consents.Step(id);
            if (d == "allow") return true;
            if (d == "decline" && !s.Required) { Log.Line(string.Format("permission: '{0}' declined, skipped", s.Title)); return false; }
            if (d == "ask")
            {
                Log.Line(string.Format("permission: '{0}' needs an answer (level {1})", s.Title, level));
                Emit(J.O("t", "ask", "step", id, "level", level));
                Reported = true;
                throw new NeedAnswer(id, level);
            }
            Log.Line(string.Format("permission: '{0}' is needed to play and was declined: stopped", s.Title));
            Emit(J.O("t", "declined", "step", id));
            Reported = true;
            throw new StepDeclined(id);
        }

        public void MarkUsed(string id, int level) { Used[id] = level; Emit(J.O("t", "used", "step", id, "level", level)); }
    }

    /// <summary>Installer versions: "3.0.0". Anything that is not 1-4 dotted numbers is never newer.</summary>
    public static class Ver
    {
        static readonly System.Text.RegularExpressions.Regex Shape = new System.Text.RegularExpressions.Regex(@"^\d{1,4}(\.\d{1,4}){1,3}$");
        public static bool Valid(string v) => !string.IsNullOrEmpty(v) && Shape.IsMatch(v);
        public static bool IsNewer(string theirs, string ours)
        {
            if (!Valid(theirs) || !Valid(ours)) return false;
            try { return new Version(theirs) > new Version(ours); } catch { return false; }
        }
    }
}

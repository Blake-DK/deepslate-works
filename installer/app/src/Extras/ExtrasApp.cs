using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>Everything the Extras tab shows, worked out in one go (Show-Extras without the drawing).</summary>
    public sealed class ExtrasOverview
    {
        /// <summary>No list yet, extras not allowed, or not downloaded: the tab shows "Download the optional visual extras?"
        /// (Show-ExtrasDownload) with DownloadSizeMb, and nothing else.</summary>
        public bool NeedsDownload;
        public string DownloadSizeMb = "10";
        public ExtrasManifest Manifest;
        public ExtrasState State;
        /// <summary>What the switches show: the queued choice when there is one (Get-ChosenState).</summary>
        public ExtrasState Chosen;
        public bool GameRunning;
        public List<ExtrasCheck> Verify = new List<ExtrasCheck>();
        public Dictionary<string, InGameState> InGame = new Dictionary<string, InGameState>(StringComparer.OrdinalIgnoreCase);
        /// <summary>One per extra that has a switch (not the two shader packs), in the list's order.</summary>
        public List<ExtraItem> Switches = new List<ExtraItem>();
        public Dictionary<string, ExtraStatus> Statuses = new Dictionary<string, ExtraStatus>(StringComparer.OrdinalIgnoreCase);
        public ExtrasHeadline Headline;
        /// <summary>The headline box's colour: green (all active), red (wrong), amber (restart), else blue.</summary>
        public string HeadlineTone = "blue";
        /// <summary>The last thing that went wrong, in one line (null: hide the line).</summary>
        public string ErrorLine;
        /// <summary>The tick list, grouped Files, Settings, Dependencies, In game (Show-Checks' rows).</summary>
        public List<ExtrasCheck> CheckRows = new List<ExtrasCheck>();
        /// <summary>Ids not seen in the tab before: they get a "New" badge.</summary>
        public HashSet<string> New = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>What pressing Apply comes to (On-Apply before any question): Route nothing | ask_restart | restart | install.</summary>
    public sealed class ApplyPlan
    {
        public string Route = "nothing";
        public ExtrasState State;
        public ExtrasChoice Pick;
        /// <summary>The tab's status line when there is nothing more to do ("Nothing to change."), else null.</summary>
        public string Say;
    }

    /// <summary>What an install with the game closed did (Install-Now without the questions).</summary>
    public sealed class InstallOutcome
    {
        public ApplyResult Result;
        public List<ExtrasCheck> Checks = new List<ExtrasCheck>();
        /// <summary>The tab's status line; null when the window asks "Start the game now?" next (or starts it).</summary>
        public string Say;
        /// <summary>Installed by Apply with the game closed: AfterInstall decides whether to ask "Start the game now?".</summary>
        public bool StartNext;
    }

    /// <summary>The words the Extras tab and its questions use (2.0.1), so the window says exactly what 2.0.x said.</summary>
    public static class ExtrasText
    {
        public const string RestartQuestion = "Restart the game now to use your extras?";
        public const string RestartWhy = "Minecraft is running and has its mods open, so they can only change while it's closed. Yes closes it (like its own X button), installs your changes, checks them and starts the game again. Later installs them the moment you close the game.";
        public const string RestartAllNote = "Allow all: Yes now, and from now on restart without asking (Review permissions changes that).";
        public const string StartQuestion = "Start the game now?";
        public const string StartWhy = "Your extras are installed and checked. Yes opens the Minecraft Launcher on Deepslate Works; press Play there. Later leaves everything ready for the next time you play.";
        public const string StartAllNote = "Allow all: Yes now, and from now on start the game after Apply without asking.";
        public const string Busy = "Wait until the current step is done.";
        public const string NothingToChange = "Nothing to change.";
        public const string Queued = "Waiting for the game to close. Your changes install by themselves then.";
        public const string InstalledQueued = "Installed. Active next time you play.";
        public const string InstalledLater = "Installed. Ready, starts next time you play.";
        public const string InstalledStarting = "Installed. The Minecraft Launcher is opening: press Play there.";
        public const string CheckedOk = "Checked: everything is where it should be.";
        public const string CheckedBad = "{0} check(s) failed: see the list below.";
        public const string NoExtrasYet = "No extras on this PC yet.";
        public const string DownloadQuestion = "Download the optional visual extras?";
        public const string DownloadText = "About {0} MB, nothing is switched on. Once they're on this PC, switching one on or off needs no download and works offline. Allow all says yes to this and carries on.";
        public const string WeakWarning = "This PC looks like an older laptop or one without a graphics card: this one may make the game stutter.";
        public const string WeakShaderTip = "This PC may stutter with these.";
        /// <summary>The Shaders choice under Iris: value and label.</summary>
        public static readonly KeyValuePair<string, string>[] ShaderOptions =
        {
            new KeyValuePair<string, string>("none", "None"),
            new KeyValuePair<string, string>("light", "Light (MakeUp Ultra Fast)"),
            new KeyValuePair<string, string>("full", "Full (Complementary Reimagined)"),
        };
    }

    public static partial class Extras
    {
        /// <summary>The game folder's extras paths (Get-ExtrasPaths $DataDir).</summary>
        public static ExtrasPaths Paths => GetPaths(Env.LiveDataDir);   // docs/45: the Extras tab is the live game's

        /// <summary>Hooks the extras into the report (Report.ExtrasBlock = the Extras tab's state, Get-ReportExtras).</summary>
        public static void Wire() => Report.ExtrasBlock = ReportExtras;

        /// <summary>Get-ReportExtras: the Extras tab's state for the report; null when this PC has no extras or it cannot be read.</summary>
        public static object ReportExtras()
        {
            try
            {
                var m = ExtrasManifest.Read(Env.ExtrasManifestPath);
                if (m == null) return null;
                return ReportBlock(Paths, m, ExtrasState.Read(Env.ExtrasStatePath));
            }
            catch (Exception e) { DeepslateWorks.Log.Line("extras: not in the report: " + e.Message); return null; }
        }

        /// <summary>The file names of the extras' jars that are switched on: the install steps leave them in mods\
        /// (Get-AppliedExtraJars of the saved state).</summary>
        public static List<string> AppliedJars() => AppliedJars(ExtrasState.Read(Env.ExtrasStatePath));

        /// <summary>
        /// The install steps' extras step (2.0.0, "every extra downloaded into extras\, nothing switched on; the Extras tab
        /// switches them"): the site's list saved, every extra's files downloaded into extras\, the ones switched on brought
        /// up to date, a queue left by Later installed. A failure is a Note; only the permission question (NeedAnswer /
        /// StepDeclined) leaves this.
        /// </summary>
        public static void SyncForRun(Run run) => SyncForRun(run, null);

        /// <summary>SyncForRun with the download swapped (tests): fetch(url, outFile); null = Http.Download.</summary>
        public static void SyncForRun(Run run, Action<string, string> fetch)
        {
            if (run.DryRun || !run.RequestConsent("extras")) return;
            try
            {
                var raw = Http.GetJson(Env.ExtrasUrl, 60);
                run.Step("Visual extras");
                Json.WriteFile(Env.ExtrasManifestPath, raw);
                var m = ExtrasManifest.FromJson(raw) ?? new ExtrasManifest { Raw = raw };
                var state = ExtrasState.Read(Env.ExtrasStatePath);
                var sx = SyncFiles(Paths, m, state, fetch ?? ((url, outFile) => Http.Download(url, outFile)));
                if (!state.Downloaded) { state.Seen = m.Extras.Select(x => x.Id).ToList(); state.Downloaded = true; }
                if (sx.Applied != null && !sx.Applied.Ok) run.Note("Your extras could not be updated this time: " + sx.Applied.Error);
                state.Save(Env.ExtrasStatePath);
                run.Tick(string.Format("{0} extras ready ({1} downloaded), {2} on", m.Extras.Count, sx.Downloaded, GetOn(m, state).Count));
                run.Emit(J.O("t", "extras", "downloaded", sx.Downloaded));
            }
            catch (NeedAnswer) { throw; }
            catch (StepDeclined) { throw; }
            catch (Exception e) { run.Note("The visual extras could not be fetched this time: " + e.Message); }
        }

        static void Say(string text, ConsoleColor? color = null)
        {
            try
            {
                if (color != null) Console.ForegroundColor = color.Value;
                Console.WriteLine(text);
            }
            catch { }
            finally { try { if (color != null) Console.ResetColor(); } catch { } }
        }

        /// <summary>-VerifyExtras (Invoke-VerifyExtras): the Extras tab's checks printed to the console; 1 when one fails
        /// ("waiting for the game" is not a failure).</summary>
        public static int VerifyCommand()
        {
            var paths = Paths;
            var m = ExtrasManifest.Read(Env.ExtrasManifestPath);
            var st = ExtrasState.Read(Env.ExtrasStatePath);
            if (m == null) { Say("No extras on this PC (no extras list yet).", ConsoleColor.Yellow); return 0; }
            var verify = Verify(paths, m, st);
            var inGame = InGame(paths, m, st, ReadGameSession(paths.LatestLog));
            int fail = 0;
            var on = GetOn(m, st);
            Say(string.Format("Extras on: {0}{1}", on.Count > 0 ? string.Join(", ", on) : "none", st.Queued != null ? " (changes queued for when the game closes)" : ""));
            foreach (var c in verify)
            {
                Say(string.Format("  [{0}] {1}: {2}", c.Ok == true ? "OK" : "FAIL", c.Group, c.Text), c.Ok == true ? ConsoleColor.Green : ConsoleColor.Red);
                if (c.Ok != true) fail++;
            }
            foreach (var id in on)
            {
                inGame.TryGetValue(id, out var g);
                var x = m.Find(id);
                if (x != null && x.IsShader) continue;
                var state = g?.State;
                var tag = state == "active" ? "OK" : state == "waiting" ? "WAIT" : "FAIL";
                if (tag == "FAIL") fail++;
                Say(string.Format("  [{0}] In game: {1}: {2}", tag, NameOf(x), state == "active" ? "confirmed in game" : state == "waiting" ? "waiting for the game to start" : g?.Reason ?? ""),
                    tag == "OK" ? ConsoleColor.Green : tag == "WAIT" ? ConsoleColor.Cyan : ConsoleColor.Red);
            }
            foreach (var x in m.Extras.Where(x => !x.IsShader))
                if (inGame.TryGetValue(x.Id, out var g) && g.State == "off-loaded") Say(string.Format("  [INFO] In game: {0} is off; the last session still had it", NameOf(x)));
            XLog(string.Format("verify (-VerifyExtras): {0} failed", fail), fail > 0);
            return fail > 0 ? 1 : 0;
        }

        // ---- the Extras tab's building blocks (the window draws; these decide, log and save) ----------------------

        /// <summary>Show-ExtrasDownload's size: the list's size in MB ("{0:0}"), or "10" when it is not known.</summary>
        public static string DownloadSizeMb(ExtrasManifest m)
            => m != null && m.Size != null && m.Size.Value != 0 ? string.Format(CultureInfo.InvariantCulture, "{0:0}", m.Size.Value / (1024.0 * 1024)) : "10";

        /// <summary>Show-Extras without the drawing: reads extras-manifest.json and extras.json, runs the checks, reads the
        /// game's log, and works out every status, the headline, the error line and the tick list. allowed: the
        /// "extras" permission is Allow. sim* are the screenshots' stand-ins (state, game running, all active).</summary>
        public static ExtrasOverview Overview(bool allowed, bool gameRunning, ExtrasState simState = null, bool simInGameAll = false)
        {
            var paths = Paths;
            var o = new ExtrasOverview { Manifest = ExtrasManifest.Read(Env.ExtrasManifestPath), GameRunning = gameRunning };
            var st = simState ?? ExtrasState.Read(Env.ExtrasStatePath);
            o.State = st;
            o.DownloadSizeMb = DownloadSizeMb(o.Manifest);
            var m = o.Manifest;
            if (m == null || !allowed || !st.Downloaded) { o.NeedsDownload = true; return o; }
            o.Chosen = st.Chosen();
            o.Verify = Verify(paths, m, st);
            o.InGame = InGame(paths, m, st, ReadGameSession(paths.LatestLog));
            if (simInGameAll) foreach (var id in GetOn(m, st)) o.InGame[id] = new InGameState("active");
            foreach (var x in m.Extras.Where(x => !x.IsShader))
            {
                o.Switches.Add(x);
                o.Statuses[x.Id] = Status(x, m, st, o.Verify, o.InGame, gameRunning);
                if (!Extras_.Has(st.Seen, x.Id)) o.New.Add(x.Id);
            }
            o.Headline = Headline(m, st, o.Statuses, gameRunning);
            var h = o.Headline.Text;
            o.HeadlineTone = h.IndexOf("active in game", StringComparison.OrdinalIgnoreCase) >= 0 ? "green"
                           : h.IndexOf("wrong", StringComparison.OrdinalIgnoreCase) >= 0 ? "red"
                           : o.Headline.Action == "restart" ? "amber" : "blue";
            if (st.LastApply != null && !st.LastApply.Ok && !string.IsNullOrEmpty(st.LastApply.Summary)) o.ErrorLine = st.LastApply.Summary;
            o.CheckRows = CheckRows(m, st, o.Verify, o.InGame);
            return o;
        }

        /// <summary>What has been shown counts as seen: "New" once (the end of Show-Extras; not for screenshots).</summary>
        public static void MarkSeen(ExtrasManifest m)
        {
            var st = ExtrasState.Read(Env.ExtrasStatePath);
            st.Seen = m.Extras.Select(x => x.Id).ToList();
            st.Save(Env.ExtrasStatePath);
        }

        /// <summary>Show-Checks' rows: the checks, then In game per extra that is on (ok true active, null waiting, false
        /// a problem), then the off ones the last session still had; ordered Files, Settings, Dependencies, In game.</summary>
        public static List<ExtrasCheck> CheckRows(ExtrasManifest m, ExtrasState st, List<ExtrasCheck> verify, Dictionary<string, InGameState> inGame)
        {
            var rows = new List<ExtrasCheck>(verify);
            foreach (var id in GetOn(m, st))
            {
                var x = m.Find(id);
                if (x == null || x.IsShader) continue;
                inGame.TryGetValue(id, out var g);
                var s = g?.State;
                rows.Add(new ExtrasCheck("In game", id, s == "active" ? true : s == "waiting" ? (bool?)null : false,
                    s == "active" ? string.Format("{0}: confirmed in game", NameOf(x)) : s == "waiting" ? string.Format("{0}: waiting for the game to start", NameOf(x)) : string.Format("{0}: {1}", NameOf(x), g?.Reason)));
            }
            foreach (var x in m.Extras.Where(x => !x.IsShader))
                if (inGame.TryGetValue(x.Id, out var g) && g.State == "off-loaded")
                    rows.Add(new ExtrasCheck("In game", x.Id, null, string.Format("{0}: off; the last game session still had it, gone next time", NameOf(x))));
            var order = new[] { "Files", "Settings", "Dependencies", "In game" };
            return order.SelectMany(grp => rows.Where(r => r.Group == grp)).ToList();
        }

        /// <summary>On-Check (the Check extras button, which changes nothing): the checks, logged; and the tab's status line.</summary>
        public static KeyValuePair<List<ExtrasCheck>, string> CheckNow(ExtrasManifest m = null)
        {
            m = m ?? ExtrasManifest.Read(Env.ExtrasManifestPath);
            if (m == null) return new KeyValuePair<List<ExtrasCheck>, string>(new List<ExtrasCheck>(), null);
            var st = ExtrasState.Read(Env.ExtrasStatePath);
            var verify = Verify(Paths, m, st);
            var bad = verify.Where(c => c.Ok == false).ToList();
            XLog(string.Format("check: {0} check(s), {1} failed{2}", verify.Count, bad.Count, bad.Count > 0 ? ": " + string.Join("; ", bad.Select(c => c.Text)) : ""), bad.Count > 0);
            return new KeyValuePair<List<ExtrasCheck>, string>(verify, bad.Count > 0 ? string.Format(ExtrasText.CheckedBad, bad.Count) : ExtrasText.CheckedOk);
        }

        /// <summary>
        /// On-Apply up to the questions: reads extras.json, logs "apply pressed" with the switches before and after, and
        /// decides the route (ApplyRoute). Nothing switched: a queue is dropped (back to what is installed), Say =
        /// "Nothing to change.". The window then: ask_restart -> the restart question (log "apply: restart choice: " +
        /// yes|later|all with XLog; all = allow "restart" and Yes); Later -> QueueForLater; Yes/restart ->
        /// RestartFlow.Start; install -> InstallNow. Busy (a run or a flow going): ExtrasText.Busy, without calling this.
        /// </summary>
        public static ApplyPlan PressApply(ExtrasManifest m, ExtrasChoice pick, bool gameRunning, bool autoRestart)
        {
            var st = ExtrasState.Read(Env.ExtrasStatePath);
            var want = st.With(pick);
            var before = FormatSwitches(m, st.Chosen());
            var changed = Changed(m, want);
            var route = ApplyRoute(gameRunning, changed, autoRestart);
            XLog(string.Format("apply pressed: switches before: {0}; after: {1}; the game is {2}", before, FormatSwitches(m, want), gameRunning ? "running" : "not running"));
            var plan = new ApplyPlan { Route = route, State = st, Pick = pick };
            if (route == "nothing")
            {
                if (st.Queued != null) { st.Queued = null; st.Save(Env.ExtrasStatePath); XLog("apply: back to what is installed: the queued changes were dropped"); }
                plan.Say = ExtrasText.NothingToChange;
            }
            return plan;
        }

        /// <summary>Later on the restart question (planner H): the choice queued in extras.json (replacing an earlier queue),
        /// logged; returns the tab's status line.</summary>
        public static string QueueForLater(ExtrasState st, ExtrasChoice pick)
        {
            var replaced = SetQueue(st, pick.Choices, pick.Shader);
            st.Save(Env.ExtrasStatePath);
            XLog(string.Format("queued install: queued at {0}{1}; installs when the game closes", st.Queued.At, replaced ? " (replaces the changes queued before)" : ""));
            return ExtrasText.Queued;
        }

        /// <summary>
        /// Install-Now without the questions: with the game closed, installs pick (Apply with the game closed) or, when pick
        /// is null, the queue (the game just closed); saves, checks and logs. A failed install keeps the previous choice.
        /// Say is the status line; when StartNext the window goes on with AfterInstall ("Start the game now?", logging
        /// "apply: start the game? " + the answer; Yes -> StartAfterInstall; Later -> ExtrasText.InstalledLater).
        /// </summary>
        public static InstallOutcome InstallNow(ExtrasManifest m, ExtrasState st, ExtrasChoice pick)
        {
            m = m ?? ExtrasManifest.Read(Env.ExtrasManifestPath);
            var paths = Paths;
            var o = new InstallOutcome();
            ApplyResult r;
            if (pick == null) r = QueuedInstall(paths, m, st);
            else
            {
                st.Queued = null;
                var prevC = st.Choices; var prevS = st.Shader;
                st.Choices = pick.Choices; st.Shader = pick.Shader;
                r = Apply(paths, m, st);
                if (!r.Ok) { st.Choices = prevC; st.Shader = prevS; }   // what is chosen goes back with the files
            }
            o.Result = r;
            st.Save(Env.ExtrasStatePath);
            o.Checks = Verify(paths, m, st);
            var bad = o.Checks.Count(c => c.Ok == false);
            XLog(string.Format("check after install: {0} check(s), {1} failed", o.Checks.Count, bad), bad > 0);
            if (r == null) return o;
            if (!r.Ok) { o.Say = r.Summary; return o; }
            if (pick == null) { o.Say = ExtrasText.InstalledQueued; return o; }
            o.StartNext = true;
            return o;
        }

        /// <summary>Yes on "Start the game now?" (or allowed before): opens the launcher, logs the relaunch, returns the
        /// status line.</summary>
        public static string StartAfterInstall(Func<bool> openLauncher)
        {
            var ok = false;
            try { ok = openLauncher != null && openLauncher(); } catch { }
            XLog("relaunch: " + (ok ? "started (the Minecraft Launcher on Deepslate Works)" : "the Minecraft Launcher was not found"), !ok);
            return ExtrasText.InstalledStarting;
        }

        /// <summary>
        /// The window's 2 s look at the game (planner H, Later): queued changes install the moment it closes. Call with
        /// whether the game is running now (GameRunning()) and whether the install steps are running; returns the queued
        /// install's outcome when one ran, else null.
        /// </summary>
        public static InstallOutcome InstallQueuedIfClosed(bool gameRunning, bool engineRunning)
        {
            if (gameRunning || engineRunning) return null;
            var st = ExtrasState.Read(Env.ExtrasStatePath);
            if (st.Queued == null) return null;
            XLog("queued install: the game closed at " + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture));
            return InstallNow(null, st, null);
        }

        /// <summary>On-Headline "restart" (Restart now for the queued changes): the restart flow for the queue, or null when
        /// nothing is queued.</summary>
        public static RestartFlow RestartForQueue(ExtrasManifest m, IGameControl game = null)
        {
            var st = ExtrasState.Read(Env.ExtrasStatePath);
            if (st.Queued == null) return null;
            XLog("restart: Restart now pressed for the queued changes");
            var pick = new ExtrasChoice(st.Queued.Choices, st.Queued.Shader);
            return RestartFlow.Start(m ?? ExtrasManifest.Read(Env.ExtrasManifestPath), st, pick, true, game);
        }
    }
}

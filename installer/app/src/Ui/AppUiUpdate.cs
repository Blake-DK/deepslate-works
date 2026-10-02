using System;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Threading;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.3.0: Play waits for an Update that is running, then starts the game once. Pure, so it is tested.
    /// </summary>
    public sealed class PlayQueue
    {
        public bool Queued { get; private set; }
        /// <summary>Play pressed (the website's Play, a relaunch): "start" now, or "wait" for the update in hand.</summary>
        public string Press(bool updating) { if (!updating) return "start"; Queued = true; return "wait"; }
        /// <summary>The update ended: "play" once when Play was pressed meanwhile and it went through, else "none".</summary>
        public string UpdateEnded(bool ok) { var q = Queued; Queued = false; return q && ok ? "play" : "none"; }
    }

    /// <summary>
    /// 3.3.0 (planner 2026-10-02): the Update button, to the right of Play. "✓ Up to date" (a click checks again),
    /// "● Update" when the site has something newer, "Updating…" while it runs, with the step under it. Update runs
    /// exactly what Play runs before the launch (the same Engine.Execute, run.UpdateOnly) and stops there: no launcher,
    /// no countdown, no wake. With the game running it downloads into .waiting\ and finishes when the game closes.
    /// Must-vote polls shut Play only; Update always works.
    /// </summary>
    sealed partial class AppUi
    {
        Button UpdateButton;
        TextBlock UpdateLine;
        DispatcherTimer UpdTimer;
        public Waiting LastCheck;
        volatile bool checkBusy;
        bool updating;           // an Update run is going
        bool deferredUpdate;     // it waits for the game to close
        bool updateAfter;        // a run waiting for Play is ended first, then the Update starts
        bool resumeUpdate;       // a permission card came up during an Update: Continue goes on with the Update
        public bool AutoUpdate;  // started with -Update (the app updated itself during an Update and carries on)
        readonly PlayQueue playQueue = new PlayQueue();

        void WireUpdate()
        {
            var w = Window;
            UpdateButton = w.FindName("UpdateButton") as Button ?? throw new InvalidOperationException("the window has no UpdateButton");
            UpdateLine = w.FindName("UpdateLine") as TextBlock ?? throw new InvalidOperationException("the window has no UpdateLine");
            UpdateButton.Click += (s, e) => OnUpdateButton();
            UpdTimer = new DispatcherTimer(DispatcherPriority.Normal, w.Dispatcher) { Interval = TimeSpan.FromMinutes(UpdateCheck.EveryMinutes) };
            UpdTimer.Tick += (s, e) => CheckUpdates();
        }

        void StartUpdateChecks() { CheckUpdates(); UpdTimer.Start(); }

        /// <summary>Asks the site what is newer (a thread of its own) and shows it, unless an Update is in hand.</summary>
        public void CheckUpdates()
        {
            if (homeSim || checkBusy) return;
            checkBusy = true;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                Waiting w;
                try { w = UpdateCheck.Run(DateTime.Now); } catch (Exception e) { w = new Waiting { Problem = e.Message, CheckedAt = DateTime.Now }; }
                finally { checkBusy = false; }
                try { d.BeginInvoke(new Action(() => ShowCheck(w))); } catch { }
            }) { IsBackground = true, Name = "update check" }.Start();
        }

        void ShowCheck(Waiting w)
        {
            LastCheck = w;
            if (updating || deferredUpdate) return;
            Log.Line("update check: " + UpdateCheck.Line(w));
            UpdateButton.Content = UpdateCheck.Button(w, false);
            UpdateLine.Text = UpdateCheck.Line(w);
            UpdateLine.Visibility = Visibility.Visible;
            UpdateButtonEnabled();
        }

        /// <summary>One run at a time: while any run works (Play's or Update's) the button waits.</summary>
        void UpdateButtonEnabled() => UpdateButton.IsEnabled = !updating && !deferredUpdate && Guided == 0 && (Mode == "idle" || Mode == "ready");

        void OnUpdateButton()
        {
            if (updating || deferredUpdate || Guided > 0 || Mode == "asking") return;
            if (LastCheck != null && !LastCheck.Any && LastCheck.Problem == null)
            {
                UpdateLine.Text = "Checking...";
                CheckUpdates();   // "Up to date": a click checks again
                return;
            }
            StartUpdate();
        }

        void StartUpdate()
        {
            if (updating || deferredUpdate) return;
            if (runWaiting)
            {
                // a run that got the game ready waits for Play: it ends first (the game not started), then the Update
                Log.Line("window: Update pressed while the game was ready: that run ends first");
                updateAfter = true; keepScreen = true; Go(false);
                return;
            }
            if (worker != null && worker.IsAlive) return;
            StartRun(true, false, false, true);
        }

        /// <summary>StartRun's part for an Update: the button, the line, and Play shut until it ends.</summary>
        void UpdateStarted()
        {
            updating = true;
            UpdateButton.Content = UpdateCheck.Button(LastCheck, true);
            UpdateButton.IsEnabled = false;
            UpdateLine.Text = UiText.UpdateStarting; UpdateLine.Visibility = Visibility.Visible;
            PlayTitle.Text = UiText.UpdatingTitle;
            PlayStatus.Text = UiText.UpdatingStatus;
            PlayButton.Content = UiText.Play;
            PlayButton.IsEnabled = false;
        }

        /// <summary>The step in hand, under "Updating…".</summary>
        void UpdateStep(string text) { if (updating && !string.IsNullOrEmpty(text)) UpdateLine.Text = text; }

        /// <summary>OnRunEnded's part for an Update. True when it was one (the rest of OnRunEnded is skipped).</summary>
        bool UpdateEnded(string outcome, Exception err)
        {
            if (!updating) return false;
            updating = false;
            Mode = "idle";
            if (err is UpdateDeferred)
            {
                deferredUpdate = true;
                PlayTitle.Text = UiText.UpdateWaitTitle;
                PlayStatus.Text = UiText.UpdateWaitStatus;
                UpdateButton.Content = UpdateCheck.Button(LastCheck, true); UpdateButton.IsEnabled = false;
                UpdateLine.Text = UiText.UpdateWaitLine;
                PlayButton.IsEnabled = false;
                GameRunning = true;   // seen running just now; the 2 s look at the processes says when it has closed
                Log.Line("window: Update waits for the game to close");
                return true;
            }
            if (err is NeedAnswer || err is StepDeclined) { resumeUpdate = err is NeedAnswer; UpdateButton.Content = UpdateCheck.Button(LastCheck, false); UpdateButtonEnabled(); return false; }   // the cards, as for Play
            PlayButton.Content = UiText.Play;
            PlayButton.IsEnabled = true;
            if (err != null || outcome == "updated")
            {
                if (outcome == "updated") return false;   // the new app takes over and carries on (-Update)
                ClearPlayBody();
                PlayTitle.Text = UiText.UpdateFailedTitle;
                PlayStatus.Text = string.IsNullOrEmpty(LastFail) ? UiText.FailedStatus : LastFail;
                var t = new TextBlock { Margin = new Thickness(0, 6, 0, 0) };
                var hl = new Hyperlink(); hl.Inlines.Add(UiText.OpenTheLog); hl.Click += (s, e) => ShowLogDetails();
                t.Inlines.Add(hl); PlayBody.Children.Add(t);
                UpdateButton.Content = UpdateCheck.Button(new Waiting { Problem = "failed" }, false);
                UpdateLine.Text = UiText.UpdateFailedLine;
                UpdateButtonEnabled();
                playQueue.UpdateEnded(false);
                Log.Line("window: Update failed: " + (LastFail ?? err?.Message));
                return true;
            }
            PlayTitle.Text = UiText.UpToDateTitle;
            PlayStatus.Text = UiText.UpToDateStatus;
            if (!string.IsNullOrEmpty(Changed)) { PlayChanged.Text = Changed; PlayChanged.Visibility = Visibility.Visible; }
            var now = new Waiting { CheckedAt = DateTime.Now };
            LastCheck = now;
            UpdateButton.Content = UpdateCheck.Button(now, false);
            UpdateLine.Text = UpdateCheck.Line(now);
            UpdateButtonEnabled();
            UpdateAppBrand();
            RefreshVersions();
            CheckUpdates();   // what the site says now (the extras may still be queued)
            Log.Line("window: Update finished; the game was not started");
            if (playQueue.UpdateEnded(true) == "play") { Log.Line("window: Play was pressed during the Update: starting the game now"); StartRun(); }
            return true;
        }

        /// <summary>Play pressed while an Update runs or waits for the game: it starts once the Update has finished.</summary>
        bool PlayWaitsForUpdate(string why)
        {
            if (playQueue.Press(updating || deferredUpdate) == "start") return false;
            Log.Line("window: Play (" + why + ") waits for the Update to finish");
            UpdateLine.Text = UiText.PlayAfterUpdate;
            return true;
        }

        /// <summary>Every tick: an Update waiting for the game carries on when it has closed; nothing else enables Play meanwhile.</summary>
        void UpdateTick()
        {
            if (deferredUpdate)
            {
                PlayButton.IsEnabled = false;
                if (!GameRunning)
                {
                    deferredUpdate = false;
                    Log.Line("window: the game has closed: finishing the Update");
                    StartUpdate();
                }
                return;
            }
            if (!updating && UpdateButton.IsEnabled != (Guided == 0 && (Mode == "idle" || Mode == "ready"))) UpdateButtonEnabled();
        }

        /// <summary>The footer's versions straight after an Update (the pack on this PC, the site's current one).</summary>
        void RefreshVersions()
        {
            VerLocal = Footer.InstalledPack();
            UpdateAppFooter();
        }

        // ---- for the window tests and the screenshots ---------------------------------------------------------------
        internal bool UpdateOpen => UpdateButton.IsEnabled;
        internal string UpdateLabel => UpdateButton.Content as string;
        internal string UpdateLineText => UpdateLine.Text;
        public void SimCheck(Waiting w) { homeSim = true; updating = false; deferredUpdate = false; Mode = "idle"; ShowIdle(); PlayHint.Visibility = Visibility.Collapsed; ShowCheck(w); }
        public void SimUpdating(string step)
        {
            homeSim = true; Mode = "running"; ClearPlayBody(); UpdateStarted();
            foreach (var l in new[] { "Signed in", "Launcher found", "Java 21 (the launcher's own)", "Already installed" }) AddPlayLine("✓ " + l, "#2E7D5B");
            AddPlayLine(step, "#1A5FB4", "SemiBold");
            UpdateStep(step);
        }
        public void SimUpToDate() { homeSim = true; updating = true; Changed = "Updated 3 mods"; UpdateEnded("done", null); homeSim = true; }
        public void SimGameRunning() { updating = true; UpdateEnded(null, new UpdateDeferred(3)); }
        public void SimEnd() { updating = false; deferredUpdate = false; LastCheck = null; Mode = "idle"; ShowIdle(); }
    }
}

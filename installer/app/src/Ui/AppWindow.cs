using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace DeepslateWorks
{
    /// <summary>
    /// The window (2.0.0, 2.0.1, 2.0.3). One window per PC user: a second start (the Play button on the site, a shortcut)
    /// only brings it to the front and presses Play. It stays open until it is closed; the game closing does not close it.
    /// 3.0: the install steps run on a thread of this process (Engine.Execute) instead of a hidden -Engine child that
    /// wrote a status file; their status lines come straight to the window.
    /// </summary>
    public static partial class AppWindow
    {
        /// <summary>The window (2.0.x Start-AppWindow + Show-App): one per PC user; a second start brings it to the front and
        /// presses Play. Returns the exit code when it closes. When the window cannot be made the exception goes to the
        /// caller (Program says so in a message box).</summary>
        public static int Run(Run run, Args args)
        {
            var mutex = new Mutex(true, Env.AppMutexName, out var created);
            var signal = new EventWaitHandle(false, EventResetMode.AutoReset, Env.AppShowEvent);
            var play = new EventWaitHandle(false, EventResetMode.AutoReset, Env.AppPlayEvent);
            if (!created)
            {
                Native.GrantForeground();   // the open window may take the foreground from this process
                // 3.1.0: the website's Play button asks the open window to play; a shortcut only brings it to the front
                if (args != null && args.Link != "") play.Set(); else signal.Set();
                try { using (var up = new EventWaitHandle(false, EventResetMode.ManualReset, Env.AppUpEvent)) up.Set(); } catch { }
                Log.Line("the window is already open: brought to the front" + (args != null && args.Link != "" ? ", asked to play" : ""));
                signal.Dispose(); play.Dispose(); mutex.Dispose();
                return 0;
            }
            try
            {
                // before any window: its own taskbar button (2.0.3), never grouped under another program
                try { Native.SetCurrentProcessExplicitAppUserModelID(Env.AppUserModelId); } catch (Exception e) { Log.Line("window: " + e.Message); }
                var ui = new AppUi(run ?? new DeepslateWorks.Run(), false) { ShowSignal = signal, PlaySignal = play, FromWebsite = args != null && args.Link != "", AutoUpdate = args != null && args.Update };
                ui.Open();
                return 0;
            }
            finally
            {
                try { mutex.ReleaseMutex(); } catch { }
                mutex.Dispose(); signal.Dispose(); play.Dispose();
            }
        }

        /// <summary>-Screenshots: the window's main states drawn into PNG files in dir, then exit.</summary>
        public static int Screenshots(string dir)
        {
            var files = DrawScreenshots(dir);
            Log.Line(string.Format("Screenshots in {0} ({1} files)", dir, files.Count));
            try { Process.Start(new ProcessStartInfo(dir) { UseShellExecute = true }); } catch { }
            return 0;
        }

        /// <summary>
        /// Save-Screenshots: the window made and drawn off screen (never shown where anyone sees it): 1. the first-run
        /// questions with Allow all, 2. the restart question, and, when this PC has the extras list, 3. the extras waiting
        /// for the game to close (Iris + Light shaders and Falling Leaves chosen with Later, the game running), 4. everything
        /// active in game with the checks. Must run on an STA thread. Returns the files written.
        /// </summary>
        public static List<string> DrawScreenshots(string dir)
        {
            Directory.CreateDirectory(dir);
            var files = new List<string>();
            var ui = new AppUi(new DeepslateWorks.Run(), true);
            var w = ui.Window;
            w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
            w.Show(); ui.Pump();
            try
            {
                // 1. a question with Allow all (the first-run cards)
                var real = ui.Consent;
                ui.Consent = new Dictionary<string, ConsentAnswer>();
                ui.ShowFirstRun();
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "1-permissions-allow-all.png")));
                ui.Consent = real;
                // 2. the restart question
                var d = ui.MakeAsk(ExtrasText.RestartQuestion, ExtrasText.RestartWhy, ExtrasText.RestartAllNote);
                d.WindowStartupLocation = WindowStartupLocation.Manual; d.Left = -20000; d.Top = 0; d.ShowInTaskbar = false;
                d.Show(); ui.Pump();
                files.Add(SavePng(d.Content as FrameworkElement, Path.Combine(dir, "2-restart-question.png")));
                d.Close();
                // 3. waiting for the game to close
                ui.Tabs.SelectedItem = ui.ExtrasTab; ui.Pump();
                var m = ExtrasManifest.Read(Env.ExtrasManifestPath);
                if (m != null)
                {
                    var s3 = ExtrasState.Read(Env.ExtrasStatePath); s3.Downloaded = true;
                    s3.Queued = new ExtrasChoice(new Dictionary<string, bool> { { "iris", true }, { "falling-leaves", true } }, "light", Extras.NowIso());
                    ui.XRendered = false;
                    ui.ShowExtras(false, s3, true, false);
                    ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "3-waiting-for-the-game.png")));
                    // 4. everything active in game, with the checks
                    var s4 = ExtrasState.Read(Env.ExtrasStatePath); s4.Downloaded = true; s4.Queued = null;
                    ui.XRendered = false;
                    ui.ShowExtras(false, s4, false, true);
                    ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "4-all-active.png")));
                }
                else Log.Line("No extras on this PC yet: press Play once with extras allowed, then take the Extras screenshots.");

                // 3.1.0: the guided setup after the old launcher, the countdown, the countdown stopped, the Play settings
                var real3 = ui.Consent;
                ui.ShowGuidedStep(1);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "5-guided-1-welcome.png")));
                var items = HandOver.NewItems();
                foreach (var it in items) it.Status = "ok";
                items[0].Detail = Env.AppHome; items[4].Detail = "Kept: 9 permission answers, your extras, your sign-in, pack 0.1.0+43978c76";
                items[5].Detail = UiText.MoveVerified; items[6].Detail = "DeepslateWorks.ps1, DeepslateWorks.vbs, DeepslateWorks.ico";
                ui.SimMove(items, false);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "6-guided-2-move-over.png")));
                var bad = HandOver.NewItems();
                for (int i = 0; i < 4; i++) bad[i].Status = "ok";
                bad[0].Detail = Env.AppHome; bad[4].Status = "ok"; bad[4].Detail = "Kept: 9 permission answers, your extras, your sign-in, pack 0.1.0+43978c76";
                bad[5].Status = "failed"; bad[5].Detail = "the website's Play button does not start it";
                bad[6].Status = "failed"; bad[6].Detail = "Waiting for the check above";
                ui.SimMove(bad, true);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "6b-guided-2-retry.png")));
                ui.Consent = new Dictionary<string, ConsentAnswer>();
                foreach (var st in Consents.Steps()) if (st.FirstRun) Consents.SetAnswer(ui.Consent, st.Id, st.Id == "reports" ? "decline" : "allow", 1);
                ui.ShowGuidedStep(3);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "7-guided-3-permissions.png")));
                ui.Consent = real3;
                ui.ShowGuidedStep(4);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "8-guided-4-extras.png")));
                ui.SimReady(true, 5);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "9-countdown.png")));
                ui.SimReady(true, 3);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "9b-countdown-3.png")));
                ui.SimReady(false);
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "10-countdown-stopped.png")));
                var sd = ui.MakeSettings();
                sd.WindowStartupLocation = WindowStartupLocation.Manual; sd.Left = -20000; sd.Top = 0; sd.ShowInTaskbar = false;
                sd.Show(); ui.Pump();
                files.Add(SavePng(sd.Content as FrameworkElement, Path.Combine(dir, "11-play-settings.png")));
                sd.Close();
                ui.Guided = 0;

                // 3.2.0 (planner 2026-10-02): the server on the Play tab while a wake runs; switched off, with an admin's
                // Start; a vote before play (Play shut), and its results
                ui.Consent = real3;
                ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Waking)), "ready");
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "12-play-server-waking.png")));
                ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.OffAdmin)), "idle");
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "13-play-switched-off-admin.png")));
                ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes)), "ready");
                ui.SimPick("o2");
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "14-vote.png")));
                ui.Tabs.SelectedItem = ui.PlayTab;
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "14b-play-vote-first.png")));
                ui.Tabs.SelectedItem = ui.VoteTab;
                ui.SimVoted(SiteHome.ParsePoll(Json.Parse(HomeSamples.Voted)));
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "15-vote-results.png")));
                ui.SimDone();

                // 3.3.0: the Update button: something waiting, mid-update, up to date, and the game running
                var at = new DateTime(2026, 10, 2, 15, 42, 0);
                ui.SimCheck(new Waiting { ModsChanged = 3, PackNew = true, AppVersion = "3.3.1", CheckedAt = at });
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "16-update-waiting.png")));
                ui.SimUpdating("Setting up the mods");
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "17-updating.png")));
                ui.SimUpToDate();
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "18-up-to-date.png")));
                ui.SimCheck(new Waiting { ModsChanged = 3, PackNew = true, CheckedAt = at });
                ui.SimGameRunning();
                ui.Pump(); files.Add(SavePng(w.Content as FrameworkElement, Path.Combine(dir, "19-update-game-running.png")));
                ui.SimEnd();
            }
            finally { w.Close(); }
            return files;
        }

        /// <summary>Save-Png: an element drawn into a PNG file at its size on screen.</summary>
        public static string SavePng(FrameworkElement visual, string file)
        {
            visual.UpdateLayout();
            int w = (int)Math.Ceiling(visual.ActualWidth), h = (int)Math.Ceiling(visual.ActualHeight);
            var bmp = new RenderTargetBitmap(Math.Max(1, w), Math.Max(1, h), 96, 96, PixelFormats.Pbgra32);
            // painted at its own size: rendered straight, an element keeps its offset in the window (its margin), so the
            // right and bottom edge of a question window were cut off in the pictures
            var dv = new DrawingVisual();
            using (var dc = dv.RenderOpen())
            {
                dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, Math.Max(1, w), Math.Max(1, h)));
                dc.DrawRectangle(new VisualBrush(visual), null, new Rect(0, 0, Math.Max(1, w), Math.Max(1, h)));
            }
            bmp.Render(dv);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            using (var fs = File.Create(file)) enc.Save(fs);
            return file;
        }
    }
}

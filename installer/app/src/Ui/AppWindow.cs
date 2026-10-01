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
            if (!created)
            {
                Native.GrantForeground();   // the open window may take the foreground from this process
                signal.Set();
                try { using (var up = new EventWaitHandle(false, EventResetMode.ManualReset, Env.AppUpEvent)) up.Set(); } catch { }
                Log.Line("the window is already open: brought to the front");
                signal.Dispose(); mutex.Dispose();
                return 0;
            }
            try
            {
                // before any window: its own taskbar button (2.0.3), never grouped under another program
                try { Native.SetCurrentProcessExplicitAppUserModelID(Env.AppUserModelId); } catch (Exception e) { Log.Line("window: " + e.Message); }
                var ui = new AppUi(run ?? new DeepslateWorks.Run(), false) { ShowSignal = signal };
                ui.Open();
                return 0;
            }
            finally
            {
                try { mutex.ReleaseMutex(); } catch { }
                mutex.Dispose(); signal.Dispose();
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
            bmp.Render(visual);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            using (var fs = File.Create(file)) enc.Save(fs);
            return file;
        }
    }
}

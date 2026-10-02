using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.3.1 (planner 2026-10-02): Review permissions is a view of its own. On 3.3.0 its row (Reset all, Allow all,
    // Save and play, Update) was wider than the window and "Reset all" was cut off behind the links.
    [Collection("env")]
    public class ReviewTests
    {
        static void OnSta(Action a)
        {
            Exception err = null;
            var t = new Thread(() => { try { a(); } catch (Exception e) { err = e; } finally { System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); } });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            Assert.True(t.Join(TimeSpan.FromMinutes(2)), "the window did not finish");
            if (err != null) throw new Exception("the window failed: " + err, err);
        }

        /// <summary>A window with every first-run step answered (extras: Not now), an Update check done ("Checked at").</summary>
        static AppUi Open()
        {
            var c = new Dictionary<string, ConsentAnswer>();
            foreach (var st in Consents.Steps()) Consents.SetAnswer(c, st.Id, st.Id == "extras" ? "decline" : "allow", 1);
            Consents.Save(Env.ConsentPath, c);
            var ui = new AppUi(new Run(), true);
            var w = ui.Window;
            w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
            w.Show(); ui.Pump();
            ui.SimCheck(new Waiting { CheckedAt = new DateTime(2026, 10, 2, 15, 42, 0) });
            ui.Pump();
            return ui;
        }

        [WindowsFact] public void Review_shows_Allow_all_Reset_all_and_Save_and_nothing_else()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = Open();
                    try
                    {
                        Assert.True(ui.UpdateShown); Assert.True(ui.UpdateLineShown);
                        var label = ui.UpdateLabel; var line = ui.UpdateLineText;
                        ui.PressReview(); ui.Pump();
                        Assert.True(ui.InReview);
                        Assert.True(ui.AllowAllShown); Assert.True(ui.ResetShown);
                        Assert.Equal("Save", ui.PlayLabel);
                        Assert.False(ui.UpdateShown); Assert.False(ui.UpdateLineShown); Assert.False(ui.PlayHintShown);
                        ui.Tick(); ui.Pump();   // nothing brings them back while the view is open
                        Assert.False(ui.UpdateShown); Assert.False(ui.UpdateLineShown);

                        ui.PressPlay(); ui.Pump();   // Save
                        Assert.False(ui.InReview);
                        Assert.Equal("idle", ui.ModeNow);
                        Assert.False(ui.RunStarted);   // no run, no game
                        Assert.Equal("Play", ui.PlayLabel); Assert.True(ui.PlayOpen);
                        Assert.False(ui.AllowAllShown); Assert.False(ui.ResetShown);
                        Assert.True(ui.UpdateShown); Assert.True(ui.UpdateLineShown);
                        Assert.Equal(label, ui.UpdateLabel); Assert.Equal(line, ui.UpdateLineText);
                        Assert.Equal(190, ui.PlayMinWidthNow);
                        Assert.Equal("decline", Consents.Read(Env.ConsentPath)["extras"].Answer);   // stored as answered
                    }
                    finally { ui.Window.Close(); }
                });
        }

        [WindowsFact] public void Allow_all_in_Review_stores_every_answer_and_goes_back_without_a_run()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = Open();
                    try
                    {
                        ui.PressReview(); ui.Pump();
                        ui.PressAllowAll(); ui.Pump();
                        Assert.False(ui.InReview);
                        Assert.False(ui.RunStarted);
                        Assert.Equal("allow", Consents.Read(Env.ConsentPath)["extras"].Answer);
                        Assert.True(ui.UpdateShown);
                    }
                    finally { ui.Window.Close(); }
                });
        }

        [WindowsFact] public void A_game_that_was_ready_is_still_ready_after_Save_and_Play_starts_it()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = Open();
                    try
                    {
                        ui.SimReady(false); ui.SimWaiting(); ui.Pump();
                        ui.PressReview(); ui.Pump();
                        ui.PressPlay(); ui.Pump();   // Save
                        Assert.Equal("ready", ui.ModeNow);
                        Assert.False(ui.GoSent);     // Save did not start it
                        Assert.Equal("Play", ui.PlayLabel); Assert.True(ui.PlayOpen);
                        ui.PressPlay();              // Play does, as before
                        Assert.True(ui.GoSent);
                    }
                    finally { ui.Window.Close(); }
                });
        }

        [WindowsFact] public void Leaving_for_another_tab_puts_the_Play_view_back_and_saves_nothing()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = Open();
                    try
                    {
                        ui.PressReview(); ui.Pump();
                        ui.PressTab("extras"); ui.PressTab("play"); ui.Pump();
                        Assert.False(ui.InReview);
                        Assert.Equal("Play", ui.PlayLabel);
                        Assert.True(ui.UpdateShown); Assert.True(ui.UpdateLineShown);
                        Assert.False(ui.ResetShown);
                        Assert.Equal("decline", Consents.Read(Env.ConsentPath)["extras"].Answer);   // unchanged
                    }
                    finally { ui.Window.Close(); }
                });
        }

        [WindowsFact] public void Nothing_is_cut_off_at_the_smallest_width_in_any_view()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = Open();
                    var w = ui.Window;
                    try
                    {
                        w.Width = w.MinWidth; ui.Pump(); w.UpdateLayout();
                        AssertRowFits(w, "the Play view");
                        ui.PressReview(); ui.Pump(); w.UpdateLayout();
                        AssertRowFits(w, "Review permissions");
                        ui.PressTab("play"); ui.PressAllowAll(); ui.Pump();
                        // the first-run cards: Allow all and Continue (the Update button stays out of them too)
                        ui.Consent = new Dictionary<string, ConsentAnswer>();
                        ui.ShowFirstRun(); ui.Tick(); ui.Pump(); w.UpdateLayout();
                        Assert.False(ui.UpdateShown);
                        AssertRowFits(w, "the first-run questions");
                    }
                    finally { w.Close(); }
                });
        }

        /// <summary>Every visible button of the bottom row lies wholly inside the Play tab and to the right of the links.</summary>
        static void AssertRowFits(Window w, string view)
        {
            var root = (FrameworkElement)w.Content;
            var links = (FrameworkElement)((FrameworkElement)w.FindName("ReviewLink")).Parent;
            var settings = (FrameworkElement)((FrameworkElement)w.FindName("SettingsLink")).Parent;
            double linksRight = Math.Max(Right(links, root), Right(settings, root));
            var tab = (FrameworkElement)w.FindName("Tabs");
            double tabRight = Right(tab, root);
            foreach (var n in new[] { "AllowAllButton", "ResetButton", "PlayButton", "UpdateButton" })
            {
                var b = (Button)w.FindName(n);
                if (b.Visibility != Visibility.Visible) continue;
                var left = b.TranslatePoint(new Point(0, 0), root).X;
                var right = left + b.ActualWidth;
                Assert.True(left >= linksRight, string.Format("{0}: {1} starts at {2:0} under the links (they end at {3:0})", view, n, left, linksRight));
                Assert.True(right <= tabRight, string.Format("{0}: {1} ends at {2:0}, past the tab's edge {3:0}", view, n, right, tabRight));
                Assert.True(b.ActualWidth >= b.DesiredSize.Width - 0.5, string.Format("{0}: {1} is squeezed", view, n));
            }
        }
        static double Right(FrameworkElement e, FrameworkElement root) => e.TranslatePoint(new Point(e.ActualWidth, 0), root).X;
    }
}

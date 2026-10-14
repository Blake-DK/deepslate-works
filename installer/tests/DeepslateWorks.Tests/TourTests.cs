using System;
using System.Linq;
using System.Threading;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.6.6 (Alex, 2026-10-14): the first-time guide.

    [Collection("env")]
    public class TourTests
    {
        [Fact] public void The_tour_walks_the_tabs_and_ends_on_the_keys()
        {
            var p = Tour.Pages(false);
            Assert.Equal(new[] { "play", "play", "play", "extras", "settings", "log", "play" }, p.Select(x => x.Tab).ToArray());
            Assert.Equal("Welcome to Deepslate Works", p[0].Title);
            Assert.True(p.Last().Keys); Assert.Equal("Got it", p.Last().Button);
            Assert.All(p.Take(p.Count - 1), x => { Assert.False(x.Keys); Assert.Equal("Next", x.Button); Assert.NotEmpty(x.Lines); });
            Assert.Contains(p.Last().Lines, l => l.StartsWith("` (top left"));
            Assert.Equal(p.Count - 1, Tour.SkipTo(p));
            var t = Tour.Pages(true);   // an admin's or a tester's: the Test tab too, before the keys
            Assert.Equal(p.Count + 1, t.Count);
            Assert.Equal("test", t[t.Count - 2].Tab);
            Assert.Equal("1 of 7", Tour.StepLine(0, 7));
        }

        [Fact] public void The_tour_is_shown_once_per_PC_and_again_for_a_new_version()
        {
            using (var s = new Scratch())
            {
                var f = s.P("settings.json");
                Assert.Null(AppSettings.TourSeen(f));
                Assert.True(Tour.Due(AppSettings.TourSeen(f)));
                AppSettings.SetWebsitePlay(AppSettings.Wait, f);
                AppSettings.SetTourSeen(Tour.Version, f);
                Assert.False(Tour.Due(AppSettings.TourSeen(f)));
                Assert.Equal(AppSettings.Wait, AppSettings.WebsitePlay(f));   // one setting never wipes another
                Assert.True(Tour.Due("3.6.5"));
            }
        }
    }

    [Collection("env")]
    public class TourWindowTests
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

        [WindowsFact] public void Play_waits_for_the_tour_and_opens_once_the_keys_are_confirmed()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = new AppUi(new Run(), true);
                    var w = ui.Window;
                    w.WindowStartupLocation = System.Windows.WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                    w.Show(); ui.Pump();
                    try
                    {
                        ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Up)), "ready");
                        ui.StartTour(); ui.Pump();
                        Assert.Equal("Welcome to Deepslate Works", ui.TourPageTitle);
                        Assert.True(ui.VotesBlock);
                        Assert.Equal(UiText.TourFirstButton, ui.PlayLabel);
                        ui.TourClickNext(); ui.Pump();
                        Assert.Equal("Play", ui.TourPageTitle);
                        ui.TourClickSkip(); ui.Pump();
                        Assert.Equal("New keys", ui.TourPageTitle);
                        ui.TourClickNext(); ui.Pump();   // Got it
                        Assert.Null(ui.TourPageTitle);
                        Assert.False(ui.VotesBlock);
                        Assert.True(ui.PlayOpen);
                        Assert.Equal("Play", ui.PlayLabel);
                        Assert.Equal(Tour.Version, AppSettings.TourSeen());
                    }
                    finally { ui.SimDone(); w.Close(); }
                });
        }
    }
}

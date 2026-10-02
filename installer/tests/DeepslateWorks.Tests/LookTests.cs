using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.4.0 (docs/21 §4, §8): the real window, off screen: the ground, the banner, the brand, the server pill, the badge.
    [Collection("env")]
    public class LookTests
    {
        const string Png64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

        static void OnSta(Action a)
        {
            Exception err = null;
            var t = new Thread(() => { try { a(); } catch (Exception e) { err = e; } finally { System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); } });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            Assert.True(t.Join(TimeSpan.FromMinutes(2)), "the window did not finish");
            if (err != null) throw new Exception("the window failed: " + err, err);
        }

        /// <summary>A window shown off screen, every first-run step answered; body runs, then it closes.</summary>
        static void WithWindow(Action<AppUi> body)
        {
            var c = new Dictionary<string, ConsentAnswer>();
            foreach (var st in Consents.Steps()) Consents.SetAnswer(c, st.Id, "allow", 1);
            Consents.Save(Env.ConsentPath, c);
            OnSta(() =>
            {
                var ui = new AppUi(new Run(), true);
                var w = ui.Window;
                w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                try { w.Show(); ui.Pump(); body(ui); }
                finally { w.Close(); }
            });
        }

        static void Resize(AppUi ui, double width, double height)
        {
            ui.Window.Width = width; ui.Window.Height = height;
            ui.Pump(); ui.Window.UpdateLayout(); ui.Pump();
        }

        static Color Of(string key) => Theme.ColorOf(key);

        [WindowsFact] public void Every_name_is_in_the_window()
        {
            using (new Scratch())
                WithWindow(ui => { foreach (var n in AppWindow.Names) Assert.NotNull(ui.Window.FindName(n)); });
        }

        [WindowsFact] public void The_ground_is_tiled_and_the_banner_shrinks_in_a_short_window()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    Assert.True(ui.GroundTiled);
                    Assert.True(ui.HeroPictured);
                    Resize(ui, 600, 740); Assert.Equal(160, ui.HeroHeightNow);
                    Resize(ui, 600, 600); Assert.Equal(110, ui.HeroHeightNow);
                    Resize(ui, 560, 560); Assert.Equal(110, ui.HeroHeightNow);
                    Resize(ui, 600, 740); Assert.Equal(160, ui.HeroHeightNow);
                });
        }

        [WindowsFact] public void Without_a_logo_the_brand_shows_the_drawn_tile()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    Assert.True(ui.BrandShown);
                    Assert.True(ui.LogoFallbackShown);
                    Assert.False(ui.BrandLogoShown);
                });
        }

        [WindowsFact] public void With_a_logo_the_brand_shows_it_and_hides_the_tile()
        {
            using (new Scratch())
            {
                Directory.CreateDirectory(Env.AppHome);
                File.WriteAllBytes(Path.Combine(Env.AppHome, Brand.LogoPngName), Convert.FromBase64String(Png64));
                Json.WriteFile(Path.Combine(Env.AppHome, Brand.MarkerName), J.O("hash", "0123456789ab", "name", "Deepslate Works", "tagline", "Friends only. Bring a pickaxe.", "pixel", true));
                WithWindow(ui =>
                {
                    Assert.True(ui.BrandShown);
                    Assert.True(ui.BrandLogoShown);
                    Assert.False(ui.LogoFallbackShown);
                });
            }
        }

        [WindowsFact] public void The_banner_pill_follows_the_server_line()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Up)), "idle"); ui.Pump();
                    Assert.Equal("Server is up · 2 playing", ui.HeroLineText); Assert.Equal(Of("GreenHi"), ui.HeroDotColour);
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Asleep)), "idle"); ui.Pump();
                    Assert.Equal("Server is asleep", ui.HeroLineText); Assert.Equal(Of("Dim"), ui.HeroDotColour);
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Waking)), "idle"); ui.Pump();
                    Assert.Equal("Waking, about 30 s", ui.HeroLineText); Assert.Equal(Of("Copper"), ui.HeroDotColour);
                    ui.SimSiteDown(); ui.Pump();
                    Assert.Equal("Can't reach the site", ui.HeroLineText); Assert.Equal(Of("Red"), ui.HeroDotColour);
                });
        }

        [WindowsFact] public void The_Vote_tab_has_a_badge_with_the_number_of_votes_waiting()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes)), "idle"); ui.Pump();
                    Assert.True(ui.VoteBadgeShown); Assert.Equal("2", ui.VoteBadgeNumber);
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Up)), "idle"); ui.Pump();
                    Assert.False(ui.VoteBadgeShown);
                });
        }

        [WindowsFact] public void The_question_and_settings_windows_are_dark_too()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    foreach (var d in new[] { ui.MakeAsk("Q", "Why", "All"), ui.MakeSettings() })
                    {
                        Assert.Equal(Of("Card"), ((SolidColorBrush)d.Background).Color);
                        Assert.NotNull(d.TryFindResource("Primary"));
                        Assert.NotNull(d.TryFindResource("Copper"));
                        d.Close();
                    }
                });
        }
    }
}

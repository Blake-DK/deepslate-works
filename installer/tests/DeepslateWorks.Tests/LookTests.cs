using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Automation.Peers;
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

        [WindowsFact] public void The_ground_is_tiled_and_the_banner_is_128_at_any_size()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    Assert.True(ui.GroundTiled);
                    Assert.True(ui.HeroPictured);
                    Resize(ui, 980, 620); Assert.Equal(128, ui.HeroHeightNow);
                    Resize(ui, 900, 560); Assert.Equal(128, ui.HeroHeightNow);
                    Assert.Equal(900, ui.Window.ActualWidth, 0); Assert.Equal(560, ui.Window.ActualHeight, 0);
                    Resize(ui, 600, 400); Assert.True(ui.Window.ActualWidth >= 900 && ui.Window.ActualHeight >= 560, "smaller than 900x560");
                });
        }

        [WindowsFact] public void The_Play_tab_is_two_columns_with_the_row_under_both()
        {
            // 3.4.1 (docs/21 §11): the server on the left (340), the run on the right, Play along the bottom
            using (new Scratch())
                WithWindow(ui =>
                {
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Up)), "ready");
                    foreach (var size in new[] { new Size(980, 620), new Size(900, 560) })
                    {
                        Resize(ui, size.Width, size.Height);
                        var w = ui.Window;
                        FrameworkElement F(string n) => (FrameworkElement)w.FindName(n);
                        Rect At(string n) { var e = F(n); return e.TransformToAncestor(w).TransformBounds(new Rect(0, 0, e.ActualWidth, e.ActualHeight)); }
                        Assert.Equal(340, F("PlayLeft").ActualWidth, 0);
                        Assert.True(At("PlayCard").Left >= At("PlayLeft").Right + 15, size + ": the card overlaps the left column");
                        Assert.True(At("ServerBox").Width >= 330, size + ": the server card does not fill its column");
                        Assert.True(At("PlayRow").Top >= At("PlayLeft").Bottom + 11 && At("PlayRow").Top >= At("PlayCard").Bottom + 11, size + ": the row is not under both columns");
                        Assert.True(At("PlayButton").Right <= At("PlayRow").Right + 0.5, size + ": Play is cut off");
                    }
                });
        }

        /// <summary>Every element in the window's visual tree, depth first.</summary>
        static IEnumerable<DependencyObject> Tree(DependencyObject root)
        {
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
            {
                var c = VisualTreeHelper.GetChild(root, i);
                yield return c;
                foreach (var d in Tree(c)) yield return d;
            }
        }

        /// <summary>The place a pixel-face element belongs to: the nearest named Button above it (a block's label and its
        /// drawn shadow, "Shade" in the template, belong to the button), else the nearest named TextBlock.</summary>
        static string Owner(DependencyObject d)
        {
            string text = null;
            for (var p = d; p != null; p = VisualTreeHelper.GetParent(p))
            {
                if (p is System.Windows.Controls.Button b && !string.IsNullOrEmpty(b.Name)) return b.Name;
                if (text == null && p is System.Windows.Controls.TextBlock t && !string.IsNullOrEmpty(t.Name)) text = t.Name;
            }
            return text ?? "(unnamed)";
        }

        [WindowsFact] public void The_pixel_face_is_in_exactly_three_places()
        {
            // 3.4.1 (docs/21 §11): the name on the banner (with its drawn shadow), the Play block and the Vote block. A
            // stand-in face (swapped into the window's resources, which every use reaches as a DynamicResource) makes it
            // visible whether or not the real one could be written out on this machine.
            {
                using (new Scratch())
                    WithWindow(ui =>
                    {
                        ui.Window.Resources["PixelFont"] = new FontFamily("Deepslate Look Test Face");
                        var owners = new HashSet<string>();
                        void Walk(params string[] tabs)
                        {
                            foreach (var tab in tabs)
                            {
                                ui.PressTab(tab); ui.Pump(); ui.Window.UpdateLayout();
                                foreach (var d in Tree(ui.Window))
                                {
                                    var f = (d as System.Windows.Controls.TextBlock)?.FontFamily ?? (d as System.Windows.Controls.Control)?.FontFamily;
                                    if (f != null && f.Source == "Deepslate Look Test Face") owners.Add(Owner(d));
                                }
                            }
                        }
                        // ready with nothing to vote on: Play's label is the short "Play"
                        ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Up)), "ready"); ui.Pump();
                        Walk("play", "extras", "log");
                        // two votes waiting: the Vote tab and its block (Play's label is then long, so Segoe UI)
                        ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes)), "ready"); ui.Pump();
                        Walk("play", "vote");
                        owners.Remove("BrandShade");   // the name's shadow is the name's place
                        Assert.Equal(new[] { "BrandName", "PlayButton", "VoteButton" }, owners.OrderBy(o => o, StringComparer.Ordinal).ToArray());
                    });
            }
        }

        [WindowsFact] public void A_long_block_label_is_Segoe_UI_and_a_short_one_keeps_the_face()
        {
            {
                using (new Scratch())
                    WithWindow(ui =>
                    {
                        ui.Window.Resources["PixelFont"] = new FontFamily("Deepslate Look Test Face");
                        var play = (System.Windows.Controls.Button)ui.Window.FindName("PlayButton");
                        play.Content = "Play"; ui.Pump();
                        Assert.Equal("Deepslate Look Test Face", play.FontFamily.Source);
                        play.Content = "Vote first, it takes ten seconds"; ui.Pump();
                        Assert.Equal("Segoe UI", play.FontFamily.Source); Assert.Equal(15, play.FontSize);
                    });
            }
        }

        [WindowsFact] public void The_vote_options_are_two_to_a_row()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes)), "ready"); ui.PressTab("vote"); ui.Pump(); ui.Window.UpdateLayout();
                    var body = (System.Windows.Controls.Panel)ui.Window.FindName("VoteBody");
                    var grid = body.Children.OfType<System.Windows.Controls.Primitives.UniformGrid>().Single();
                    Assert.Equal(2, grid.Columns);
                    Assert.True(grid.Children.Count >= 2);
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

        [WindowsFact] public void Step_4_the_cards_the_marks_and_the_log()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    // "Since last time" names the files under the line
                    ui.SimChanged("Updated 2 mods", "jade-15.8, tabtps-1.3 (removed)"); ui.Pump();
                    Assert.Equal("jade-15.8, tabtps-1.3 (removed)", ui.ChangedDetailNow);
                    ui.SimChanged("Updated 2 mods", null); ui.Pump();
                    Assert.Null(ui.ChangedDetailNow);
                    // the Update button's content stays the plain label; the template draws the mark
                    ui.SimCheck(new Waiting { ModsChanged = 2, CheckedAt = DateTime.Now }); ui.Pump();
                    Assert.Equal("● Update", ui.UpdateLabel);
                    // the vote's options are drawn boxes
                    ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes)), "ready"); ui.SimPick("o2"); ui.Pump();
                    Assert.Equal(4, ui.OptionBoxesDrawn);
                    // the Log tab: the last line in Fg
                    Log.Line("look test: the last line");
                    ui.PressTab("log"); ui.Pump();
                    Assert.Equal(Of("Fg"), ui.LastLogColour);
                });
        }

        /// <summary>Every UI Automation element under a peer, depth first (what windows-smoke-3.ps1 searches).</summary>
        static IEnumerable<AutomationPeer> Peers(AutomationPeer p)
        {
            foreach (var c in p.GetChildren() ?? new List<AutomationPeer>())
            {
                yield return c;
                foreach (var d in Peers(c)) yield return d;
            }
        }

        [WindowsFact] public void The_tabs_content_is_reachable_by_UI_Automation()
        {
            // the restyled tab strip once hid every button from UI Automation: the content host lacked its part name
            using (new Scratch())
                WithWindow(ui =>
                {
                    Assert.NotNull(ui.Tabs.Template.FindName("PART_SelectedContentHost", ui.Tabs));
                    var root = UIElementAutomationPeer.CreatePeerForElement(ui.Window);
                    var buttons = Peers(root).Where(p => p.GetClassName() == "Button").Select(p => p.GetName()).ToList();
                    Assert.Contains("Play", buttons);
                    Assert.Contains(buttons, n => n.StartsWith("✓") || n.StartsWith("●") || n == "Update");
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

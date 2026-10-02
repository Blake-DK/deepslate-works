using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Windows;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.4.0 (docs/21 §7): players' heads before "Online now". The site serves them; the app shows the grey placeholder
    // until the real one is there, and keeps it when it cannot be fetched.
    [Collection("env")]
    public class HeadsTests
    {
        const string Uuid = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
        const string Png64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

        [Fact] public void The_home_answer_carries_the_players_with_their_UUIDs()
        {
            var h = SiteHome.Parse(Json.Parse(HomeSamples.Up));
            Assert.Equal(new[] { "Bramble09", "samoyedx" }, h.Players.Select(p => p.Name).ToArray());
            Assert.Equal(Uuid, h.Players[0].Uuid);
            Assert.Null(h.Players[1].Uuid);   // a player the site has no UUID for: the placeholder, nothing fetched
            Assert.Equal(2, SiteHome.HeadsFor(h).Count);
        }

        [Fact] public void A_site_before_3_4_0_sends_names_only_and_the_heads_are_placeholders()
        {
            var h = SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes));   // "online" only
            Assert.Empty(h.Players);
            var heads = SiteHome.HeadsFor(h);
            Assert.Equal(new[] { "Bramble09", "m1_owl" }, heads.Select(p => p.Name).ToArray());
            Assert.All(heads, p => Assert.Null(p.Uuid));
            Assert.Empty(SiteHome.HeadsFor(SiteHome.Parse(Json.Parse(@"{ ""signedIn"": false }"))));
        }

        [Fact] public void Only_a_UUID_goes_into_a_heads_address()
        {
            Assert.True(SiteHome.IsUuid(Uuid));
            Assert.False(SiteHome.IsUuid("../../api/admin"));
            Assert.False(SiteHome.IsUuid("069a79f444e94726a5befca90e38aaf5"));
            Assert.False(SiteHome.IsUuid(null));
            var h = SiteHome.Parse(Json.Parse(HomeSamples.Up.Replace(Uuid, "../x")));
            Assert.Null(h.Players[0].Uuid);
            using (new Scratch()) Assert.Equal("https://deepslate.example/api/app/head/" + Uuid + ".png", SiteHome.HeadUrl(Uuid));
        }

        static void OnSta(Action a)
        {
            Exception err = null;
            var t = new Thread(() => { try { a(); } catch (Exception e) { err = e; } finally { System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); } });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            Assert.True(t.Join(TimeSpan.FromMinutes(2)), "the window did not finish");
            if (err != null) throw new Exception("the window failed: " + err, err);
        }

        [WindowsFact] public void The_placeholders_show_at_once_and_a_real_head_replaces_one_when_it_comes()
        {
            using (new Scratch())
            {
                var lines = new List<string>();
                Action<string> grab = l => { lock (lines) lines.Add(l); };
                Log.Written += grab;
                try
                {
                    OnSta(() =>
                    {
                        var ui = new AppUi(new Run(), true);
                        var w = ui.Window;
                        w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                        try
                        {
                            w.Show(); ui.Pump();
                            ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Up)), "idle"); ui.Pump();
                            Assert.Equal(2, ui.HeadsDrawn);
                            Assert.True(ui.HeadIsPlaceholder(0)); Assert.True(ui.HeadIsPlaceholder(1));
                            ui.SimGotHead(Uuid, Convert.FromBase64String(Png64)); ui.Pump();
                            Assert.False(ui.HeadIsPlaceholder(0)); Assert.True(ui.HeadIsPlaceholder(1));
                            ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Up)), "idle"); ui.Pump();   // the next round keeps it
                            Assert.False(ui.HeadIsPlaceholder(0));
                            ui.SimHeadFailed("11111111-2222-3333-4444-555555555555", "503");
                            ui.SimHeadFailed("11111111-2222-3333-4444-555555555555", "503");
                            ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Asleep)), "idle"); ui.Pump();
                            Assert.Equal(0, ui.HeadsDrawn);   // nobody online: no heads
                        }
                        finally { w.Close(); }
                    });
                }
                finally { Log.Written -= grab; }
                lock (lines) Assert.Single(lines, l => l.Contains("a player's head could not be fetched"));
            }
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.2.0 (planner 2026-10-02): the app as the front door, and votes before play.

    [Collection("env")]
    public class FrontDoorTests
    {
        static HomeInfo H(string json) => SiteHome.Parse(Json.Parse(json));

        [Fact] public void The_Play_tab_says_what_the_site_says_and_how_long_a_wake_takes()
        {
            var w = H(HomeSamples.Waking);
            Assert.True(w.SignedIn);
            Assert.True(w.Server.Waking);
            Assert.Equal("Waking the server, about 30 s", SiteHome.ServerLine(w.Server));
            w.Server.WakeLeftS = 12;
            Assert.Equal("Waking the server, about 12 s", SiteHome.ServerLine(w.Server));
            Assert.Equal("Nobody online right now.", SiteHome.OnlineLine(w));
            Assert.StartsWith("Season 1 starts Saturday", w.News.Body);
            var on = H(HomeSamples.TwoVotes);
            Assert.Equal("Online, 2 playing", SiteHome.ServerLine(on.Server));
            Assert.Equal("Online now: Bramble09, m1_owl", SiteHome.OnlineLine(on));
            Assert.Equal("GreenHi", Theme.ToneKey(on.Server.Tone));   // 3.4.0: a Theme key, no colour outside Theme.cs
        }

        [Fact] public void Only_an_admin_gets_Start_and_only_for_a_server_that_will_not_wake()
        {
            var off = H(HomeSamples.OffAdmin);
            Assert.True(off.Admin && off.Server.CanStart);
            Assert.Equal("Switched off", SiteHome.ServerLine(off.Server));
            var player = H(HomeSamples.OffAdmin.Replace("\"admin\": true", "\"admin\": false").Replace("\"canStart\": true", "\"canStart\": false"));
            Assert.False(player.Admin || player.Server.CanStart);
        }

        [Fact] public void Votes_come_oldest_first_and_keep_Play_shut_until_answered()
        {
            var h = H(HomeSamples.TwoVotes);
            Assert.Equal(new[] { "p1", "p2" }, h.Votes.Select(v => v.Id).ToArray());
            Assert.True(SiteHome.BlocksPlay(h));
            Assert.Equal("Vote first, it takes ten seconds", h.VoteFirstButton);
            Assert.False(SiteHome.BlocksPlay(H(HomeSamples.Waking)));
            Assert.False(SiteHome.BlocksPlay(new HomeInfo { SignedIn = false }));
            var p = h.Votes[0].Poll;
            Assert.Equal(4, p.Options.Count);
            Assert.Equal("Create", p.Options[2].ModName);
            Assert.Equal("Vote 1 of 2", SiteHome.StepLine(0, 2));
            Assert.Equal("Pick one. Open until 4 Oct, 19:00. You can change your vote on the site until it closes.", SiteHome.PickNote(p));
        }

        [Fact] public void The_countdown_waits_for_the_vote_whatever_else_says_go()
        {
            Assert.Equal("wait", PlayStart.Decide(true, false, AppSettings.Countdown, false, false, false, false, false, votesPending: true).Do);
            Assert.Equal("wait", PlayStart.Decide(false, true, AppSettings.Now, false, false, false, false, false, votesPending: true).Do);   // Play pressed
            Assert.Equal("countdown", PlayStart.Decide(true, false, AppSettings.Countdown, false, false, false, false, false, votesPending: false).Do);   // after voting: as normal
            Assert.Equal("wait", PlayStart.Decide(false, false, AppSettings.Countdown, false, false, false, false, false).Do);   // opened from the desktop: waits for Play
        }

        [Fact] public void Picking_one_several_or_I_dont_mind_on_its_own()
        {
            Assert.Equal(new[] { "o2" }, SiteHome.Pick(new List<string> { "o1" }, "o2", false, true));
            Assert.Equal(new[] { "o1", "o2" }, SiteHome.Pick(new List<string> { "o1" }, "o2", true, true));
            Assert.Equal(new[] { "dont-mind" }, SiteHome.Pick(new List<string> { "o1", "o2" }, "dont-mind", true, true));
            Assert.Equal(new[] { "o1" }, SiteHome.Pick(new List<string> { "dont-mind" }, "o1", true, true));
            Assert.Empty(SiteHome.Pick(new List<string> { "o1" }, "o1", true, false));
        }

        [Fact] public void A_vote_goes_to_the_site_with_this_PCs_sign_in_and_comes_back_with_the_results()
        {
            using (new Scratch())
            {
                Http.Token = "tok-123456789012345678901234";
                string url = null, body = null;
                Http.Fake = (m, u, b) => { url = u; body = b; return Tuple.Create(200, "{\"poll\":" + HomeSamples.Voted + "}"); };
                var p = SiteHome.Vote("p1", new[] { "o2" });
                Assert.Equal("https://deepslate.example/api/polls/p1/vote", url);
                Assert.Equal("{\"choices\":[\"o2\"]}", body);
                Assert.Equal(new[] { "o2" }, p.Mine);
                Assert.Equal(60, p.Counts.Single(c => c.Id == "o2").Percent);
                Assert.Equal(5, p.Voters);
                Http.Fake = (m, u, b) => Tuple.Create(409, "{\"error\":{\"code\":\"closed\",\"message\":\"This vote has closed.\"}}");
                var e = Assert.ThrowsAny<Exception>(() => SiteHome.Vote("p1", new[] { "o1" }));
                Assert.Equal("This vote has closed.", SiteHome.Why(e));
            }
        }

        [Fact] public void The_wake_says_it_came_from_the_app()
        {
            using (new Scratch())
            {
                Http.Token = "tok-123456789012345678901234";
                var calls = new List<string>();
                Http.Fake = (m, u, b) => { calls.Add(m + " " + u + " " + b); return Tuple.Create(202, "{\"result\":\"started\",\"wake\":{\"phase\":\"waking\"}}"); };
                Engine.Wake.Call("POST");
                SiteHome.Wake();
                Assert.Equal(new[] { "POST https://deepslate.example/api/play/wake {\"via\":\"app\"}", "POST https://deepslate.example/api/play/wake {\"via\":\"app\"}" }, calls.ToArray());
            }
        }

        [Fact] public void Opening_the_app_and_closing_it_without_playing_is_not_a_press_of_Play()
        {
            using (new Scratch())
            {
                var reports = new List<string>();
                Http.Fake = (m, u, b) => { if (u.EndsWith("/api/installer/report")) reports.Add(b); return Tuple.Create(200, "{}"); };
                var opened = new Run { Token = "tok-123456789012345678901234", OpenedOnly = true, Mode = "play", WaitForGo = () => false };
                Assert.False(Engine.WaitForGo(opened));
                Assert.True(opened.Reported);
                Assert.Empty(reports);
                var updated = new Run { Token = "tok-123456789012345678901234", OpenedOnly = true, Mode = "update", WaitForGo = () => false };
                Assert.False(Engine.WaitForGo(updated));   // something changed: that is reported, as before
                Assert.Single(reports);
                var played = new Run { Token = "tok-123456789012345678901234", OpenedOnly = true, Mode = "play", WaitForGo = () => true };
                Assert.True(Engine.WaitForGo(played));     // opened, then Play: counts as pressing Play (the report at launch)
                Assert.Equal(2, reports.Count);
                Assert.Contains("\"outcome\":\"ok\"", reports[1]);
            }
        }
    }

    [Collection("env")]
    public class FrontDoorWindowTests
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

        static AppUi Window()
        {
            var ui = new AppUi(new Run(), true);
            var w = ui.Window;
            w.WindowStartupLocation = System.Windows.WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
            w.Show(); ui.Pump();
            return ui;
        }

        [WindowsFact] public void The_Vote_screen_comes_first_and_Play_stays_shut_until_every_vote_is_answered()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = Window();
                    try
                    {
                        ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes)), "ready");
                        ui.Pump();
                        Assert.True(ui.OnVoteTab);
                        Assert.Equal("What's the next boss?", ui.VoteQuestion);
                        Assert.False(ui.PlayOpen);
                        Assert.Equal("Vote first, it takes ten seconds", ui.PlayLabel);
                        ui.Tick();   // nothing turns it back on while the vote waits
                        Assert.False(ui.PlayOpen);
                        ui.SimVoted(SiteHome.ParsePoll(Json.Parse(HomeSamples.Voted)));
                        Assert.Equal("Next vote", ui.VoteButtonLabel);
                        Assert.False(ui.PlayOpen);   // the second one still waits
                        ui.Next();
                        Assert.Equal("Which mods should we add next?", ui.VoteQuestion);
                        ui.SimVoted(SiteHome.ParsePoll(Json.Parse(HomeSamples.Voted)));
                        Assert.Equal("Go to Play", ui.VoteButtonLabel);
                        ui.Next();
                        Assert.False(ui.OnVoteTab);
                        Assert.True(ui.PlayOpen);
                        Assert.Equal("Play", ui.PlayLabel);
                    }
                    finally { ui.Window.Close(); }
                });
        }

        [WindowsFact] public void The_Play_tab_shows_the_server_and_an_admin_gets_Start()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = Window();
                    try
                    {
                        ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.Waking)), "ready");
                        Assert.Equal("Waking the server, about 30 s", ui.ServerLineShown);
                        Assert.True(ui.PlayOpen);   // the game still loads while the server wakes
                        Assert.False(ui.StartShown);
                        ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.OffAdmin)), "idle");
                        Assert.Equal("Switched off", ui.ServerLineShown);
                        Assert.True(ui.StartShown);
                    }
                    finally { ui.Window.Close(); }
                });
        }
    }
}

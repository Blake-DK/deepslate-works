using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.6.1: the Play tab and the Test tab, one view each with a target. These are the pure parts; the window itself is
    // proven by installer/tests/windows-tabs.ps1 on the Windows runner.

    [Collection("env")]
    public class TabsTests
    {
        const string StandIn = "http://127.0.0.1:47123";

        [Fact] public void AsLink_opens_a_test_run_as_the_Play_link_does_only_against_the_stand_in_site()
        {
            var a = Args.Parse(new[] { "-Root", @"C:\scratch", "-From", "desktop", "-AsLink" });
            Assert.True(a.AsLink);
            Assert.True(Args.TestLink(a, true, StandIn));
            Assert.False(Args.TestLink(a, false, StandIn));                             // not a test run (no -Root)
            Assert.False(Args.TestLink(a, true, "https://deepslate.dsw.test"));         // any other site
            Assert.False(Args.TestLink(a, true, "http://localhost:47123"));
            Assert.False(Args.TestLink(a, true, "http://127.0.0.1.example.com:80"));
            Assert.False(Args.TestLink(a, true, "http://127.0.0.1:47123/elsewhere"));
            Assert.False(Args.TestLink(Args.Parse(new[] { "-Root", @"C:\scratch" }), true, StandIn));   // not asked for
        }

        [Fact] public void A_real_link_that_carries_AsLink_gets_nothing_from_it()
        {
            var a = Args.Parse(new[] { "deepslate://play", "-AsLink", "-Root", @"C:\scratch" });
            Assert.Equal("deepslate://play", a.Link);
            Assert.False(a.AsLink);
            Assert.Equal("", a.Root);
            Assert.False(Args.TestLink(a, true, StandIn));
            var b = Args.Parse(new[] { "-AsLink", "deepslate://play" });
            Assert.False(b.AsLink);
            Assert.False(Args.TestLink(b, true, StandIn));
        }

        [Fact] public void The_Test_tabs_card_is_the_test_server_in_the_sites_own_words_even_a_state_this_app_does_not_know()
        {
            var t = SiteHome.ParseTestSection((JObj)Json.Parse("{\"available\":true,\"state\":\"upkeep\",\"players\":2,\"address\":\"lab.dsw.test\",\"pack\":\"0.1.0+test\",\"serverPack\":\"0.1.0+test\","
                + "\"server\":{\"state\":\"upkeep\",\"line\":\"Closed for upkeep\",\"label\":\"Upkeep\",\"tone\":\"neutral\",\"hint\":\"Back soon.\",\"canStart\":false}}"));
            Assert.True(t.Available);
            Assert.Equal("upkeep", t.Server.State);
            Assert.Equal("Closed for upkeep", SiteHome.ServerLine(t.Server));
            Assert.Equal("Back soon.", t.Server.Hint);
            Assert.Equal(2, t.Players);
            Assert.Equal("0.1.0+test", t.Pack);
            // a site from before 3.6.1 sends the state only
            var old = SiteHome.ParseTestSection((JObj)Json.Parse("{\"available\":true,\"state\":\"asleep\",\"players\":0,\"address\":null,\"pack\":\"0.1.0+test\",\"serverPack\":null}"));
            Assert.Equal("Asleep, join to wake it", SiteHome.ServerLine(old.Server));
            Assert.True(old.Server.Asleep);
            var unknown = SiteHome.ParseTestSection((JObj)Json.Parse("{\"available\":true,\"state\":\"upkeep\",\"players\":0}"));
            Assert.Equal("upkeep", SiteHome.ServerLine(unknown.Server));
            // the test stack off or out of reach: the site's reason, and Play test shut
            var off = SiteHome.ParseTestSection((JObj)Json.Parse("{\"available\":false,\"reason\":\"The site can't reach the test server right now.\"}"));
            Assert.False(off.Available);
            Assert.Equal("The site can't reach the test server right now.", SiteHome.ServerLine(off.Server));
            Assert.False(SiteHome.ParseTestSection(null, true).Available);
        }

        [Fact] public void Each_tab_says_which_server_it_shows_and_the_footer_and_pill_follow_it()
        {
            Assert.Equal("Live server", UiText.LiveServerName);
            Assert.Equal("Test server", UiText.TestServerName);
            var f = Footer.TestParts("3.6.1", null, "0.1.0+test", "Online");
            Assert.Equal("Test pack 0.1.0+test, not installed yet", f.Pack);
            Assert.Equal("Test server: Online", f.Server);
            Assert.Equal("Test pack 0.1.0+test", Footer.TestParts("3.6.1", "0.1.0+test", "0.1.0+test", null).Pack);
            Assert.Equal("Test server: ?", Footer.TestParts("3.6.1", "0.1.0+test", "0.1.0+test", null).Server);
            Assert.Equal("Pack 0.1.0+smoke", Footer.Parts("3.6.1", "0.1.0+smoke", "0.1.0+smoke", "Online").Pack);   // the Play tab's, as before
            var h = new HomeInfo { SignedIn = true, Server = new ServerInfo { State = "online", Line = "Online" } };
            Assert.Equal("Test server is up · 1 playing", SiteHome.HeroLine(h, 1, UiText.TestServerName));
            Assert.Equal("Server is up", SiteHome.HeroLine(h));   // the Play tab's, as before
        }

        [Fact] public void Start_names_the_live_server_on_the_button_and_in_the_question()
        {
            Assert.Equal("Start live server", UiText.StartLiveButton);
            Assert.StartsWith("Start the live server?", UiText.StartServerQuestion);
        }

        [Fact] public void A_run_that_only_waited_and_was_ended_for_the_other_servers_Play_sends_no_report()
        {
            using (new Scratch())
            {
                var run = new Run { Token = "t", WaitForGo = () => false, Switched = true, Mode = "play" };
                Assert.False(Engine.WaitForGo(run));
                Assert.True(run.Reported);
                Assert.Contains(Log.RunLines, l => l.Contains("ended so the other server's game could start: no report"));
                Assert.DoesNotContain(Log.RunLines, l => l.Contains("install report sent"));
            }
        }

        [Fact] public void Only_a_test_run_against_the_stand_in_site_skips_the_Minecraft_Launcher()
        {
            using (new Scratch())
            {
                Env.PortalUrl = StandIn;
                Assert.True(Env.StandIn);
                Env.PortalUrl = "https://deepslate.dsw.test";
                Assert.False(Env.StandIn);
                Env.CustomRoot = false; Env.PortalUrl = StandIn;
                Assert.False(Env.StandIn);
            }
        }
    }
}

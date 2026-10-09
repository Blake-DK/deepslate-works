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

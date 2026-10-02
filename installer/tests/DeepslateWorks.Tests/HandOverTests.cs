using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>3.1.0 (planner, 2026-10-02, A): the guided setup after the old launcher. Move over ticks every line, keeps
    /// what the old launcher saved, and removes the old launcher only after this app's own install checked out; a move
    /// cut off half-way carries on.</summary>
    [Collection("env")]
    public class HandOverTests : HomeTestBase
    {
        string wh, exe;
        FileHomeIo io;
        const string ConsentJson = "{\"version\":1,\"steps\":{\"extras\":{\"answer\":\"allow\",\"level\":1,\"at\":\"2026-10-01T12:00:00\"},\"reports\":{\"answer\":\"decline\",\"level\":1,\"at\":\"2026-10-01T12:00:00\"},\"shortcuts\":{\"answer\":\"allow\",\"level\":1,\"at\":\"2026-10-01T12:00:00\"}}}";
        const string ExtrasJson = "{\"version\":1,\"choices\":{\"iris\":true},\"shader\":\"light\"}";

        /// <summary>A PC on the old launcher 2.2.0 that just fetched the app: its files, its Play link and shortcuts
        /// (through the .vbs shim), its answers and extras, its sign-in and pack, and handover.json.</summary>
        void OldLauncherPc(bool links = true)
        {
            wh = Env.AppHome;
            Write(Path.Combine(wh, "DeepslateWorks.ps1"), "# Deepslate Works\n$InstallerVersion = \"2.2.0\"   # asks first\n");
            foreach (var f in new[] { "DeepslateWorks.ps1.bak", "DeepslateWorks.vbs", "DeepslateWorks.ico" }) Write(Path.Combine(wh, f), "old");
            Write(Env.ConsentPath, links ? ConsentJson : ConsentJson.Replace("\"shortcuts\":{\"answer\":\"allow\"", "\"shortcuts\":{\"answer\":\"decline\""));
            Write(Env.ExtrasStatePath, ExtrasJson);
            Write(Env.TokenFile, "{\"token\":\"t0k\",\"savedAt\":\"2026-10-01T12:00:00\"}");
            Write(Env.InstalledFile, "{\"version\":\"0.1.0+43978c76\",\"hash\":\"abc\",\"installer\":\"2.2.0\"}");
            exe = Write(Path.Combine(wh, "DeepslateWorks.exe"), "MZ 3.1");
            Write(HandOverState.PathIn(wh), "{\"version\":1,\"from\":\"2.2.0\",\"app\":\"3.1.0\",\"sha256\":\"" + Home.Sha256(exe) + "\",\"state\":\"downloaded\",\"at\":\"2026-10-02T06:00:00Z\",\"steps\":{}}");
            io = new FileHomeIo(S.P("registry and shortcuts"));
            var vbs = Path.Combine(wh, "DeepslateWorks.vbs");
            File.WriteAllText(Path.Combine(io.At, "handler.txt"), "\"C:\\Windows\\System32\\wscript.exe\" \"" + vbs + "\" \"%1\"");
            foreach (var n in new[] { "Desktop.lnk", "Programs.lnk", "Uninstall.lnk" }) File.WriteAllText(Path.Combine(io.At, n), "\"C:\\Windows\\System32\\wscript.exe\" \"" + vbs + "\" -From desktop");
        }

        HandOver.Context Ctx(bool links = true) => new HandOver.Context { Me = exe, Dir = wh, Io = io, Links = links, Consent = Consents.Read(Env.ConsentPath) };

        [Fact] public void Move_over_ticks_every_line_and_removes_the_old_launcher_only_after_the_check()
        {
            OldLauncherPc();
            var items = HandOver.NewItems();
            var seen = new List<string>();
            Assert.True(HandOver.MoveOver(items, Ctx(), it => seen.Add(it.Id + ":" + it.Status)));
            Assert.All(items, it => Assert.Equal("ok", it.Status));
            // in order, each line first "doing" then done; the check before the clean-up
            Assert.Equal(new[] { "copy", "link", "shortcuts", "apps", "carry", "verify", "cleanup" }, seen.Where(x => x.EndsWith(":ok")).Select(x => x.Split(':')[0]));
            Assert.True(seen.IndexOf("verify:ok") < seen.IndexOf("cleanup:doing"));
            Assert.Equal(Home.HandlerCommand(exe), File.ReadAllText(Path.Combine(io.At, "handler.txt")));
            Assert.True(io.ShortcutsThere(exe));
            Assert.True(io.Listed(exe));
            Assert.Empty(HandOver.OldLauncherFiles(wh));
            Assert.Equal("DeepslateWorks.ps1, DeepslateWorks.ps1.bak, DeepslateWorks.vbs, DeepslateWorks.ico", items.Single(i => i.Id == "cleanup").Detail);
            Assert.Equal(HandOverState.Moved, HandOverState.Read(wh).State);
        }

        [Fact] public void What_the_old_launcher_saved_is_carried_over_untouched()
        {
            OldLauncherPc();
            var before = new[] { Env.ConsentPath, Env.ExtrasStatePath, Env.TokenFile, Env.InstalledFile }.Select(File.ReadAllText).ToList();
            var items = HandOver.NewItems();
            Assert.True(HandOver.MoveOver(items, Ctx()));
            var after = new[] { Env.ConsentPath, Env.ExtrasStatePath, Env.TokenFile, Env.InstalledFile }.Select(File.ReadAllText).ToList();
            Assert.Equal(before, after);
            Assert.Equal("Kept: 3 permission answers, your extras, your sign-in, pack 0.1.0+43978c76", items.Single(i => i.Id == "carry").Detail);
            var c = Consents.Read(Env.ConsentPath);
            Assert.Equal("decline", c["reports"].Answer);
            Assert.Equal("allow", c["extras"].Answer);
            Assert.True(J.Bool(J.Obj(Json.ReadFile(Env.ExtrasStatePath), "choices"), "iris"));
        }

        [Fact] public void A_file_that_is_there_but_unreadable_stops_the_carry_over_with_why()
        {
            OldLauncherPc();
            File.WriteAllText(Env.ConsentPath, "{not json");
            var r = HandOver.CarriedOver(new Dictionary<string, ConsentAnswer>());
            Assert.Equal("consent.json is there but cannot be read", r.Problem);
            File.WriteAllText(Env.ConsentPath, ConsentJson);
            File.WriteAllText(Env.TokenFile, "{}");
            Assert.Equal("the sign-in file is there but has no sign-in in it", HandOver.CarriedOver().Problem);
        }

        [Fact] public void A_check_that_fails_keeps_the_old_launcher_and_Retry_finishes_the_rest()
        {
            OldLauncherPc();
            io.SetHandlerFn = e => false;   // Windows does not keep the Play link
            var items = HandOver.NewItems();
            Assert.False(HandOver.MoveOver(items, Ctx()));
            Assert.Equal("failed", items.Single(i => i.Id == "link").Status);
            Assert.Equal("failed", items.Single(i => i.Id == "verify").Status);
            Assert.Contains("Play button", items.Single(i => i.Id == "verify").Detail);
            Assert.Equal("Waiting for the check above", items.Single(i => i.Id == "cleanup").Detail);
            Assert.True(File.Exists(Path.Combine(wh, "DeepslateWorks.ps1")));   // the old launcher still works
            Assert.True(File.Exists(Path.Combine(wh, "DeepslateWorks.vbs")));
            Assert.Equal(HandOverState.Moving, HandOverState.Read(wh).State);
            Assert.True(HandOverState.Pending(wh));
            // Retry: only what is not done runs again
            io.SetHandlerFn = null;
            var again = new List<string>();
            Assert.True(HandOver.MoveOver(items, Ctx(), it => { if (it.Status == "doing") again.Add(it.Id); }));
            Assert.Equal(new[] { "link", "verify", "cleanup" }, again);
            Assert.Empty(HandOver.OldLauncherFiles(wh));
        }

        [Fact] public void Not_now_to_the_Play_button_keeps_the_one_the_old_launcher_had()
        {
            OldLauncherPc(links: false);
            var items = HandOver.NewItems();
            Assert.True(HandOver.MoveOver(items, Ctx(links: false)));
            Assert.Equal(UiText.MoveKeptLink, items.Single(i => i.Id == "link").Detail);
            Assert.Equal("skipped", items.Single(i => i.Id == "shortcuts").Status);
            // never a link to a file the clean-up removed
            Assert.Equal(Home.HandlerCommand(exe), File.ReadAllText(Path.Combine(io.At, "handler.txt")));
            Assert.Empty(HandOver.OldLauncherFiles(wh));
        }

        [Fact] public void An_interrupted_move_carries_on_where_it_stopped()
        {
            OldLauncherPc();
            Assert.True(HandOverState.Pending(wh));
            Assert.Equal(1, HandOverState.Read(wh).FirstStep);    // fetched, nothing moved: from Welcome
            var st = HandOverState.Read(wh); st.State = HandOverState.Moving; st.Save(wh);
            Assert.True(HandOverState.Pending(wh));
            Assert.Equal(1, HandOverState.Read(wh).FirstStep);    // cut off during Move over: again, from the start
            st.State = HandOverState.Moved; st.Save(wh);
            Assert.True(HandOverState.Pending(wh));
            Assert.Equal(3, HandOverState.Read(wh).FirstStep);    // moved, the last steps not seen: from Permissions
            HandOver.Finish(wh);
            Assert.False(HandOverState.Pending(wh));
            Assert.Equal("2.2.0", HandOverState.Read(wh).From);   // the rest of the file is kept
            File.Delete(HandOverState.PathIn(wh));
            Assert.False(HandOverState.Pending(wh));
        }

        [Fact] public void The_hand_over_flag_and_2_1_3s_flag_both_open_the_guided_setup()
        {
            Assert.Equal("2.2.0", Args.Parse(new[] { "-From", "update", "-HandOver", "2.2.0", "-WaitFor", "42" }).MigratedFrom);
            Assert.Equal("2.1.3", Args.Parse(new[] { "-From", "update", "-MigratedFrom", "2.1.3" }).MigratedFrom);
            Assert.Equal("", Args.Parse(new[] { "deepslate://play", "-HandOver", "2.2.0" }).MigratedFrom);   // never from a link
        }
    }

    /// <summary>3.1.0 (planner, 2026-10-02, B): Play with a countdown.</summary>
    [Collection("env")]
    public class PlayStartTests : IDisposable
    {
        readonly Scratch S = new Scratch();
        public void Dispose() => S.Dispose();

        static PlayStart.Decision D(bool web = true, bool pressed = false, string setting = AppSettings.Countdown, bool first = false, bool handOver = false, bool perm = false, bool extras = false, bool queued = false)
            => PlayStart.Decide(web, pressed, setting, first, handOver, perm, extras, queued);

        [Fact] public void From_the_website_with_everything_ready_it_counts_down()
            => Assert.Equal("countdown", D().Do);

        [Fact] public void From_the_desktop_or_the_Start_Menu_only_the_Play_button()
        {
            var d = D(web: false);
            Assert.Equal("wait", d.Do);
            Assert.Contains("desktop", d.Why);
        }

        [Fact] public void Pressing_Play_or_Continue_starts_it_as_soon_as_it_is_ready()
        {
            Assert.Equal("now", D(pressed: true).Do);
            Assert.Equal("now", D(web: false, pressed: true, first: true).Do);
        }

        [Fact] public void No_countdown_on_a_first_run_after_a_hand_over_or_with_something_to_look_at()
        {
            Assert.Equal("wait", D(first: true).Do);
            Assert.Equal("wait", D(handOver: true).Do);
            Assert.Equal("wait", D(perm: true).Do);
            Assert.Equal("wait", D(extras: true).Do);
            Assert.Equal("wait", D(queued: true).Do);
            Assert.Equal("first run, new extras to look at", D(first: true, extras: true).Why);
            // and the setting does not override those
            Assert.Equal("wait", D(setting: AppSettings.Now, handOver: true).Do);
        }

        [Fact] public void The_setting_wait_or_straight_away()
        {
            Assert.Equal("wait", D(setting: AppSettings.Wait).Do);
            Assert.Equal("now", D(setting: AppSettings.Now).Do);
        }

        [Fact] public void The_setting_is_5_seconds_until_changed_and_is_remembered()
        {
            Assert.Equal(AppSettings.Countdown, AppSettings.WebsitePlay());
            AppSettings.SetWebsitePlay(AppSettings.Wait);
            Assert.Equal(AppSettings.Wait, AppSettings.WebsitePlay());
            File.WriteAllText(AppSettings.Path, "{\"websitePlay\":\"launch-rockets\"}");
            Assert.Equal(AppSettings.Countdown, AppSettings.WebsitePlay());   // anything else is the default
            Assert.Throws<ArgumentException>(() => AppSettings.SetWebsitePlay("soon"));
            Assert.Equal(new[] { "Start after 5 seconds", "Wait for me to press Play", "Start straight away" }, UiText.WebsitePlayLabels.Select(l => l.Value));
        }

        [Fact] public void The_countdown_launches_at_0()
        {
            var c = new Countdown();
            Assert.Equal("Starting the game in 5\u2026", c.ButtonText);
            for (int i = 4; i >= 1; i--) { Assert.False(c.Tick()); Assert.Equal(string.Format("Starting the game in {0}\u2026", i), c.ButtonText); }
            Assert.True(c.Tick());
            Assert.True(c.Fired);
            Assert.False(c.Running);
            Assert.False(c.Tick());   // once only
        }

        [Theory]
        [InlineData("a click")]
        [InlineData("a key")]
        [InlineData("a tab switch")]
        [InlineData("a setting")]
        public void A_click_a_key_a_tab_switch_or_a_setting_stops_it_for_good(string by)
        {
            var c = new Countdown();
            c.Tick(); c.Tick();
            Assert.True(c.Cancel(by));
            Assert.Equal(by, c.CancelledBy);
            Assert.Equal("Play", c.ButtonText);
            for (int i = 0; i < 10; i++) Assert.False(c.Tick());   // never restarts by itself
            Assert.False(c.Fired);
            Assert.False(c.Cancel("again"));
        }

        // planner B8: "pressed Play" (the report Play first counts from) goes when the game is started, not when the app opens
        [Fact] public void The_report_is_sent_when_the_game_is_started()
        {
            var seq = new List<string>();
            Http.Fake = (m, u, b) =>
            {
                if (u.EndsWith("/api/installer/report")) { seq.Add("report " + J.Str(Json.Parse(b), "outcome")); return Tuple.Create(200, "{\"ok\":true}"); }
                return null;
            };
            var run = new Run { Mode = "play", PackSeen = "0.1.0+43978c76", Token = "t0k" };
            run.Sink = l => { if (J.Str(l, "t") == "ready") seq.Add("ready"); };
            run.WaitForGo = () => { seq.Add("countdown"); return true; };
            Assert.True(Engine.WaitForGo(run));
            seq.Add("launch");
            Assert.Equal(new[] { "ready", "countdown", "report ok", "launch" }, seq);
        }

        [Fact] public void Closed_while_ready_says_so_and_does_not_count_as_Play()
        {
            string body = null;
            Http.Fake = (m, u, b) => { if (u.EndsWith("/api/installer/report")) { body = b; return Tuple.Create(200, "{}"); } return null; };
            var run = new Run { Mode = "update", PackSeen = "0.1.0+43978c76", Token = "t0k", WaitForGo = () => false };
            Assert.False(Engine.WaitForGo(run));
            Assert.Equal("cancelled", J.Str(Json.Parse(body), "outcome"));
            Assert.Equal("Waiting for you to press Play", J.Str(Json.Parse(body), "failedStep"));
        }

        [Fact] public void Without_a_window_it_starts_as_soon_as_it_is_ready()
        {
            var sent = 0;
            Http.Fake = (m, u, b) => { if (u.EndsWith("/api/installer/report")) { sent++; return Tuple.Create(200, "{}"); } return null; };
            var run = new Run { Mode = "play", PackSeen = "x", Token = "t0k" };
            Assert.True(Engine.WaitForGo(run));
            Assert.Equal(1, sent);
        }
    }
}

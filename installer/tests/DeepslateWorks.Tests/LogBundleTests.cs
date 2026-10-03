using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.4.2 (Alex, 2026-10-03): Save log, Send to Alex, and the logs that go by themselves. Home/LogBundle.cs.
    [Collection("env")]
    public class LogBundleTests
    {
        static string GameDir => Env.DataDir;

        static void GameLog(params string[] lines)
        {
            Directory.CreateDirectory(Path.Combine(GameDir, "logs"));
            File.WriteAllLines(Path.Combine(GameDir, "logs", "latest.log"), lines);
        }

        [Fact] public void Chat_lines_are_left_out_of_the_game_log_and_the_rest_is_redacted()
        {
            using (new Scratch())
            {
                Report.SetPersonal(new[] { "bramble09" });
                var text = LogBundle.CleanGameLog(new[]
                {
                    "[09:41:20] [Render thread/INFO] [net.minecraft.client.gui.components.ChatComponent/]: [CHAT] <Pabulum> meet me at the base, code 4417",
                    "[09:41:21] [Server thread/INFO] [minecraft/MinecraftServer]: <KaneFinch> hello",
                    "[09:41:22] [main/ERROR] [net.neoforged.fml.ModLoader/]: Failed to create mod instance. ModID: sodium",
                    "[09:41:23] [main/INFO]: Loading from C:\\Users\\bramble09\\AppData\\Roaming\\.minecraft-deepslate-works",
                });
                Assert.DoesNotContain("meet me", text);
                Assert.DoesNotContain("hello", text);
                Assert.Contains("Failed to create mod instance. ModID: sodium", text);
                Assert.DoesNotContain("bramble09", text);
                Assert.Contains("[2 chat lines left out]", text);
                Report.SetPersonal(new string[0]);
            }
        }

        [Fact] public void Save_log_writes_a_zip_with_the_apps_log_the_games_log_and_the_newest_crash_report()
        {
            using (var s = new Scratch())
            {
                File.WriteAllLines(Env.LogFile, new[] { "[2026-10-03T09:41:05] started: Deepslate Works 3.4.2", "[2026-10-03T09:41:06] ERROR: something" });
                GameLog("[09:41:22] [main/ERROR]: Failed to create mod instance", "[09:41:23] [CHAT] <Pabulum> private");
                Directory.CreateDirectory(Path.Combine(GameDir, "crash-reports"));
                File.WriteAllText(Path.Combine(GameDir, "crash-reports", "crash-2026-10-03_09.41.30-client.txt"), "---- Minecraft Crash Report ----");
                var path = LogBundle.Save(s.P("Downloads"), new DateTime(2026, 10, 3, 9, 45, 0));
                Assert.Equal("Deepslate Works logs 2026-10-03 09-45.zip", Path.GetFileName(path));
                using (var z = ZipFile.OpenRead(path))
                {
                    var names = z.Entries.Select(e => e.FullName).ToList();
                    Assert.Equal(new[] { "deepslate-works.log", "game-latest.log", "game-crash-2026-10-03_09.41.30-client.txt" }, names);
                    using (var r = new StreamReader(z.GetEntry("game-latest.log").Open())) { var t = r.ReadToEnd(); Assert.Contains("Failed to create mod instance", t); Assert.DoesNotContain("private", t); }
                }
            }
        }

        [Fact] public void Send_to_Alex_posts_a_log_sent_report_even_with_reports_off()
        {
            using (new Scratch())
            {
                Http.Token = "tok-123";
                File.WriteAllLines(Env.LogFile, new[] { "[2026-10-03T09:41:05] started: Deepslate Works 3.4.2" });
                GameLog("[09:41:22] [main/ERROR]: Failed to create mod instance");
                string url = null, body = null;
                Http.Fake = (m, u, b) => { url = u; body = b; return Tuple.Create(200, "{\"ok\":true}"); };
                Assert.Null(LogBundle.Send("0.1.0+c99f2aae"));
                Assert.EndsWith("/api/installer/report", url);
                var j = Json.Parse(body);
                Assert.Equal("log_sent", J.Str(j, "mode"));
                Assert.Contains("===== deepslate-works.log =====", J.Str(j, "log"));
                Assert.Contains("===== game-latest.log =====", J.Str(j, "log"));
                Assert.DoesNotContain("tok-123", body);
            }
        }

        [Fact] public void Send_to_Alex_says_so_when_this_PC_is_not_signed_in()
        {
            using (new Scratch())
            {
                bool called = false;
                Http.Fake = (m, u, b) => { called = true; return Tuple.Create(200, "{}"); };
                Assert.Contains("isn't signed in", LogBundle.Send("x"));
                Assert.False(called);
            }
        }

        [Fact] public void A_run_that_never_reported_is_sent_by_the_next_one_with_its_own_lines()
        {
            using (new Scratch())
            {
                var first = new Run { Started = new DateTime(2026, 10, 3, 9, 41, 5), Mode = "play" };
                File.WriteAllLines(Env.LogFile, new[]
                {
                    "[2026-10-03T09:30:00] started: Deepslate Works 3.4.1 (an older run)",
                    "[2026-10-03T09:41:05] started: Deepslate Works 3.4.1",
                    "[2026-10-03T09:41:11] mods: 51 to check",
                    "[2026-10-03T09:42:00] started: Deepslate Works 3.4.2",
                    "[2026-10-03T09:42:01] this run",
                });
                LogBundle.Opened(first);   // ... and the window was closed by Task Manager: no report, the marker stays
                var second = new Run { Started = new DateTime(2026, 10, 3, 9, 42, 0), Mode = "play" };
                LogBundle.Opened(second);
                Assert.True(File.Exists(Path.Combine(Env.AppHome, LogBundle.UnreportedName)));
                var posts = new List<string>();
                Http.Token = "tok";
                Http.Fake = (m, u, b) => { posts.Add(b); return Tuple.Create(200, "{}"); };
                Report.Send(second, "ok");
                Assert.Equal(2, posts.Count);
                var unfinished = Json.Parse(posts[0]);
                Assert.Equal("unfinished", J.Str(unfinished, "mode"));
                Assert.Equal("failed", J.Str(unfinished, "outcome"));
                var log = J.Str(unfinished, "log");
                Assert.Contains("mods: 51 to check", log);
                Assert.DoesNotContain("an older run", log);
                Assert.DoesNotContain("this run", log);
                Assert.False(File.Exists(Path.Combine(Env.AppHome, LogBundle.UnreportedName)));
                Assert.False(File.Exists(Path.Combine(Env.AppHome, LogBundle.OpenMarkerName)));
            }
        }

        [Fact] public void An_unfinished_run_goes_without_its_log_when_reports_are_off()
        {
            using (new Scratch())
            {
                File.WriteAllLines(Env.LogFile, new[] { "[2026-10-03T09:41:05] started: x", "[2026-10-03T09:41:06] secret line" });
                LogBundle.Opened(new Run { Started = new DateTime(2026, 10, 3, 9, 41, 5) });
                var second = new Run { Started = new DateTime(2026, 10, 3, 9, 50, 0), ReportsOff = true };
                LogBundle.Opened(second);
                var posts = new List<string>();
                Http.Token = "tok";
                Http.Fake = (m, u, b) => { posts.Add(b); return Tuple.Create(200, "{}"); };
                Report.Send(second, "ok");
                var unfinished = Json.Parse(posts[0]);
                Assert.Equal("unfinished", J.Str(unfinished, "mode"));
                Assert.True(string.IsNullOrEmpty(J.Str(unfinished, "log")));
                Assert.DoesNotContain("secret line", posts[0]);
            }
        }

        [Fact] public void A_run_that_reported_leaves_nothing_behind()
        {
            using (new Scratch())
            {
                var run = new Run();
                LogBundle.Opened(run);
                Http.Token = "tok";
                Http.Fake = (m, u, b) => Tuple.Create(200, "{}");
                Report.Send(run, "ok");
                LogBundle.Opened(new Run());
                Assert.False(File.Exists(Path.Combine(Env.AppHome, LogBundle.UnreportedName)));
            }
        }

        [Fact] public void A_game_that_failed_to_load_sends_its_log_with_the_game_check()
        {
            using (new Scratch())
            {
                GameLog("[09:41:22] [main/ERROR]: Failed to create mod instance. ModID: sodium", "[09:41:23] [CHAT] <x> hi");
                Assert.Equal("game check: all 51 mods loaded", LogBundle.GameCheckLog("game check: all 51 mods loaded", true, false));
                Assert.Equal("", LogBundle.GameCheckLog("game check: 1 missing", false, true));
                var failed = LogBundle.GameCheckLog("game check: 1 missing", false, false);
                Assert.Contains("ModID: sodium", failed);
                Assert.DoesNotContain("<x> hi", failed);
            }
        }

        [Fact] public void Lines_of_a_run_stop_at_the_next_start()
        {
            var lines = LogBundle.LinesOfRun(new[]
            {
                "[2026-10-03T09:00:00] started: a",
                "[2026-10-03T09:00:01] a1",
                "  a continuation without a stamp",
                "[2026-10-03T09:10:00] started: b",
                "[2026-10-03T09:10:01] b1",
            }, new DateTime(2026, 10, 3, 9, 0, 0));
            Assert.Equal(new[] { "[2026-10-03T09:00:00] started: a", "[2026-10-03T09:00:01] a1", "  a continuation without a stamp" }, lines);
        }
    }
}

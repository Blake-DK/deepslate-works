using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.5.0 (docs/30 §8): options.txt, the memory rule, settings.json version 2, what waits for the next Play, the
    // prisoner villagers. None of it needs WPF.
    [Collection("env")]
    public class GameOptionsTests
    {
        /// <summary>The options.txt Minecraft 1.21.1 wrote with this pack's Sodium 0.8.13 on the windows runner (docs/30
        /// §4.2, docs/11): kept byte for byte.</summary>
        public static string FixturePath([CallerFilePath] string me = "") => Path.Combine(Path.GetDirectoryName(me), "fixtures", "options-1.21.1.txt");
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
        static Dictionary<string, string> D(params string[] kv) { var d = new Dictionary<string, string>(StringComparer.Ordinal); for (int i = 0; i + 1 < kv.Length; i += 2) d[kv[i]] = kv[i + 1]; return d; }

        [Fact] public void Every_key_of_the_tab_is_in_the_file_Minecraft_wrote_with_the_value_the_tab_expects()
        {
            var text = File.ReadAllText(FixturePath());
            Assert.Contains("\r\n", text);   // written on Windows: CRLF
            var read = GameOptions.Read(FixturePath());
            foreach (var o in GameOptions.Known)
            {
                Assert.True(read.ContainsKey(o.Key), o.Key + " is not in the file");
                Assert.Equal(SettingsModel.GameDefaults[o.Key], read[o.Key]);   // the game's own first value
                Assert.True(GameOptions.Show(o.Key, read[o.Key], 0).Fits, o.Key + " cannot be shown: " + read[o.Key]);
            }
            Assert.Equal("\"true\"", read["renderClouds"]);   // quoted in the file
            Assert.Equal("0.0", read["fov"]);                  // (degrees - 70) / 40
            Assert.Matches(@"(?m)^resourcePacks:\[\]\r?$", text);
        }

        [Fact] public void The_fixture_round_trips_with_no_change_when_nothing_is_set()
        {
            using (var s = new Scratch())
            {
                var f = s.P("options.txt");
                File.Copy(FixturePath(), f);
                var before = File.ReadAllBytes(f);
                var stamp = File.GetLastWriteTimeUtc(f);
                Assert.Empty(GameOptions.Set(f, D()));
                Assert.Empty(GameOptions.Set(f, D("renderDistance", "12", "renderClouds", "\"true\"")));   // the values it has
                Assert.Equal(before, File.ReadAllBytes(f));
                Assert.Equal(stamp, File.GetLastWriteTimeUtc(f));   // not even written
                Assert.False(File.Exists(f + ".new"));
            }
        }

        [Fact] public void Only_the_named_lines_change_byte_for_byte()
        {
            using (var s = new Scratch())
            {
                var f = s.P("options.txt");
                File.Copy(FixturePath(), f);
                var before = File.ReadAllText(f);
                var changed = GameOptions.Set(f, D("renderDistance", "14", "renderClouds", "\"false\"", "fov", GameOptions.FovToFile(90)));
                Assert.Equal(new[] { "fov", "renderClouds", "renderDistance" }, changed.OrderBy(x => x, StringComparer.Ordinal).ToArray());
                var want = before.Replace("\r\nrenderDistance:12\r\n", "\r\nrenderDistance:14\r\n").Replace("\r\nrenderClouds:\"true\"\r\n", "\r\nrenderClouds:\"false\"\r\n").Replace("\r\nfov:0.0\r\n", "\r\nfov:0.5\r\n");
                Assert.NotEqual(before, want);
                Assert.Equal(Utf8.GetBytes(want), File.ReadAllBytes(f));
                Assert.Equal("simulationDistance:12", Regex.Match(File.ReadAllText(f), @"(?m)^simulationDistance:.*?(?=\r?$)").Value);   // not on the tab: never touched
            }
        }

        [Fact] public void CRLF_and_LF_files_keep_their_endings_and_a_missing_key_goes_at_the_end()
        {
            using (var s = new Scratch())
            {
                var crlf = s.P("crlf.txt"); File.WriteAllText(crlf, "version:3955\r\nrenderDistance:10\r\nlang:en_us\r\n");
                GameOptions.Set(crlf, D("renderDistance", "8", "gamma", "0.75"));
                Assert.Equal("version:3955\r\nrenderDistance:8\r\nlang:en_us\r\ngamma:0.75\r\n", File.ReadAllText(crlf));
                var lf = s.P("lf.txt"); File.WriteAllText(lf, "version:3955\nrenderDistance:10\nlang:en_us\n");
                GameOptions.Set(lf, D("renderDistance", "8", "gamma", "0.75"));
                Assert.Equal("version:3955\nrenderDistance:8\nlang:en_us\ngamma:0.75\n", File.ReadAllText(lf));
                var noEnd = s.P("noend.txt"); File.WriteAllText(noEnd, "version:3955\r\nrenderDistance:10");
                GameOptions.Set(noEnd, D("renderDistance", "9", "ao", "false"));
                Assert.Equal("version:3955\r\nrenderDistance:9\r\nao:false\r\n", File.ReadAllText(noEnd));
                var none = s.P("none.txt");
                GameOptions.Set(none, D("renderClouds", "\"false\""));
                Assert.Equal("renderClouds:\"false\"\r\n", File.ReadAllText(none));
            }
        }

        [Fact] public void The_clouds_are_quoted_in_the_file()
        {
            Assert.Equal("\"false\"", GameOptions.ToFile("renderClouds", 0));
            Assert.Equal("\"fast\"", GameOptions.ToFile("renderClouds", 1));
            Assert.Equal("\"true\"", GameOptions.ToFile("renderClouds", 2));
            Assert.Equal(1, GameOptions.Show("renderClouds", "\"fast\"", 0).Value);
            Assert.Equal("clouds off", GameOptions.Describe("renderClouds", "\"false\""));
        }

        [Fact] public void Field_of_view_percentages_and_unlimited_convert_both_ways()
        {
            Assert.Equal("-1.0", GameOptions.FovToFile(30)); Assert.Equal("0.0", GameOptions.FovToFile(70)); Assert.Equal("1.0", GameOptions.FovToFile(110));
            Assert.Equal(30, GameOptions.FovFromFile("-1.0")); Assert.Equal(70, GameOptions.FovFromFile("0.0")); Assert.Equal(110, GameOptions.FovFromFile("1.0"));
            for (int d = 30; d <= 110; d++) Assert.Equal(d, GameOptions.FovFromFile(GameOptions.FovToFile(d)));
            Assert.Equal("1.0", GameOptions.PercentToFile(100)); Assert.Equal(100, GameOptions.PercentFromFile("1.0"));
            Assert.Equal("0.5", GameOptions.PercentToFile(50)); Assert.Equal("0.0", GameOptions.PercentToFile(0)); Assert.Equal("5.0", GameOptions.PercentToFile(500));
            for (int p = 0; p <= 500; p++) Assert.Equal(p, GameOptions.PercentFromFile(GameOptions.PercentToFile(p)));
            Assert.Equal("260", GameOptions.ToFile("maxFps", GameOptions.UnlimitedFps));
            Assert.Equal(GameOptions.UnlimitedFps, GameOptions.Show("maxFps", "260", 120).Value);
            Assert.Equal("frame rate limit unlimited", GameOptions.Describe("maxFps", "260"));
            Assert.Equal(150, GameOptions.Show("entityDistanceScaling", "1.5", 100).Value);
            Assert.Equal("1.25", GameOptions.ToFile("entityDistanceScaling", 125));
        }

        [Fact] public void A_value_the_tab_cannot_show_is_shown_nearest_with_the_games_value_and_left_alone()
        {
            var fab = GameOptions.Show("graphicsMode", "2", 1);
            Assert.Equal(1, fab.Value); Assert.False(fab.Fits); Assert.Equal("Fabulous", fab.InGame);
            var far = GameOptions.Show("renderDistance", "24", 10);
            Assert.Equal(16, far.Value); Assert.False(far.Fits); Assert.Equal("24", far.InGame);
            var big = GameOptions.Show("guiScale", "6", 0);
            Assert.Equal(4, big.Value); Assert.False(big.Fits); Assert.Equal("6", big.InGame);
            var past = GameOptions.Show("renderDistance", "40", 10);   // a value the game itself would not keep
            Assert.Equal(16, past.Value); Assert.Equal("40", past.InGame);
            var junk = GameOptions.Show("renderClouds", "\"maybe\"", 1);
            Assert.Equal(1, junk.Value); Assert.False(junk.Fits); Assert.Equal("maybe", junk.InGame);
            Assert.Equal("60 %", GameOptions.Show("entityDistanceScaling", "0.6", 100).InGame);
            using (var s = new Scratch())
            {
                var f = s.P("game", "options.txt"); Directory.CreateDirectory(Path.GetDirectoryName(f));
                File.WriteAllText(f, "graphicsMode:2\r\nrenderDistance:24\r\nguiScale:6\r\nentityDistanceScaling:0.6\r\n");
                var m = SettingsModel.Load(f, s.P("game", "none.zip"), s.P("settings.json"), null, 16, false);
                var now = m.Shown.ToDictionary(kv => kv.Key, kv => kv.Value.Value);
                Assert.Empty(m.Changes(now, new HashSet<string>()));   // not moved: left alone, even though shown differently
                Assert.False(m.Differs(now, new HashSet<string>(), null, false));
                // touched (moved and back, or Back to recommended): written as shown
                var c = m.Changes(now, new HashSet<string> { "graphicsMode" });
                Assert.Equal(new[] { "graphicsMode" }, c.Keys.ToArray()); Assert.Equal("1", c["graphicsMode"]);
                now["renderDistance"] = 12;
                Assert.Equal("12", m.Changes(now, new HashSet<string>())["renderDistance"]);
            }
        }

        [Fact] public void Only_known_keys_and_values_without_a_line_break_are_written()
        {
            using (var s = new Scratch())
            {
                var f = s.P("options.txt"); File.WriteAllText(f, "renderDistance:10\r\n");
                Assert.Throws<ArgumentException>(() => GameOptions.Set(f, D("simulationDistance", "12")));   // not on the tab
                Assert.Throws<ArgumentException>(() => GameOptions.Set(f, D("renderDistance", "12\r\nkey_key.jump:x")));
                Assert.Equal("renderDistance:10\r\n", File.ReadAllText(f));
            }
        }

        [Fact] public void Keep_on_top_moves_only_that_pack_and_only_that_line()
        {
            using (var s = new Scratch())
            {
                var f = s.P("options.txt");
                File.WriteAllText(f, "ao:true\r\nresourcePacks:[\"vanilla\",\"file/deepslate-textures.zip\",\"file/Mine.zip\",\"file/fa.zip\"]\r\nlang:en_us\r\n");
                Assert.True(GameOptions.KeepOnTop(f, GameSettings.VillagerId));
                Assert.Equal("ao:true\r\nresourcePacks:[\"vanilla\",\"file/Mine.zip\",\"file/fa.zip\",\"file/deepslate-textures.zip\"]\r\nlang:en_us\r\n", File.ReadAllText(f));
                Assert.False(GameOptions.KeepOnTop(f, GameSettings.VillagerId));   // already on top
                File.WriteAllText(f, "resourcePacks:[\"vanilla\",\"file/fa.zip\"]\n");
                Assert.False(GameOptions.KeepOnTop(f, GameSettings.VillagerId));   // not in the list: a no-op
                Assert.Equal("resourcePacks:[\"vanilla\",\"file/fa.zip\"]\n", File.ReadAllText(f));
                Assert.False(GameOptions.KeepOnTop(s.P("missing.txt"), GameSettings.VillagerId));
            }
        }
    }

    [Collection("env")]
    public class MemoryTests
    {
        [Theory]
        // PC GB, user_max_gb (null: not in the mod list, read as 8), low, high, fixed, automatic
        [InlineData(4, 12, 3, 3, true, 3)]
        [InlineData(6, 12, 3, 3, true, 3)]
        [InlineData(8, 12, 3, 4, false, 4)]
        [InlineData(12, 12, 3, 8, false, 5)]
        [InlineData(16, 12, 3, 12, false, 6)]
        [InlineData(32, 12, 3, 12, false, 6)]
        [InlineData(4, null, 3, 3, true, 3)]
        [InlineData(6, null, 3, 3, true, 3)]
        [InlineData(8, null, 3, 4, false, 4)]
        [InlineData(12, null, 3, 8, false, 5)]
        [InlineData(16, null, 3, 8, false, 6)]
        [InlineData(32, null, 3, 8, false, 6)]
        public void The_range_for_a_PC(int pc, int? userMax, int low, int high, bool isFixed, int auto)
        {
            var b = Memory.Range(pc, 3, 6, userMax);
            Assert.Equal(low, b.Low); Assert.Equal(high, b.High); Assert.Equal(isFixed, b.Fixed); Assert.Equal(auto, b.Auto); Assert.Equal(pc, b.TotalGb);
        }

        [Fact] public void The_engine_gives_the_choice_kept_within_the_range()
        {
            Assert.Equal(6, Memory.Xmx(null, Memory.Range(16, 3, 6, 12), out var c0)); Assert.False(c0);   // automatic: as before
            Assert.Equal(8, Memory.Xmx(8, Memory.Range(16, 3, 6, 12), out var c1)); Assert.False(c1);
            Assert.Equal(4, Memory.Xmx(8, Memory.Range(8, 3, 6, 12), out var c2)); Assert.True(c2);       // an 8 GB PC: no more than 4
            Assert.Equal(8, Memory.Xmx(12, Memory.Range(12, 3, 6, 12), out var c3)); Assert.True(c3);
            Assert.Equal(8, Memory.Xmx(12, Memory.Range(32, 3, 6, null), out var c4)); Assert.True(c4);  // the mod list's limit came down
            Assert.Equal(3, Memory.Xmx(8, Memory.Range(6, 3, 6, 12), out var c5)); Assert.True(c5);       // never below min_gb
            Assert.Equal(3, Memory.Xmx(2, Memory.Range(16, 3, 6, 12), out var c6)); Assert.True(c6);
            Assert.Equal(4, Memory.Automatic(8, 3, 6)); Assert.Equal(3, Memory.Automatic(7.6, 3, 6)); Assert.Equal(6, Memory.Automatic(64, null, null));
        }

        [Fact] public void A_choice_above_the_range_is_not_rewritten_in_settings_json()
        {
            using (var s = new Scratch())
            {
                var path = s.P("settings.json");
                File.WriteAllText(path, "{\"version\":2,\"websitePlay\":\"wait\",\"ramGb\":12}");
                var before = File.ReadAllBytes(path);
                Assert.Equal(12, AppSettings.RamGb(path));
                Assert.Equal(4, Memory.Xmx(AppSettings.RamGb(path), Memory.Range(8, 3, 6, 12), out var clamped)); Assert.True(clamped);
                var m = SettingsModel.Load(s.P("options.txt"), s.P("pack.zip"), path, null, 8, false);
                Assert.False(m.Differs(m.Shown.ToDictionary(kv => kv.Key, kv => kv.Value.Value), new HashSet<string>(), 12, false));
                Assert.Equal(before, File.ReadAllBytes(path));
            }
        }

        [Fact] public void An_open_launcher_leaves_the_profile_alone_only_when_it_already_has_this_memory()
        {
            using (var s = new Scratch())
            {
                var f = s.P("launcher_profiles.json");
                File.WriteAllText(f, "{\"profiles\":{\"deepslate-works\":{\"lastVersionId\":\"neoforge-21.1.252\",\"javaArgs\":\"-Xmx6G -Xms1G\"}}}");
                Assert.Equal("-Xmx6G -Xms1G", Engine.ProfileJavaArgs(f, "deepslate-works"));
                Assert.Null(Engine.ProfileJavaArgs(f, "someone-else"));
                Assert.Null(Engine.ProfileJavaArgs(s.P("none.json"), "deepslate-works"));
                File.WriteAllText(f, "{not json");
                Assert.Null(Engine.ProfileJavaArgs(f, "deepslate-works"));
            }
        }

        [Fact] public void One_warning_at_a_time()
        {
            Assert.Equal(UiText.RamWarnHalf, Memory.Warning(9, 16));
            Assert.Equal(UiText.RamWarnHalf, Memory.Warning(5, 8));
            Assert.Equal(UiText.RamWarnStutter, Memory.Warning(10, 32));
            Assert.Null(Memory.Warning(8, 16));
            Assert.Null(Memory.Warning(4, 8));
        }
    }

    [Collection("env")]
    public class AppSettingsV2Tests
    {
        [Fact] public void A_version_1_file_reads_as_it_is_and_the_first_write_makes_it_version_2()
        {
            using (var s = new Scratch())
            {
                var p = s.P("settings.json");
                File.WriteAllText(p, "{\"version\":1,\"websitePlay\":\"wait\"}");
                Assert.Equal(AppSettings.Wait, AppSettings.WebsitePlay(p));
                Assert.Null(AppSettings.RamGb(p));
                Assert.False(AppSettings.Pending(p).Any);
                AppSettings.SetRamGb(8, p);
                var j = Json.Parse(File.ReadAllText(p));
                Assert.Equal(2L, J.Long(j, "version")); Assert.Equal("wait", J.Str(j, "websitePlay")); Assert.Equal(8L, J.Long(j, "ramGb"));
            }
        }

        [Fact] public void Every_setter_keeps_the_other_keys()
        {
            using (var s = new Scratch())
            {
                var p = s.P("settings.json");
                AppSettings.SetWebsitePlay(AppSettings.Now, p);
                AppSettings.SetRamGb(6, p);
                var pend = new AppSettings.PendingSettings { Villagers = true }; pend.Options["renderDistance"] = "14";
                AppSettings.SetPending(pend, p);
                AppSettings.SetWebsitePlay(AppSettings.Wait, p);
                Assert.Equal(6, AppSettings.RamGb(p)); Assert.Equal("14", AppSettings.Pending(p).Options["renderDistance"]); Assert.True(AppSettings.Pending(p).Villagers);
                var more = new AppSettings.PendingSettings(); more.Options["renderClouds"] = "\"false\""; more.Options["renderDistance"] = "16";
                AppSettings.SetPending(more, p);   // adds: a key saved again replaces its value, villagers stay
                var now = AppSettings.Pending(p);
                Assert.Equal("16", now.Options["renderDistance"]); Assert.Equal("\"false\"", now.Options["renderClouds"]); Assert.True(now.Villagers);
                AppSettings.SetRamGb(null, p);
                Assert.Null(AppSettings.RamGb(p)); Assert.True(AppSettings.Pending(p).Any); Assert.Equal(AppSettings.Wait, AppSettings.WebsitePlay(p));
                AppSettings.ClearPending(p);
                Assert.False(AppSettings.Pending(p).Any); Assert.Equal(AppSettings.Wait, AppSettings.WebsitePlay(p));
                Assert.DoesNotContain("ramGb", File.ReadAllText(p));
            }
        }

        [Fact] public void A_broken_file_reads_as_empty()
        {
            using (var s = new Scratch())
            {
                var p = s.P("settings.json");
                File.WriteAllText(p, "{\"websitePlay\":\"wait\",");
                Assert.Equal(AppSettings.Countdown, AppSettings.WebsitePlay(p));
                Assert.Null(AppSettings.RamGb(p));
                Assert.False(AppSettings.Pending(p).Any);
                File.WriteAllText(p, "{\"ramGb\":\"lots\"}"); Assert.Null(AppSettings.RamGb(p));
                File.WriteAllText(p, "{\"ramGb\":7.5}"); Assert.Null(AppSettings.RamGb(p));
                File.WriteAllText(p, "{\"ramGb\":null}"); Assert.Null(AppSettings.RamGb(p));
            }
        }

        [Fact] public void Unknown_waiting_keys_are_dropped()
        {
            using (var s = new Scratch())
            {
                var p = s.P("settings.json");
                File.WriteAllText(p, "{\"version\":2,\"pending\":{\"options\":{\"renderDistance\":\"14\",\"key_key.jump\":\"key.keyboard.x\",\"simulationDistance\":\"32\",\"fov\":\"0.5\\nboom:1\",\"gamma\":3},\"villagers\":\"yes\"}}");
                var pend = AppSettings.Pending(p);
                Assert.Equal(new[] { "renderDistance" }, pend.Options.Keys.ToArray());
                Assert.Null(pend.Villagers);
            }
        }
    }

    [Collection("env")]
    public class PendingAndVillagerTests
    {
        static Dictionary<string, string> D(params string[] kv) { var d = new Dictionary<string, string>(StringComparer.Ordinal); for (int i = 0; i + 1 < kv.Length; i += 2) d[kv[i]] = kv[i + 1]; return d; }

        [Fact] public void With_the_game_running_Save_writes_nothing_to_options_txt_and_the_next_Play_applies_it_once()
        {
            using (var s = new Scratch())
            {
                var opt = s.P("options.txt"); var set = s.P("settings.json");
                File.Copy(GameOptionsTests.FixturePath(), opt);
                var before = File.ReadAllBytes(opt);
                var was = Engine.GameRunningNow;
                try
                {
                    Engine.GameRunningNow = () => true;
                    var r = GameSettings.Save(opt, D("renderDistance", "14", "renderClouds", "\"false\""), null, Engine.GameRunningNow(), set);
                    Assert.Equal("pending", r.Status);
                    Assert.Equal(before, File.ReadAllBytes(opt));
                    Assert.Equal("14", AppSettings.Pending(set).Options["renderDistance"]);
                    Assert.Contains(Log.RunLines, l => l.EndsWith("] settings: kept for the next Play (Minecraft is open)"));
                    Assert.Contains(Log.RunLines, l => l.EndsWith("] settings: renderDistance 12 → 14, renderClouds \"true\" → \"false\""));
                    // the tab opened again: it shows what waits, and says so
                    var m = SettingsModel.Load(opt, s.P("none.zip"), set, null, 16, false);
                    Assert.True(m.PendingShown); Assert.Equal(14, m.Shown["renderDistance"].Value); Assert.Equal(0, m.Shown["renderClouds"].Value);
                    // the next Play with the game still open: it keeps waiting
                    Assert.Null(GameSettings.ApplyPending(opt, true, set));
                    Assert.Equal(before, File.ReadAllBytes(opt));
                    // the next Play with the game closed: written once, cleared
                    Engine.GameRunningNow = () => false;
                    var tick = GameSettings.ApplyPending(opt, Engine.GameRunningNow(), set);
                    Assert.Equal("Your settings from the Settings tab applied (render distance 14, clouds off)", tick);
                    var after = GameOptions.Read(opt);
                    Assert.Equal("14", after["renderDistance"]); Assert.Equal("\"false\"", after["renderClouds"]);
                    Assert.False(AppSettings.Pending(set).Any);
                    var once = File.ReadAllBytes(opt);
                    Assert.Null(GameSettings.ApplyPending(opt, false, set));   // a second run changes nothing
                    Assert.Equal(once, File.ReadAllBytes(opt));
                }
                finally { Engine.GameRunningNow = was; }
            }
        }

        [Fact] public void With_the_game_closed_Save_writes_what_waited_too_and_clears_it()
        {
            using (var s = new Scratch())
            {
                var opt = s.P("options.txt"); var set = s.P("settings.json");
                File.WriteAllText(opt, "renderDistance:10\r\nrenderClouds:\"fast\"\r\nresourcePacks:[\"vanilla\"]\r\n");
                GameSettings.Save(opt, D("renderDistance", "14"), true, true, set);
                Assert.Equal("renderDistance:10\r\nrenderClouds:\"fast\"\r\nresourcePacks:[\"vanilla\"]\r\n", File.ReadAllText(opt));
                var r = GameSettings.Save(opt, D("renderClouds", "\"false\""), null, false, set);
                Assert.Equal("written", r.Status);
                Assert.Equal("renderDistance:14\r\nrenderClouds:\"false\"\r\nresourcePacks:[\"vanilla\",\"file/deepslate-textures.zip\"]\r\n", File.ReadAllText(opt));
                Assert.False(AppSettings.Pending(set).Any);
            }
        }

        [Fact] public void Villagers_on_off_and_on_again_leave_the_players_packs_and_order_alone()
        {
            using (var s = new Scratch())
            {
                var opt = s.P("options.txt");
                var start = "ao:true\r\nresourcePacks:[\"vanilla\",\"file/Mine.zip\",\"file/Faithful.zip\"]\r\nlang:en_us\r\n";
                File.WriteAllText(opt, start);
                Assert.True(GameSettings.SetVillagers(opt, true));
                var on = "ao:true\r\nresourcePacks:[\"vanilla\",\"file/Mine.zip\",\"file/Faithful.zip\",\"file/deepslate-textures.zip\"]\r\nlang:en_us\r\n";
                Assert.Equal(on, File.ReadAllText(opt));
                Assert.True(GameSettings.VillagersOn(opt));
                Assert.True(GameSettings.SetVillagers(opt, false));
                Assert.Equal(start, File.ReadAllText(opt));
                Assert.False(GameSettings.VillagersOn(opt));
                GameSettings.SetVillagers(opt, true);
                Assert.Equal(on, File.ReadAllText(opt));
                // the list the game writes on a fresh start is empty (docs/11): the pack alone
                File.WriteAllText(opt, "resourcePacks:[]\r\n");
                GameSettings.SetVillagers(opt, true);
                Assert.Equal("resourcePacks:[\"file/deepslate-textures.zip\"]\r\n", File.ReadAllText(opt));
            }
        }

        [Fact] public void Fresh_Animations_switched_on_by_Extras_afterwards_stays_under_the_villagers()
        {
            using (var s = new Scratch())
            {
                var gd = s.P("game");
                var xp = Extras.GetPaths(gd);
                foreach (var d0 in new[] { xp.Extras, xp.Mods, xp.ResourcePacks, xp.ShaderPacks }) Directory.CreateDirectory(d0);
                var bodies = new Dictionary<string, string> { { "fa.zip", "fa" }, { "emf.jar", "emf" }, { "etf.jar", "etf" } };
                var shaOf = bodies.ToDictionary(kv => kv.Key, kv => XKit.ShaOfText(XKit.Rep(kv.Value, 50)));
                JObj F(string n, string k) => XKit.File_(n, k, shaOf, 200);
                var raw = J.O("extras", new List<object> { XKit.Extra("fresh-animations", null, "Medium", null, new string[0], null, F("fa.zip", "resourcepack"), F("emf.jar", "mod"), F("etf.jar", "mod")) });
                var xm = ExtrasManifest.FromJson(Json.Parse(Json.Write(raw)));
                File.WriteAllText(xp.Options, "renderDistance:10\r\nresourcePacks:[\"vanilla\",\"file/Mine.zip\"]\r\n");
                GameSettings.SetVillagers(xp.Options, true);
                var st = new ExtrasState();
                Extras.SyncFiles(xp, xm, st, XKit.Fetch(bodies, 50));
                st.Choices["fresh-animations"] = true;
                var a = Extras.Apply(xp, xm, st);
                Assert.True(a.Ok, a.Error);
                Assert.Matches("resourcePacks:\\[\"vanilla\",\"file/Mine.zip\",\"file/fa.zip\",\"file/deepslate-textures.zip\"\\]", File.ReadAllText(xp.Options));
                st.Choices["fresh-animations"] = false;
                a = Extras.Apply(xp, xm, st);
                Assert.True(a.Ok, a.Error);
                Assert.Matches("resourcePacks:\\[\"vanilla\",\"file/Mine.zip\",\"file/deepslate-textures.zip\"\\]", File.ReadAllText(xp.Options));   // Apply never takes it out
            }
        }

        [Fact] public void The_pack_file_missing_shuts_the_switch()
        {
            using (var s = new Scratch())
            {
                var opt = s.P("options.txt"); File.WriteAllText(opt, "resourcePacks:[]\r\n");
                var m = SettingsModel.Load(opt, s.P("deepslate-textures.zip"), s.P("settings.json"), null, 16, false);
                Assert.False(m.VillagerPackHere);
                Assert.False(m.Differs(m.Shown.ToDictionary(kv => kv.Key, kv => kv.Value.Value), new HashSet<string>(), null, true));   // a shut switch saves nothing
                File.WriteAllText(s.P("deepslate-textures.zip"), "zip");
                Assert.True(SettingsModel.Load(opt, s.P("deepslate-textures.zip"), s.P("settings.json"), null, 16, false).VillagerPackHere);
            }
        }

        [Fact] public void A_render_distance_saved_on_the_tab_is_left_alone_and_back_to_recommended_follows_the_tier_again()
        {
            using (var s = new Scratch())
            {
                var opt = s.P("options.txt");
                Engine.SetRenderDistance(opt, null, 10, 8);   // the first install: the tier's 10, ours
                GameSettings.Save(opt, D("renderDistance", "14"), null, false, s.P("settings.json"));
                var r = Engine.SetRenderDistance(opt, 10, 10, 8);   // the next Play: set by you
                Assert.Equal("left", r.Status); Assert.Equal("14", GameOptions.Read(opt)["renderDistance"]);
                r = Engine.SetRenderDistance(opt, r.Ours, 12, 8);   // the tier moved up: still yours
                Assert.Equal("left", r.Status); Assert.Equal("14", GameOptions.Read(opt)["renderDistance"]);
                // Back to recommended writes the tier's value (the mod list's render_distance for this PC)
                var m = SettingsModel.Load(opt, s.P("none.zip"), s.P("settings.json"), Json.Parse("{\"settings\":{\"renderDistance\":12}}"), 16, false);
                Assert.Equal(12, m.Recommended["renderDistance"]);
                var now = m.Shown.ToDictionary(kv => kv.Key, kv => kv.Value.Value); now["renderDistance"] = m.Recommended["renderDistance"];
                GameSettings.Save(opt, m.Changes(now, new HashSet<string> { "renderDistance" }), null, false, s.P("settings.json"));
                r = Engine.SetRenderDistance(opt, r.Ours, 12, 8);
                Assert.Equal("same", r.Status); Assert.Equal(12, r.Ours);   // the engine's own again
                r = Engine.SetRenderDistance(opt, r.Ours, 10, 8);   // and it follows the tier from now on
                Assert.Equal("changed", r.Status); Assert.Equal("10", GameOptions.Read(opt)["renderDistance"]);
            }
        }

        [Fact] public void The_recommended_values_follow_the_tier()
        {
            using (var s = new Scratch())
            {
                var low = SettingsModel.Load(s.P("o.txt"), s.P("p.zip"), s.P("s.json"), Json.Parse("{\"settings\":{\"tier\":\"LOW\",\"renderDistance\":8}}"), 6, true);
                Assert.Equal(0, low.Recommended["graphicsMode"]); Assert.Equal(0, low.Recommended["renderClouds"]); Assert.Equal(1, low.Recommended["particles"]); Assert.Equal(0, low.Recommended["entityShadows"]);
                Assert.Equal(8, low.Recommended["renderDistance"]);
                var high = SettingsModel.Load(s.P("o.txt"), s.P("p.zip"), s.P("s.json"), Json.Parse("{\"settings\":{\"tier\":\"HIGH\",\"renderDistance\":12,\"serverViewDistance\":12}}"), 32, false);
                Assert.Equal(1, high.Recommended["graphicsMode"]); Assert.Equal(1, high.Recommended["renderClouds"]); Assert.Equal(0, high.Recommended["particles"]); Assert.Equal(1, high.Recommended["entityShadows"]);
                Assert.Equal(100, high.Recommended["entityDistanceScaling"]); Assert.Equal(120, high.Recommended["maxFps"]); Assert.Equal(70, high.Recommended["fov"]); Assert.Equal(50, high.Recommended["gamma"]);
                Assert.Equal(UiText.ServerShows(12), high.RenderNote(14)); Assert.Null(high.RenderNote(12));
                Assert.True(low.RenderStruggles(12)); Assert.False(low.RenderStruggles(10)); Assert.False(high.RenderStruggles(16));
                Assert.True(low.GraphicsStruggles(1)); Assert.False(high.GraphicsStruggles(1));
                Assert.False(low.HasOptions);   // before the first Play: "These appear after your first Play."
            }
        }

        [Fact] public void The_report_says_what_the_game_got()
        {
            using (var s = new Scratch())
            {
                var opt = s.P("options.txt"); File.WriteAllText(opt, "renderDistance:14\r\nresourcePacks:[\"file/deepslate-textures.zip\"]\r\n");
                var b = GameSettings.ReportBlock(8, 8, opt);
                Assert.Equal("{\"ramGb\":8,\"xmxGb\":8,\"renderDistance\":14,\"villagers\":true}", Json.Write(b));
                Assert.Equal("{\"ramGb\":null,\"xmxGb\":6,\"renderDistance\":null,\"villagers\":false}", Json.Write(GameSettings.ReportBlock(null, 6, s.P("none.txt"))));
                var run = new Run { Settings = b };
                Assert.Equal(b, Report.New(run, "ok")["settings"]);
            }
        }
    }
}

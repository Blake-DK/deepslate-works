using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.6.1, items 4 to 9: what follows the run's target. A test Play writes nothing into the live folder, a live Play
    // nothing into the test folder; extras and settings reach both games; the game check reads a log with no date.

    [Collection("env")]
    public class TargetTests
    {
        static byte[] B(string s) => Encoding.UTF8.GetBytes(s);
        static string TestDir => Path.Combine(Env.Root, Env.TestDirName);
        static Run TestRun() => new Run { UpdateOnly = true, NoLaunch = true, AllowAll = true, Target = "test" };

        static readonly byte[] LeavesJar = Encoding.ASCII.GetBytes("a stand-in extra: falling leaves 1.0");
        static string ExtrasJson => "{\"extras\":[{\"id\":\"leaves\",\"name\":\"Falling Leaves\",\"description\":\"\",\"fps\":\"low\",\"files\":[{\"filename\":\"leaves-1.0.jar\",\"kind\":\"mods\",\"url\":\"https://cdn.example/leaves-1.0.jar\",\"sha512\":\"" + FakeSite.Sha(LeavesJar) + "\",\"size\":" + LeavesJar.Length + "}]}]}";

        /// <summary>The fake site with the extras list and its jar; the Extras tab has Falling Leaves switched on.</summary>
        static void WithExtras(FakeSite f)
        {
            var inner = Http.Fake;
            Http.Fake = (m, u, b) => u == Env.ExtrasUrl ? Tuple.Create(200, ExtrasJson) : inner(m, u, b);
            var innerDl = Http.FakeDownload;
            Http.FakeDownload = (url, outFile) => { if (url.EndsWith("leaves-1.0.jar")) { File.WriteAllBytes(outFile, LeavesJar); return true; } return innerDl(url, outFile); };
            Directory.CreateDirectory(Env.AppHome);
            File.WriteAllText(Env.ExtrasStatePath, "{\"version\":2,\"choices\":{\"leaves\":true},\"shader\":\"none\",\"applied\":{\"mods\":[],\"resourcepacks\":[],\"shaderpacks\":[]},\"seen\":[\"leaves\"],\"downloaded\":true}");
        }

        static Dictionary<string, string> Snap(string dir) => !Directory.Exists(dir) ? new Dictionary<string, string>()
            : Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Where(p => !p.Contains(Path.DirectorySeparatorChar + "logs" + Path.DirectorySeparatorChar))
                .ToDictionary(p => p.Substring(dir.Length), p => FakeSite.Sha(File.ReadAllBytes(p)));

        // ---- item 5: extras follow the target -------------------------------------------------------------------------

        [WindowsFact] public void A_test_Play_puts_the_extras_that_are_on_into_the_test_game_and_writes_nothing_into_the_live_folder()
        {
            using (var f = new FakeSite())
            {
                WithExtras(f);
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") } };
                Assert.Equal("done", Engine.Execute(f.Update()));   // the live game, with the extra
                Assert.True(File.Exists(Path.Combine(Env.LiveDataDir, "mods", "leaves-1.0.jar")));
                var live = Snap(Env.LiveDataDir);
                var liveState = File.ReadAllText(Env.ExtrasStatePath);

                var lines = new List<string>();
                var run = TestRun(); run.Sink = o => lines.Add(J.Str(o, "t") + ":" + J.Str(o, "text"));
                Assert.Equal("done", Engine.Execute(run));
                Assert.True(File.Exists(Path.Combine(TestDir, "mods", "leaves-1.0.jar")), "the test game has no Falling Leaves");
                Assert.Equal(FakeSite.Sha(LeavesJar), FakeSite.Sha(File.ReadAllBytes(Path.Combine(TestDir, "mods", "leaves-1.0.jar"))));
                Assert.Equal(live, Snap(Env.LiveDataDir));                              // the live folder as it was, every file
                Assert.Equal(liveState, File.ReadAllText(Env.ExtrasStatePath));          // and the live game's extras state
                Assert.Contains(lines, l => l == "tick:1 extras ready (1 downloaded), 1 on");
                Assert.Contains("leaves-1.0.jar", J.Strs(Json.ReadFile(Env.ExtrasTestStatePath), "applied.mods"));
            }
        }

        [Fact] public void On_is_said_only_for_an_extra_whose_files_are_in_that_games_folders()
        {
            using (var s = new Scratch())
            {
                var m = ExtrasManifest.FromJson(Json.Parse(ExtrasJson));
                var st = new ExtrasState(); st.Choices["leaves"] = true;
                var paths = Extras.GetPaths(Path.Combine(Env.Root, "game"));
                Assert.Equal(0, Extras.InPlace(paths, m, st));   // chosen, not in mods\
                Directory.CreateDirectory(paths.Mods);
                File.WriteAllBytes(Path.Combine(paths.Mods, "leaves-1.0.jar"), B("something else"));
                Assert.Equal(0, Extras.InPlace(paths, m, st));   // there, but not the right file
                File.WriteAllBytes(Path.Combine(paths.Mods, "leaves-1.0.jar"), LeavesJar);
                Assert.Equal(1, Extras.InPlace(paths, m, st));
            }
        }

        // ---- item 6: settings reach both games; a test Play never uses up what the live game has not had ----------------

        [Fact] public void A_new_test_folder_starts_from_the_live_games_options_without_packs_it_does_not_have()
        {
            using (var s = new Scratch())
            {
                var live = Path.Combine(Env.Root, "live", "options.txt"); var test = Path.Combine(Env.Root, "test", "options.txt"); var packs = Path.Combine(Env.Root, "test", "resourcepacks");
                Directory.CreateDirectory(Path.GetDirectoryName(live)); Directory.CreateDirectory(packs);
                File.WriteAllText(live, "version:3955\r\nrenderDistance:12\r\nguiScale:2\r\nkey_key.jump:key.keyboard.space\r\nresourcePacks:[\"vanilla\",\"file/mine.zip\",\"file/deepslate-textures.zip\"]\r\nincompatibleResourcePacks:[]\r\n");
                File.WriteAllText(Path.Combine(packs, "deepslate-textures.zip"), "pack");
                var line = GameSettings.CarryToTest(live, test, packs, Path.Combine(Env.AppHome, "settings.json"));
                Assert.Equal("Your settings from the live game copied in", line);
                var t = File.ReadAllText(test);
                Assert.Contains("guiScale:2", t);
                Assert.Contains("key_key.jump:key.keyboard.space", t);   // key binds and all
                Assert.Contains("resourcePacks:[\"vanilla\",\"file/deepslate-textures.zip\"]", t);   // mine.zip is not in the test folder
            }
        }

        [Fact] public void Settings_tab_changes_reach_the_next_Play_of_either_game_and_a_test_Play_leaves_them_for_the_live_one()
        {
            using (var s = new Scratch())
            {
                var settings = Path.Combine(Env.AppHome, "settings.json");
                var live = Path.Combine(Env.Root, "live", "options.txt"); var test = Path.Combine(Env.Root, "test", "options.txt"); var packs = Path.Combine(Env.Root, "test", "resourcepacks");
                Directory.CreateDirectory(Path.GetDirectoryName(live)); Directory.CreateDirectory(packs); Directory.CreateDirectory(Env.AppHome);
                File.WriteAllText(live, "renderDistance:12\r\nfov:0.0\r\n");
                GameSettings.CarryToTest(live, test, packs, settings);
                File.AppendAllText(test, "lang:de_de\r\n");   // changed inside the test game: stays
                // saved in the Settings tab while Minecraft was open: waits for the live game
                AppSettings.SetPending(new AppSettings.PendingSettings { Options = { { "renderDistance", "14" } } }, settings);
                var line = GameSettings.CarryToTest(live, test, packs, settings);
                Assert.Equal("Your settings brought across from the live game (render distance 14)", line);
                Assert.Contains("renderDistance:14", File.ReadAllText(test));
                Assert.Contains("lang:de_de", File.ReadAllText(test));
                Assert.True(AppSettings.Pending(settings).Any, "the test Play used up what the live game has not had");
                Assert.Contains("renderDistance:12", File.ReadAllText(live));
                // the live Play applies it and clears it; the next test Play still has it, from the live game now
                GameSettings.ApplyPending(live, false, settings);
                Assert.False(AppSettings.Pending(settings).Any);
                Assert.Contains("renderDistance:14", File.ReadAllText(live));
                Assert.Null(GameSettings.CarryToTest(live, test, packs, settings));   // nothing new
            }
        }

        [WindowsFact] public void A_test_Play_brings_the_Settings_change_across_and_the_live_Play_after_it_still_gets_it()
        {
            using (var f = new FakeSite())
            {
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") } };
                Assert.Equal("done", Engine.Execute(f.Update()));
                Directory.CreateDirectory(Env.AppHome);
                AppSettings.SetPending(new AppSettings.PendingSettings { Options = { { "renderDistance", "14" } } });
                Assert.Equal("done", Engine.Execute(TestRun()));
                Assert.Contains("renderDistance:14", File.ReadAllText(Path.Combine(TestDir, "options.txt")));
                Assert.True(AppSettings.Pending().Any);
                Assert.Equal("done", Engine.Execute(f.Update()));
                Assert.Contains("renderDistance:14", File.ReadAllText(Path.Combine(Env.LiveDataDir, "options.txt")));
                Assert.False(AppSettings.Pending().Any);
            }
        }

        // ---- item 8: the profile line names the profile written ----------------------------------------------------------

        [WindowsFact] public void The_profile_line_names_the_profile_written()
        {
            using (var f = new FakeSite())
            {
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") } };
                var lines = new List<string>();
                var run = TestRun(); run.Sink = o => lines.Add(J.Str(o, "t") + ":" + J.Str(o, "text"));
                Assert.Equal("done", Engine.Execute(run));
                Assert.Contains(lines, l => l.StartsWith("tick:Profile 'Deepslate Works TEST' with "));
                Assert.DoesNotContain(lines, l => l.StartsWith("tick:Profile 'Deepslate Works' "));
            }
        }

        // ---- item 9: the Minecraft Launcher opens on the live profile again ------------------------------------------------

        [Fact] public void After_a_test_Play_the_launcher_opens_on_the_live_profile_again_but_never_while_it_is_open()
        {
            using (var s = new Scratch())
            {
                var p = Path.Combine(Env.Root, "launcher_profiles.json");
                const string after = "{\"profiles\":{\"deepslate-works\":{\"name\":\"Deepslate Works\",\"lastUsed\":\"2026-10-09T12:00:00.000Z\"},\"deepslate-works-test\":{\"name\":\"Deepslate Works TEST\",\"lastUsed\":\"2026-10-09T13:00:00.000Z\"}},\"selectedProfile\":\"deepslate-works-test\",\"settings\":{\"profileSorting\":\"ByLastPlayed\"},\"version\":3}";
                File.WriteAllText(p, after);
                Assert.False(Engine.PutLiveFirst(p, "deepslate-works", "deepslate-works-test", true));   // the launcher is open
                Assert.Equal(after, File.ReadAllText(p));
                Assert.True(Engine.PutLiveFirst(p, "deepslate-works", "deepslate-works-test", false));
                var j = Json.ReadFile(p);
                Assert.Equal("deepslate-works", J.Str(j, "selectedProfile"));
                Assert.True(string.CompareOrdinal(J.Str(j, "profiles.deepslate-works.lastUsed"), "2026-10-09T13:00:00.000Z") > 0, "the live profile is not the last used");
                Assert.Equal("Deepslate Works TEST", J.Str(j, "profiles.deepslate-works-test.name"));   // the test profile stays
                Assert.False(Engine.PutLiveFirst(p, "deepslate-works", "deepslate-works-test", false));   // already so: not written again
                // a PC that never played the test server: nothing to do
                File.WriteAllText(p, "{\"profiles\":{\"deepslate-works\":{\"lastUsed\":\"2026-10-09T12:00:00.000Z\"}},\"selectedProfile\":\"deepslate-works\",\"version\":3}");
                Assert.False(Engine.PutLiveFirst(p, "deepslate-works", "deepslate-works-test", false));
            }
        }

        // ---- item 4b: a log with no date in its first line --------------------------------------------------------------

        [Fact] public void A_time_with_no_date_is_read_on_the_day_the_log_was_written_or_the_day_before()
        {
            var written = new DateTime(2026, 10, 9, 23, 10, 0, DateTimeKind.Local);
            Assert.Equal(new DateTime(2026, 10, 9, 22, 51, 16, DateTimeKind.Local).ToUniversalTime(), Extras.StartFromTime("22:51:16", written));
            var afterMidnight = new DateTime(2026, 10, 10, 0, 5, 0, DateTimeKind.Local);
            Assert.Equal(new DateTime(2026, 10, 9, 22, 51, 16, DateTimeKind.Local).ToUniversalTime(), Extras.StartFromTime("22:51:16", afterMidnight));
        }

        [WindowsFact] public void The_game_check_finds_a_session_whose_log_starts_with_a_time_and_no_date_even_with_an_old_creation_time()
        {
            using (var s = new Scratch())
            {
                var game = Path.Combine(Env.Root, "game"); var logs = Path.Combine(game, "logs"); Directory.CreateDirectory(logs);
                var log = Path.Combine(logs, "latest.log");
                var start = DateTime.Now.AddSeconds(-20);
                File.WriteAllText(log, string.Format("[{0:HH:mm:ss}] [main/INFO] [cpw.mods.modlauncher.Launcher/MODLAUNCHER]: ModLauncher running\n[{0:HH:mm:ss}] [Render thread/INFO] [minecraft/ReloadableResourceManager]: Reloading ResourceManager: vanilla\n", start));
                File.SetCreationTime(log, DateTime.Now.AddHours(-1));   // what Windows keeps from the log before (tunnelling)
                var since = start.ToUniversalTime().AddSeconds(-2);
                var found = Engine.FindGameSession(game, null, since, "");
                Assert.NotNull(found);
                Assert.InRange(found.Session.StartedAt.Value, since, DateTime.UtcNow);
            }
        }

        // ---- item 4a: a library or game library is as loaded as a mod -----------------------------------------------------

        [Fact] public void Libraries_and_game_libraries_count_as_loaded_and_debug_log_is_always_read()
        {
            using (var s = new Scratch())
            {
                var game = Path.Combine(Env.Root, "game"); var logs = Path.Combine(game, "logs"); Directory.CreateDirectory(logs);
                var stamp = DateTime.Now.ToString("ddMMMyyyy HH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture);
                File.WriteAllText(Path.Combine(logs, "latest.log"), string.Format(
                    "[{0}] [main/INFO] [net.neoforged.fml.loading.moddiscovery.ModDiscoverer/SCAN]: Found mod file \"create.jar\" of type MOD with provider net.neoforged.fml.loading.moddiscovery.locators.ModsFolderLocator\n"
                    + "[{0}] [Render thread/INFO] [minecraft/ReloadableResourceManager]: Reloading ResourceManager: vanilla\n", stamp));
                File.WriteAllText(Path.Combine(logs, "debug.log"), string.Format(
                    "[{0}] [main/DEBUG] [net.neoforged.fml.loading.moddiscovery.ModDiscoverer/SCAN]: Found library file \"kotlinlangforge.jar\" of type LIBRARY with provider net.neoforged.fml.loading.moddiscovery.locators.ModsFolderLocator\n"
                    + "[{0}] [main/DEBUG] [net.neoforged.fml.loading.moddiscovery.ModDiscoverer/SCAN]: Found gamelibrary file \"scalable-cats-force.jar\" of type GAMELIBRARY with provider net.neoforged.fml.loading.moddiscovery.locators.ModsFolderLocator\n", stamp));
                var found = Engine.FindGameSession(game, null, DateTime.UtcNow.AddMinutes(-5), "");
                Assert.NotNull(found);
                foreach (var n in new[] { "create.jar", "kotlinlangforge.jar", "scalable-cats-force.jar" }) Assert.Contains(n, found.Session.Found);
            }
        }

        // ---- item 4 on a real game log: Alex's test game, NeoForge 21.1.253 client, 2026-10-09 (fixtures/, chosen lines,
        // personal values replaced) ------------------------------------------------------------------------------------
        static string RealLog([System.Runtime.CompilerServices.CallerFilePath] string me = "") => Path.Combine(Path.GetDirectoryName(me), "fixtures", "neoforge-21.1.253-client-latest.log");
        static object PackFile(string filename) => Json.Parse("{\"slug\":\"x\",\"name\":\"x\",\"filename\":\"" + filename + "\",\"side\":\"client\"}");

        [WindowsFact] public void On_a_real_game_log_the_four_mods_3_6_0_called_missing_are_loaded_and_the_game_is_found()
        {
            using (var s = new Scratch())
            {
                var game = Path.Combine(Env.Root, "game"); var logs = Path.Combine(game, "logs"); Directory.CreateDirectory(logs);
                var log = Path.Combine(logs, "latest.log");
                File.Copy(RealLog(), log);
                var written = DateTime.Now;
                File.SetLastWriteTime(log, written);
                File.SetCreationTime(log, written.AddDays(-3));   // Windows' tunnelling: the creation time of an older log
                var start = Extras.StartFromTime("20:26:09", written);   // its first line: "[20:26:09] [main/INFO]: …", no date
                var found = Engine.FindGameSession(game, null, start.AddMinutes(-1), "");
                Assert.NotNull(found);
                Assert.Equal(start, found.Session.StartedAt);
                Assert.True(found.Session.Loaded);
                // what 3.6.0 called not loaded: a game library, two libraries, and Sodium, which its own locator loads
                // under another name ("net.caffeinemc.sodium-neoforge-…-mod.jar"; the pack's name is never in the log)
                Assert.DoesNotContain("sodium-neoforge-0.8.13+mc1.21.1.jar", found.Session.Found);
                var files = new[] { "CustomWindowTitle-1.21.4+v1.4.1.jar", "KotlinLangForge-2.14.1-k2.4.20-3.0+neoforge.jar", "ScalableCatsForce-NeoForge-3.7.1-build-11-with-library.jar", "sodium-neoforge-0.8.13+mc1.21.1.jar", "mcw-mcwwindows-2.4.2-mc1.21.1neoforge.jar" }.Select(PackFile).ToList();
                var c = Engine.TestGameMods(found.Session, files);
                Assert.True(c.Ok, "missing: " + string.Join(", ", c.Missing.Select(m => m.Filename)));
                Assert.Equal(5, c.Checked);
                // and a jar the game did not load is still missing
                var c2 = Engine.TestGameMods(found.Session, files.Concat(new[] { PackFile("not-in-this-game-1.0.jar") }).ToList());
                Assert.Equal(new[] { "not-in-this-game-1.0.jar" }, c2.Missing.Select(m => m.Filename).ToArray());
            }
        }

        [Fact] public void A_mods_own_locator_counts_only_for_the_pack_file_whose_name_it_carries()
        {
            var s = new GameSession();
            s.FoundByOwnLocator.Add("net.caffeinemc.sodium-neoforge-0.8.13+mc1.21.1-mod.jar");
            Assert.True(Engine.FoundUnderOwnLocator(s, "sodium-neoforge-0.8.13+mc1.21.1.jar"));
            Assert.False(Engine.FoundUnderOwnLocator(s, "sodium-neoforge-0.8.14+mc1.21.1.jar"));   // another version is not it
            Assert.False(Engine.FoundUnderOwnLocator(s, "iris-neoforge-1.8.12+mc1.21.1.jar"));
        }

        [Fact] public void A_test_games_check_has_its_own_mode()
        {
            Assert.Equal("test_game_check", Engine.GameCheckMode(true));
            Assert.Equal("game_check", Engine.GameCheckMode(false));
        }

        // ---- item 7: the wake's words -------------------------------------------------------------------------------------

        [Fact] public void The_wake_line_tells_the_truth_for_each_state()
        {
            Assert.Equal("the test server is up, nothing to wake", Engine.Wake.LogWords("awake", true));
            Assert.Equal("the test server is switched off, and Play does not start it", Engine.Wake.LogWords("off", true));
            Assert.Equal("the test server is already starting, stopping or restarting", Engine.Wake.LogWords("busy", true));
            Assert.Equal("the live site can't reach the test server's site (the test stack may be down)", Engine.Wake.LogWords("test_unreachable", true));
            Assert.Equal("the site has no word from the server's control panel right now", Engine.Wake.LogWords("unreachable", false));
            Assert.True(Engine.Wake.RefusedText.ContainsKey("test_unreachable"));
        }
    }
}

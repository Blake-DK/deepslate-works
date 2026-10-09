using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Xunit;

namespace DeepslateWorks.Tests
{
    // docs/45: the launcher's Test section, version one. A Play from it is the same run with its target set to "test":
    // the test pack in its own game folder, its own profile, its own state; the live folder is never touched, and a live
    // Play never touches the test folder.

    [Collection("env")]
    public class TestSectionTests
    {
        static byte[] B(string s) => Encoding.UTF8.GetBytes(s);
        static string TestDir => Path.Combine(Env.Root, Env.TestDirName);
        static Dictionary<string, string> Jars(string dir) => Directory.Exists(Path.Combine(dir, "mods")) ? Directory.GetFiles(Path.Combine(dir, "mods"), "*.jar").ToDictionary(Path.GetFileName, f => FakeSite.Sha(File.ReadAllBytes(f))) : new Dictionary<string, string>();
        static Run TestRun() => new Run { UpdateOnly = true, NoLaunch = true, AllowAll = true, Target = "test" };

        [Fact] public void Only_the_runs_own_paths_follow_the_target_and_the_sign_in_is_shared()
        {
            using (new Scratch())
            {
                var liveDir = Env.DataDir;
                var liveToken = Env.TokenFile;
                Env.Target = "test";
                try
                {
                    Assert.Equal(TestDir, Env.DataDir);
                    Assert.Equal(Path.Combine(TestDir, "installed.json"), Env.InstalledFile);
                    Assert.Equal(liveToken, Env.TokenFile);   // one sign-in
                    Assert.Equal(Path.Combine(liveDir, "installed.json"), Env.LiveInstalledFile);
                    Assert.EndsWith("/api/app/test/manifest", Env.ManifestUrl);
                    Assert.EndsWith("/api/app/test/wake", Env.WakeUrl);
                    Assert.Equal(Engine.TestPackListPath, Engine.PackListPath);
                    Assert.NotEqual(Engine.LivePackListPath, Engine.PackListPath);
                }
                finally { Env.Target = "live"; }
                Assert.Equal(liveDir, Env.DataDir);
                Assert.EndsWith("/api/modpack/manifest", Env.ManifestUrl);
            }
        }

        [Fact] public void A_test_run_reports_as_test_play_whatever_kind_of_run_it_is()
        {
            Assert.Equal("test_play", new Run { Target = "test" }.ReportMode);
            Assert.Equal("test_play", new Run { Target = "test", UpdateOnly = true, Mode = "update" }.ReportMode);
            Assert.Equal("play", new Run { Mode = "play" }.ReportMode);
        }

        [WindowsFact] public void Test_Play_installs_the_test_pack_into_its_own_folder_and_leaves_the_live_one_alone()
        {
            using (var f = new FakeSite())
            {
                // the live game, as a live Play left it
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") }, { "cataclysm.jar", B("boss mod") }, { "curios.jar", B("curios") } };
                Assert.Equal("done", Engine.Execute(f.Update()));
                var liveJars = Jars(Env.LiveDataDir);
                var liveInstalled = File.ReadAllText(Env.LiveInstalledFile);
                var livePackList = File.ReadAllText(Engine.LivePackListPath);
                var liveCalls = f.Calls.Count;
                f.Reports.Clear();

                // the test pack: the season mods gone; and a jar no test manifest lists already in the test folder
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") } };
                Directory.CreateDirectory(Path.Combine(TestDir, "mods"));
                File.WriteAllText(Path.Combine(TestDir, "mods", "leftover.jar"), "not in the test manifest");
                Assert.Equal("done", Engine.Execute(TestRun()));
                Assert.Equal("live", Env.Target);   // put back when the run ends

                Assert.Equal(f.Wanted(), Jars(TestDir));               // exactly the test pack: leftover.jar removed
                Assert.Equal(liveJars, Jars(Env.LiveDataDir));          // the live mods untouched
                Assert.Equal(liveInstalled, File.ReadAllText(Env.LiveInstalledFile));
                Assert.Equal(livePackList, File.ReadAllText(Engine.LivePackListPath));
                Assert.True(File.Exists(Path.Combine(TestDir, "installed.json")));
                Assert.Equal(f.Hash, J.Str(Json.ReadFile(Engine.TestPackListPath), "hash"));
                var testCalls = f.Calls.Skip(liveCalls).ToList();
                Assert.Contains(testCalls, c => c.Contains("/api/app/test/manifest"));
                Assert.DoesNotContain(testCalls, c => c.Contains("/api/modpack/manifest"));
                Assert.Contains("\"mode\":\"test_play\"", f.Reports.Last());
            }
        }

        [WindowsFact] public void A_live_Play_after_a_test_one_never_touches_the_test_folder()
        {
            using (var f = new FakeSite())
            {
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") } };
                Assert.Equal("done", Engine.Execute(TestRun()));
                var testJars = Jars(TestDir);
                var testInstalled = File.ReadAllText(Path.Combine(TestDir, "installed.json"));
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") }, { "cataclysm.jar", B("boss mod") } };
                Assert.Equal("done", Engine.Execute(f.Update()));
                Assert.Equal(f.Wanted(), Jars(Env.LiveDataDir));
                Assert.Equal(testJars, Jars(TestDir));
                Assert.Equal(testInstalled, File.ReadAllText(Path.Combine(TestDir, "installed.json")));
            }
        }
    }
}

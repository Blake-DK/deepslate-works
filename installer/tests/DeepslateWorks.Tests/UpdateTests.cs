using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.3.0 (planner 2026-10-02): the Update button. It runs exactly what Play runs before the launch (Engine.Execute
    // with run.UpdateOnly) and stops there.

    /// <summary>A stand-in site and PC for whole runs of the install steps: a mod list, its files, Java, NeoForge, the launcher.</summary>
    sealed class FakeSite : IDisposable
    {
        public readonly Scratch S = new Scratch();
        public readonly List<string> Reports = new List<string>();
        public readonly List<string> Calls = new List<string>();
        public int Downloads;
        public Dictionary<string, byte[]> Files = new Dictionary<string, byte[]>();
        public string Neo = "21.1.209";
        readonly Action<int> realSleep = Engine.Sleep;
        readonly Action<string> realOpen = Engine.OpenUrl;
        readonly Func<string, string> realAsk = Engine.AskJava;
        readonly Func<bool> realGame = Engine.GameRunningNow;
        public bool GameRunning;
        public int Opened;

        public FakeSite()
        {
            Engine.Sleep = _ => { };
            Engine.OpenUrl = _ => Opened++;
            Engine.AskJava = _ => "openjdk version \"21.0.4\" 2024-07-16 LTS\r\n";
            Engine.GameRunningNow = () => GameRunning;
            Directory.CreateDirectory(Path.GetDirectoryName(Env.Profiles));
            File.WriteAllText(Env.Profiles, "{ \"profiles\": {}, \"version\": 3 }");
            var java = Path.Combine(Env.Minecraft, @"runtime\java-runtime-delta\windows-x64\java-runtime-delta\bin\java.exe");
            Directory.CreateDirectory(Path.GetDirectoryName(java)); File.WriteAllText(java, "");
            Directory.CreateDirectory(Path.Combine(Env.Minecraft, "versions", "neoforge-" + Neo));
            Directory.CreateDirectory(Env.DataDir);
            File.WriteAllText(Env.TokenFile, "{\"token\":\"tok-123456789012345678901234\"}");
            Http.Fake = (m, u, b) =>
            {
                Calls.Add(m + " " + u);
                if (u.StartsWith(Env.ManifestUrl)) return Tuple.Create(200, Manifest());
                if (u == Env.ReportUrl) { Reports.Add(b); return Tuple.Create(200, "{}"); }
                if (u == Env.WakeUrl) return Tuple.Create(202, "{\"result\":\"started\",\"wake\":{\"phase\":\"waking\"}}");
                return Tuple.Create(404, "{}");
            };
            Http.FakeDownload = (url, outFile) => { Downloads++; File.WriteAllBytes(outFile, Files[url.Substring(url.LastIndexOf('/') + 1)]); return true; };
        }

        public static string Sha(byte[] b) { using (var h = SHA512.Create()) return string.Concat(h.ComputeHash(b).Select(x => x.ToString("x2"))); }
        public string Hash => Sha(Encoding.UTF8.GetBytes(string.Join(",", Files.Keys.OrderBy(k => k).Select(k => k + Sha(Files[k])))));

        public string Manifest()
        {
            var files = string.Join(",", Files.Select(kv => string.Format("{{\"slug\":\"{0}\",\"name\":\"{0}\",\"filename\":\"{1}\",\"url\":\"https://cdn.example/{1}\",\"sha512\":\"{2}\",\"size\":{3},\"side\":\"both\"}}", kv.Key.Replace(".jar", ""), kv.Key, Sha(kv.Value), kv.Value.Length)));
            return "{\"name\":\"Deepslate Works\",\"version\":\"0.1.0+" + Hash.Substring(0, 8) + "\",\"hash\":\"" + Hash + "\",\"minecraft\":\"1.21.1\",\"neoforge\":\"" + Neo + "\",\"server_address\":\"play.example\",\"profile\":{\"id\":\"deepslate-works\",\"dir\":\".minecraft-deepslate-works\",\"icon\":\"Grass\"},\"ram\":{\"min_gb\":4,\"max_gb\":8},\"render_distance\":8,\"simulation_distance\":6,\"config_url\":null,\"files\":[" + files + "],\"configs\":[],\"installer\":null,\"branding\":null}";
        }

        public string ModsDir => Path.Combine(Env.DataDir, "mods");
        public Dictionary<string, string> InMods() => Directory.Exists(ModsDir) ? Directory.GetFiles(ModsDir, "*.jar").ToDictionary(Path.GetFileName, f => Sha(File.ReadAllBytes(f))) : new Dictionary<string, string>();
        public Dictionary<string, string> Wanted() => Files.ToDictionary(kv => kv.Key, kv => Sha(kv.Value));

        public Run Update() => new Run { UpdateOnly = true, NoLaunch = true, AllowAll = true };
        public Run Play() => new Run { AllowAll = true, NoLaunch = false };

        public void Dispose()
        {
            Engine.Sleep = realSleep; Engine.OpenUrl = realOpen; Engine.AskJava = realAsk; Engine.GameRunningNow = realGame;
            S.Dispose();
        }
    }

    [Collection("env")]
    public class UpdateRunTests
    {
        static byte[] B(string s) => Encoding.UTF8.GetBytes(s);

        [WindowsFact] public void Update_with_a_newer_pack_brings_the_mods_folder_to_the_lockfile_and_never_starts_the_launcher()
        {
            using (var f = new FakeSite())
            {
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") }, { "tacz.jar", B("tacz r6") }, { "old.jar", B("old") } };
                Assert.Equal("done", Engine.Execute(f.Update()));
                Assert.Equal(f.Wanted(), f.InMods());
                // the site moves on: tacz r7, old.jar gone, a new one
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") }, { "tacz.jar", B("tacz r7") }, { "veinminer.jar", B("vm 2.4") } };
                var lines = new List<string>();
                var run = f.Update(); run.Sink = o => lines.Add(J.Str(o, "t") + ":" + J.Str(o, "text"));
                Assert.Equal("done", Engine.Execute(run));
                Assert.Equal(f.Wanted(), f.InMods());   // the lockfile's files, and nothing else
                Assert.DoesNotContain(lines, l => l.StartsWith("launched") || l.StartsWith("ready"));
                Assert.Equal(0, f.Opened);   // no browser, no launcher
                Assert.DoesNotContain(f.Calls, c => c.Contains("/api/play/wake"));   // Update never wakes the server
                Assert.Contains("\"mode\":\"update_only\"", f.Reports.Last());
                Assert.Contains("\"outcome\":\"ok\"", f.Reports.Last());
                Assert.Equal(f.Hash, J.Str(Json.ReadFile(Env.InstalledFile), "hash"));
                Assert.Equal(f.Hash, J.Str(Engine.ReadPackList(Engine.PackListPath), "hash"));
            }
        }

        [WindowsFact] public void Update_with_nothing_new_changes_nothing_and_says_so()
        {
            using (var f = new FakeSite())
            {
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") }, { "tacz.jar", B("tacz r7") } };
                Engine.Execute(f.Update());
                var before = Directory.GetFiles(f.ModsDir).ToDictionary(p => p, File.GetLastWriteTimeUtc);
                var downloads = f.Downloads;
                var changed = new List<string>();
                var run = f.Update(); run.Sink = o => { if (J.Str(o, "t") == "changed") changed.Add(J.Str(o, "text")); };
                Assert.Equal("done", Engine.Execute(run));
                Assert.Equal(downloads, f.Downloads);
                Assert.Empty(changed);
                Assert.Equal(before, Directory.GetFiles(f.ModsDir).ToDictionary(p => p, File.GetLastWriteTimeUtc));
                // and the check, against the same site, says there is nothing to do
                var site = Json.Parse("{\"pack\":{\"hash\":\"" + f.Hash + "\",\"files\":[" + string.Join(",", f.Wanted().Select(kv => "{\"filename\":\"" + kv.Key + "\",\"sha512\":\"" + kv.Value + "\"}")) + "],\"configs\":[]},\"app\":{\"version\":null},\"extras\":[]}");
                var w = UpdateCheck.Compare(site, Engine.ReadPackList(Engine.PackListPath), Json.ReadFile(Env.InstalledFile), null, false, Env.Version, new DateTime(2026, 10, 2, 15, 42, 0));
                Assert.False(w.Any);
                Assert.Equal("Checked at 15:42. Nothing to update.", UpdateCheck.Line(w));
            }
        }

        [WindowsFact] public void Update_while_the_game_is_running_downloads_and_finishes_after_the_game_closes()
        {
            using (var f = new FakeSite())
            {
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") }, { "tacz.jar", B("tacz r6") } };
                Engine.Execute(f.Update());
                var old = f.InMods();
                f.Files = new Dictionary<string, byte[]> { { "create.jar", B("create 6.0.6") }, { "tacz.jar", B("tacz r7") } };
                f.GameRunning = true;
                var reports = f.Reports.Count;
                Assert.Throws<UpdateDeferred>(() => Engine.Execute(f.Update()));
                Assert.Equal(old, f.InMods());   // nothing in mods\ touched while the game runs
                Assert.True(File.Exists(Path.Combine(Env.DataDir, Engine.WaitingFolder, "tacz.jar")));
                Assert.Equal(reports, f.Reports.Count);   // no report until it has finished
                var downloads = f.Downloads;
                f.GameRunning = false;   // the game closes; the window runs the same Update again
                Assert.Equal("done", Engine.Execute(f.Update()));
                Assert.Equal(f.Wanted(), f.InMods());
                Assert.Equal(downloads, f.Downloads);   // moved in from .waiting\, not fetched twice
                Assert.Empty(Directory.GetFiles(Path.Combine(Env.DataDir, Engine.WaitingFolder)));
                Assert.Contains("\"mode\":\"update_only\"", f.Reports.Last());
            }
        }
    }

    [Collection("env")]
    public class UpdateCheckTests
    {
        static object Site(string files, string app = null, string configs = "[]", string extras = "[]", string hash = "h2") =>
            Json.Parse("{\"pack\":{\"hash\":\"" + hash + "\",\"files\":[" + files + "],\"configs\":" + configs + "},\"app\":{\"version\":" + (app == null ? "null" : "\"" + app + "\"") + "},\"extras\":" + extras + "}");
        static readonly object Ours = Json.Parse("{\"hash\":\"h1\",\"files\":[{\"filename\":\"a.jar\",\"sha512\":\"aa\"},{\"filename\":\"b.jar\",\"sha512\":\"bb\"},{\"filename\":\"c.jar\",\"sha512\":\"cc\"}],\"configs\":[{\"path\":\"x.toml\",\"sha256\":\"11\"}]}");
        static readonly object Installed = Json.Parse("{\"hash\":\"h1\"}");
        static readonly DateTime At = new DateTime(2026, 10, 2, 15, 42, 0);

        [Fact] public void Says_what_is_waiting_in_plain_words()
        {
            // b changed, c gone, d new: 3 mods
            var w = UpdateCheck.Compare(Site("{\"filename\":\"a.jar\",\"sha512\":\"aa\"},{\"filename\":\"b.jar\",\"sha512\":\"b2\"},{\"filename\":\"d.jar\",\"sha512\":\"dd\"}", "9.9.9", "[{\"path\":\"x.toml\",\"sha256\":\"11\"}]"), Ours, Installed, null, false, "3.3.0", At);
            Assert.Equal(3, w.ModsChanged);
            Assert.Equal("New pack: 3 mods changed. New version of this app.", UpdateCheck.Line(w));
            Assert.Equal("● Update", UpdateCheck.Button(w, false));
            Assert.Equal("Updating…", UpdateCheck.Button(w, true));
        }

        [Fact] public void Settings_only_extras_and_nothing()
        {
            var same = "{\"filename\":\"a.jar\",\"sha512\":\"aa\"},{\"filename\":\"b.jar\",\"sha512\":\"bb\"},{\"filename\":\"c.jar\",\"sha512\":\"cc\"}";
            var cfg = UpdateCheck.Compare(Site(same, null, "[{\"path\":\"x.toml\",\"sha256\":\"22\"}]"), Ours, Installed, null, false, "3.3.0", At);
            Assert.Equal("New pack settings.", UpdateCheck.Line(cfg));
            var queued = UpdateCheck.Compare(Site(same, null, "[{\"path\":\"x.toml\",\"sha256\":\"11\"}]", "[]", "h1"), Ours, Installed, null, true, "3.3.0", At);
            Assert.Equal("Your extras changed.", UpdateCheck.Line(queued));
            var none = UpdateCheck.Compare(Site(same, "3.3.0", "[{\"path\":\"x.toml\",\"sha256\":\"11\"}]", "[]", "h1"), Ours, Installed, null, false, "3.3.0", At);
            Assert.False(none.Any);
            Assert.Equal("Checked at 15:42. Nothing to update.", UpdateCheck.Line(none));
            Assert.Equal("✓ Up to date", UpdateCheck.Button(none, false));
            Assert.Equal("Not installed on this PC yet.", UpdateCheck.Line(UpdateCheck.Compare(Site(same), null, null, null, false, "3.3.0", At)));
        }

        [Fact] public void The_check_asks_the_quiet_endpoint_never_the_mod_list()
        {
            using (var s = new Scratch())
            {
                Directory.CreateDirectory(Env.DataDir);
                File.WriteAllText(Env.TokenFile, "{\"token\":\"tok-123456789012345678901234\"}");
                var calls = new List<string>();
                Http.Fake = (m, u, b) => { calls.Add(m + " " + u); return Tuple.Create(200, "{\"pack\":{\"hash\":\"h\",\"files\":[],\"configs\":[]},\"app\":{\"version\":null},\"extras\":[]}"); };
                var w = UpdateCheck.Run(At);
                Assert.Equal(new[] { "GET https://deepslate.example/api/app/updates" }, calls.ToArray());
                Assert.True(w.NotInstalled);
            }
        }

        [Fact] public void The_report_of_an_Update_carries_its_type()
        {
            using (new Scratch())
            foreach (var mode in new[] { "play", "update", "first_install" })
            {
                var r = new Run { UpdateOnly = true, Mode = mode };
                Assert.Equal("update_only", r.ReportMode);
                Assert.Equal("update_only", J.Str(Report.New(r, "ok"), "mode"));
            }
            Assert.Equal("update", new Run { Mode = "update" }.ReportMode);   // a Play that brought a new pack stays what it was
        }

        [Fact] public void Play_pressed_during_an_Update_starts_the_game_once_after_it()
        {
            var q = new PlayQueue();
            Assert.Equal("start", q.Press(false));
            Assert.Equal("wait", q.Press(true));
            Assert.Equal("wait", q.Press(true));        // pressed twice: still one launch
            Assert.Equal("play", q.UpdateEnded(true));
            Assert.Equal("none", q.UpdateEnded(true));  // once
            q.Press(true);
            Assert.Equal("none", q.UpdateEnded(false)); // a failed update starts nothing
        }

        [Fact] public void An_Update_that_restarts_the_app_carries_on_by_itself()
        {
            Assert.Equal(new[] { "-Console", "-Update" }, Args.ForUpdate(new[] { "-Console" }));
            Assert.Equal(new[] { "-Update" }, Args.ForUpdate(new[] { "deepslate://play" }));   // never a link: it would reset the switches
            Assert.Equal(new[] { "-Update" }, Args.ForUpdate(new[] { "-Update" }));
            var a = Args.Parse(new[] { "-Update", "-WaitFor", "123", "-From", "update" });
            Assert.True(a.Update);
            Assert.Contains("-Update", a.ForRestart());
        }
    }

    [Collection("env")]
    public class UpdateWindowTests
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

        [WindowsFact] public void A_must_vote_poll_shuts_Play_and_leaves_Update_working()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = new AppUi(new Run(), true);
                    var w = ui.Window;
                    w.WindowStartupLocation = System.Windows.WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                    w.Show(); ui.Pump();
                    try
                    {
                        ui.SimCheck(new Waiting { ModsChanged = 2, PackNew = true, CheckedAt = DateTime.Now });
                        ui.SimHome(SiteHome.Parse(Json.Parse(HomeSamples.TwoVotes)), "idle");
                        ui.Tick();
                        Assert.False(ui.PlayOpen);
                        Assert.Equal("Vote first, it takes ten seconds", ui.PlayLabel);
                        Assert.True(ui.UpdateOpen);
                        Assert.Equal("● Update", ui.UpdateLabel);
                        Assert.Equal("New pack: 2 mods changed.", ui.UpdateLineText);
                    }
                    finally { w.Close(); }
                });
        }

        [WindowsFact] public void Up_to_date_mid_update_and_the_game_running_read_as_they_should()
        {
            using (new Scratch())
                OnSta(() =>
                {
                    var ui = new AppUi(new Run(), true);
                    var w = ui.Window;
                    w.WindowStartupLocation = System.Windows.WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                    w.Show(); ui.Pump();
                    try
                    {
                        ui.SimUpdating("Setting up the mods");
                        Assert.False(ui.UpdateOpen); Assert.False(ui.PlayOpen);
                        Assert.Equal("Updating…", ui.UpdateLabel);
                        Assert.Equal("Setting up the mods", ui.UpdateLineText);
                        ui.SimUpToDate();
                        Assert.True(ui.PlayOpen);
                        Assert.Equal("✓ Up to date", ui.UpdateLabel);
                        Assert.StartsWith("Checked at ", ui.UpdateLineText);
                        ui.SimCheck(new Waiting { ModsChanged = 1, CheckedAt = DateTime.Now });
                        ui.SimGameRunning();
                        Assert.False(ui.PlayOpen); Assert.False(ui.UpdateOpen);
                        Assert.Equal("Downloaded. Finishes when the game closes.", ui.UpdateLineText);
                    }
                    finally { w.Close(); }
                });
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Xunit;

namespace DeepslateWorks.Tests
{
    // The self test's checks for the install steps (DeepslateWorks.ps1 -SelfTest 2.0.3), with the same expected words.

    [Collection("env")]
    public class EngineLauncherProfileTests
    {
        const string Defaults = "{\"profiles\":{\"a1b2\":{\"created\":\"1970-01-01T00:00:00.000Z\",\"icon\":\"Grass\",\"lastUsed\":\"1970-01-01T00:00:00.000Z\",\"lastVersionId\":\"latest-release\",\"name\":\"\",\"type\":\"latest-release\"},\"c3d4\":{\"created\":\"1970-01-01T00:00:00.000Z\",\"icon\":\"Dirt\",\"lastUsed\":\"1970-01-01T00:00:00.000Z\",\"lastVersionId\":\"latest-snapshot\",\"name\":\"\",\"type\":\"latest-snapshot\"}},\"settings\":{\"crashAssistance\":true,\"enableAdvanced\":false,\"keepLauncherOpen\":false,\"profileSorting\":\"ByLastPlayed\",\"showGameLog\":false},\"version\":3}";
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        static JObj Entry(string version = "neoforge-21.1.252", string xmx = "-Xmx6G", string at = "2026-09-29T10:00:00.000Z")
            => J.O("name", "Deepslate Works", "type", "custom", "lastVersionId", version, "gameDir", @"C:\Users\x\AppData\Roaming\.minecraft-deepslate-works",
                   "javaArgs", xmx, "javaDir", @"C:\java.exe", "icon", "Furnace", "created", at, "lastUsed", at);

        [Fact] public void Profile_is_written_checked_and_kept_with_the_launchers_own()
        {
            using (var s = new Scratch())
            {
                var f = s.P("launcher_profiles.json");
                File.WriteAllText(f, Defaults, Utf8);
                Assert.NotEqual("", Engine.TestLauncherProfile(f, "deepslate-works", "neoforge-21.1.252"));   // a fresh file has no profile of ours
                Engine.SetLauncherProfile(f, "deepslate-works", Entry());
                Assert.Equal("", Engine.TestLauncherProfile(f, "deepslate-works", "neoforge-21.1.252"));
                var bytes = File.ReadAllBytes(f);
                Assert.False(bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF);   // no byte-order mark
                var j = Engine.ReadJson(f);
                Assert.NotNull(J.Get(j, "profiles.a1b2")); Assert.NotNull(J.Get(j, "profiles.c3d4"));
                Assert.Equal("ByLastPlayed", J.Str(j, "settings.profileSorting")); Assert.Equal(3L, J.Long(j, "version"));
                Assert.Equal("deepslate-works", J.Str(j, "selectedProfile"));
                Assert.Equal(@"C:\Users\x\AppData\Roaming\.minecraft-deepslate-works", J.Str(J.Obj(j, "profiles")["deepslate-works"], "gameDir"));   // backslashes survive
                Assert.True(File.Exists(f + ".bak")); Assert.Equal(Defaults, File.ReadAllText(f + ".bak"));
                Assert.False(File.Exists(f + ".deepslate-tmp"));

                Engine.SetLauncherProfile(f, "deepslate-works", Entry("neoforge-21.1.253", "-Xmx4G", "2026-10-05T10:00:00.000Z"));
                j = Engine.ReadJson(f);
                var ours = J.Obj(j, "profiles")["deepslate-works"];
                Assert.Equal("neoforge-21.1.253", J.Str(ours, "lastVersionId"));
                Assert.Equal("-Xmx4G", J.Str(ours, "javaArgs"));
                Assert.Equal(3, J.Obj(j, "profiles").Count);
                Assert.Equal("2026-09-29T10:00:00.000Z", J.Str(ours, "created"));   // keeps the date it was first created
                Assert.Contains("points at", Engine.TestLauncherProfile(f, "deepslate-works", "neoforge-21.1.252"));

                File.WriteAllText(f, Defaults, Utf8);   // what the launcher did on 2026-09-29: back to its two defaults
                Assert.Contains("is not in launcher_profiles.json", Engine.TestLauncherProfile(f, "deepslate-works", "neoforge-21.1.253"));

                File.WriteAllText(f, Defaults, new UTF8Encoding(true));
                Engine.SetLauncherProfile(f, "deepslate-works", Entry());
                Assert.Equal("", Engine.TestLauncherProfile(f, "deepslate-works", "neoforge-21.1.252"));
                Assert.NotEqual(0xEF, File.ReadAllBytes(f)[0]);   // read with a byte-order mark, written back without

                File.WriteAllText(f, "{\"profiles\": {", Utf8);
                Assert.Contains("can't be read", Engine.TestLauncherProfile(f, "deepslate-works", "x"));
                File.Delete(f);
                Assert.Contains("is gone", Engine.TestLauncherProfile(f, "deepslate-works", "x"));
            }
        }

        [Fact] public void Profile_in_a_folder_PowerShell_would_read_as_a_pattern()
        {
            using (var s = new Scratch())
            {
                var odd = s.P("Bra [x] BRAMBL~1");
                Directory.CreateDirectory(odd);
                var pf = Path.Combine(odd, "launcher_profiles.json");
                File.WriteAllText(pf, Defaults, Utf8);
                Engine.SetLauncherProfile(pf, "deepslate-works", Entry());
                Assert.Equal("", Engine.TestLauncherProfile(pf, "deepslate-works", "neoforge-21.1.252"));
            }
        }

        [WindowsFact] public void Finding_the_launcher()
        {
            var run = new Run();
            Assert.Empty(Engine.FindLauncher(run));   // the CI runner has no launcher
            run.PretendRunning = new[] { "MinecraftLauncher" };
            Assert.Contains("MinecraftLauncher", Engine.FindLauncher(run));
        }

        [Fact] public void A_running_launcher_stops_a_write()
        {
            using (var s = new Scratch())
            {
                var run = new Run { PretendRunning = new[] { "MinecraftLauncher" } };
                var lines = new List<JObj>(); run.Sink = lines.Add;
                var e = Assert.Throws<RunFailed>(() => Engine.RequireLauncherClosed(run, "launcher_profiles.json is written"));
                Assert.Equal("Close the Minecraft Launcher (including the tray icon) and run this again", e.Message);
                Assert.Contains(Log.RunLines, l => l.EndsWith("launcher is running (MinecraftLauncher), stopping before: launcher_profiles.json is written"));
                Assert.Equal("fail", J.Str(lines.Last(), "t"));
            }
        }
    }

    [Collection("env")]
    public class EngineOptionsTests
    {
        const string Game = "version:3955\r\nautoJump:false\r\nrenderDistance:8\r\nsimulationDistance:6\r\nlang:en_gb\r\nkey_key.jump:key.keyboard.space\r\nlastServer:mc.dsw.test\r\n";

        [Fact] public void Render_distance()
        {
            using (var s = new Scratch())
            {
                var od = s.P("options [x]"); Directory.CreateDirectory(od);
                var of = Path.Combine(od, "options.txt");
                var r = Engine.SetRenderDistance(of, null, 12, 8);
                Assert.Equal("written", r.Status); Assert.Equal(12, r.Ours);
                Assert.Equal("renderDistance:12\r\nsimulationDistance:8\r\nfullscreen:false\r\nchatLinks:true\r\nchatLinksPrompt:true\r\n", File.ReadAllText(of));
                Assert.Equal("Render distance set to 12", r.Text);

                File.WriteAllText(of, Game);
                r = Engine.SetRenderDistance(of, 8L, 12, 8);
                Assert.Equal("changed", r.Status); Assert.Equal(12, r.Ours);
                Assert.Equal("Render distance 8 \u2192 12", r.Text);
                Assert.Equal(Game.Replace("renderDistance:8", "renderDistance:12").Replace("simulationDistance:6", "simulationDistance:8"), File.ReadAllText(of));

                File.WriteAllText(of, Game.Replace("renderDistance:8", "renderDistance:16"));
                r = Engine.SetRenderDistance(of, 8L, 12, 8);
                Assert.Equal("left", r.Status); Assert.Equal(8, r.Ours);
                Assert.Equal("Render distance left at 16 (set by you)", r.Text);
                Assert.Equal(Game.Replace("renderDistance:8", "renderDistance:16"), File.ReadAllText(of));

                File.WriteAllText(of, Game);
                r = Engine.SetRenderDistance(of, null, 10, 8);   // installed before 1.5.4: 8 counts as its own
                Assert.Equal("changed", r.Status);
                Assert.Matches(new Regex("(?m)^renderDistance:10\r?$"), File.ReadAllText(of));
                r = Engine.SetRenderDistance(of, 10L, 10, 8);
                Assert.Equal("same", r.Status); Assert.Equal(10, r.Ours);
                r = Engine.SetRenderDistance(of, 8L, 10, 8);     // changed on a run that failed before it could remember it
                Assert.Equal("same", r.Status); Assert.Equal(10, r.Ours);

                File.WriteAllText(of, "renderDistance:8\nfullscreen:false\n");
                Engine.SetRenderDistance(of, null, 12, 8);
                Assert.Equal("renderDistance:12\nfullscreen:false\nsimulationDistance:8\n", File.ReadAllText(of));

                File.WriteAllText(of, Game);
                Assert.Equal("changed", Engine.SetRenderDistance(of, "banana", 12, 8).Status);   // nonsense in installed.json counts as 8
            }
        }

        [Fact] public void Chat_links()
        {
            using (var s = new Scratch())
            {
                var of = s.P("options.txt");
                Engine.SetRenderDistance(of, null, 12, 8);
                Assert.Matches(new Regex("(?m)^chatLinks:true\r?$"), File.ReadAllText(of));
                Assert.Matches(new Regex("(?m)^chatLinksPrompt:true\r?$"), File.ReadAllText(of));
                Assert.Null(Engine.SetChatLinks(of));
                var withOff = Game.Replace("lang:en_gb", "chatLinks:false\r\nchatLinksPrompt:false\r\nlang:en_gb");
                File.WriteAllText(of, withOff);
                var said = Engine.SetChatLinks(of);
                Assert.StartsWith("Chat links switched on", said);
                Assert.Equal(withOff.Replace("chatLinks:false", "chatLinks:true"), File.ReadAllText(of));
                Assert.Matches(new Regex("(?m)^chatLinksPrompt:false\r?$"), File.ReadAllText(of));
                File.WriteAllText(of, Game);
                Assert.Null(Engine.SetChatLinks(of));
                Assert.Equal(Game, File.ReadAllText(of));
            }
        }

        [Fact] public void Servers_dat_is_the_same_bytes_as_2_0()
        {
            var b = Engine.ServersDat("Deepslate Works", "mc.dsw.test");
            var want = new List<byte> { 10, 0, 0, 9, 0, 7 };
            want.AddRange(Encoding.ASCII.GetBytes("servers"));
            want.AddRange(new byte[] { 10, 0, 0, 0, 1, 8, 0, 4 });
            want.AddRange(Encoding.ASCII.GetBytes("name"));
            want.AddRange(new byte[] { 0, 15 }); want.AddRange(Encoding.ASCII.GetBytes("Deepslate Works"));
            want.AddRange(new byte[] { 8, 0, 2 }); want.AddRange(Encoding.ASCII.GetBytes("ip"));
            want.AddRange(new byte[] { 0, 11 }); want.AddRange(Encoding.ASCII.GetBytes("mc.dsw.test"));
            want.AddRange(new byte[] { 0, 0 });
            Assert.Equal(want.ToArray(), b);
            Assert.Equal(new byte[] { 0, 0 }, Engine.ServersDat("x", null).Skip(Engine.ServersDat("x", null).Length - 4).Take(2).ToArray());   // no address: an empty string
        }
    }

    [Collection("env")]
    public class EngineModsTests
    {
        static string Sha(byte[] b) { using (var s = SHA512.Create()) return BitConverter.ToString(s.ComputeHash(b)).Replace("-", "").ToLowerInvariant(); }
        static string State(string md) => string.Join(";", Directory.GetFiles(md).OrderBy(x => x, StringComparer.Ordinal).Select(f => Path.GetFileName(f) + "=" + File.ReadAllText(f)));

        [Fact] public void Downloads_land_in_mods_only_when_complete()
        {
            using (var s = new Scratch())
            {
                var gd = s.P("game [x]");
                var md = Path.Combine(gd, "mods"); var stg = Path.Combine(gd, ".downloading");
                Directory.CreateDirectory(md);
                File.WriteAllText(Path.Combine(md, "create-6.0.jar"), "old jar");
                var jarBytes = Encoding.UTF8.GetBytes("a whole jar");
                var jarSha = Sha(jarBytes);
                var was = State(md);
                var dest = Path.Combine(md, "create-6.1.jar");

                Assert.ThrowsAny<Exception>(() => Engine.SaveModFile("https://cdn.modrinth.com/x.jar", dest, jarSha, stg,
                    (url, o) => { File.WriteAllBytes(o, Encoding.UTF8.GetBytes("a who")); throw new IOException("the run was killed here"); }));
                Assert.Equal(was, State(md));   // a download cut off half-way leaves mods\ exactly as it was
                Assert.True(File.Exists(Path.Combine(stg, "create-6.1.jar.part")));

                File.WriteAllText(Path.Combine(md, "old-mod.jar.part"), "from 1.4.x");
                Engine.ClearLeftovers(gd);
                Assert.Empty(Directory.GetFiles(stg));
                Assert.False(File.Exists(Path.Combine(md, "old-mod.jar.part")));
                Assert.Contains(Log.RunLines, l => l.EndsWith("removing a part file left by an earlier run: old-mod.jar.part"));

                var r = Engine.SaveModFile("https://cdn.modrinth.com/x.jar", dest, jarSha, stg, (url, o) => File.WriteAllText(o, "not what the mod list says"));
                Assert.Equal("wrong", r);
                Assert.Equal(was, State(md));
                Assert.Empty(Directory.GetFiles(stg));

                r = Engine.SaveModFile("https://cdn.modrinth.com/x.jar", dest, jarSha, stg, (url, o) => File.WriteAllBytes(o, jarBytes));
                Assert.Equal("", r);
                Assert.Equal("a whole jar", File.ReadAllText(dest));
                Assert.Empty(Directory.GetFiles(stg));
            }
        }

        [Fact] public void Downloads_go_through_Http_Download()
        {
            using (var s = new Scratch())
            {
                var jarBytes = Encoding.UTF8.GetBytes("a whole jar");
                Http.FakeDownload = (url, o) => { File.WriteAllBytes(o, jarBytes); return true; };
                var md = s.P("mods"); Directory.CreateDirectory(md);
                var r = Engine.SaveModFile("https://cdn.modrinth.com/x.jar", Path.Combine(md, "a.jar"), Sha(jarBytes).ToUpperInvariant(), s.P(".downloading"), (u, o) => Http.Download(u, o));
                Assert.Equal("", r);   // the checksum is compared as PowerShell's -eq did: case does not matter
                Assert.Equal("a whole jar", File.ReadAllText(Path.Combine(md, "a.jar")));
            }
        }

        [Fact] public void Temporary_files_that_are_not_there_never_stop_the_run()
        {
            using (var s = new Scratch())
            {
                var odd = s.P("Bra [x] BRAMBL~1"); Directory.CreateDirectory(odd);
                var jar = Path.Combine(odd, "neoforge-21.1.252-installer.jar");
                File.WriteAllText(jar, "jar");
                Log.RemoveTemp(jar);
                Assert.False(File.Exists(jar));
                Log.RemoveTemp(jar); Log.RemoveTemp(s.P("nothing [here]", "x.jar")); Log.RemoveTemp(null);
            }
        }

        [Fact] public void A_config_zip_is_unpacked_over_the_game_folder()
        {
            using (var s = new Scratch())
            {
                var gd = s.P("game"); Directory.CreateDirectory(Path.Combine(gd, "config"));
                File.WriteAllText(Path.Combine(gd, "config", "a.toml"), "old");
                var zip = s.P("c.zip");
                using (var z = System.IO.Compression.ZipFile.Open(zip, System.IO.Compression.ZipArchiveMode.Create))
                {
                    using (var w = new StreamWriter(z.CreateEntry("config/a.toml").Open())) w.Write("new");
                    using (var w = new StreamWriter(z.CreateEntry("config/sub/b.toml").Open())) w.Write("b");
                }
                Engine.ExtractZip(zip, gd);
                Assert.Equal("new", File.ReadAllText(Path.Combine(gd, "config", "a.toml")));
                Assert.Equal("b", File.ReadAllText(Path.Combine(gd, "config", "sub", "b.toml")));
            }
        }
    }

    [Collection("env")]
    public class EngineJavaTests : IDisposable
    {
        readonly Func<string, string> realAsk = Engine.AskJava;
        public void Dispose() => Engine.AskJava = realAsk;

        // Stand-ins for java that say their version the way java does: on stderr, and nothing on stdout.
        static readonly Dictionary<string, string[]> Stubs = new Dictionary<string, string[]>
        {
            { "java8", new[] { "java version \"1.8.0_503\"", "Java(TM) SE Runtime Environment (build 1.8.0_503-b13)" } },
            { "java21", new[] { "java version \"21.0.12\" 2026-07-21 LTS", "Java(TM) SE Runtime Environment (build 21.0.12+8-LTS-250)" } },
            { "javaopts", new[] { "Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8", "openjdk version \"21.0.4\" 2024-07-16 LTS" } },
            { "javamute", new[] { "Error: could not open jvm.cfg" } },
        };

        /// <summary>The seam: what each stand-in writes, stderr first and stdout empty; a path that is not there throws, as starting it would.</summary>
        static void UseStubs(Scratch s)
        {
            Engine.AskJava = exe =>
            {
                foreach (var k in Stubs.Keys) if (exe == s.P(k, "java.exe")) return string.Join("\r\n", Stubs[k]) + "\r\n" + "\n";
                throw new System.ComponentModel.Win32Exception(2, "The system cannot find the file specified");
            };
        }

        [Fact] public void Version_lines()
        {
            Assert.Equal(8, Engine.GetJavaMajor("java version \"1.8.0_503\""));
            Assert.Equal(21, Engine.GetJavaMajor("java version \"21.0.12\" 2026-07-21 LTS"));
            Assert.Equal(17, Engine.GetJavaMajor("openjdk version \"17.0.9\" 2023-10-17"));
            Assert.Equal(25, Engine.GetJavaMajor("openjdk version \"25\" 2025-09-16"));
            Assert.Equal(0, Engine.GetJavaMajor(null));
            Assert.Equal(0, Engine.GetJavaMajor(""));
            Assert.Equal(0, Engine.GetJavaMajor("Error: could not open jvm.cfg"));
            Assert.Equal(0, Engine.GetJavaMajor("version 21"));
        }

        [Fact] public void Selecting_java()
        {
            using (var s = new Scratch())
            {
                UseStubs(s);
                string J8 = s.P("java8", "java.exe"), J21 = s.P("java21", "java.exe"), Opts = s.P("javaopts", "java.exe"), Mute = s.P("javamute", "java.exe");
                var noLauncher = s.P("no-launcher-java.exe");
                var noJre = s.P("no-runtime");
                var jre = s.P("runtime");
                var jreBin = Path.Combine(jre, "jdk-21.0.4+7-jre", "bin");
                Directory.CreateDirectory(jreBin);
                File.WriteAllText(Path.Combine(jreBin, "java.exe"), "stand-in");

                Assert.Equal("java version \"1.8.0_503\"", Engine.GetJavaVersionText(J8));   // stderr only, and nothing thrown
                var c = Engine.SelectJava(noLauncher, J8, noJre);
                Assert.Null(c.Path); Assert.Null(c.Source); Assert.Equal("java version \"1.8.0_503\"", c.PassedOver);
                c = Engine.SelectJava(noLauncher, J21, noJre);
                Assert.Equal(J21, c.Path); Assert.Equal("on PATH", c.Source); Assert.Equal("Using Java 21 from PATH", c.Say); Assert.Null(c.PassedOver);
                c = Engine.SelectJava(noLauncher, J8, jre);
                Assert.Contains("jdk-21.0.4+7-jre", c.Path); Assert.EndsWith("java.exe", c.Path);
                Assert.Equal("downloaded on an earlier run", c.Source); Assert.Equal("Using the Java we downloaded last time", c.Say);
                Assert.Equal("java version \"1.8.0_503\"", c.PassedOver);
                c = Engine.SelectJava(noLauncher, Opts, noJre);
                Assert.Equal("on PATH", c.Source);
                Assert.Equal("openjdk version \"21.0.4\" 2024-07-16 LTS", Engine.GetJavaVersionText(Opts));
                c = Engine.SelectJava(noLauncher, Mute, noJre);
                Assert.Null(c.Path); Assert.Equal("a java that did not say its version", c.PassedOver);
                var gone = s.P("gone", "java.exe");
                c = Engine.SelectJava(noLauncher, gone, noJre);
                Assert.Null(c.Path); Assert.Null(Engine.GetJavaVersionText(gone));
                Directory.CreateDirectory(Path.GetDirectoryName(J21));
                File.WriteAllText(J21, "the launcher's own");   // as a file that is there
                c = Engine.SelectJava(J21, J8, jre);
                Assert.Equal(J21, c.Path); Assert.Equal("the launcher's own", c.Source); Assert.Equal("Using the launcher's own Java", c.Say); Assert.Null(c.PassedOver);
                c = Engine.SelectJava(noLauncher, "", noJre);
                Assert.Null(c.Path); Assert.Null(c.PassedOver);
                Assert.Null(Engine.GetJavaVersionText(null));
            }
        }

        /// <summary>The real process: .cmd stand-ins that write only to stderr, as the self test's were on Windows.</summary>
        [WindowsFact] public void Real_java_stand_ins_on_stderr_only()
        {
            using (var s = new Scratch())
            {
                string Stub(string name)
                {
                    var dir = s.P(name); Directory.CreateDirectory(dir);
                    var f = Path.Combine(dir, "java.cmd");
                    File.WriteAllText(f, "@echo off\r\n" + string.Join("\r\n", Stubs[name].Select(l => "echo " + l + " 1>&2")) + "\r\n", Encoding.ASCII);
                    return f;
                }
                Assert.Equal("java version \"1.8.0_503\"", Engine.GetJavaVersionText(Stub("java8")));
                Assert.Equal("openjdk version \"21.0.4\" 2024-07-16 LTS", Engine.GetJavaVersionText(Stub("javaopts")));
                Assert.Null(Engine.GetJavaVersionText(Stub("javamute")));
                Assert.Null(Engine.GetJavaVersionText(s.P("gone", "java.exe")));
                var c = Engine.SelectJava(s.P("none.exe"), Stub("java21"), s.P("no-runtime"));
                Assert.Equal("Using Java 21 from PATH", c.Say);
            }
        }
    }

    [Collection("env")]
    public class EngineSiteTests : IDisposable
    {
        readonly Action<int> realSleep = Engine.Sleep;
        readonly Action<string> realOpen = Engine.OpenUrl;
        public void Dispose() { Engine.Sleep = realSleep; Engine.OpenUrl = realOpen; }

        [Fact] public void Kind_of_run()
        {
            var prev = J.O("version", "0.1.0+aaaaaaaa", "hash", "aaaa");
            Assert.Equal("first_install", Engine.GetRunMode(null, "aaaa"));
            Assert.Equal("update", Engine.GetRunMode(prev, "bbbb"));
            Assert.Equal("play", Engine.GetRunMode(prev, "aaaa"));
            Assert.Equal("play", Engine.GetRunMode(prev, ""));   // before the mod list is read
        }

        static Func<string, object> Answer(List<string> asked, string json) => m => { asked.Add(m); return Json.Parse(json); };
        static Func<string, object> Refuse(List<string> asked, string code) => m => { asked.Add(m); throw new Exception("{\"error\":{\"code\":\"" + code + "\",\"message\":\"no\"}}"); };

        [Fact] public void Wake_on_play()
        {
            using (var s = new Scratch())
            {
                var run = new Run(); var lines = new List<JObj>(); run.Sink = lines.Add;
                var asked = new List<string>();
                var w = new Engine.Wake();
                Assert.Equal("waking", w.Request(run, Answer(asked, "{\"result\":\"started\",\"wake\":{\"phase\":\"waking\"}}")));
                Assert.Equal("POST", string.Join(",", asked));
                Assert.Contains(lines, l => J.Str(l, "t") == "note" && J.Str(l, "text") == "Waking the server, ready in about 30 s");
                Assert.Equal("waking", w.Request(run, Answer(asked, "{\"result\":\"already\",\"wake\":{\"phase\":\"waking\"}}")));
                Assert.Equal("awake", w.Request(run, Answer(asked, "{\"result\":\"awake\",\"wake\":{\"phase\":\"idle\"}}")));

                w = new Engine.Wake();
                Assert.Equal("no", w.Request(run, Refuse(asked, "off"))); Assert.Equal("off", w.Refused);
                Assert.Equal("The server is switched off. Ask Alex in Discord.", Engine.GateMessage(new Exception("{\"error\":{\"code\":\"server_offline\"}}"), w.Refused));
                w = new Engine.Wake();
                Assert.Equal("no", w.Request(run, Refuse(asked, "crashed"))); Assert.Equal("crashed", w.Refused);
                w = new Engine.Wake();
                Assert.Equal("no", w.Request(run, m => throw new Exception("The remote name could not be resolved"))); Assert.Null(w.Refused);
                Assert.Contains(Log.RunLines, l => l.EndsWith("wake: not started: the site could not be asked (The remote name could not be resolved)"));

                var seq = new Queue<string>(new[] { "waking", "waking", "ready" });
                Func<string, object> seqCall = m => { var p = seq.Count > 1 ? seq.Dequeue() : seq.Peek(); return J.O("wake", J.O("phase", p)); };
                int slept = 0;
                Assert.Equal("ready", w.Watch(run, seqCall, x => slept += x));
                Assert.Equal(10, slept);
                Assert.Contains(lines, l => J.Str(l, "text") == "Server ready");
                seq = new Queue<string>(new[] { "waking", "failed" });
                Assert.Equal("failed", w.Watch(run, seqCall, x => { }));
                Assert.Contains(lines, l => J.Str(l, "text") == "The server didn't wake up. Try again in a minute or tell Alex");
                Assert.Equal("gave up", w.Watch(run, seqCall, x => { }, 0));
            }
        }

        [Fact] public void Gate_messages()
        {
            Assert.Equal("The server hasn't launched yet. Watch Discord for the date.", Engine.GateMessage(new HttpError(403, "{\"error\":{\"code\":\"not_live\"}}", "x"), null));
            Assert.Equal("The server isn't up right now (it is starting, stopping or out of reach), so updates are paused. Try again in a minute.",
                Engine.GateMessage(new HttpError(403, "{\"error\":{\"code\":\"server_offline\"}}", "x"), null));
            Assert.Equal("The server has crashed. Ask Alex in Discord.", Engine.GateMessage(new HttpError(403, "{\"error\":{\"code\":\"server_offline\"}}", "x"), "crashed"));
            Assert.Equal("The site can't reach the server right now. Try again in a minute.", Engine.GateMessage(new HttpError(403, "server_offline", "x"), "unreachable"));
            Assert.Equal("The site said no (nope)", Engine.GateMessage(new HttpError(403, "nope", "x"), null));
            var longBody = new string('y', 300);
            Assert.Equal("The site said no (" + new string('y', 120) + ")", Engine.GateMessage(new HttpError(403, longBody, "x"), null));
        }

        [Fact] public void Manifest_answers()
        {
            using (var s = new Scratch())
            {
                var run = new Run { DryRun = true };
                Http.Fake = (m, u, b) => Tuple.Create(401, "");
                Engine.GetManifest(run, new Engine.Wake(), out var unauthorized);
                Assert.True(unauthorized);
                Http.Fake = (m, u, b) => Tuple.Create(403, "{\"error\":{\"code\":\"not_live\"}}");
                Assert.Equal("The server hasn't launched yet. Watch Discord for the date.", Assert.Throws<RunFailed>(() => Engine.GetManifest(run, new Engine.Wake(), out _)).Message);
                run = new Run { DryRun = true };
                Http.Fake = (m, u, b) => Tuple.Create(500, "");
                Assert.Equal("Couldn't reach https://deepslate.example. Check your internet, or ask Alex if the site is down.", Assert.Throws<RunFailed>(() => Engine.GetManifest(run, new Engine.Wake(), out _)).Message);
                run = new Run { DryRun = true };
                Http.Fake = (m, u, b) => Tuple.Create(200, "{\"version\":\"0.2.0\"}");
                Assert.Equal("0.2.0", J.Str(Engine.GetManifest(run, new Engine.Wake(), out unauthorized), "version"));
                Assert.False(unauthorized);
            }
        }

        static Func<string, string, string, Tuple<int, string>> Site(Queue<Tuple<int, string>> polls, List<string> calls)
            => (m, u, b) =>
            {
                calls.Add(m + " " + u);
                if (u.EndsWith("/api/launcher/start")) return Tuple.Create(200, "{\"code\":\"ABCD-1234\",\"url\":\"https://deepslate.example/link?c=ABCD-1234\",\"pollToken\":\"pt\",\"pollEverySec\":2,\"expiresInSec\":600}");
                if (u.Contains("/api/launcher/poll?token=pt")) return polls.Count > 1 ? polls.Dequeue() : polls.Peek();
                return Tuple.Create(404, "");
            };

        Run SignInRun(List<JObj> lines, List<string> opened, List<int> slept)
        {
            Engine.OpenUrl = u => opened.Add(u);
            Engine.Sleep = x => slept.Add(x);
            var run = new Run(); run.Sink = lines.Add;
            return run;
        }

        [Fact] public void Sign_in_approved()
        {
            using (var s = new Scratch())
            {
                var lines = new List<JObj>(); var opened = new List<string>(); var slept = new List<int>(); var calls = new List<string>();
                var run = SignInRun(lines, opened, slept);
                var polls = new Queue<Tuple<int, string>>(new[]
                {
                    Tuple.Create(500, ""),                                     // the site out of reach for a moment: asked again
                    Tuple.Create(200, "{\"status\":\"pending\"}"),
                    Tuple.Create(200, "{\"status\":\"approved\",\"launcherToken\":\"tok-123456\",\"displayName\":\"m1owl\"}"),
                });
                Http.Fake = Site(polls, calls);
                var token = Engine.SignIn(run);
                Assert.Equal("tok-123456", token);
                Assert.Equal("tok-123456", run.Token);
                Assert.Equal(new[] { "https://deepslate.example/link?c=ABCD-1234" }, opened);
                Assert.Equal(new[] { 2, 2, 2 }, slept);
                Assert.Equal("POST https://deepslate.example/api/launcher/start", calls[0]);
                Assert.Contains(lines, l => J.Str(l, "t") == "note" && J.Str(l, "text") == "Your code is  ABCD-1234  - a browser window is opening. Sign in with Discord and press 'Yes, that's me'.");
                Assert.Contains(lines, l => J.Str(l, "t") == "tick" && J.Str(l, "text") == "Signed in as m1owl");
                var saved = Json.ReadFile(Env.TokenFile);
                Assert.Equal("tok-123456", J.Str(saved, "token"));
                Assert.NotNull(J.Str(saved, "savedAt"));
                Assert.Equal("tok-123456", Engine.ReadToken(run));
            }
        }

        [Fact] public void Sign_in_denied_expired_or_unreachable()
        {
            using (var s = new Scratch())
            {
                var lines = new List<JObj>(); var opened = new List<string>(); var slept = new List<int>(); var calls = new List<string>();
                var run = SignInRun(lines, opened, slept);
                Http.Fake = Site(new Queue<Tuple<int, string>>(new[] { Tuple.Create(200, "{\"status\":\"denied\"}") }), calls);
                Assert.Equal("Sign-in was denied in the browser.", Assert.Throws<RunFailed>(() => Engine.SignIn(run)).Message);
                Assert.Equal("fail", J.Str(lines.Last(), "t"));
                Assert.False(File.Exists(Env.TokenFile));

                run = SignInRun(lines, opened, slept);
                Http.Fake = Site(new Queue<Tuple<int, string>>(new[] { Tuple.Create(200, "{\"status\":\"expired\"}") }), calls);
                Assert.Equal("The sign-in code expired. Press Play again.", Assert.Throws<RunFailed>(() => Engine.SignIn(run)).Message);

                run = SignInRun(lines, opened, slept);
                Http.Fake = (m, u, b) => u.EndsWith("/start") ? Tuple.Create(200, "{\"code\":\"X\",\"url\":\"https://deepslate.example/l\",\"pollToken\":\"pt\",\"pollEverySec\":1,\"expiresInSec\":0}") : Tuple.Create(500, "");
                Assert.Equal("Timed out waiting for the browser sign-in. Press Play again.", Assert.Throws<RunFailed>(() => Engine.SignIn(run)).Message);

                run = SignInRun(lines, opened, slept);
                Http.Fake = (m, u, b) => Tuple.Create(502, "");
                Assert.Equal("Couldn't reach https://deepslate.example. Check your internet, or ask Alex if the site is down.", Assert.Throws<RunFailed>(() => Engine.SignIn(run)).Message);

                run = SignInRun(lines, opened, slept); run.DryRun = true;
                Assert.Equal("(dry run) not signed in; the mod list needs a sign-in", Assert.Throws<RunFailed>(() => Engine.SignIn(run)).Message);
            }
        }

        [Fact] public void Token_file()
        {
            using (var s = new Scratch())
            {
                var run = new Run();
                Assert.Null(Engine.ReadToken(run));
                Directory.CreateDirectory(Env.DataDir);
                File.WriteAllText(Env.TokenFile, "{\"token\":\"abc\",\"savedAt\":\"2026-10-01T10:00:00\"}");
                Assert.Equal("abc", Engine.ReadToken(run));
                File.WriteAllText(Env.TokenFile, "{ broken");
                Assert.Null(Engine.ReadToken(run));
            }
        }

        [WindowsFact] public void One_copy_at_a_time()
        {
            var name = @"Local\DeepslateWorks.Test." + Guid.NewGuid().ToString("N");
            using (var s = new Scratch())
            {
                var mine = Engine.EnterLock(name);
                Assert.NotNull(mine);
                Mutex other = null;
                var t = new Thread(() => { other = Engine.EnterLock(name); });   // a second run (a mutex is the thread's: another thread)
                t.Start(); t.Join();
                Assert.Null(other);
                Engine.ExitLock(ref mine);
                Assert.Null(mine);
                t = new Thread(() => { other = Engine.EnterLock(name); Engine.ExitLock(ref other); });
                t.Start(); t.Join();
                Assert.Null(other);   // taken and let go

                // a run that took the lock and ended without letting go, as a killed run would
                t = new Thread(() => { var m = new Mutex(false, name); m.WaitOne(0); });
                t.Start(); t.Join();
                var after = Engine.EnterLock(name);
                Assert.NotNull(after);
                Assert.Contains(Log.RunLines, l => l.EndsWith("the last run did not end properly; carrying on"));
                Engine.ExitLock(ref after);
            }
        }
    }
}

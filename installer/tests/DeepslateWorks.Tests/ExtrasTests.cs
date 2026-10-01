using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>What the extras self test sections share: a list of extras built the way the site sends it, file bodies
    /// with their checksums, a stand-in download, a folder snapshot.</summary>
    static class XKit
    {
        public static void Check(string name, bool ok) => Assert.True(ok, name);

        public static string Rep(string s, int n) => string.Concat(Enumerable.Repeat(s, n));

        public static string ShaOfText(string text)
        {
            var f = Path.Combine(Path.GetTempPath(), "dw-body-" + Guid.NewGuid().ToString("N") + ".tmp");
            File.WriteAllText(f, text);
            try { return Extras.Sha512(f); } finally { File.Delete(f); }
        }

        public static JObj File_(string n, string kind, Dictionary<string, string> sha, long size)
            => J.O("filename", n, "kind", kind, "url", "https://example.invalid/" + n, "sha512", sha[n], "size", size);

        public static JObj Extra(string id, string name, string fps, string shader, string[] requires, string[] modIds, params JObj[] files)
        {
            var o = J.O("id", id);
            if (name != null) o["name"] = name;
            o["fps"] = fps; o["shader"] = shader;
            o["requires"] = requires.Cast<object>().ToList();
            if (modIds != null) o["modIds"] = modIds.Cast<object>().ToList();
            o["files"] = files.Cast<object>().ToList();
            return o;
        }

        /// <summary>The stand-in download: the body for the file the address names, repeated n times.</summary>
        public static Action<string, string> Fetch(Dictionary<string, string> bodies, int n)
            => (url, outFile) => File.WriteAllText(outFile, Rep(bodies[Path.GetFileName(new Uri(url).AbsolutePath)], n));

        public static string Snap(string dir)
            => string.Join(";", new DirectoryInfo(dir).GetFiles().OrderBy(f => f.Name, StringComparer.Ordinal).Select(f => f.Name + "=" + Extras.Sha512(f.FullName)));

        public static int Count(string dir) => new DirectoryInfo(dir).GetFiles().Length;

        public static int Lines(string pattern) => Extras.LogLines.Count(l => Regex.IsMatch(l, pattern));

        /// <summary>The 2.0.1 self test's list (names and mod ids, Falling Leaves).</summary>
        public static ExtrasManifest List201(Dictionary<string, string> sh2)
        {
            JObj F(string n, string k) => File_(n, k, sh2, 160);
            var raw = J.O("extras", new List<object> {
                Extra("iris", "Iris (shaders)", "High", null, new string[0], new[] { "iris" }, F("iris.jar", "mod")),
                Extra("shader-light", "Light", "Medium", "light", new[] { "iris" }, new string[0], F("makeup.zip", "shader")),
                Extra("shader-full", "Full", "High", "full", new[] { "iris" }, new string[0], F("comp.zip", "shader")),
                Extra("fresh-animations", "Fresh Animations", "Medium", null, new string[0], new[] { "entity_model_features", "entity_texture_features" }, F("fa.zip", "resourcepack"), F("emf.jar", "mod"), F("etf.jar", "mod")),
                Extra("falling-leaves", "Falling Leaves", "Low", null, new string[0], new[] { "fallingleaves" }, F("fl.jar", "mod")),
            });
            return ExtrasManifest.FromJson(Json.Parse(Json.Write(raw)));
        }

        public static Dictionary<string, bool> C(params object[] kv)
        {
            var d = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = (bool)kv[i + 1];
            return d;
        }
    }

    /// <summary>Self test: visual extras (1.6.0): options.txt's resource pack list and Iris's settings.</summary>
    [Collection("env")]
    public class ExtrasSettingsTests
    {
        const string Game = "version:3955\r\nautoJump:false\r\nrenderDistance:8\r\nsimulationDistance:6\r\nlang:en_gb\r\nkey_key.jump:key.keyboard.space\r\nlastServer:mc.dsw.test\r\n";

        [Fact]
        public void Resource_pack_list_and_iris_shader()
        {
            using (var s = new Scratch())
            {
                var od = s.P("options [x]"); Directory.CreateDirectory(od);
                var of = Path.Combine(od, "options.txt");
                File.WriteAllText(of, Game);
                var r = Extras.SetResourcePackList(of, new[] { "FreshAnimations_v1.10.4.zip" }, new string[0]);
                XKit.Check("no resourcePacks line yet: one is added with vanilla and ours: " + r.Text, r.Status == "changed" && File.ReadAllText(of) == Game + "resourcePacks:[\"vanilla\",\"file/FreshAnimations_v1.10.4.zip\"]\r\n");
                Assert.Equal("Resource pack switched on: FreshAnimations_v1.10.4.zip", r.Text);
                r = Extras.SetResourcePackList(of, new[] { "FreshAnimations_v1.10.4.zip" }, new[] { "FreshAnimations_v1.10.4.zip" });
                XKit.Check("already on: nothing written", r.Status == "same");
                var rpMine = Game.Replace("lang:en_gb", "resourcePacks:[\"vanilla\",\"mod_resources\",\"file/My Pack.zip\",\"file/FreshAnimations_v1.10.3.zip\"]\r\nlang:en_gb");
                File.WriteAllText(of, rpMine);
                r = Extras.SetResourcePackList(of, new[] { "FreshAnimations_v1.10.4.zip" }, new[] { "FreshAnimations_v1.10.3.zip" });
                XKit.Check("a new version: the old one out, the new one on top, the player's own pack and the order kept", File.ReadAllText(of) == rpMine.Replace(",\"file/FreshAnimations_v1.10.3.zip\"]", ",\"file/FreshAnimations_v1.10.4.zip\"]"));
                r = Extras.SetResourcePackList(of, new string[0], new[] { "FreshAnimations_v1.10.4.zip" });
                XKit.Check("extras off: ours out, the player's own stays: " + r.Text, r.Status == "changed" && File.ReadAllText(of) == rpMine.Replace(",\"file/FreshAnimations_v1.10.3.zip\"", ""));
                Assert.Equal("Visual extras' resource pack switched off", r.Text);
                File.WriteAllText(of, Game);
                r = Extras.SetResourcePackList(of, new string[0], new[] { "FreshAnimations_v1.10.4.zip" });
                XKit.Check("extras off and no list at all: the file is left as it is", r.Status == "same" && File.ReadAllText(of) == Game);
                File.WriteAllText(of, "resourcePacks:not json\n");
                r = Extras.SetResourcePackList(of, new[] { "FreshAnimations_v1.10.4.zip" }, new string[0]);
                XKit.Check("a list it cannot read: left alone", r.Status == "left" && File.ReadAllText(of) == "resourcePacks:not json\n");
                File.WriteAllText(of, "renderDistance:8\nresourcePacks:[]\n");
                r = Extras.SetResourcePackList(of, new[] { "FA.zip" }, new string[0]);
                XKit.Check("an empty list and Unix line endings: ours added, endings kept", File.ReadAllText(of) == "renderDistance:8\nresourcePacks:[\"file/FA.zip\"]\n");

                var ip = Path.Combine(od, "config", "iris.properties");
                Extras.SetIrisShader(ip, "ComplementaryReimagined_r5.9.3.zip");
                XKit.Check("no iris.properties yet: written with the pack and shaders on", File.ReadAllText(ip) == "enableShaders=true\r\nshaderPack=ComplementaryReimagined_r5.9.3.zip\r\n");
                File.WriteAllText(ip, "#Iris settings\ncolorSpace=SRGB\nenableShaders=false\nmaxShadowRenderDistance=32\nshaderPack=Mine.zip\n");
                Extras.SetIrisShader(ip, "MakeUp-UltraFast-9.5f.zip");
                XKit.Check("Iris's own file: the two lines changed, the rest as it was", File.ReadAllText(ip) == "#Iris settings\ncolorSpace=SRGB\nenableShaders=true\nmaxShadowRenderDistance=32\nshaderPack=MakeUp-UltraFast-9.5f.zip\n");
                Extras.SetIrisShader(ip, "");
                XKit.Check("None: shaders off, the pack name left", File.ReadAllText(ip) == "#Iris settings\ncolorSpace=SRGB\nenableShaders=false\nmaxShadowRenderDistance=32\nshaderPack=MakeUp-UltraFast-9.5f.zip\n");
                Extras.SetIrisShader(ip, "a$1.zip");
                XKit.Check("a $ in the pack's name is written as it is", File.ReadAllText(ip).Contains("shaderPack=a$1.zip\n"));
            }
        }
    }

    /// <summary>Self test: the app, extras (2.0.0).</summary>
    [Collection("env")]
    public class ExtrasAppTests
    {
        [Fact]
        public void Download_apply_rollback_and_new_versions()
        {
            using (var s = new Scratch())
            {
                var gd = s.P("game [x]");
                var xp = Extras.GetPaths(gd);
                foreach (var d0 in new[] { xp.Extras, xp.Mods, xp.ResourcePacks, xp.ShaderPacks }) Directory.CreateDirectory(d0);
                var bodies = new Dictionary<string, string> { { "iris.jar", "iris" }, { "makeup.zip", "makeup" }, { "comp.zip", "comp" }, { "fa.zip", "fa" }, { "emf.jar", "emf" }, { "etf.jar", "etf" }, { "nea.jar", "nea" } };
                var shaOf = bodies.ToDictionary(kv => kv.Key, kv => XKit.ShaOfText(XKit.Rep(kv.Value, 50)));
                JObj F(string n, string k) => XKit.File_(n, k, shaOf, 200);
                var raw = J.O("extras", new List<object> {
                    XKit.Extra("iris", null, "High", null, new string[0], null, F("iris.jar", "mod")),
                    XKit.Extra("shader-light", null, "Medium", "light", new[] { "iris" }, null, F("makeup.zip", "shader")),
                    XKit.Extra("shader-full", null, "High", "full", new[] { "iris" }, null, F("comp.zip", "shader")),
                    XKit.Extra("fresh-animations", null, "Medium", null, new string[0], null, F("fa.zip", "resourcepack"), F("emf.jar", "mod"), F("etf.jar", "mod")),
                    XKit.Extra("nea", null, "Low", null, new string[0], null, F("nea.jar", "mod")),
                });
                var xm = ExtrasManifest.FromJson(Json.Parse(Json.Write(raw)));
                var fetchX = XKit.Fetch(bodies, 50);
                File.WriteAllText(Path.Combine(xp.Mods, "create.jar"), "pack"); File.WriteAllText(Path.Combine(xp.Mods, "sodium.jar"), "pack");
                File.WriteAllText(xp.Options, "renderDistance:10\r\nresourcePacks:[\"vanilla\",\"file/Mine.zip\"]\r\n");
                var modsBefore = XKit.Snap(xp.Mods); var optBefore = File.ReadAllText(xp.Options);
                var st = new ExtrasState();
                var r = Extras.SyncFiles(xp, xm, st, fetchX);
                XKit.Check("first download: every extra into extras\\, nothing switched on, mods\\ untouched: " + r.Downloaded, r.Downloaded == 7 && XKit.Count(xp.Extras) == 7 && XKit.Snap(xp.Mods) == modsBefore);
                XKit.Check("and again: nothing downloaded twice", Extras.SyncFiles(xp, xm, st, (u, o) => throw new Exception("no")).Downloaded == 0);
                XKit.Check("nothing switched: Apply has nothing to do", Extras.ApplyRoute(false, Extras.Changed(xm, st)) == "nothing");
                st.Choices["iris"] = true; st.Choices["fresh-animations"] = true; st.Shader = "full";
                XKit.Check("the game running: Restart the game to apply? is asked", Extras.ApplyRoute(true, Extras.Changed(xm, st)) == "ask_restart");
                XKit.Check("the game not running: installed straight away", Extras.ApplyRoute(false, Extras.Changed(xm, st)) == "install");
                var a = Extras.Apply(xp, xm, st);
                bool In(string dir, string f) => File.Exists(Path.Combine(dir, f));
                XKit.Check("on: Iris, Fresh Animations with EMF and ETF, the Full shader pack in place: " + a.Error,
                    a.Ok && In(xp.Mods, "iris.jar") && In(xp.Mods, "emf.jar") && In(xp.Mods, "etf.jar") && In(xp.ResourcePacks, "fa.zip") && In(xp.ShaderPacks, "comp.zip") && !In(xp.ShaderPacks, "makeup.zip") && !In(xp.Mods, "nea.jar"));
                XKit.Check("Fresh Animations switched on in options.txt, the player's own pack kept", Regex.IsMatch(File.ReadAllText(xp.Options), "resourcePacks:\\[\"vanilla\",\"file/Mine.zip\",\"file/fa.zip\"\\]"));
                XKit.Check("Iris set to the chosen shader pack", Regex.IsMatch(File.ReadAllText(xp.Iris), "(?m)^shaderPack=comp.zip") && Regex.IsMatch(File.ReadAllText(xp.Iris), "(?m)^enableShaders=true"));
                XKit.Check("dependencies on together: Light is chosen only with Iris", string.Join(",", Extras.GetOn(xm, new ExtrasState { Shader = "light" })) == "");
                st.Shader = "light";
                a = Extras.Apply(xp, xm, st);
                XKit.Check("Full to Light: one shader pack out, the other in", a.Ok && In(xp.ShaderPacks, "makeup.zip") && !In(xp.ShaderPacks, "comp.zip") && In(xp.Extras, "comp.zip"));
                st.Choices = XKit.C(); st.Shader = "none";
                a = Extras.Apply(xp, xm, st);
                XKit.Check("all off again: mods\\ exactly as before (names and contents), options.txt's list as before", a.Ok && XKit.Snap(xp.Mods) == modsBefore && File.ReadAllText(xp.Options) == optBefore);
                XKit.Check("and every extra is back in extras\\", XKit.Count(xp.Extras) == 7);
                st.Choices["iris"] = true; st.Choices["fresh-animations"] = true; st.Choices["nea"] = true; st.Shader = "full";
                int moveCount = 0;
                a = Extras.Apply(xp, xm, st, (x, y) => { moveCount++; if (moveCount >= 4) throw new IOException("disk full"); Extras.MoveFile(x, y); });
                XKit.Check("a move that fails half-way: everything put back (" + a.Error + ")", !a.Ok && XKit.Snap(xp.Mods) == modsBefore && XKit.Count(xp.Extras) == 7 && File.ReadAllText(xp.Options) == optBefore && st.Applied.Mods.Count == 0);
                File.WriteAllText(Path.Combine(xp.Extras, "nea.jar"), "damaged");
                a = Extras.Apply(xp, xm, st);
                XKit.Check("a damaged file found by the check after the moves: everything put back (" + a.Error + ")", !a.Ok && XKit.Snap(xp.Mods) == modsBefore && File.ReadAllText(xp.Options) == optBefore);
                File.Delete(Path.Combine(xp.Extras, "nea.jar"));
                a = Extras.Apply(xp, xm, st);
                XKit.Check("an extra not downloaded yet: refused, nothing changed", !a.Ok && Regex.IsMatch(a.Error, "not downloaded") && XKit.Snap(xp.Mods) == modsBefore);
                var r2 = Extras.SyncFiles(xp, xm, st, fetchX);
                XKit.Check("the next Play fetches what is missing and applies the choice that was waiting", r2.Applied != null && r2.Applied.Ok && In(xp.Mods, "nea.jar") && In(xp.Mods, "iris.jar"));
                XKit.Check("the pack's mod sync leaves switched-on extras alone", string.Join(",", Extras.AppliedJars(st).OrderBy(x => x, StringComparer.Ordinal)) == "emf.jar,etf.jar,iris.jar,nea.jar");
                // a new version of an extra that is on
                bodies["iris2.jar"] = "iris two"; shaOf["iris2.jar"] = XKit.ShaOfText(XKit.Rep(bodies["iris2.jar"], 50));
                xm.Extras[0].Files = new List<ExtraFile> { new ExtraFile { Filename = "iris2.jar", Kind = "mod", Url = "https://example.invalid/iris2.jar", Sha512 = shaOf["iris2.jar"], Size = 200 } };
                var r3 = Extras.SyncFiles(xp, xm, st, fetchX);
                XKit.Check("a new version of an extra that is on: swapped in mods\\, the old file gone everywhere", r3.Applied != null && r3.Applied.Ok && In(xp.Mods, "iris2.jar") && !In(xp.Mods, "iris.jar") && !In(xp.Extras, "iris.jar"));
                var sp0 = s.P("app [x]", "extras.json");
                st.Save(sp0);
                var st2 = ExtrasState.Read(sp0);
                XKit.Check("extras.json remembers the choices and where the files are", st2.On("nea") && st2.Shader == "full" && st2.Applied.Mods.Contains("nea.jar"));
                st2.InstalledAt = "2026-10-01T15:30:11.123Z"; st2.Save(sp0);
                XKit.Check("times come back as ISO text whatever happens to JSON dates", ExtrasState.Read(sp0).InstalledAt == "2026-10-01T15:30:11.123Z");
            }
        }

        [Fact]
        public void State_file_is_the_2_0_shape()
        {
            using (var s = new Scratch())
            {
                // as 2.0.x wrote it (ConvertTo-Json of a hashtable: keys in any order, one-item arrays as arrays)
                Directory.CreateDirectory(Env.AppHome);
                File.WriteAllText(Env.ExtrasStatePath, @"{
  ""version"": 2,
  ""choices"": { ""iris"": true, ""falling-leaves"": false },
  ""shader"": ""light"",
  ""applied"": { ""shaderpacks"": [ ""makeup.zip"" ], ""mods"": [ ""iris.jar"", """" ], ""resourcepacks"": [] },
  ""seen"": [ ""iris"", ""shader-light"" ],
  ""downloaded"": true,
  ""queued"": { ""shader"": ""full"", ""at"": ""2026-10-01T16:00:00.000Z"", ""choices"": { ""iris"": true } },
  ""lastApply"": { ""summary"": ""Couldn't switch on Iris: file in use. Nothing was changed."", ""ok"": false, ""error"": ""file in use"", ""at"": ""2026-10-01T15:59:00.000Z"" },
  ""installedAt"": ""2026-10-01T15:30:11.123Z""
}");
                var st = ExtrasState.Read(Env.ExtrasStatePath);
                Assert.True(st.On("iris")); Assert.False(st.On("falling-leaves"));
                Assert.Equal("light", st.Shader);
                Assert.Equal(new List<string> { "iris.jar" }, st.Applied.Mods);
                Assert.Equal(new List<string> { "makeup.zip" }, st.Applied.ShaderPacks);
                Assert.Equal(new List<string> { "iris", "shader-light" }, st.Seen);
                Assert.True(st.Downloaded);
                Assert.Equal("full", st.Queued.Shader); Assert.True(st.Queued.On("iris")); Assert.Equal("2026-10-01T16:00:00.000Z", st.Queued.At);
                Assert.False(st.LastApply.Ok); Assert.Equal("file in use", st.LastApply.Error);
                Assert.Equal("2026-10-01T15:30:11.123Z", st.InstalledAt);
                st.Save(Env.ExtrasStatePath);
                var j = (JObj)Json.ReadFile(Env.ExtrasStatePath);
                Assert.Equal(new[] { "version", "choices", "shader", "applied", "seen", "downloaded", "queued", "lastApply", "installedAt" }, j.OrderedKeys.ToArray());
                Assert.Equal(2L, J.Long(j, "version"));
                Assert.Equal(new[] { "mods", "resourcepacks", "shaderpacks" }, J.Obj(j, "applied").OrderedKeys.ToArray());
                Assert.Equal(new[] { "choices", "shader", "at" }, J.Obj(j, "queued").OrderedKeys.ToArray());
                Assert.Equal(new[] { "at", "ok", "error", "summary" }, J.Obj(j, "lastApply").OrderedKeys.ToArray());
                Assert.True(J.Bool(j, "choices.iris"));
                Assert.Empty(J.Arr(j, "applied.resourcepacks"));
                // a new state, and one that cannot be read: nothing on, nulls where 2.0.x had $null
                File.WriteAllText(Env.ExtrasStatePath, "{ not json");
                var n = ExtrasState.Read(Env.ExtrasStatePath);
                Assert.Equal("none", n.Shader); Assert.False(n.Downloaded); Assert.Null(n.Queued);
                n.Save(Env.ExtrasStatePath);
                var j2 = (JObj)Json.ReadFile(Env.ExtrasStatePath);
                Assert.Null(j2["queued"]); Assert.Null(j2["lastApply"]); Assert.Null(j2["installedAt"]); Assert.True(j2.ContainsKey("queued"));
                Assert.Equal(new List<string>(), Extras.AppliedJars());
            }
        }

        [Fact]
        public void Plain_reasons_and_names()
        {
            Assert.Equal("file in use", Extras.PlainReason("The process cannot access the file because it is being used by another process."));
            Assert.Equal("not downloaded yet", Extras.PlainReason("nea.jar is not downloaded yet"));
            Assert.Equal("the file is damaged", Extras.PlainReason("nea.jar is damaged"));
            Assert.Equal("the file could not be moved", Extras.PlainReason("fl.jar is still in mods"));
            Assert.Equal("Windows refused access to the file", Extras.PlainReason("Access to the path 'x' is denied."));
            Assert.Equal("disk full", Extras.PlainReason("disk full"));
            Assert.Equal("Iris", Extras.NameOf(new ExtraItem { Id = "iris", Name = "Iris (shaders)" }));
            Assert.Equal("nea", Extras.NameOf(new ExtraItem { Id = "nea" }));
            Assert.Equal("an extra", Extras.NameOf(null));
            Assert.Equal("mods", Extras.FolderFor("mod")); Assert.Equal("resourcepacks", Extras.FolderFor("resourcepack")); Assert.Equal("shaderpacks", Extras.FolderFor("shader")); Assert.Equal("mods", Extras.FolderFor("other"));
        }
    }

    /// <summary>Self test: the app, the game and the PC (2.0.0).</summary>
    public class ExtrasGameAndPcTests
    {
        static readonly List<GameProcess> Procs = new List<GameProcess>
        {
            new GameProcess { Id = 11, Name = "javaw.exe", CommandLine = "\"C:\\Program Files\\Java\\bin\\javaw.exe\" -Xmx6G -Dminecraft.client.jar=... --gameDir C:\\Users\\x\\AppData\\Roaming\\.minecraft-deepslate-works --username y" },
            new GameProcess { Id = 12, Name = "javaw.exe", CommandLine = "\"javaw.exe\" --gameDir C:\\Users\\x\\AppData\\Roaming\\.minecraft" },
            new GameProcess { Id = 13, Name = "chrome.exe", CommandLine = "chrome.exe .minecraft-deepslate-works" },
        };

        [Fact]
        public void The_game_and_the_pc()
        {
            XKit.Check("finds the Deepslate game, not another Minecraft and not a browser", string.Join(",", Extras.FindGame("C:\\Users\\x\\AppData\\Roaming\\.minecraft-deepslate-works", Procs).Select(p => p.Id)) == "11");
            XKit.Check("no game running: no restart question", Extras.ApplyRoute(Extras.FindGame("C:\\none", Procs).Count > 0, true) == "install");
            XKit.Check("weak: 4 GB with a real card", Extras.IsWeakPc(4, new[] { "NVIDIA GeForce RTX 3060" }));
            XKit.Check("weak: 16 GB with built-in Intel graphics", Extras.IsWeakPc(16, new[] { "Intel(R) UHD Graphics 620" }));
            XKit.Check("not weak: 16 GB and an RTX 3060", !Extras.IsWeakPc(16, new[] { "Intel(R) UHD Graphics 770", "NVIDIA GeForce RTX 3060" }));
            XKit.Check("not weak: 16 GB and a Radeon RX 6600", !Extras.IsWeakPc(16, new[] { "AMD Radeon RX 6600" }));
            XKit.Check("weak: memory known, no graphics card seen", Extras.IsWeakPc(16, new string[0]));
        }

        [WindowsFact]
        public void Real_processes_answer_without_throwing()
        {
            var procs = Extras.JavaProcesses();
            Assert.NotNull(procs);
            Assert.True(Extras.GameGone(new[] { int.MaxValue - 7 }));
            Extras.LocalWeakPc();   // measured or not, never throws
        }
    }

    /// <summary>A stand-in game for the restart flow: running until closed (or after a number of looks), or never.</summary>
    sealed class FakeGame : IGameControl
    {
        public List<int> Running = new List<int>();
        public bool IgnoresClose;
        public readonly List<string> Did = new List<string>();
        public List<int> Find() => new List<int>(Running);
        public void Close(IList<int> ids) { Did.Add("close " + string.Join(",", ids)); if (!IgnoresClose) Running.RemoveAll(ids.Contains); }
        public bool Gone(IList<int> ids) => !ids.Any(Running.Contains);
        public void Force(IList<int> ids) { Did.Add("force " + string.Join(",", ids)); Running.RemoveAll(ids.Contains); }
    }

    /// <summary>Self test: extras logged, checked, confirmed in game (2.0.1), and Apply -> restart, the queue, rollback.</summary>
    [Collection("env")]
    public class ExtrasCheckedTests
    {
        static Dictionary<string, string> B2 => new Dictionary<string, string> { { "iris.jar", "iris" }, { "makeup.zip", "makeup" }, { "comp.zip", "comp" }, { "fa.zip", "fa" }, { "emf.jar", "emf" }, { "etf.jar", "etf" }, { "fl.jar", "fl" } };

        [Fact]
        public void Logged_checked_confirmed_in_game_then_restart_queue_and_rollback()
        {
            using (var s = new Scratch())
            {
                Extras.ClearLogLines();
                var xq = Extras.GetPaths(Env.DataDir);   // the game folder -VerifyExtras looks at
                foreach (var d0 in new[] { xq.Extras, xq.Mods, xq.ResourcePacks, xq.ShaderPacks, Path.GetDirectoryName(xq.LatestLog) }) Directory.CreateDirectory(d0);
                var b2 = B2;
                var sh2 = b2.ToDictionary(kv => kv.Key, kv => XKit.ShaOfText(XKit.Rep(kv.Value, 40)));
                var xm2 = XKit.List201(sh2);
                var fetch2 = XKit.Fetch(b2, 40);
                var s2 = new ExtrasState();
                var threw = false;
                try { Extras.SyncFiles(xq, xm2, s2, (u, o) => File.WriteAllText(o, "not it")); } catch { threw = true; }
                XKit.Check("a download with the wrong checksum: refused, logged with expected and got, FAILED", threw && XKit.Lines(@"ERROR download: iris\.jar .*sha512 expected [0-9a-f]{16}\.\.\. got [0-9a-f]{16}\.\.\. FAILED") == 1);
                Extras.SyncFiles(xq, xm2, s2, fetch2);
                s2.Downloaded = true;
                XKit.Check("each download logged: name, extra, size, checksums, OK", XKit.Lines(@"download: fl\.jar \(Falling Leaves\), 80 bytes, sha512 expected .* OK$") == 1);
                var logFile = Path.Combine(Env.AppHome, "logs", string.Format(CultureInfo.InvariantCulture, "extras-{0:yyyy-MM-dd}.log", DateTime.Now));
                XKit.Check("and in logs\\extras-<date>.log, with the time", File.Exists(logFile) && Regex.IsMatch(File.ReadAllText(logFile), @"(?m)^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] download: fl\.jar"));
                XKit.Check("and in the main log, marked extras:", File.ReadAllText(Env.LogFile).Contains("extras: download: fl.jar"));
                File.WriteAllText(xq.Options, "renderDistance:10\r\nresourcePacks:[\"vanilla\",\"file/Mine.zip\"]\r\n");
                Extras.ClearLogLines();
                s2.Choices = XKit.C("iris", true, "fresh-animations", true, "falling-leaves", true); s2.Shader = "light";
                var r = Extras.Apply(xq, xm2, s2);
                XKit.Check("Apply logged: switches before and after, each move from -> to, options.txt and Iris written, the result",
                    r.Ok && XKit.Lines(@"apply: before: \(nothing on\)") == 1
                    && XKit.Lines("apply: after:  iris=on, fresh-animations=on, falling-leaves=on, shaders=light") == 1
                    && XKit.Lines(@"apply: moved .*extras.fl\.jar -> .*mods.fl\.jar") == 1
                    && XKit.Lines("apply: options.txt written: resourcePacks:\\[\"vanilla\",\"file/Mine.zip\",\"file/fa.zip\"\\]") == 1
                    && XKit.Lines(@"iris.properties written: enableShaders=true, shaderPack=makeup\.zip") == 1
                    && XKit.Lines(@"apply: result OK, 6 file\(s\) moved") == 1);
                var v = Extras.Verify(xq, xm2, s2);
                XKit.Check("checks after Apply: all good (" + v.Count + " checks)", v.Count(c => c.Ok == false) == 0 && v.Count(c => c.Group == "Files") == 6 && v.Count(c => c.Group == "Dependencies") == 2);
                // each check failing
                var flPath = Path.Combine(xq.Mods, "fl.jar"); var flBody = File.ReadAllText(flPath);
                File.Delete(flPath);
                XKit.Check("check fails: a switched-on file is missing", Extras.Verify(xq, xm2, s2).Count(c => c.Ok == false && Regex.IsMatch(c.Text, @"fl\.jar is missing")) == 1);
                File.WriteAllText(flPath, "tampered");
                XKit.Check("check fails: a file with the wrong checksum", Extras.Verify(xq, xm2, s2).Count(c => c.Ok == false && c.Text.Contains("not the right file")) == 1);
                File.WriteAllText(flPath, flBody);
                var optGood = File.ReadAllText(xq.Options);
                File.WriteAllText(xq.Options, "resourcePacks:[\"vanilla\"]\r\n");
                XKit.Check("check fails: options.txt not updated", Extras.Verify(xq, xm2, s2).Count(c => c.Ok == false && c.Group == "Settings" && Regex.IsMatch(c.Text, @"should be \[fa\.zip\]")) == 1);
                File.WriteAllText(xq.Options, optGood);
                var irisGood = File.ReadAllText(xq.Iris);
                File.WriteAllText(xq.Iris, "enableShaders=true\nshaderPack=Other.zip\n");
                XKit.Check("check fails: Iris set to another shader pack", Extras.Verify(xq, xm2, s2).Count(c => c.Ok == false && c.Id == "iris") == 1);
                File.WriteAllText(xq.Iris, irisGood);
                File.Move(Path.Combine(xq.Mods, "emf.jar"), Path.Combine(xq.Extras, "emf.jar"));
                XKit.Check("check fails: Fresh Animations on without EMF", Extras.Verify(xq, xm2, s2).Count(c => c.Ok == false && c.Group == "Dependencies" && c.Text.Contains("EMF or ETF is missing")) == 1);
                File.Move(Path.Combine(xq.Extras, "emf.jar"), Path.Combine(xq.Mods, "emf.jar"));
                XKit.Check("and all good again", Extras.Verify(xq, xm2, s2).Count(c => c.Ok == false) == 0);

                // in game, from the game's latest.log
                var t0 = DateTime.Parse(s2.InstalledAt, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
                string Stamp(DateTime dt) => dt.ToLocalTime().ToString("ddMMMyyyy HH:mm:ss.fff", CultureInfo.InvariantCulture);
                string Found(string n) => string.Format("[{0}] [main/INFO] [net.neoforged.fml.loading.moddiscovery.ModDiscoverer/SCAN]: Found mod file \"{1}\" [locator: mods folder]", Stamp(t0.AddMinutes(1)), n);
                var reload = string.Format("[{0}] [Render thread/INFO] [net.minecraft.server.packs.resources.ReloadableResourceManager/]: Reloading ResourceManager: vanilla, mod_resources, file/Mine.zip, file/fa.zip", Stamp(t0.AddMinutes(1)));
                XKit.Check("no game since the install: waiting for the game to start", Extras.InGame(xq, xm2, s2, null)["falling-leaves"].State == "waiting");
                File.WriteAllText(xq.LatestLog, string.Join("\n", Found("sodium.jar"), Found("iris.jar"), Found("fl.jar"), Found("emf.jar"), Found("etf.jar"), reload));
                var ig = Extras.InGame(xq, xm2, s2, Extras.ReadGameSession(xq.LatestLog));
                XKit.Check("the game's log shows them loaded: active in game", ig["iris"].State == "active" && ig["fresh-animations"].State == "active" && ig["falling-leaves"].State == "active" && ig["shader-light"].State == "active");
                File.WriteAllText(xq.LatestLog, string.Join("\n", Found("sodium.jar"), Found("iris.jar"), Found("emf.jar"), Found("etf.jar"), reload));
                ig = Extras.InGame(xq, xm2, s2, Extras.ReadGameSession(xq.LatestLog));
                XKit.Check("check fails: a mod that did not load in latest.log: " + ig["falling-leaves"].Reason, ig["falling-leaves"].State == "problem" && ig["iris"].State == "active");
                Assert.Equal("the game did not load it (not in its mod list)", ig["falling-leaves"].Reason);
                var err = string.Format("[{0}] [main/ERROR] [net.neoforged.fml.ModLoader/LOADING]: Mod loading has failed: fallingleaves requires minecraft 1.21.2", Stamp(t0.AddMinutes(1)));
                File.WriteAllText(xq.LatestLog, string.Join("\n", Found("iris.jar"), Found("fl.jar"), Found("emf.jar"), Found("etf.jar"), err, reload));
                ig = Extras.InGame(xq, xm2, s2, Extras.ReadGameSession(xq.LatestLog));
                XKit.Check("a loading error naming the mod: the reason is shown: " + ig["falling-leaves"].Reason, ig["falling-leaves"].State == "problem" && Regex.IsMatch(ig["falling-leaves"].Reason, @"requires minecraft 1\.21\.2"));
                Assert.Equal("the game could not load it: Mod loading has failed: fallingleaves requires minecraft 1.21.2", ig["falling-leaves"].Reason);
                var old = string.Format("[{0}] [main/INFO] x: Found mod file \"fl.jar\" [x]", Stamp(t0.AddHours(-2)));
                File.WriteAllText(xq.LatestLog, old);
                XKit.Check("a game session from before the install does not count: waiting", Extras.InGame(xq, xm2, s2, Extras.ReadGameSession(xq.LatestLog))["falling-leaves"].State == "waiting");

                // planner G: the status words
                ExtraStatus StOf(string id, List<ExtrasCheck> vf, Dictionary<string, InGameState> ign, bool run) => Extras.Status(xm2.Find(id), xm2, s2, vf, ign, run);
                Dictionary<string, InGameState> G(string state) => new Dictionary<string, InGameState>(StringComparer.OrdinalIgnoreCase) { { "falling-leaves", new InGameState(state) } };
                var none = new Dictionary<string, InGameState>();
                var okv = Extras.Verify(xq, xm2, s2);
                var st0 = StOf("falling-leaves", okv, G("waiting"), false);
                XKit.Check("installed, no game since: Ready, starts next time you play (blue)", st0.Tone == "blue" && st0.Text == "Ready, starts next time you play");
                XKit.Check("confirmed in latest.log: Active in game (green)", StOf("falling-leaves", okv, G("active"), true).Text == "Active in game");
                XKit.Check("a failed check: Problem: <reason> (red)", StOf("falling-leaves", new List<ExtrasCheck> { new ExtrasCheck("Files", "falling-leaves", false, "fl.jar is missing") }, none, false).Text == "Problem: fl.jar is missing");
                Extras.SetQueue(s2, XKit.C("iris", true, "fresh-animations", true, "falling-leaves", false, "particle-rain", true), "light");
                var stq = StOf("falling-leaves", okv, none, true);
                XKit.Check("Later while the game runs: switched off shows Off, removed when the game closes (amber)", stq.Text == "Off, removed when the game closes" && stq.Tone == "amber" && stq.ShowsRestart);
                s2.Queued.Choices["falling-leaves"] = true; s2.Applied.Mods = s2.Applied.Mods.Where(x => x != "fl.jar").ToList();
                XKit.Check("Later while the game runs: switched on shows Waiting for the game to close (amber)", StOf("falling-leaves", okv, none, true).Text == "Waiting for the game to close");
                s2.Applied.Mods.Add("fl.jar"); s2.Queued = null;
                s2.Choices["falling-leaves"] = false; var keepMods = s2.Applied.Mods; s2.Applied.Mods = keepMods.Where(x => x != "fl.jar").ToList();
                XKit.Check("switched off, last session still had it: Off, takes effect next time you play", StOf("falling-leaves", okv, G("off-loaded"), false).Text == "Off, takes effect next time you play");
                XKit.Check("switched off and gone from the game too: Off (grey)", StOf("falling-leaves", okv, G("off"), false).Tone == "grey");
                s2.Choices["falling-leaves"] = true; s2.Applied.Mods = keepMods;
                var stats = new Dictionary<string, ExtraStatus> { { "iris", new ExtraStatus("Active in game", "green") }, { "fresh-animations", new ExtraStatus("Active in game", "green") }, { "falling-leaves", new ExtraStatus("Active in game", "green") } };
                XKit.Check("the top line: everything active", Extras.Headline(xm2, s2, stats, true).Text == "Everything you've switched on is active in game.");
                stats["falling-leaves"] = new ExtraStatus("Ready, starts next time you play", "blue");
                var h0 = Extras.Headline(xm2, s2, stats, false);
                XKit.Check("the top line: the game isn't running, with Play now", h0.Text.StartsWith("The game isn't running") && h0.Action == "play");
                Extras.SetQueue(s2, XKit.C("iris", true), "none");
                var h1 = Extras.Headline(xm2, s2, stats, true);
                XKit.Check("the top line: the game is running, changes queued, with Restart now", h1.Text.Contains("install when it closes") && h1.Action == "restart");
                s2.Queued = null;
                stats["falling-leaves"] = new ExtraStatus("Problem: x", "red");
                Assert.Equal("Something is wrong with an extra: see the red line below.", Extras.Headline(xm2, s2, stats, false).Text);
                Assert.Equal("No extras are switched on. Switch some on and press Apply.", Extras.Headline(xm2, new ExtrasState(), stats, false).Text);
                Assert.Equal("The game is running. No extras are switched on.", Extras.Headline(xm2, new ExtrasState(), stats, true).Text);

                // Apply -> restart, the queue, rollback (2.0.1)
                XKit.Check("game running, not allowed before: the restart question", Extras.ApplyRoute(true, true, false) == "ask_restart");
                XKit.Check("game running, Allow all given before: restart without asking", Extras.ApplyRoute(true, true, true) == "restart");
                XKit.Check("game closed: install now, then Start the game now? is asked", Extras.ApplyRoute(false, true, false) == "install" && Extras.AfterInstall(false) == "ask_start");
                XKit.Check("game closed, Allow all given before: install and start without asking", Extras.AfterInstall(true) == "start");
                XKit.Check("Apply again while queued: the queue is replaced, not stacked",
                    !Extras.SetQueue(s2, XKit.C("iris", true), "full") && Extras.SetQueue(s2, XKit.C("falling-leaves", false, "iris", true, "fresh-animations", true), "light") && s2.Queued.Shader == "light" && !s2.Queued.On("falling-leaves"));
                Extras.ClearLogLines();
                var rq = Extras.QueuedInstall(xq, xm2, s2);
                XKit.Check("the game closed: the queue installs by itself, logged with queued at and installed at",
                    rq.Ok && s2.Queued == null && !File.Exists(Path.Combine(xq.Mods, "fl.jar")) && XKit.Lines("queued install: queued at .* installing now") == 1 && XKit.Lines("queued install: installed at") == 1);
                Extras.SetQueue(s2, XKit.C("iris", true, "fresh-animations", true, "falling-leaves", true), "light");
                s2.Save(Env.ExtrasStatePath);
                var s3 = ExtrasState.Read(Env.ExtrasStatePath);
                var r3 = Extras.SyncFiles(xq, xm2, s3, fetch2);
                XKit.Check("the app closed before the game: the next Play installs the queue", r3.Applied != null && r3.Applied.Ok && s3.Queued == null && File.Exists(Path.Combine(xq.Mods, "fl.jar")));
                var modsBefore2 = XKit.Snap(xq.Mods);
                Extras.ClearLogLines();
                s3.Choices["falling-leaves"] = false;
                var rf = Extras.Apply(xq, xm2, s3, (x, y) => throw new IOException("The process cannot access the file because it is being used by another process."));
                XKit.Check("a file in use: rolled back, said in plain English: " + rf.Summary, !rf.Ok && rf.Summary == "Couldn't switch off Falling Leaves: file in use. Nothing was changed." && XKit.Snap(xq.Mods) == modsBefore2);
                XKit.Check("and the rollback is logged, as errors", XKit.Lines("ERROR rollback: putting everything back because: file in use") == 1 && XKit.Lines("rollback: done") == 1);
                var after = Extras.AfterRestartInstall(rf);
                XKit.Check("Yes with a failed install: the game still starts, on the previous set", after.Relaunch && after.Say.Contains("previous extras"));
                s3.Choices["falling-leaves"] = true;
                Assert.Equal("Problem: file in use", Extras.Status(xm2.Find("falling-leaves"), xm2, s3, Extras.Verify(xq, xm2, s3), none, false).Text);
                var rep = Extras.ReportBlock(xq, xm2, s3);
                XKit.Check("the report's extras block: on, last Apply, checks, in game: " + Json.Write(rep),
                    J.Strs(rep, "on").Contains("falling-leaves") && J.Str(rep, "shader") == "light" && J.Bool(rep, "lastApply.ok", true) == false && J.Bool(rep, "verify.ok") && new[] { "waiting", "active", "problems" }.Contains(J.Str(rep, "inGame.state")));
                Assert.Equal(new[] { "on", "shader", "queued", "lastApply", "verify", "inGame" }, ((JObj)rep).OrderedKeys.ToArray());
                s3.Save(Env.ExtrasStatePath);
                Json.WriteFile(Env.ExtrasManifestPath, xm2.Raw);
                var vOk = Extras.VerifyCommand();
                File.Delete(Path.Combine(xq.Mods, "fl.jar"));
                var vBad = Extras.VerifyCommand();
                XKit.Check("-VerifyExtras: exit code 0 when all is well, 1 when a check fails", vOk == 0 && vBad == 1);
                XKit.Check("and it is logged", XKit.Lines(@"ERROR verify \(-VerifyExtras\): \d+ failed") == 1 && XKit.Lines(@"\] verify \(-VerifyExtras\): 0 failed") == 1);

                // the report hook reads the same files
                Extras.Wire();
                var block = Report.ExtrasBlock();
                Assert.NotNull(block);
                Assert.Contains("falling-leaves", J.Strs(block, "on"));
                Report.ExtrasBlock = () => null;
            }
        }

        [Fact]
        public void No_extras_list_verify_says_so()
        {
            using (var s = new Scratch())
            {
                Assert.Equal(0, Extras.VerifyCommand());
                Assert.Null(Extras.ReportExtras());
            }
        }
    }

    /// <summary>The window's building blocks: Apply -> Yes (restart flow), Later -> the game closes, install now.</summary>
    [Collection("env")]
    public class ExtrasFlowTests
    {
        static ExtrasManifest Setup(Scratch s, out ExtrasPaths xq)
        {
            var b2 = new Dictionary<string, string> { { "iris.jar", "iris" }, { "makeup.zip", "makeup" }, { "comp.zip", "comp" }, { "fa.zip", "fa" }, { "emf.jar", "emf" }, { "etf.jar", "etf" }, { "fl.jar", "fl" } };
            var sh2 = b2.ToDictionary(kv => kv.Key, kv => XKit.ShaOfText(XKit.Rep(kv.Value, 40)));
            var m = XKit.List201(sh2);
            xq = Extras.GetPaths(Env.DataDir);
            foreach (var d0 in new[] { xq.Mods, xq.ResourcePacks, xq.ShaderPacks }) Directory.CreateDirectory(d0);
            var st = new ExtrasState();
            Extras.SyncFiles(xq, m, st, XKit.Fetch(b2, 40));
            st.Downloaded = true;
            st.Save(Env.ExtrasStatePath);
            Json.WriteFile(Env.ExtrasManifestPath, m.Raw);
            return m;
        }

        [Fact]
        public void Yes_closes_installs_checks_and_starts_the_game()
        {
            using (var s = new Scratch())
            {
                var m = Setup(s, out var xq);
                Extras.ClearLogLines();
                var game = new FakeGame { Running = { 41 } };
                var pick = new ExtrasChoice(XKit.C("falling-leaves", true), "none");
                var plan = Extras.PressApply(m, pick, true, false);
                Assert.Equal("ask_restart", plan.Route);
                Assert.Equal(1, XKit.Lines("apply pressed: switches before: iris=off, fresh-animations=off, falling-leaves=off, shaders=none; after: iris=off, fresh-animations=off, falling-leaves=on, shaders=none; the game is running"));
                var flow = RestartFlow.Start(m, plan.State, plan.Pick, true, game);
                Assert.Equal(1, XKit.Lines(@"restart: game found \(process 41\)"));
                Assert.Equal("closing", flow.Stage);
                Assert.Equal(new[] { "close 41" }, game.Did.ToArray());
                var launched = false;
                var lines = new List<string>();
                for (int i = 0; i < 10 && !flow.Finished; i++) { var l = flow.Step(() => launched = true); if (l != null) lines.Add(l); }
                Assert.True(flow.Finished);
                Assert.Equal(new[] { "Installing...", "Checking...", "Starting the game..." }, lines.ToArray());
                Assert.Equal(new[] { "Closing the game...", "Installing...", "Checking...", "Starting the game..." }, flow.Progress.ToArray());
                Assert.True(launched);
                Assert.Equal("Installed and checked.", flow.Say);
                Assert.True(File.Exists(Path.Combine(xq.Mods, "fl.jar")));
                var saved = ExtrasState.Read(Env.ExtrasStatePath);
                Assert.True(saved.On("falling-leaves")); Assert.Contains("fl.jar", saved.Applied.Mods); Assert.Null(saved.Queued);
                Assert.Equal(1, XKit.Lines(@"restart: the game closed after \d+ s"));
                Assert.Equal(1, XKit.Lines("restart: install done: OK"));
                Assert.Equal(1, XKit.Lines(@"check after install: \d+ check\(s\), 0 failed"));
                Assert.Equal(1, XKit.Lines(@"restart: relaunch started \(the Minecraft Launcher on Deepslate Works\)"));
            }
        }

        [Fact]
        public void A_game_that_does_not_close_is_ended_after_30_seconds()
        {
            using (var s = new Scratch())
            {
                var m = Setup(s, out var xq);
                var game = new FakeGame { Running = { 7 }, IgnoresClose = true };
                var clock = new DateTime(2026, 10, 1, 12, 0, 0);
                var st = ExtrasState.Read(Env.ExtrasStatePath);
                var flow = RestartFlow.Start(m, st, new ExtrasChoice(XKit.C("iris", true), "light"), false, game, now: () => clock);
                Assert.Null(flow.Step(null));
                clock = clock.AddSeconds(29); Assert.Null(flow.Step(null)); Assert.Equal("closing", flow.Stage);
                clock = clock.AddSeconds(1); Assert.Equal("Installing...", flow.Step(null));
                Assert.Contains("force 7", game.Did);
                Assert.Equal("Checking...", flow.Step(null));
                Assert.Null(flow.Step(null)); Assert.Equal("done", flow.Stage);   // not relaunching
                Assert.Null(flow.Step(null)); Assert.True(flow.Finished);
                Assert.True(File.Exists(Path.Combine(xq.ShaderPacks, "makeup.zip")));
            }
        }

        [Fact]
        public void A_failed_install_after_yes_still_starts_the_game_on_the_previous_set()
        {
            using (var s = new Scratch())
            {
                var m = Setup(s, out var xq);
                File.WriteAllText(Path.Combine(xq.Extras, "fl.jar"), "damaged");
                var st = ExtrasState.Read(Env.ExtrasStatePath);
                var flow = RestartFlow.Start(m, st, new ExtrasChoice(XKit.C("falling-leaves", true), "none"), true, new FakeGame());
                var opened = false;
                while (!flow.Finished) flow.Step(() => opened = true);
                Assert.False(flow.Result.Ok);
                Assert.Equal("Couldn't switch on Falling Leaves: the file is damaged. Nothing was changed. The game starts with your previous extras.", flow.Say);
                Assert.True(opened);
                Assert.False(ExtrasState.Read(Env.ExtrasStatePath).On("falling-leaves"));   // what is chosen goes back with the files
            }
        }

        [Fact]
        public void Later_queues_and_the_game_closing_installs()
        {
            using (var s = new Scratch())
            {
                var m = Setup(s, out var xq);
                Extras.ClearLogLines();
                var plan = Extras.PressApply(m, new ExtrasChoice(XKit.C("falling-leaves", true), "none"), true, false);
                Assert.Equal(ExtrasText.Queued, Extras.QueueForLater(plan.State, plan.Pick));
                Assert.Equal(1, XKit.Lines("queued install: queued at .*; installs when the game closes$"));
                var plan2 = Extras.PressApply(m, new ExtrasChoice(XKit.C("falling-leaves", true, "iris", true), "light"), true, false);
                Extras.QueueForLater(plan2.State, plan2.Pick);
                Assert.Equal(1, XKit.Lines(@"\(replaces the changes queued before\)"));
                var o = Extras.Overview(true, true);
                Assert.False(o.NeedsDownload);
                Assert.Equal("The game is running. Your changes install when it closes.", o.Headline.Text);
                Assert.Equal("restart", o.Headline.Action); Assert.Equal("amber", o.HeadlineTone);
                Assert.Equal("Waiting for the game to close", o.Statuses["falling-leaves"].Text);
                Assert.True(o.Chosen.On("iris"));
                Assert.Null(Extras.InstallQueuedIfClosed(true, false));    // still running
                Assert.Null(Extras.InstallQueuedIfClosed(false, true));    // the install steps are busy
                var done = Extras.InstallQueuedIfClosed(false, false);
                Assert.NotNull(done);
                Assert.True(done.Result.Ok);
                Assert.Equal(ExtrasText.InstalledQueued, done.Say);
                Assert.Equal(1, XKit.Lines(@"queued install: the game closed at \d{2}:\d{2}:\d{2}"));
                Assert.True(File.Exists(Path.Combine(xq.Mods, "fl.jar")) && File.Exists(Path.Combine(xq.ShaderPacks, "makeup.zip")));
                Assert.Null(ExtrasState.Read(Env.ExtrasStatePath).Queued);
                Assert.Null(Extras.InstallQueuedIfClosed(false, false));   // nothing left
                // Apply with nothing switched while a queue waits: back to what is installed
                var st = ExtrasState.Read(Env.ExtrasStatePath); Extras.SetQueue(st, XKit.C(), "none"); st.Save(Env.ExtrasStatePath);
                var same = Extras.PressApply(m, new ExtrasChoice(st.Choices, st.Shader), false, false);
                Assert.Equal("nothing", same.Route); Assert.Equal("Nothing to change.", same.Say);
                Assert.Null(ExtrasState.Read(Env.ExtrasStatePath).Queued);
                Assert.Equal(1, XKit.Lines("apply: back to what is installed: the queued changes were dropped"));
            }
        }

        [Fact]
        public void Install_now_then_start_and_restart_for_the_queue()
        {
            using (var s = new Scratch())
            {
                var m = Setup(s, out var xq);
                Extras.ClearLogLines();
                var plan = Extras.PressApply(m, new ExtrasChoice(XKit.C("fresh-animations", true), "none"), false, false);
                Assert.Equal("install", plan.Route);
                var o = Extras.InstallNow(m, plan.State, plan.Pick);
                Assert.True(o.Result.Ok); Assert.True(o.StartNext); Assert.Null(o.Say);
                Assert.Equal(0, o.Checks.Count(c => c.Ok == false));
                Assert.Equal(ExtrasText.InstalledStarting, Extras.StartAfterInstall(() => false));
                Assert.Equal(1, XKit.Lines("ERROR relaunch: the Minecraft Launcher was not found"));
                var check = Extras.CheckNow(m);
                Assert.Equal(ExtrasText.CheckedOk, check.Value);
                File.Delete(Path.Combine(xq.Mods, "emf.jar"));
                check = Extras.CheckNow(m);
                Assert.Equal("2 check(s) failed: see the list below.", check.Value);
                Assert.Equal(1, XKit.Lines(@"ERROR check: \d+ check\(s\), 2 failed: Fresh Animations: emf\.jar is missing from mods; Fresh Animations is on but EMF or ETF is missing"));
                var ov = Extras.Overview(true, false);
                Assert.Equal("Something is wrong with an extra: see the red line below.", ov.Headline.Text);
                Assert.Equal("red", ov.HeadlineTone);
                Assert.True(ov.Statuses["fresh-animations"].ShowsDetails);
                Assert.Equal(new[] { "Files", "Files", "Files", "Settings", "Dependencies", "Dependencies", "In game" }, ov.CheckRows.Select(r => r.Group).ToArray());
                Assert.Equal("Fresh Animations: waiting for the game to start", ov.CheckRows.Last().Text);
                Assert.Null(ov.CheckRows.Last().Ok);
                Assert.Equal(3, ov.New.Count);   // the switches: Iris, Fresh Animations, Falling Leaves
                Extras.MarkSeen(m);
                Assert.Empty(Extras.Overview(true, false).New);
                Assert.True(Extras.Overview(false, false).NeedsDownload);
                Assert.Null(Extras.RestartForQueue(m, new FakeGame()));
                var st = ExtrasState.Read(Env.ExtrasStatePath); Extras.SetQueue(st, XKit.C("iris", true), "full"); st.Save(Env.ExtrasStatePath);
                var flow = Extras.RestartForQueue(m, new FakeGame());
                Assert.NotNull(flow); Assert.True(flow.Pick.On("iris")); Assert.Equal("full", flow.Pick.Shader);
                Assert.Equal(1, XKit.Lines("restart: Restart now pressed for the queued changes"));
                Assert.Equal(1, XKit.Lines("restart: game not found: nothing to close"));
                Assert.Equal("10", Extras.DownloadSizeMb(new ExtrasManifest()));
                Assert.Equal("10", Extras.DownloadSizeMb(new ExtrasManifest { Size = 10485760 }));
            }
        }

        [Fact]
        public void Stop_game_closes_or_forces()
        {
            using (var s = new Scratch())
            {
                var g = new FakeGame { Running = { 5 } };
                Assert.Equal("closed", Extras.StopGame(new List<int> { 5 }, 30, g, ms => { }));
                var g2 = new FakeGame { Running = { 6 }, IgnoresClose = true };
                Assert.Equal("forced", Extras.StopGame(new List<int> { 6 }, 0, g2, ms => { }));
                Assert.Contains("force 6", g2.Did);
            }
        }
    }

    /// <summary>The install steps' extras step (2.0.0): the list fetched and saved, files downloaded, a failure a note.</summary>
    [Collection("env")]
    public class ExtrasSyncForRunTests
    {
        [Fact]
        public void The_engine_step()
        {
            using (var s = new Scratch())
            {
                var b2 = new Dictionary<string, string> { { "iris.jar", "iris" }, { "makeup.zip", "makeup" }, { "comp.zip", "comp" }, { "fa.zip", "fa" }, { "emf.jar", "emf" }, { "etf.jar", "etf" }, { "fl.jar", "fl" } };
                var sh2 = b2.ToDictionary(kv => kv.Key, kv => XKit.ShaOfText(XKit.Rep(kv.Value, 40)));
                var m = XKit.List201(sh2);
                var body = Json.Write(m.Raw);
                Http.Fake = (method, url, b) => url == Env.ExtrasUrl ? Tuple.Create(200, body) : null;
                var lines = new List<JObj>();
                var run = new Run { AllowAll = true, Sink = lines.Add };
                Extras.SyncForRun(run, XKit.Fetch(b2, 40));
                Assert.Equal(new[] { "step", "tick", "extras" }, lines.Select(l => J.Str(l, "t")).ToArray());
                Assert.Equal("Visual extras", J.Str(lines[0], "text"));
                Assert.Equal("5 extras ready (7 downloaded), 0 on", J.Str(lines[1], "text"));
                Assert.Equal(7L, J.Long(lines[2], "downloaded"));
                Assert.True(File.Exists(Env.ExtrasManifestPath));
                Assert.Equal(5, ExtrasManifest.Read(Env.ExtrasManifestPath).Extras.Count);
                var st = ExtrasState.Read(Env.ExtrasStatePath);
                Assert.True(st.Downloaded);
                Assert.Equal(new[] { "iris", "shader-light", "shader-full", "fresh-animations", "falling-leaves" }, st.Seen.ToArray());
                Assert.Equal(7, XKit.Count(Extras.GetPaths(Env.DataDir).Extras));

                // a queue left by Later is installed by the next Play; a failing one is a note
                st.Queued = new ExtrasChoice(XKit.C("falling-leaves", true), "none", Extras.NowIso()); st.Save(Env.ExtrasStatePath);
                lines.Clear();
                Extras.SyncForRun(run, XKit.Fetch(b2, 40));
                Assert.Equal("5 extras ready (0 downloaded), 1 on", J.Str(lines[1], "text"));
                Assert.Contains("fl.jar", ExtrasState.Read(Env.ExtrasStatePath).Applied.Mods);

                // the site cannot be reached: a note, the run goes on
                Http.Fake = (method, url, b) => Tuple.Create(500, "");
                lines.Clear();
                Extras.SyncForRun(run, XKit.Fetch(b2, 40));
                Assert.Single(lines);
                Assert.Equal("note", J.Str(lines[0], "t"));
                Assert.Equal("The visual extras could not be fetched this time: The remote server returned an error: (500).", J.Str(lines[0], "text"));

                // a dry run does nothing; no answer yet asks (and that leaves the step); Not now skips it
                lines.Clear();
                Extras.SyncForRun(new Run { AllowAll = true, DryRun = true, Sink = lines.Add });
                Assert.Empty(lines);
                Assert.Throws<NeedAnswer>(() => Extras.SyncForRun(new Run { Sink = lines.Add }));
                var declined = new Run { Sink = lines.Add };
                Consents.SetAnswer(declined.Consent, "extras", "decline", 1);
                lines.Clear();
                Extras.SyncForRun(declined);
                Assert.Empty(lines);
            }
        }
    }
}

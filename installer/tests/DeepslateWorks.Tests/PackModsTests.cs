using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 2.1.0's checks (DeepslateWorks.ps1 -SelfTest "the pack's mods before and after a launch"), ported: every mod checked
    // before the game starts, the game's log checked after (kanefinch's TaCZ kick, 2026-10-01). Same expected words.

    [Collection("env")]
    public class PackModsTests
    {
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
        static readonly Dictionary<string, string> Body = new Dictionary<string, string> { { "create.jar", "create body" }, { "tacz.jar", "tacz body" }, { "jei.jar", "jei body" } };
        static string Sha(string text) { using (var h = SHA512.Create()) return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant(); }

        static JObj Manifest() => J.O("version", "0.1.0+test", "server_address", "mc.example.test:25565", "files", new List<object> {
            J.O("slug", "create", "name", "Create", "filename", "create.jar", "sha512", Sha("create body"), "side", "both", "url", "https://cdn.modrinth.com/create.jar"),
            J.O("slug", "tacz-1.21.1", "name", "TaCZ (Timeless and Classics Zero)", "filename", "tacz.jar", "sha512", Sha("tacz body"), "side", "both", "url", "https://cdn.modrinth.com/tacz.jar"),
            J.O("slug", "jei", "name", "JEI", "filename", "jei.jar", "sha512", Sha("jei body"), "side", "both", "url", "https://cdn.modrinth.com/jei.jar"),
            J.O("slug", "bluemap", "name", "BlueMap", "filename", "bluemap.jar", "sha512", "00", "side", "server", "url", "https://cdn.modrinth.com/bluemap.jar") });

        static string Mods(Scratch s, params string[] present)
        {
            var dir = s.P("game", "mods"); Directory.CreateDirectory(dir);
            foreach (var n in present) File.WriteAllText(Path.Combine(dir, n), Body[n], Utf8);
            return dir;
        }

        [Fact] public void The_client_set_leaves_server_only_mods_out()
        {
            var files = Engine.PackFiles(Manifest());
            Assert.Equal(new[] { "create", "tacz-1.21.1", "jei" }, files.Select(f => J.Str(f, "slug")).ToArray());
        }

        [Fact] public void TaCZ_missing_or_damaged_is_said_and_counted()
        {
            using (var s = new Scratch())
            {
                var files = Engine.PackFiles(Manifest());
                var mods = Mods(s, "create.jar", "jei.jar");
                var c = Engine.TestPackMods(mods, files);
                Assert.False(c.Ok); Assert.Single(c.Missing); Assert.Equal("tacz-1.21.1", c.Missing[0].Slug); Assert.Equal("missing", c.Missing[0].Why);
                Assert.Equal("TaCZ (Timeless and Classics Zero) is not on this PC yet. Press Play to repair.", Engine.MissingText(c));
                File.WriteAllText(Path.Combine(mods, "tacz.jar"), "half a jar", Utf8);
                Assert.Equal("wrong", Engine.TestPackMods(mods, files).Missing[0].Why);
            }
        }

        [Fact] public void Repair_fetches_only_what_is_missing_or_wrong_then_everything_checks()
        {
            using (var s = new Scratch())
            {
                var files = Engine.PackFiles(Manifest());
                var mods = Mods(s, "create.jar", "jei.jar");
                var fetched = new List<string>();
                var c = Engine.RepairPackMods(mods, files, (f, dest) => { fetched.Add(J.Str(f, "filename")); File.WriteAllText(dest, Body[J.Str(f, "filename")], Utf8); });
                Assert.True(c.Ok); Assert.Equal(3, c.Checked); Assert.Equal(new[] { "tacz.jar" }, fetched.ToArray());
                File.Delete(Path.Combine(mods, "tacz.jar"));
                c = Engine.RepairPackMods(mods, files, (f, dest) => throw new IOException("no internet"));
                Assert.False(c.Ok); Assert.Equal("tacz-1.21.1", c.Missing[0].Slug);   // a fetch that fails: the launcher stays shut
            }
        }

        [Fact] public void The_launcher_opens_only_with_every_mod_in_place()
        {
            using (var s = new Scratch())
            {
                var files = Engine.PackFiles(Manifest());
                var mods = Mods(s, "create.jar", "jei.jar");
                var run = new Run(); var opened = 0; var launched = new List<JObj>();
                run.Sink = o => { if (J.Str(o, "t") == "launched") launched.Add(o); };
                Assert.False(Engine.OpenLauncherChecked(run, mods, files, () => { opened++; return true; }));
                Assert.Equal(0, opened); Assert.False(run.ModsCheck.Ok); Assert.Empty(launched);
                File.WriteAllText(Path.Combine(mods, "tacz.jar"), "tacz body", Utf8);
                Assert.True(Engine.OpenLauncherChecked(run, mods, files, () => { opened++; return true; }));
                Assert.Equal(1, opened); Assert.True(run.ModsCheck.Ok); Assert.Single(launched);
            }
        }

        [Fact] public void Nothing_else_opens_the_launcher()
        {
            // the source: OpenLauncher() is called only inside OpenLauncherChecked; the window goes through RequestPlay
            var src = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "..", "app", "src"));
            if (!Directory.Exists(src)) return;   // the sources are not next to the test binaries here
            var calls = Directory.GetFiles(src, "*.cs", SearchOption.AllDirectories)
                .SelectMany(f => File.ReadAllLines(f).Select(l => new { f = Path.GetFileName(f), l }))
                .Where(x => !x.l.TrimStart().StartsWith("//") && Regex.IsMatch(x.l, @"\bOpenLauncher\b(?!Checked)") && !x.l.Contains("public static bool OpenLauncher("))
                .ToList();
            Assert.Single(calls);
            Assert.Equal("PackMods.cs", calls[0].f);
            var ui = File.ReadAllText(Path.Combine(src, "Ui", "AppUi.cs"));
            Assert.Contains("RequestPlay(\"relaunch after Apply\")", ui);
            Assert.Contains("RequestPlay(\"restart after Apply\")", ui);
        }

        [Fact] public void The_mod_list_is_kept_for_the_game_check()
        {
            using (var s = new Scratch())
            {
                var p = s.P("pack.json");
                Engine.SavePackList(p, Manifest());
                var l = Engine.ReadPackList(p);
                Assert.Equal(3, J.Arr(l, "files").Count);
                Assert.Equal("TaCZ (Timeless and Classics Zero)", J.Str(J.Arr(l, "files").First(f => J.Str(f, "slug") == "tacz-1.21.1"), "name"));
                Assert.Equal("mc.example.test:25565", J.Str(l, "server"));
            }
        }

        static string Stamp(DateTime local) => local.ToString("ddMMMyyyy HH:mm:ss.fff", CultureInfo.InvariantCulture);
        static string Found(string n) => string.Format("[{0}] [main/INFO] [net.neoforged.fml.loading.moddiscovery.ModDiscoverer/SCAN]: Found mod file \"{1}\" of type MOD with provider net.neoforged.fml.loading.moddiscovery.locators.ModsFolderLocator", Stamp(DateTime.Now), n);
        static string Reload => string.Format("[{0}] [Render thread/INFO] [net.minecraft.server.packs.resources.ReloadableResourceManager/]: Reloading ResourceManager: vanilla, mod_resources", Stamp(DateTime.Now));
        static string Kick => string.Format("[{0}] [Render thread/INFO] [x/]: Channel of mod 'Timeless & Classics Guns: Zero' failed to connect: This channel is missing on the client side, but required on the server (tacz:acknowledge) [+1 more]", Stamp(DateTime.Now));
        static string Conn(string host) => string.Format("[{0}] [Server Connector #1/INFO] [net.minecraft.client.gui.screens.ConnectScreen/]: Connecting to {1}, 25565", Stamp(DateTime.Now), host);

        [Fact] public void The_games_log_after_a_launch()
        {
            using (var s = new Scratch())
            {
                var p = s.P("pack.json"); Engine.SavePackList(p, Manifest());
                var files = J.Arr(Engine.ReadPackList(p), "files");
                var ours = s.P("game"); var mc = s.P(".minecraft");
                foreach (var d in new[] { ours, mc }) Directory.CreateDirectory(Path.Combine(d, "logs"));
                var since = DateTime.UtcNow.AddMinutes(-1);
                Assert.Null(Engine.FindGameSession(ours, mc, since, "mc.example.test"));   // no game yet: nothing to say

                File.WriteAllText(Path.Combine(ours, "logs", "latest.log"), string.Join("\n", Found("create.jar"), Found("tacz.jar"), Found("jei.jar"), Reload), Utf8);
                var g = Engine.FindGameSession(ours, mc, since, "mc.example.test");
                var c = Engine.TestGameMods(g.Session, files, g.Elsewhere);
                Assert.False(g.Elsewhere); Assert.True(c.Ok); Assert.Equal("game", c.Where);

                File.WriteAllText(Path.Combine(ours, "logs", "latest.log"), string.Join("\n", Found("create.jar"), Found("jei.jar"), Reload, Conn("mc.example.test"), Kick), Utf8);
                g = Engine.FindGameSession(ours, mc, since, "mc.example.test");
                c = Engine.TestGameMods(g.Session, files, g.Elsewhere);
                Assert.True(g.Session.Refused); Assert.Equal("Timeless & Classics Guns: Zero", g.Session.RefusedMod); Assert.Equal("tacz", g.Session.RefusedChannel);
                Assert.False(c.Ok); Assert.Single(c.Missing);
                Assert.Equal("Your game started without TaCZ (Timeless and Classics Zero). Press Play to repair.", Engine.MissingText(c));

                // another launcher profile (.minecraft, no mods) going for our server: TaCZ named first, by its channel
                File.Delete(Path.Combine(ours, "logs", "latest.log"));
                File.WriteAllText(Path.Combine(mc, "logs", "latest.log"), string.Join("\n", Reload, Conn("mc.example.test"), Kick), Utf8);
                g = Engine.FindGameSession(ours, mc, since, "mc.example.test");
                c = Engine.TestGameMods(g.Session, files, g.Elsewhere);
                Assert.True(g.Elsewhere); Assert.False(c.Ok); Assert.True(c.Elsewhere); Assert.Equal("tacz-1.21.1", c.Missing[0].Slug); Assert.Equal(3, c.Missing.Count);
                Assert.Equal("Your game started without TaCZ (Timeless and Classics Zero) and 2 other mods. Press Play to repair.", Engine.MissingText(c));

                // another profile playing somewhere else is not our business
                File.WriteAllText(Path.Combine(mc, "logs", "latest.log"), string.Join("\n", Reload, Conn("hypixel.net")), Utf8);
                Assert.Null(Engine.FindGameSession(ours, mc, since, "mc.example.test"));

                // a log that lists no mod files makes no claim
                File.WriteAllText(Path.Combine(ours, "logs", "latest.log"), Reload, Utf8);
                g = Engine.FindGameSession(ours, mc, since, "mc.example.test");
                Assert.Null(Engine.TestGameMods(g.Session, files, g.Elsewhere));
            }
        }

        [Fact] public void Reports_carry_the_mod_check_even_from_a_run_that_stopped_part_way()
        {
            using (var s = new Scratch())
            {
                var files = Engine.PackFiles(Manifest());
                var mods = Mods(s, "create.jar", "jei.jar");
                var run = new Run { PackCheckDir = mods, PackCheckFiles = files };
                var b = Report.ModsBlock(run);
                Assert.False(J.Bool(b, "ok")); Assert.Equal("folder", J.Str(b, "where")); Assert.Equal(3, J.Int(b, "checked"));
                Assert.Equal("tacz-1.21.1", J.Str(J.Arr(b, "missing")[0], "slug"));
                Assert.Null(Report.ModsBlock(new Run()));   // before the mods step: nothing
            }
        }
    }
}

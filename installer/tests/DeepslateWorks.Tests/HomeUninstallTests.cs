using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>Self test: "uninstall". A whole PC in a scratch folder (brackets in the path on purpose): the game folder,
    /// vanilla .minecraft with a profile file that has other profiles in it, the app's home, the shortcuts, and
    /// "registry" keys as folders.</summary>
    [Collection("env")]
    public class HomeUninstallTests : HomeTestBase
    {
        const string Defaults = "{\"profiles\":{\"a1b2\":{\"created\":\"1970-01-01T00:00:00.000Z\",\"icon\":\"Grass\",\"lastUsed\":\"1970-01-01T00:00:00.000Z\",\"lastVersionId\":\"latest-release\",\"name\":\"\",\"type\":\"latest-release\"},"
            + "\"deepslate-works\":{\"created\":\"2026-09-30T10:00:00.000Z\",\"gameDir\":\"C:\\\\x\\\\.minecraft-deepslate-works\",\"icon\":\"Furnace\",\"javaArgs\":\"-Xmx6G\",\"lastVersionId\":\"neoforge-21.1.252\",\"name\":\"Deepslate Works\",\"type\":\"custom\"},"
            + "\"c3d4\":{\"created\":\"1970-01-01T00:00:00.000Z\",\"icon\":\"Dirt\",\"lastUsed\":\"1970-01-01T00:00:00.000Z\",\"lastVersionId\":\"latest-snapshot\",\"name\":\"\",\"type\":\"latest-snapshot\"}},"
            + "\"selectedProfile\":\"deepslate-works\",\"settings\":{\"crashAssistance\":true,\"enableAdvanced\":false,\"keepLauncherOpen\":false,\"profileSorting\":\"ByLastPlayed\",\"showGameLog\":false},\"version\":3}";

        static Uninstaller.Targets NewFootprint(string r)
        {
            var g = Path.Combine(r, ".minecraft-deepslate-works");
            foreach (var d in new[] { "mods", "config", "logs", "screenshots", @"runtime\jdk-21.0.4+7-jre\bin" }) Directory.CreateDirectory(Path.Combine(g, d));
            foreach (var f in new[] { @"mods\create.jar", @"config\x.toml", @"logs\latest.log", @"runtime\jdk-21.0.4+7-jre\bin\java.exe", "servers.dat", "installed.json" }) File.WriteAllText(Path.Combine(g, f), "x");
            File.WriteAllText(Path.Combine(g, "launcher.json"), "{\"token\":\"t0k\"}");
            File.WriteAllText(Path.Combine(g, @"screenshots\2026-09-30_10.00.00.png"), "png");
            var m = Path.Combine(r, ".minecraft");
            foreach (var d in new[] { @"saves\World 1", @"versions\neoforge-21.1.252", @"versions\1.21.1", @"runtime\java-runtime-delta" }) Directory.CreateDirectory(Path.Combine(m, d));
            foreach (var f in new[] { "options.txt", @"saves\World 1\level.dat", @"versions\neoforge-21.1.252\neoforge-21.1.252.json", @"versions\1.21.1\1.21.1.jar" }) File.WriteAllText(Path.Combine(m, f), "vanilla");
            File.WriteAllText(Path.Combine(m, "launcher_profiles.json"), Defaults);
            var h = Path.Combine(r, @"LocalAppData\DeepslateWorks");
            Directory.CreateDirectory(Path.Combine(h, "logs"));
            File.WriteAllText(Path.Combine(h, "DeepslateWorks.exe"), "MZ");
            File.WriteAllText(Path.Combine(h, @"logs\extras-2026-10-01.log"), "x");
            // 2.0.0: the extras downloaded for the Extras tab, and the app's own files
            Directory.CreateDirectory(Path.Combine(g, @"extras\pictures"));
            foreach (var f in new[] { @"extras\iris.jar", @"extras\fa.zip", @"extras\pictures\iris.png" }) File.WriteAllText(Path.Combine(g, f), "x");
            foreach (var f in new[] { "consent.json", "extras.json", "extras-manifest.json" }) File.WriteAllText(Path.Combine(h, f), "{}");
            foreach (var d in new[] { "Desktop", "Programs", "Pictures" }) Directory.CreateDirectory(Path.Combine(r, d));
            foreach (var l in new[] { @"Desktop\Deepslate Works.lnk", @"Programs\Deepslate Works.lnk", @"Programs\Uninstall Deepslate Works.lnk", @"Desktop\Somebody else.lnk" }) File.WriteAllText(Path.Combine(r, l), "lnk");
            foreach (var k in new[] { @"registry\Software\Classes\deepslate\shell\open\command", @"registry\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepslateWorks", @"registry\Software\Classes\other" }) Directory.CreateDirectory(Path.Combine(r, k));
            return Uninstaller.GetTargets(r, h, Path.Combine(r, "Desktop"), Path.Combine(r, "Programs"), Path.Combine(r, "Pictures"), Path.Combine(r, "registry"));
        }

        static string Vanilla(string r)
        {
            var m = Path.Combine(r, ".minecraft");
            return string.Join("\n", Directory.GetFiles(m, "*", SearchOption.AllDirectories).Where(f => Path.GetFileName(f) != "launcher_profiles.json")
                .OrderBy(f => f, StringComparer.Ordinal).Select(f => f.Substring(m.Length) + " " + Home.Sha256(f)));
        }

        static string OtherProfiles(string pf)
        {
            var p = J.Obj(Json.Parse(File.ReadAllText(pf)), "profiles");
            return string.Join("\n", p.OrderedKeys.Where(k => k != "deepslate-works").Select(k => k + "=" + Json.Write(p[k])));
        }

        [Fact] public void Uninstall_removes_ours_and_nothing_else()
        {
            var ur = S.P("pc [1]");
            var t = NewFootprint(ur);
            var vanilla = Vanilla(ur);
            var others = OtherProfiles(t.Profiles);
            var calls = new List<string>();

            Assert.True(Uninstaller.TestFootprint(t));
            Assert.Contains("Close the Minecraft Launcher", Uninstaller.GetRefusal(new[] { "MinecraftLauncher" }));
            Assert.Null(Uninstaller.GetRefusal(new string[0]));

            var res = Uninstaller.Invoke(t, "t0k", x => calls.Add("report " + x), x => calls.Add("revoke " + x), S.P("Downloads", "DeepslateWorks.exe"));
            Assert.Empty(res.Problems);
            Assert.False(Directory.Exists(t.GameDir));   // mods, settings, our Java, logs, the sign-in, extras\
            Assert.False(Directory.Exists(t.HomeDir));   // with consent.json and extras.json
            Assert.Null(res.RemoveLater);
            Assert.False(Directory.Exists(t.HandlerKey));
            Assert.False(Directory.Exists(t.UninstallKey));
            Assert.True(Directory.Exists(Path.Combine(ur, @"registry\Software\Classes\other")));
            Assert.DoesNotContain(t.Shortcuts, File.Exists);
            Assert.True(File.Exists(Path.Combine(ur, @"Desktop\Somebody else.lnk")));
            var pj = Json.Parse(File.ReadAllText(t.Profiles));
            Assert.False(J.Obj(pj, "profiles").ContainsKey("deepslate-works"));
            Assert.Null(J.Get(pj, "selectedProfile"));
            Assert.Equal(others, OtherProfiles(t.Profiles));
            Assert.Equal(vanilla, Vanilla(ur));
            Assert.False(File.Exists(t.Profiles + ".deepslate-backup"));
            Assert.True(File.Exists(Path.Combine(t.Pictures, "2026-09-30_10.00.00.png")));
            Assert.Contains("1 screenshot", string.Join(" ", res.Kept));
            Assert.Equal("report t0k,revoke t0k", string.Join(",", calls));   // told, then signed out, before the sign-in goes
            Assert.Contains("Java", string.Join(" ", res.Kept));
            Assert.Contains("account", string.Join(" ", res.Kept));
            Assert.Contains("this PC's sign-in, also signed out on the site", res.Removed);

            Assert.False(Uninstaller.TestFootprint(t));
            var again = Uninstaller.Invoke(t, null, x => calls.Add("report"), x => calls.Add("revoke"), null);
            Assert.Empty(again.Removed);
            Assert.Empty(again.Problems);
        }

        [Fact] public void The_running_exe_in_the_home_goes_after_this_process_has_ended()
        {
            var t = NewFootprint(S.P("pc [home]"));
            var me = Path.Combine(t.HomeDir, "DeepslateWorks.exe");
            var res = Uninstaller.Invoke(t, null, null, null, me);
            Assert.Empty(res.Problems);
            Assert.Equal(t.HomeDir, res.RemoveLater);
            Assert.Equal("DeepslateWorks.exe", Names(t.HomeDir));   // everything else is gone now
            Assert.Contains(res.Removed, x => x.StartsWith("Deepslate Works itself, in your AppData") && x.Contains("goes a few seconds after this message is closed"));
        }

        [Fact] public void The_site_out_of_reach_it_still_uninstalls()
        {
            var t = NewFootprint(S.P("pc [2]"));
            Action<string> down = x => throw new Exception("The remote name could not be resolved");
            var res = Uninstaller.Invoke(t, "t0k", down, down, null);
            Assert.Empty(res.Problems);
            Assert.False(Directory.Exists(t.GameDir));
            Assert.False(Uninstaller.TestFootprint(t));
            Assert.Contains("expires by itself", string.Join(" ", res.Removed));
        }

        [Fact] public void A_launcher_file_that_cannot_be_read_is_left_as_it_was()
        {
            var t = NewFootprint(S.P("pc [3]"));
            File.WriteAllText(t.Profiles, "{ this is not json");
            var res = Uninstaller.Invoke(t, null, null, null, null);
            Assert.Equal("{ this is not json", File.ReadAllText(t.Profiles));
            Assert.Contains("launcher profile", string.Join(" ", res.Problems));
        }

        [Fact] public void A_write_that_fails_half_way_puts_the_backup_back()
        {
            var t = NewFootprint(S.P("pc [4]"));
            var before = File.ReadAllText(t.Profiles);
            Uninstaller.WriteProfiles = (p, o) => { File.WriteAllText(p, "{ half"); throw new IOException("disk full"); };
            Assert.ThrowsAny<Exception>(() => Uninstaller.RemoveLauncherProfile(t.Profiles, "deepslate-works"));
            Assert.Equal(before, File.ReadAllText(t.Profiles));
            Assert.False(File.Exists(t.Profiles + ".deepslate-backup"));
        }

        [Fact] public void Screenshots_never_overwrite()
        {
            var from = S.P("shots");
            Write(Path.Combine(from, "a.png"), "new");
            var to = S.P("Pictures", "Deepslate Works screenshots");
            Write(Path.Combine(to, "a.png"), "old");
            Write(Path.Combine(to, "a (1).png"), "older");
            Assert.Equal(1, Uninstaller.MoveScreenshots(from, to));
            Assert.Equal("old", File.ReadAllText(Path.Combine(to, "a.png")));
            Assert.Equal("new", File.ReadAllText(Path.Combine(to, "a (2).png")));
            Assert.Equal(0, Uninstaller.MoveScreenshots(S.P("none"), to));
        }

        [Fact] public void The_summary_is_2_0_3s_words()
        {
            var r = new Uninstaller.Result();
            r.Removed.Add("a"); r.Kept.Add("b");
            Assert.Equal("Removed:\r\n  - a\r\nKept:\r\n  - b\r\n\r\nDeepslate Works is off this PC. To play again, download it from the site.", Uninstaller.Summary(r));
            r.Problems.Add("c");
            Assert.EndsWith("Not done:\r\n  - c\r\n\r\nMost of it is gone. Close Minecraft and run the uninstall again for the rest.", Uninstaller.Summary(r));
        }

        [Fact] public void Targets_on_a_PC()
        {
            var t = Uninstaller.GetTargets(@"C:\Users\x\AppData\Roaming", @"C:\Users\x\AppData\Local\DeepslateWorks", @"C:\Users\x\Desktop", @"C:\P", @"C:\Pics", "HKCU:");
            Assert.Equal(@"C:\Users\x\AppData\Roaming\.minecraft-deepslate-works", t.GameDir);
            Assert.Equal(@"C:\Users\x\AppData\Roaming\.minecraft\launcher_profiles.json", t.Profiles);
            Assert.Equal(@"HKCU:\Software\Classes\deepslate", t.HandlerKey);
            Assert.Equal(@"HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepslateWorks", t.UninstallKey);
            Assert.Equal(@"C:\Pics\Deepslate Works screenshots", t.Pictures);
            Assert.Equal(new[] { @"C:\Users\x\Desktop\Deepslate Works.lnk", @"C:\P\Deepslate Works.lnk", @"C:\P\Uninstall Deepslate Works.lnk" }, t.Shortcuts);
        }
    }
}

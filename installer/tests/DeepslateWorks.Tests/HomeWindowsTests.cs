using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Microsoft.Win32;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>The real shortcuts, registry and lock on Windows. Registry writes go under HKCU\Software\DeepslateWorksTest
    /// only, which each test deletes.</summary>
    [Collection("env")]
    public class HomeWindowsTests : HomeTestBase
    {
        const string RegRoot = @"Software\DeepslateWorksTest";

        static void DropTestKey() { try { Registry.CurrentUser.DeleteSubKeyTree(RegRoot, false); } catch { } }

        [WindowsFact] public void A_real_shortcut_reads_back_with_target_arguments_and_the_taskbar_id()
        {
            var exe = Write(S.P("home [x]", "DeepslateWorks.exe"), "MZ");
            var file = S.P("Deepslate Works.lnk");
            Home.WriteShortcut(file, Home.ShortcutSpec(exe, "desktop"));
            var l = Home.ReadShortcut(file);
            Assert.Equal(exe, l.Target, StringComparer.OrdinalIgnoreCase);
            Assert.Equal("-From desktop", l.Arguments);
            Assert.Equal(Path.GetDirectoryName(exe), l.WorkingDirectory, StringComparer.OrdinalIgnoreCase);
            Assert.Equal(exe, l.IconPath, StringComparer.OrdinalIgnoreCase);
            Assert.Equal(0, l.IconIndex);
            Assert.Equal(Env.AppUserModelId, l.AppUserModelId);
            Assert.Equal(Home.ShortcutDescription, l.Description);
        }

        [WindowsFact] public void The_three_shortcuts_count_only_when_they_start_what_this_version_makes()
        {
            var exe = Write(S.P("home", "DeepslateWorks.exe"), "MZ");
            var desk = S.P("Desktop"); var progs = S.P("Programs");
            Directory.CreateDirectory(desk); Directory.CreateDirectory(progs);
            Assert.False(Home.TestShortcuts(exe, desk, progs));
            var made = Home.SetShortcuts(exe, desk, progs);
            Assert.Equal(3, made.Made);
            Assert.Empty(made.Failed);
            Assert.True(Home.TestShortcuts(exe, desk, progs));
            Assert.Equal("-Uninstall -From startmenu", Home.ReadShortcut(Path.Combine(progs, "Uninstall Deepslate Works.lnk")).Arguments);
            // a 2.0.3 shortcut: wscript and the shim
            var wscript = Path.Combine(Environment.SystemDirectory, "wscript.exe");
            Home.WriteShortcut(Path.Combine(desk, "Deepslate Works.lnk"), new Home.Shortcut { Target = wscript, Arguments = "\"" + Path.Combine(Path.GetDirectoryName(exe), "DeepslateWorks.vbs") + "\" -From desktop" });
            Assert.False(Home.TestShortcuts(exe, desk, progs));
            // a folder that is not there: which one failed, and why
            var r = Home.SetShortcuts(exe, S.P("no such desktop"), progs);
            Assert.Equal(2, r.Made);
            Assert.Equal("desktop", Assert.Single(r.Failed).Key);
        }

        [WindowsFact] public void The_play_link_and_Settings_Apps_in_the_registry()
        {
            DropTestKey();
            try
            {
                var exe = Write(S.P("home", "DeepslateWorks.exe"), "MZ");
                var game = S.P("game");
                Write(Path.Combine(game, "mods", "a.jar"), new string('x', 4096));
                var io = new WindowsHomeIo(game, RegRoot, S.P("Desktop"), S.P("Programs"));
                Assert.Equal("", io.Handler());
                Assert.True(io.SetHandler(exe));
                Assert.Equal(Home.HandlerCommand(exe), io.Handler());
                using (var k = Registry.CurrentUser.OpenSubKey(RegRoot + @"\Classes\deepslate"))
                {
                    Assert.Equal("URL:Deepslate Works", k.GetValue(""));
                    Assert.Equal("", k.GetValue("URL Protocol"));
                }
                using (var k = Registry.CurrentUser.OpenSubKey(RegRoot + @"\Classes\deepslate\DefaultIcon")) Assert.Equal("\"" + exe + "\",0", k.GetValue(""));

                Assert.False(io.Listed(exe));
                io.List(exe);
                Assert.True(io.Listed(exe));
                using (var k = Registry.CurrentUser.OpenSubKey(RegRoot + @"\Microsoft\Windows\CurrentVersion\Uninstall\DeepslateWorks"))
                {
                    Assert.Equal("Deepslate Works", k.GetValue("DisplayName"));
                    Assert.Equal(Env.Version, k.GetValue("DisplayVersion"));
                    Assert.Equal("\"" + exe + "\" -Uninstall -From apps", k.GetValue("UninstallString"));
                    Assert.Equal(game, k.GetValue("InstallLocation"));
                    Assert.Equal(RegistryValueKind.DWord, k.GetValueKind("NoModify"));
                    Assert.Equal(1, k.GetValue("NoRepair"));
                    Assert.Equal(4, k.GetValue("EstimatedSize"));
                }
                Assert.False(io.Listed(S.P("elsewhere", "DeepslateWorks.exe")));   // another exe: listed again
            }
            finally { DropTestKey(); }
        }

        [WindowsFact] public void Repair_with_the_real_registry_and_shortcuts()
        {
            DropTestKey();
            try
            {
                var dl = Write(S.P("Downloads", "DeepslateWorks.exe"), "MZ download");
                var home = S.P("LocalAppData", "DeepslateWorks");
                Directory.CreateDirectory(S.P("Desktop")); Directory.CreateDirectory(S.P("Programs"));
                var io = new WindowsHomeIo(S.P("game"), RegRoot, S.P("Desktop"), S.P("Programs"));
                var r = Home.Repair(dl, home, io);
                Assert.Empty(r.Problems);
                Assert.True(r.Linked);
                Assert.True(io.ShortcutsThere(r.Exe));
                Assert.True(io.Listed(r.Exe));
            }
            finally { DropTestKey(); }
        }

        [WindowsFact] public void Uninstall_removes_registry_keys_too()
        {
            DropTestKey();
            try
            {
                using (Registry.CurrentUser.CreateSubKey(RegRoot + @"\Classes\deepslate\shell\open\command")) { }
                var key = @"HKCU:\" + RegRoot + @"\Classes\deepslate";
                Assert.True(Uninstaller.KeyExists(key));
                Uninstaller.RemoveKey(key);
                Assert.False(Uninstaller.KeyExists(key));
                Assert.True(Uninstaller.KeyExists(@"HKCU:\" + RegRoot + @"\Classes"));
            }
            finally { DropTestKey(); }
        }

        [WindowsFact] public void One_copy_at_a_time()
        {
            var name = @"Global\DeepslateWorksTest-" + Guid.NewGuid().ToString("N");
            var mine = Uninstaller.TakeLock(name);
            Assert.NotNull(mine);
            Mutex other = null;
            var th = new Thread(() => { other = Uninstaller.TakeLock(name); });
            th.Start(); th.Join();
            Assert.Null(other);   // a second copy while it is held
            Uninstaller.ReleaseLock(mine);
            th = new Thread(() => { other = Uninstaller.TakeLock(name); Uninstaller.ReleaseLock(other); });
            th.Start(); th.Join();
            Assert.NotNull(other);   // once it is let go

            // a copy that takes the lock and ends without letting go of it, as a killed run would
            th = new Thread(() => { var m = new Mutex(false, name); m.WaitOne(0); });
            th.Start(); th.Join();
            var after = Uninstaller.TakeLock(name);
            Assert.NotNull(after);
            Uninstaller.ReleaseLock(after);
        }

        [WindowsFact] public void Finding_the_launcher_never_throws()
        {
            Assert.Contains("MinecraftLauncher", Home.FindLauncher(new[] { "MinecraftLauncher" }));
            Assert.NotNull(Home.FindLauncher());
        }
    }
}

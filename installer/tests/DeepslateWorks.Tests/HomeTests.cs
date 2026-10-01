using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>Self test: "the Play link, the handler and the shortcuts", "the home folder", "a 1.4.x copy updated into
    /// this one" (now: a 2.x home moved over to the exe), "Setup, part by part (1.5.6)".</summary>
    [Collection("env")]
    public class HomeTests : HomeTestBase
    {
        const string HomeExe = @"C:\Users\x\AppData\Local\DeepslateWorks\DeepslateWorks.exe";

        // ---- the Play link, the handler and the shortcuts ----------------------------------------------------------

        [Fact] public void The_play_link_starts_the_exe_with_the_link_and_nothing_else()
            => Assert.Equal("\"C:\\Users\\x\\AppData\\Local\\DeepslateWorks\\DeepslateWorks.exe\" \"%1\"", Home.HandlerCommand(HomeExe));

        [Fact] public void The_shortcuts_start_the_exe_and_say_where_they_came_from()
        {
            var d = Home.ShortcutSpec(HomeExe, "desktop");
            Assert.Equal(HomeExe, d.Target);
            Assert.Equal("-From desktop", d.Arguments);
            Assert.Equal(@"C:\Users\x\AppData\Local\DeepslateWorks", d.WorkingDirectory);
            Assert.Equal(HomeExe, d.IconPath);
            Assert.Equal(0, d.IconIndex);
            Assert.Equal("DeepslateWorks.App", d.AppUserModelId);
            Assert.Equal("Opens Deepslate Works: updates the game and starts the Minecraft Launcher on it", d.Description);
            Assert.Equal("-From startmenu", Home.ShortcutSpec(HomeExe, "startmenu").Arguments);
            var u = Home.UninstallShortcutSpec(HomeExe);
            Assert.Equal(HomeExe, u.Target);
            Assert.Equal("-Uninstall -From startmenu", u.Arguments);
            Assert.Equal("Removes Deepslate Works from this PC", u.Description);
            Assert.Equal("Deepslate Works.lnk", Home.ShortcutName);
            Assert.Equal("Uninstall Deepslate Works.lnk", Home.UninstallShortcutName);
        }

        [Fact] public void Settings_Apps_names_the_version_and_its_Uninstall_runs_the_exe()
        {
            var e = Home.UninstallEntry(HomeExe, @"C:\Users\x\AppData\Roaming\.minecraft-deepslate-works", 1234);
            Assert.Equal("Deepslate Works", J.Str(e, "DisplayName"));
            Assert.Equal(Env.Version, J.Str(e, "DisplayVersion"));
            Assert.Equal("Deepslate Works", J.Str(e, "Publisher"));
            Assert.Equal("\"" + HomeExe + "\",0", J.Str(e, "DisplayIcon"));
            Assert.Equal("\"" + HomeExe + "\" -Uninstall -From apps", J.Str(e, "UninstallString"));
            Assert.Equal(@"C:\Users\x\AppData\Roaming\.minecraft-deepslate-works", J.Str(e, "InstallLocation"));
            Assert.Equal(1234, e["EstimatedSize"]);
            Assert.Equal(1, e["NoModify"]);
            Assert.Equal(1, e["NoRepair"]);
        }

        [Fact] public void Folder_size_in_kb()
        {
            Write(S.P("g", "a.bin"), new string('x', 1500));
            Write(S.P("g", "sub [1]", "b.bin"), new string('x', 1000));
            Assert.Equal(3, Home.FolderSizeKb(S.P("g")));
            Assert.Equal(0, Home.FolderSizeKb(S.P("nothing")));
        }

        // ---- the home folder ---------------------------------------------------------------------------------------

        [Fact] public void The_exe_is_put_in_place_and_never_over_a_newer_one()
        {
            var hd = S.P("LocalAppData [x]", "DeepslateWorks");
            foreach (var old in new[] { "install.ps1", "install.ps1.bak", "Setup.bat" }) Write(Path.Combine(hd, old), "old");
            var src = Write(S.P("zip folder", "DeepslateWorks.exe"), "MZ this");
            var io = new FileHomeIo(S.P("io"));
            var t = Home.InstallHome(src, hd, io);
            Assert.Equal(Path.Combine(hd, "DeepslateWorks.exe"), t);
            Assert.Equal("DeepslateWorks.exe,install.ps1,install.ps1.bak,Setup.bat", Names(hd));   // the old layout waits for the link
            Home.RemoveOldLayout(hd);
            Assert.Equal("DeepslateWorks.exe", Names(hd));

            File.WriteAllText(t, "MZ newer");
            Home.ProductVersionOf = f => Home.SamePath(f, t) ? "99.0.0" : "3.0.0";
            Home.InstallHome(src, hd, io);
            Assert.Equal("MZ newer", File.ReadAllText(t));
            Assert.True(Logged("is newer than this one; left as it is"));

            Home.ProductVersionOf = f => Home.SamePath(f, t) ? "2.9.0" : "3.0.0";
            Home.InstallHome(src, hd, io);
            Assert.Equal("MZ this", File.ReadAllText(t));
            Assert.False(File.Exists(t + ".copy"));
        }

        [Fact] public void Is_home_copy()
        {
            Assert.False(Home.IsHomeCopy());   // AppHome is in the scratch folder
            if (string.Equals(Path.GetFileName(Env.MePath), Env.ExeName, StringComparison.OrdinalIgnoreCase))
            {
                Env.AppHome = Path.GetDirectoryName(Env.MePath).ToUpperInvariant();
                Assert.True(Home.IsHomeCopy());
            }
        }

        // ---- a 2.x home moved over to the exe (3.0; was: a 1.4.x copy updated into this one) ------------------------

        string NewTwoXHome(out string exe, out FileHomeIo io)
        {
            var wh = S.P("whole path [2.x]", "LocalAppData", "DeepslateWorks");
            Write(Path.Combine(wh, "DeepslateWorks.ps1"), "# Deepslate Works\n$InstallerVersion = \"2.1.3\"   # the bridge\n");
            foreach (var f in new[] { "DeepslateWorks.ps1.bak", "DeepslateWorks.vbs", "DeepslateWorks.ico", "install.ps1", "install.ps1.bak", "DeepslateWorks.ps1.new", "other.ps1.new", "Setup.bat" })
                Write(Path.Combine(wh, f), "old");
            foreach (var f in new[] { "consent.json", "extras.json", "extras-manifest.json" }) Write(Path.Combine(wh, f), "{}");
            Write(Path.Combine(wh, "logs", "extras-2026-10-01.log"), "x");
            exe = Write(Path.Combine(wh, "DeepslateWorks.exe"), "MZ 3.0");   // put there by 2.1.3's bridge
            io = new FileHomeIo(S.P("whole path [2.x]", "registry and shortcuts"));
            var vbs = Path.Combine(wh, "DeepslateWorks.vbs");
            File.WriteAllText(Path.Combine(io.At, "handler.txt"), "\"C:\\Windows\\System32\\wscript.exe\" \"" + vbs + "\" \"%1\"");
            foreach (var n in new[] { "Desktop.lnk", "Programs.lnk", "Uninstall.lnk" }) File.WriteAllText(Path.Combine(io.At, n), "\"C:\\Windows\\System32\\wscript.exe\" \"" + vbs + "\" -From desktop");
            File.WriteAllText(Path.Combine(io.At, "apps.txt"), "\"C:\\Windows\\System32\\wscript.exe\" \"" + vbs + "\" -From apps -Uninstall|2.1.3");
            return wh;
        }

        [Fact] public void A_2x_home_moves_over_to_the_exe_and_the_old_files_go_once_the_link_points_at_it()
        {
            var wh = NewTwoXHome(out var exe, out var io);
            var r = Home.Repair(exe, wh, io);
            Assert.Empty(r.Problems);
            Assert.True(r.Linked);
            Assert.True(r.Fixed);
            Assert.Equal(exe, r.Exe);
            Assert.Equal(Home.HandlerCommand(exe), File.ReadAllText(Path.Combine(io.At, "handler.txt")));
            Assert.True(io.ShortcutsThere(exe));   // 2.x's wscript shortcuts were made again
            Assert.True(io.Listed(exe));
            Assert.Equal("consent.json,DeepslateWorks.exe,extras-manifest.json,extras.json,logs", Names(wh));
            Assert.True(Logged("removed the old DeepslateWorks.ps1 (2.1.3)"));
            Assert.True(Logged("removed the old DeepslateWorks.vbs"));
            Assert.True(Logged("removed the old other.ps1.new"));
            Assert.True(Logged("Play button set up on this run"));

            // and the next run finds everything right and does nothing
            Log.ClearRun();
            var again = Home.Repair(exe, wh, io);
            Assert.True(again.Linked);
            Assert.False(again.Fixed);
            Assert.Empty(again.Problems);
            Assert.False(Logged("the shortcuts were made again"));
            Assert.False(Logged("listed in Settings -> Apps"));
        }

        [Fact] public void When_the_link_cannot_be_pointed_at_the_exe_the_2x_files_are_kept()
        {
            var wh = NewTwoXHome(out var exe, out var io);
            io.SetHandlerFn = t => false;
            var r = Home.Repair(exe, wh, io);
            Assert.False(r.Linked);
            Assert.True(File.Exists(Path.Combine(wh, "DeepslateWorks.ps1")));
            Assert.True(File.Exists(Path.Combine(wh, "DeepslateWorks.vbs")));
            Assert.Equal("link_failed", J.Str(r.Problems.Single(), "code"));
            Assert.True(Logged("the old files are kept: the Play link does not point at the installed copy"));
        }

        [Fact] public void Links_declined_no_link_no_shortcuts_but_listed_in_Settings_Apps()
        {
            var wh = NewTwoXHome(out var exe, out var io);
            var r = Home.Repair(exe, wh, io, noLinks: true);
            Assert.False(r.Linked);
            Assert.Empty(r.Problems);
            Assert.Contains(r.Said, x => x.Key == "note" && x.Value == "No Play button link or shortcuts: you said Not now (Review permissions changes that)");
            Assert.False(io.ShortcutsThere(exe));
            Assert.True(io.Listed(exe));
            Assert.True(File.Exists(Path.Combine(wh, "DeepslateWorks.ps1")));   // the link may still name it
        }

        // ---- Setup, part by part (1.5.6) ---------------------------------------------------------------------------

        [Fact] public void Inside_the_zip_and_under_temp()
        {
            var ft = S.P("fake temp");
            Assert.True(Home.TestInsideZip(Path.Combine(ft, "Temp1_installer.zip", "DeepslateWorks.exe"), ft));
            Assert.True(Home.TestInsideZip(Path.Combine(ft, "Temp2_installer (1).zip", "installer", "DeepslateWorks.exe"), ft));
            Assert.False(Home.TestInsideZip(S.P("Downloads", "installer", "DeepslateWorks.exe"), ft));
            Assert.False(Home.TestInsideZip(Path.Combine(ft, "deepslate-update", "DeepslateWorks.exe"), ft));
            Assert.True(Home.TestUnderTemp(Path.Combine(ft, "deepslate-update", "DeepslateWorks.exe"), ft + "\\"));
            Assert.False(Home.TestUnderTemp(S.P("fake temperature", "DeepslateWorks.exe"), ft));
            Assert.False(Home.TestUnderTemp("", ft));
        }

        [Fact] public void Denied_and_in_use_count_as_refused()
        {
            Assert.True(Home.TestDenied(new UnauthorizedAccessException("Access to the path 'x' is denied.")));
            Assert.True(Home.TestDenied(new IOException("The process cannot access the file because it is being used by another process.")));
            Assert.True(Home.TestDenied(new Exception("outer", new UnauthorizedAccessException("no"))));
            Assert.False(Home.TestDenied(new IOException("There is not enough space on the disk.")));
        }

        string Download() => Write(S.P("Downloads [x]", "DeepslateWorks.exe"), "MZ download");
        FileHomeIo NewIo(string name) => new FileHomeIo(S.P(name));

        [Fact] public void Copy_refused_twice_tried_twice_2s_apart_and_the_link_still_points_at_the_download()
        {
            var dl = Download();
            int tries = 0;
            var io = NewIo("denied twice");
            io.Copier = (from, to) => { tries++; throw new UnauthorizedAccessException("Access to the path '" + to + "' is denied."); };
            var h = S.P("denied twice home", "DeepslateWorks");
            var r = Home.Repair(dl, h, io, force: true);
            var c = r.Problems.Where(p => J.Str(p, "part") == "copy").ToList();
            Assert.Equal(2, tries);
            Assert.Equal(2, io.Slept);
            Assert.Single(c);
            Assert.Equal("copy_denied", J.Str(c[0], "code"));
            Assert.Equal(string.Format("Your antivirus or Windows stopped the installer copying itself to {0}. The game is installed and works from the Deepslate Works launcher profile; the Play button on the site won't work on this PC until this is fixed.", h), J.Str(c[0], "message"));
            Assert.True(r.Linked);
            Assert.Equal(Home.HandlerCommand(dl), File.ReadAllText(Path.Combine(io.At, "handler.txt")));
            Assert.Single(r.Problems);
            Assert.Equal(J.Str(c[0], "message") + "|The Play button on the site now starts Deepslate Works on this PC|Shortcuts made", string.Join("|", r.Said.Select(x => x.Value)));
        }

        [Fact] public void Copy_refused_once_then_fine()
        {
            var dl = Download();
            int tries = 0;
            var io = NewIo("denied once");
            io.Copier = (from, to) => { tries++; if (tries == 1) throw new IOException("The process cannot access the file because it is being used by another process."); Home.CopyFile(from, to); };
            var h = S.P("denied once home", "DeepslateWorks");
            var r = Home.Repair(dl, h, io, force: true);
            Assert.Equal(2, tries);
            Assert.Equal(2, io.Slept);
            Assert.Empty(r.Problems);
            Assert.Equal(Path.Combine(h, "DeepslateWorks.exe"), r.Exe);
            Assert.Equal("MZ download", File.ReadAllText(r.Exe));
            Assert.Equal("Installed in " + h, r.Said[0].Value);
        }

        [Fact] public void Desktop_blocked_by_ransomware_protection_is_a_note_and_otherwise_a_problem()
        {
            var dl = Download();
            var io = NewIo("no desktop");
            io.MakeShortcutsFn = t => new Home.ShortcutsMade { Made = 2, Failed = { new KeyValuePair<string, string>("desktop", "Access is denied.") } };
            io.Cfa = true;
            var h = S.P("no desktop home", "DeepslateWorks");
            var r = Home.Repair(dl, h, io, force: true);
            Assert.Single(r.Problems);
            Assert.Equal("shortcut_blocked", J.Str(r.Problems[0], "code"));
            Assert.True(r.Linked);
            Assert.Equal(Path.Combine(h, "DeepslateWorks.exe"), r.Exe);
            Assert.Equal("Windows' ransomware protection blocked the desktop shortcut. The Start Menu entry and the Play button still work.", r.Said.First(x => x.Key == "note").Value);

            io.Cfa = false;
            var r5 = Home.Repair(dl, S.P("no desktop 2", "DeepslateWorks"), io, force: true);
            Assert.Single(r5.Problems);
            Assert.Equal("other", J.Str(r5.Problems[0], "code"));
            Assert.Equal("Could not make the shortcuts: Access is denied.", J.Str(r5.Problems[0], "message"));
            Assert.True(r5.Linked);
        }

        [Fact] public void Copy_refused_while_running_from_temp_no_link_and_no_shortcuts_to_it()
        {
            var ft = S.P("fake temp");
            var io = NewIo("temp run");
            io.Copier = (from, to) => throw new UnauthorizedAccessException("Access to the path '" + to + "' is denied.");
            io.Temp = ft;
            var r = Home.Repair(Path.Combine(ft, "deepslate-update", "DeepslateWorks.exe"), S.P("temp run home", "DeepslateWorks"), io, force: true);
            Assert.False(r.Linked);
            Assert.False(File.Exists(Path.Combine(io.At, "handler.txt")));
            Assert.False(File.Exists(Path.Combine(io.At, "Desktop.lnk")));
            Assert.Single(r.Problems, p => J.Str(p, "code") == "link_failed");
        }

        [Fact] public void A_later_run_puts_right_what_setup_could_not_and_the_report_says_what_is_missing()
        {
            var dl = Download();
            var io = NewIo("fixed later");
            File.WriteAllText(Path.Combine(io.At, "handler.txt"), "something else");
            var r7 = Home.Repair(dl, S.P("fixed later home", "DeepslateWorks"), io);
            Assert.True(r7.Fixed);
            Assert.True(r7.Linked);
            Assert.Empty(r7.Problems);

            var io2 = NewIo("denied twice");
            io2.Copier = (from, to) => throw new UnauthorizedAccessException("Access to the path '" + to + "' is denied.");
            var r2 = Home.Repair(dl, S.P("denied twice home", "DeepslateWorks"), io2, force: true);

            var run = new Run { Mode = "uninstall" };   // "uninstall": the report leaves out the PC details (no WMI in a unit test)
            Home.SetSetupState(run, r2);
            var j2 = Json.Write(Report.New(run, "ok"));
            Home.SetSetupState(run, r7);
            var j7 = Json.Write(Report.New(run, "ok"));
            run.SetupChecked = false;
            var j0 = Json.Write(Report.New(run, "ok"));
            Assert.Contains("\"setupProblems\":[{\"part\":\"copy\",\"code\":\"copy_denied\",\"message\":\"Your antivirus", j2);
            Assert.Contains("\"setupProblems\":[]", j7);
            Assert.Contains("\"setupProblems\":null", j0);
        }

        [Fact] public void A_problem_message_is_cut_at_500()
        {
            var list = new List<JObj>();
            Home.AddSetupProblem(list, "apps", "other", new string('x', 800));
            Assert.Equal(500, J.Str(list[0], "message").Length);
            Assert.True(Logged("setup: apps other: "));
        }

        // ---- RepairHere and InstallFromDownload (3.0) --------------------------------------------------------------

        [Fact] public void RepairHere_sets_the_runs_setup_state()
        {
            var io = new FileHomeIo(S.P("io"));
            Home.Io = io;
            var run = new Run();
            var r = Home.RepairHere(run, true);
            Assert.True(run.SetupChecked);
            Assert.Equal(r.Problems.Count, run.SetupProblems.Count);
            Assert.True(r.Linked);
            Assert.Equal(Env.HomeExe, r.Exe);
            Assert.True(File.Exists(Env.HomeExe));
            Assert.True(io.ShortcutsThere(Env.HomeExe));
            Assert.True(io.Listed(Env.HomeExe));

            var off = Home.RepairHere(run, false);
            Assert.False(off.Linked);
            Assert.Contains(off.Said, x => x.Key == "note");

            var dry = Home.RepairHere(new Run { DryRun = true }, true);
            Assert.Empty(dry.Said);
        }

        [Fact] public void A_test_run_keeps_the_registry_and_the_shortcuts_inside_Root()
        {
            Home.Io = null;
            var io = Home.DefaultIo() as FileHomeIo;
            Assert.NotNull(io);
            Assert.StartsWith(Env.Root, io.At);
        }

        [Fact] public void From_a_download_copies_itself_home_lists_itself_and_starts_that_copy()
        {
            var io = new FileHomeIo(S.P("io"));
            Home.Io = io;
            var problems = new List<JObj>();
            Assert.True(Home.InstallFromDownload(problems));
            Assert.Empty(problems);
            Assert.True(File.Exists(Env.HomeExe));
            Assert.True(io.Listed(Env.HomeExe));
            Assert.False(File.Exists(Path.Combine(io.At, "handler.txt")));   // the link waits for its permission
            var p = Started.Single();
            Assert.Equal(Env.HomeExe, p.FileName);
            Assert.Equal("-From download", p.Arguments);
            Assert.False(p.UseShellExecute);
        }

        [Fact] public void From_a_temporary_folder_nothing_is_copied_and_it_says_save_it_first()
        {
            Home.Io = new FileHomeIo(S.P("io"));
            var temp = Path.GetDirectoryName(Path.GetDirectoryName(Env.MePath));
            var log = Path.Combine(temp, "deepslate-works.log");
            bool hadLog = File.Exists(log);
            Env.Temp = temp;
            try
            {
                var problems = new List<JObj>();
                Assert.False(Home.InstallFromDownload(problems));
                var p = problems.Single();
                Assert.Equal("setup", J.Str(p, "part"));
                Assert.Equal("in_zip", J.Str(p, "code"));
                Assert.Contains("Save it first", J.Str(p, "message"));
                Assert.False(File.Exists(Env.HomeExe));
                Assert.Empty(Started);
            }
            finally { if (!hadLog) try { File.Delete(log); } catch { } }
        }
    }
}

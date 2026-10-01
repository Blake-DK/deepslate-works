using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>Self test: "the script updates itself", for the exe: fetched only from the site's /downloads, size,
    /// checksum, MZ and the version inside checked, .old kept, nothing replaced on any problem.</summary>
    [Collection("env")]
    public class HomeUpdateTests : HomeTestBase
    {
        readonly string ud, exe, site;
        readonly List<string> asked = new List<string>();
        static readonly byte[] OldBytes = Encoding.ASCII.GetBytes("MZ v=3.0.0 old");

        public HomeUpdateTests()
        {
            ud = S.P("update");
            site = S.P("site", "DeepslateWorks.exe");
            exe = Path.Combine(ud, "DeepslateWorks.exe");
            Directory.CreateDirectory(ud); Directory.CreateDirectory(Path.GetDirectoryName(site));
            File.WriteAllBytes(exe, OldBytes);
            // the version "inside" a stand-in exe: the text after v=
            Home.ProductVersionOf = f => { var t = File.ReadAllText(f); int i = t.IndexOf("v="); return i < 0 ? "" : t.Substring(i + 2).Split(' ')[0]; };
            Http.FakeDownload = (url, outFile) => { asked.Add(url); File.Copy(site, outFile, true); return true; };
        }

        SelfUpdate.Offer SetSite(string text, string version = "9.9.1")
        {
            File.WriteAllText(site, text);
            return new SelfUpdate.Offer { Version = version, Sha256 = Home.Sha256(site), Size = new FileInfo(site).Length };
        }

        bool Untouched() => File.ReadAllBytes(exe).SequenceEqual(OldBytes) && Directory.GetFileSystemEntries(ud).Length == 1;

        [Fact] public void A_newer_version_is_fetched_from_downloads_checked_and_put_in_place()
        {
            var o = SetSite("MZ v=9.9.1 new");
            var u = SelfUpdate.Apply(o, exe);
            Assert.Equal("updated", u.Status);
            Assert.Equal("MZ v=9.9.1 new", File.ReadAllText(exe));
            Assert.Equal(OldBytes, File.ReadAllBytes(exe + ".old"));   // the one that ran, renamed
            Assert.Equal(2, Directory.GetFileSystemEntries(ud).Length);
            Assert.Equal(new[] { "https://deepslate.example/downloads/DeepslateWorks.exe" }, asked);
        }

        [Fact] public void The_same_version_or_none_offered_nothing_happens()
        {
            var o = SetSite("MZ v=" + Env.Version, Env.Version);
            Assert.Equal("current", SelfUpdate.Apply(o, exe).Status);
            Assert.Equal("current", SelfUpdate.Apply(null, exe).Status);
            Assert.Equal("current", SelfUpdate.Apply(new SelfUpdate.Offer { Version = "banana", Sha256 = o.Sha256 }, exe).Status);
            Assert.Empty(asked);
            Assert.True(Untouched());
        }

        [Fact] public void The_download_fails_nothing_replaced_nothing_left()
        {
            SetSite("MZ v=9.9.1 new");
            Http.FakeDownload = (url, outFile) => { File.WriteAllText(outFile, "half"); throw new HttpError(0, "", "The remote name could not be resolved"); };
            var u = SelfUpdate.Apply(new SelfUpdate.Offer { Version = "9.9.1", Sha256 = new string('a', 64) }, exe);
            Assert.Equal("failed", u.Status);
            Assert.Contains("could not be downloaded", u.Problem);
            Assert.True(Untouched());
        }

        [Fact] public void Every_check_that_fails_replaces_nothing()
        {
            var good = SetSite("MZ v=9.9.1 new");
            var cases = new List<(SelfUpdate.Offer, string)>
            {
                (new SelfUpdate.Offer { Version = "9.9.1", Sha256 = new string('0', 64), Size = good.Size }, "checksum"),
                (new SelfUpdate.Offer { Version = "9.9.1", Sha256 = good.Sha256, Size = good.Size + 1 }, "bytes"),
            };
            foreach (var (o, why) in cases)
            {
                var u = SelfUpdate.Apply(o, exe);
                Assert.Equal("failed", u.Status);
                Assert.Contains(why, u.Problem);
                Assert.True(Untouched());
            }
            asked.Clear();
            var none = SelfUpdate.Apply(new SelfUpdate.Offer { Version = "9.9.1", Sha256 = "" }, exe);
            Assert.Equal("the site gave no checksum for it", none.Problem);
            Assert.Empty(asked);   // nothing fetched

            var other = SetSite("MZ v=9.9.2 other");
            other.Version = "9.9.1";
            Assert.Equal("the program in the download is not version 9.9.1", SelfUpdate.Apply(other, exe).Problem);
            Assert.True(Untouched());

            var notExe = SetSite("PK v=9.9.1 a zip");
            Assert.Equal("the download is not a Windows program", SelfUpdate.Apply(notExe, exe).Problem);
            Assert.True(Untouched());
        }

        [Fact] public void An_older_old_is_replaced()
        {
            File.WriteAllText(exe + ".old", "from the update before");
            var u = SelfUpdate.Apply(SetSite("MZ v=9.9.1 new"), exe);
            Assert.Equal("updated", u.Status);
            Assert.Equal(OldBytes, File.ReadAllBytes(exe + ".old"));
        }

        [Fact] public void What_the_site_offers()
        {
            var m = Json.Parse("{\"installer\":{\"version\":\"2.1.3\",\"sha256\":\"" + new string('a', 64) + "\",\"size\":1,\"script\":{\"sha256\":\"" + new string('b', 64) + "\",\"size\":1},"
                + "\"exe\":{\"version\":\"9.9.1\",\"sha256\":\"" + new string('c', 64) + "\",\"size\":302,\"url\":\"https://evil.example/x.exe\"}}}");
            var o = SelfUpdate.Offered(m);
            Assert.Equal("9.9.1", o.Version);
            Assert.Equal(new string('c', 64), o.Sha256);
            Assert.Equal(302, o.Size);
            Assert.Null(SelfUpdate.Offered(Json.Parse("{\"installer\":{\"version\":\"2.1.3\",\"script\":{\"sha256\":\"" + new string('b', 64) + "\"}}}")));
            Assert.Null(SelfUpdate.Offered(Json.Parse("{\"installer\":null}")));
            Assert.Null(SelfUpdate.Offered(null));
        }

        [Fact] public void The_version_inside_must_be_the_one_offered()
        {
            Assert.True(SelfUpdate.VersionMatches("3.0.1", "3.0.1"));
            Assert.True(SelfUpdate.VersionMatches("3.0.1.0", "3.0.1"));
            Assert.False(SelfUpdate.VersionMatches("3.0.10", "3.0.1"));
            Assert.False(SelfUpdate.VersionMatches("", "3.0.1"));
        }

        static object Manifest(SelfUpdate.Offer o) => J.O("version", "0.1.0", "installer", J.O("exe", J.O("version", o.Version, "sha256", o.Sha256, "size", o.Size, "url", "https://evil.example/x.exe")));

        [Fact] public void Check_starts_the_new_exe_to_wait_for_this_one_and_leaves_the_report_to_it()
        {
            var run = new Run();
            var r = SelfUpdate.CheckAt(run, Manifest(SetSite("MZ v=9.9.1 new")), new[] { "deepslate://play", "-From", "desktop" }, exe);
            Assert.Equal("updated", r);
            Assert.True(run.Reported);
            Assert.All(asked, u => Assert.Equal(Env.ExeDownloadUrl, u));   // never the manifest's address
            var p = Started.Single();
            Assert.Equal(exe, p.FileName);
            Assert.Equal("deepslate://play -WaitFor " + Process.GetCurrentProcess().Id + " -From update", p.Arguments);
            Assert.Equal(Env.Version, p.EnvironmentVariables["DEEPSLATE_UPDATED_FROM"]);
            Assert.False(p.UseShellExecute);
            Assert.True(Logged("OK 9.9.1 is in place; starting it"));
            Assert.True(Logged("STEP Updating Deepslate Works " + Env.Version + " → 9.9.1"));
        }

        [Fact] public void Not_again_in_a_run_that_an_update_started()
        {
            var run = new Run { UpdatedFrom = "3.0.0" };
            Assert.Equal("current", SelfUpdate.CheckAt(run, Manifest(SetSite("MZ v=9.9.1 new")), new string[0], exe));
            Assert.Empty(asked);
            Assert.True(Untouched());
            Assert.True(Logged("update step: not again in this run"));
        }

        [Fact] public void A_failed_update_is_reported_and_the_run_carries_on()
        {
            var run = new Run();
            var o = SetSite("MZ v=9.9.1 new");
            o.Sha256 = new string('0', 64);
            Assert.Equal("failed", SelfUpdate.CheckAt(run, Manifest(o), new string[0], exe));
            Assert.Contains("checksum", run.UpdateProblem);
            Assert.False(run.Reported);
            Assert.True(Untouched());
            Assert.True(Logged("UPDATE NOT APPLIED: "));
            Assert.Empty(Started);
        }

        [Fact] public void A_new_exe_that_cannot_be_started_is_taken_out_again()
        {
            Home.StartProcess = psi => throw new System.ComponentModel.Win32Exception(5, "Access is denied");
            var run = new Run();
            Assert.Equal("failed", SelfUpdate.CheckAt(run, Manifest(SetSite("MZ v=9.9.1 new")), new string[0], exe));
            Assert.Contains("could not be started", run.UpdateProblem);
            Assert.True(Untouched());
        }

        [Fact] public void Restart_arguments_never_pass_From_or_WaitFor_twice()
        {
            Assert.Equal(new[] { "-Uninstall", "-WaitFor", "42", "-From", "update" }, SelfUpdate.RestartArgs(new[] { "-From", "apps", "-Uninstall", "-WaitFor", "7" }, 42));
            Assert.Equal("a \"b c\" \"d\\\"e\" \"f\\\\\"", Home.QuoteArgs(new[] { "a", "b c", "d\"e", "f\\" }));
        }

        [Fact] public void The_old_exe_goes_on_the_next_start()
        {
            File.WriteAllText(exe + ".old", "old");
            SelfUpdate.CleanOldAt(exe);
            Assert.False(File.Exists(exe + ".old"));
            Assert.True(Logged("removed DeepslateWorks.exe.old, left by the last update"));
            SelfUpdate.CleanOldAt(exe);   // nothing there: nothing happens
        }
    }
}

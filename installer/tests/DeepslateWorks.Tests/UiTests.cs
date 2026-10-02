using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Xml;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>Self test: the window's layout (2.0.0), and the window's words and decisions without WPF.</summary>
    public class UiLayoutTests
    {
        const string XamlNs = "http://schemas.microsoft.com/winfx/2006/xaml";

        static XmlDocument Load(string xaml) { var d = new XmlDocument(); d.LoadXml(xaml); return d; }

        /// <summary>name -> element name, for every x:Name in the XAML.</summary>
        static Dictionary<string, string> Named(string xaml)
        {
            var r = new Dictionary<string, string>();
            foreach (XmlElement e in Load(xaml).SelectNodes("//*[@*[local-name()='Name']]"))
            {
                var n = e.GetAttribute("Name", XamlNs);
                if (n != "") r[n] = e.LocalName;
            }
            return r;
        }

        [Fact] public void Both_windows_XAML_is_well_formed()
        {
            Load(AppWindow.AppXaml);
            Load(AppWindow.AskXaml);
            Load(AppWindow.RestartXaml);
            Assert.Equal(AppWindow.AskXaml, AppWindow.RestartXaml);
        }

        [Fact] public void Every_name_the_code_looks_up_is_in_the_XAML()
        {
            var names = Named(AppWindow.AppXaml);
            Assert.Empty(AppWindow.Names.Where(n => !names.ContainsKey(n)));
            var ask = Named(AppWindow.AskXaml);
            Assert.Empty(AppWindow.AskNames.Where(n => !ask.ContainsKey(n)));
        }

        [Fact] public void The_named_controls_are_what_the_code_takes_them_for()
        {
            var n = Named(AppWindow.AppXaml);
            Assert.Equal("TabControl", n["Tabs"]);
            foreach (var t in new[] { "PlayTab", "VoteTab", "ExtrasTab", "LogTab" }) Assert.Equal("TabItem", n[t]);
            foreach (var t in new[] { "StartButton", "VoteButton" }) Assert.Equal("Button", n[t]);
            foreach (var t in new[] { "ServerLine", "ServerHint", "ServerOnline", "NewsText", "VoteTitle", "VoteNote", "VoteError" }) Assert.Equal("TextBlock", n[t]);
            Assert.Equal("StackPanel", n["VoteBody"]);
            foreach (var t in new[] { "PlayTitle", "PlayStatus", "PlayChanged", "HeadlineText", "ErrorLine", "ExtrasStatus", "ChecksTitle" }) Assert.Equal("TextBlock", n[t]);
            foreach (var t in new[] { "ReviewLink", "DetailsLink" }) Assert.Equal("Hyperlink", n[t]);
            foreach (var t in new[] { "ResetButton", "AllowAllButton", "PlayButton", "HeadlineButton", "CheckButton", "ApplyButton" }) Assert.Equal("Button", n[t]);
            foreach (var t in new[] { "PlayBody", "ProgressBox", "ExtrasBody", "ChecksBody" }) Assert.Equal("StackPanel", n[t]);
            Assert.Equal("Border", n["HeadlineBox"]);
            Assert.Equal("Run", n["ErrorText"]);
            Assert.Equal("ListBox", n["LogList"]);
            var a = Named(AppWindow.AskXaml);
            foreach (var t in new[] { "Q", "Why", "AllNote" }) Assert.Equal("TextBlock", a[t]);
            foreach (var t in new[] { "Later", "All", "Yes" }) Assert.Equal("Button", a[t]);
        }

        [Fact] public void The_window_is_titled_Deepslate_Works_with_Play_Extras_and_Log_tabs()
        {
            var x = AppWindow.AppXaml;
            Assert.Contains("Title=\"Deepslate Works\"", x);
            Assert.Contains("Header=\"  Play  \"", x);
            Assert.Contains("Header=\"  Extras  \"", x);
            Assert.Contains("Header=\"  Log  \"", x);
        }

        [Fact] public void The_questions_offer_Yes_Later_and_Allow_all()
        {
            var x = AppWindow.AskXaml;
            Assert.Contains("Content=\"Yes\"", x);
            Assert.Contains("Content=\"Later\"", x);
            Assert.Contains("Content=\"Allow all\"", x);
        }

        [Fact] public void The_Play_tabs_questions_have_Allow_all_next_to_Continue_and_Review_has_Reset_all()
        {
            Assert.Matches(new Regex("x:Name=\"AllowAllButton\"[^>]*Content=\"Allow all\""), AppWindow.AppXaml);
            Assert.Matches(new Regex("x:Name=\"ResetButton\"[^>]*Content=\"Reset all\""), AppWindow.AppXaml);
            Assert.Matches(new Regex("x:Name=\"PlayButton\"[^>]*Content=\"Play\""), AppWindow.AppXaml);
            Assert.Contains(">Review permissions</Hyperlink>", AppWindow.AppXaml);
        }

        [Fact] public void The_Extras_tabs_download_question_has_Allow_all()
        {
            Assert.Equal("Allow all", UiText.AllowAll);
            Assert.Equal("Download", UiText.DownloadButton);
            Assert.Equal("Download the optional visual extras?", ExtrasText.DownloadQuestion);
        }

        [Fact] public void The_Extras_tab_has_Check_extras_Apply_and_the_line_about_other_players()
        {
            var x = AppWindow.AppXaml;
            Assert.Matches(new Regex("x:Name=\"CheckButton\"[^>]*Content=\"Check extras\""), x);
            Assert.Matches(new Regex("x:Name=\"ApplyButton\"[^>]*Content=\"Apply\""), x);
            Assert.Contains("Only on this PC, never voted on. Other players don't need them: you can play together either way.", x);
            Assert.Contains(">Show details</Hyperlink>", x);
        }
    }

    public class UiTextTests
    {
        [Fact] public void Status_lines_show_as_2_0_x_showed_them()
        {
            var step = UiText.LineFor(J.O("t", "step", "text", "Checking for updates"));
            Assert.Equal("Checking for updates", step.Text); Assert.Equal("#555", step.Color); Assert.Equal("Normal", step.Weight);
            var tick = UiText.LineFor(J.O("t", "tick", "text", "Signed in"));
            Assert.Equal("✓  Signed in", tick.Text); Assert.Equal("#2E7D5B", tick.Color);
            var note = UiText.LineFor(J.O("t", "note", "text", "Pack 1 → 2"));
            Assert.Equal("   Pack 1 → 2", note.Text); Assert.Equal("#666", note.Color);
            var fail = UiText.LineFor(J.O("t", "fail", "text", "No internet."));
            Assert.Equal("No internet.", fail.Text); Assert.Equal("#B3261E", fail.Color); Assert.Equal("SemiBold", fail.Weight);
            foreach (var t in new[] { "ask", "declined", "used", "changed", "extras", "done" }) Assert.Null(UiText.LineFor(J.O("t", t, "text", "x")));
        }

        [Fact] public void The_old_exit_codes_are_logged_for_each_ending()
        {
            Assert.Equal(0, UiText.ExitCodeFor(null));
            Assert.Equal(20, UiText.ExitCodeFor(new NeedAnswer("java", 2)));
            Assert.Equal(21, UiText.ExitCodeFor(new StepDeclined("mods")));
            Assert.Equal(3, UiText.ExitCodeFor(new AlreadyRunning()));
            Assert.Equal(1, UiText.ExitCodeFor(new RunFailed("x")));
            Assert.Equal(1, UiText.ExitCodeFor(new InvalidOperationException()));
        }

        [Fact] public void A_run_that_ended_badly_says_why()
        {
            var a = UiText.EndedText(new AlreadyRunning(), null);
            Assert.Equal("Already running", a.Key);
            Assert.Equal("Deepslate Works is busy in another window. Let it finish, then press Play.", a.Value);
            var f = UiText.EndedText(new RunFailed("The site is down."), "The site is down.");
            Assert.Equal("That didn't work", f.Key); Assert.Equal("The site is down.", f.Value);
            Assert.Equal("Only the message.", UiText.EndedText(new RunFailed("Only the message."), null).Value);
            Assert.Equal("Something went wrong. The Log tab has the details; Alex has them too if reports are on.", UiText.EndedText(new Exception("boom"), null).Value);
        }

        [Fact] public void A_card_says_the_bigger_wording_and_the_extras_size()
        {
            var java = Consents.Step("java");
            Assert.Equal(java.Text, UiText.CardText(java, 1, "12"));
            Assert.Equal(java.Bigger, UiText.CardText(java, 2, "12"));
            var extras = Consents.Step("extras");
            Assert.Equal("Download the optional visual extras? About 12 MB, nothing is switched on. You choose them in the Extras tab.", UiText.CardText(extras, 1, "12"));
            Assert.Contains("About 10 MB", UiText.CardText(extras, 1, ""));
            Assert.Contains("About 10 MB", UiText.CardText(extras, 1, null));
        }

        [Fact] public void An_answer_covers_the_steps_biggest_level_when_allowed()
        {
            Assert.Equal(2, UiText.SavedLevel("allow", 1, 2));
            Assert.Equal(3, UiText.SavedLevel("allow", 3, 2));
            Assert.Equal(1, UiText.SavedLevel("decline", 2, 2));
        }

        [Fact] public void The_question_page_is_titled_by_how_many_and_whether_it_is_the_first_time()
        {
            Assert.Equal("Before we start", UiText.QuestionsTitle(true, 1));
            Assert.Equal("One question", UiText.QuestionsTitle(false, 1));
            Assert.Equal("A few questions", UiText.QuestionsTitle(false, 3));
        }

        [Fact] public void Log_lines_with_errors_are_red_and_Show_details_finds_ERROR()
        {
            Assert.True(UiText.IsErrorLine("[2026-10-01T10:00:00] FAIL The site is down."));
            Assert.True(UiText.IsErrorLine("[2026-10-01T10:00:00] extras: ERROR check: 1 failed"));
            Assert.True(UiText.IsErrorLine("[2026-10-01T10:00:00] the token was refused"));
            Assert.True(UiText.IsErrorLine("[2026-10-01T10:00:00] could not remove x"));
            Assert.False(UiText.IsErrorLine("[2026-10-01T10:00:00] OK Signed in"));
            Assert.True(UiText.IsDetailsLine("x: ERROR y"));
            Assert.False(UiText.IsDetailsLine("FAIL y"));
        }

        [Fact] public void Tones_and_colours()
        {
            Assert.Equal(new[] { "#E8F3EE", "#2E7D5B" }, UiText.Tone("green"));
            Assert.Equal(new[] { "#EEF0F2", "#555555" }, UiText.Tone("nonsense"));
            Assert.Equal(new[] { "#FDECEA", "#B3261E" }, UiText.FpsTone("High"));
            Assert.Equal(new[] { "#FFF4E0", "#8A5A00" }, UiText.FpsTone("Medium"));
            Assert.Equal(new[] { "#E8F3EE", "#2E7D5B" }, UiText.FpsTone("Low"));
            Assert.Equal("#EEF4F8", UiText.HeadlineBackground("blue"));
            Assert.Equal("#FFF4E0", UiText.HeadlineBackground("amber"));
        }

        [Fact] public void Stopped_names_the_step()
        {
            Assert.Equal("You said Not now to 'Mods and settings', which is needed to play. Nothing more was done. To carry on, open Review permissions and choose Allow.",
                string.Format(UiText.StoppedStatus, Consents.Step("mods").Title));
        }
    }

    /// <summary>The real window, made and drawn off screen the way -Screenshots does (Windows only).</summary>
    [Collection("env")]
    public class UiWindowTests
    {
        static void OnSta(Action a)
        {
            Exception err = null;
            var t = new Thread(() => { try { a(); } catch (Exception e) { err = e; } finally { System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); } });   // shut WPF down on its own thread, not at process exit
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            Assert.True(t.Join(TimeSpan.FromMinutes(2)), "the window did not finish drawing");
            if (err != null) throw new Exception("drawing failed: " + err, err);
        }

        static void AssertPng(string file)
        {
            Assert.True(File.Exists(file), file);
            var b = File.ReadAllBytes(file);
            Assert.True(b.Length > 1000, file + " is " + b.Length + " bytes");
            Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, b.Take(4).ToArray());
        }

        [WindowsFact] public void The_window_is_made_off_screen_and_draws_the_questions_and_the_restart_question()
        {
            using (var s = new Scratch())
            {
                var dir = s.P("shots");
                List<string> files = null;
                OnSta(() => files = AppWindow.DrawScreenshots(dir));
                Assert.Equal(2 + NewShots.Length, files.Count);
                AssertPng(Path.Combine(dir, "1-permissions-allow-all.png"));
                AssertPng(Path.Combine(dir, "2-restart-question.png"));
                foreach (var n in NewShots) AssertPng(Path.Combine(dir, n));
            }
        }

        // 3.1.0: the guided setup (with a failed Move over), the countdown, the countdown stopped, Play settings
        static readonly string[] NewShots = { "5-guided-1-welcome.png", "6-guided-2-move-over.png", "6b-guided-2-retry.png", "7-guided-3-permissions.png", "8-guided-4-extras.png", "9-countdown.png", "9b-countdown-3.png", "10-countdown-stopped.png", "11-play-settings.png",
            // 3.2.0: the server on the Play tab (a wake; switched off with an admin's Start), the Vote tab, Play shut, the results
            "12-play-server-waking.png", "13-play-switched-off-admin.png", "14-vote.png", "14b-play-vote-first.png", "15-vote-results.png" };

        [WindowsFact] public void With_the_extras_list_it_draws_the_Extras_tab_too()
        {
            using (var s = new Scratch())
            {
                Directory.CreateDirectory(Env.AppHome);
                File.WriteAllText(Env.ExtrasManifestPath, @"{ ""size"": 10485760, ""extras"": [
  { ""id"": ""iris"", ""name"": ""Iris (shaders)"", ""description"": ""Shaders."", ""fps"": ""High"", ""modIds"": [""iris""], ""files"": [ { ""filename"": ""iris.jar"", ""kind"": ""mod"", ""url"": ""https://x/iris.jar"", ""sha512"": ""00"", ""size"": 1 } ] },
  { ""id"": ""shader-light"", ""name"": ""Light"", ""description"": """", ""fps"": ""Medium"", ""shader"": ""light"", ""requires"": [""iris""], ""files"": [ { ""filename"": ""makeup.zip"", ""kind"": ""shader"", ""url"": ""https://x/m.zip"", ""sha512"": ""00"", ""size"": 1 } ] },
  { ""id"": ""falling-leaves"", ""name"": ""Falling Leaves"", ""description"": ""Leaves fall."", ""fps"": ""Low"", ""modIds"": [""fallingleaves""], ""files"": [ { ""filename"": ""fl.jar"", ""kind"": ""mod"", ""url"": ""https://x/fl.jar"", ""sha512"": ""00"", ""size"": 1 } ] }
] }");
                var c = new Dictionary<string, ConsentAnswer>();
                Consents.SetAnswer(c, "extras", "allow", 1);
                Consents.Save(Env.ConsentPath, c);
                var dir = s.P("shots");
                List<string> files = null;
                OnSta(() => files = AppWindow.DrawScreenshots(dir));
                Assert.Equal(4 + NewShots.Length, files.Count);
                foreach (var f in files) AssertPng(f);
            }
        }
    }
}

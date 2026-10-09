using System;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;

namespace DeepslateWorks
{
    /// <summary>
    /// docs/45, 3.6.1: the Test tab, the Play tab pointed at the test server. Only for an admin: the tab is made when the
    /// live site's home says this sign-in is an admin's, and the Test section is asked about only then, so a member's app
    /// has no Test tab, asks nothing about one and logs nothing of it. Its Play view is the Play tab's (PlayPane, the
    /// same XAML and code) with the target "test": the test pack, its own game folder and launcher profile, the test
    /// server. The card is the test server in the site's own words; a state this app does not know shows as the site
    /// words it, with no app update.
    /// </summary>
    sealed partial class AppUi
    {
        public TabItem TestTab;
        bool testBusy, testAvailable;

        void WireTest()
        {
            // the Test section is asked about with the home, every 10 s, and only for an admin (SyncTestTab)
            if (HomeTimer != null) HomeTimer.Tick += (s, e) => { if (TestTab != null) RefreshTestSection(); };
        }

        /// <summary>Makes the Test tab for an admin, takes it away from anyone else (when no test run is going).</summary>
        void SyncTestTab(bool admin)
        {
            if (admin && TestTab == null) CreateTestTab();
            else if (!admin && TestTab != null && TestPane.Mode != "running" && !TestPane.Waiting)
            {
                if (Tabs.SelectedItem == TestTab) Tabs.SelectedItem = PlayTab;
                Tabs.Items.Remove(TestTab);
                TestTab = null; TestPane = null;
                Log.Line("window: the Test tab went (this sign-in is not an admin's any more)");
            }
        }

        void CreateTestTab()
        {
            TestPane = PlayPane.Load(PlayPane.Test);
            TestPane.VerLocal = Footer.InstalledPack(System.IO.Path.Combine(Env.Root, Env.TestDirName, "installed.json"));
            TestTab = new TabItem { Header = "Test", Name = "TestTab", Content = TestPane.Root };
            Tabs.Items.Insert(Tabs.Items.IndexOf(PlayTab) + 1, TestTab);
            var pane = TestPane;
            pane.PlayButton.Click += (s, e) => On(pane, OnPlayButton);
            pane.AllowAllButton.Click += (s, e) => On(pane, OnAllowAll);
            pane.ResetButton.Click += (s, e) => On(pane, OnResetAll);
            pane.SettingsLink.Inlines.Clear(); pane.SettingsLink.Inlines.Add(UiText.SettingsLink);
            pane.SettingsLink.Click += (s, e) => OpenSettingsTab();
            pane.NewsScroll.ScrollChanged += (s, e) => FitPlayTab();
            pane.PlayScroll.ScrollChanged += (s, e) => FitPlayTab();
            FitBlockOn(pane.PlayButton);
            On(pane, () => { ShowIdle(); ShowTestServer(); });
            Log.Line("window: the Test tab is shown (an admin)");
            RefreshTestSection();
        }

        /// <summary>Asks the live site for the test server's state, on a thread of its own.</summary>
        public void RefreshTestSection()
        {
            if (testBusy || TestPane == null) return;
            testBusy = true;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                JObj s = null; string err = null;
                try { s = SiteHome.FetchTestSection(); } catch (Exception e) { err = e.Message; }
                d.BeginInvoke(new Action(() =>
                {
                    testBusy = false;
                    if (TestPane == null) return;
                    if (err != null) Log.Line("window: the Test section could not be asked: " + err);
                    var t = SiteHome.ParseTestSection(s, err != null);
                    testAvailable = t.Available;
                    TestPane.Server = t.Server; TestPane.Players = t.Players;
                    TestPane.VerCurrent = t.Pack ?? TestPane.VerCurrent;
                    On(TestPane, ShowTestServer);
                }));
            }) { IsBackground = true, Name = "test section" }.Start();
        }

        /// <summary>The Test tab's card: the test server in the site's words, how many are on it, the test pack.</summary>
        void ShowTestServer()
        {
            var s = P.Server ?? new ServerInfo();
            ServerDot.Fill = NewBrush(Theme.ToneKey(s.Tone));
            ServerLineText.Text = SiteHome.ServerLine(s);
            var hint = s.State == "online" || s.Waking ? "" : s.Hint;
            ServerHint.Text = hint; ServerHint.Visibility = string.IsNullOrEmpty(hint) ? Visibility.Collapsed : Visibility.Visible;
            var on = testAvailable && s.State == "online" ? UiText.TestPlayers(P.Players) : "";
            ServerOnline.Text = on; ServerOnline.Visibility = on.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            P.OnlineHeads.Visibility = Visibility.Collapsed;
            VerServer = s.Line;
            if (ShownPane == P) { UpdateAppFooter(); ShowHeroFor(P); }
            ShowWakeHint();
            SyncPanes();
        }

        /// <summary>
        /// 3.6.1 (item 1): Play is shut on a pane only while the other server's game is really being installed or
        /// started, and the pane says why; a run that only waits for Play never shuts the other pane (Play there ends it).
        /// The Test tab's Play is shut too while the site cannot reach the test server. Every tick of the window's timer.
        /// </summary>
        void SyncPanes()
        {
            if (TestPane == null) return;
            foreach (var p in Panes)
            {
                var o = Other(p);
                var otherBusy = o != null && o.Mode == "running";
                var free = p.Mode == "idle" || p.Mode == "ready";
                if (otherBusy && free && !p.HeldByOther)
                {
                    p.HeldByOther = true;
                    p.PlayButton.IsEnabled = false;
                    p.PlayHint.Text = UiText.HeldByOther(o.IsLive); p.PlayHint.Visibility = Visibility.Visible;
                }
                else if (p.HeldByOther && (!otherBusy || !free))
                {
                    p.HeldByOther = false;
                    if (free) p.PlayButton.IsEnabled = true;
                    if (p.PlayHint.Text == UiText.HeldByOther(true) || p.PlayHint.Text == UiText.HeldByOther(false)) p.PlayHint.Visibility = Visibility.Collapsed;
                }
            }
            if (!TestPane.HeldByOther && TestPane.Mode == "idle") TestPane.PlayButton.IsEnabled = testAvailable;
        }
    }
}

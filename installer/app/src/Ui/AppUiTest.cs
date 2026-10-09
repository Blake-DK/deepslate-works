using System;
using System.Threading;
using System.Windows;
using System.Windows.Controls;

namespace DeepslateWorks
{
    /// <summary>
    /// docs/45, the launcher's Test section, version one: a tab only admins see. The live site says whether to show it
    /// (SiteHome.FetchTestSection: anyone else gets "not found", and the tab stays hidden). Play test is the Play tab's
    /// run with its target set to "test": the test pack, its own game folder and launcher profile, the test server.
    /// </summary>
    sealed partial class AppUi
    {
        public TabItem TestTab;
        TextBlock TestTitle, TestNote, TestState, TestPack, TestFolder, TestError;
        Button TestPlayButton;
        bool testBusy, testAvailable;

        void WireTest()
        {
            var w = Window;
            T F<T>(string n) where T : class => w.FindName(n) as T ?? throw new InvalidOperationException("the window has no " + n);
            TestTab = F<TabItem>("TestTab"); TestTitle = F<TextBlock>("TestTitle"); TestNote = F<TextBlock>("TestNote"); TestState = F<TextBlock>("TestState");
            TestPack = F<TextBlock>("TestPack"); TestFolder = F<TextBlock>("TestFolder"); TestError = F<TextBlock>("TestError"); TestPlayButton = F<Button>("TestPlayButton");
            TestNote.Text = UiText.TestNote;
            TestFolder.Text = UiText.TestFolderLine;
            TestPlayButton.Click += (s, e) => OnTestPlay();
            if (HomeTimer != null) HomeTimer.Tick += (s, e) => RefreshTestSection();
            RefreshTestSection();
        }

        /// <summary>Asks the live site on a thread of its own; shows the tab only for an admin, hides it otherwise.</summary>
        public void RefreshTestSection()
        {
            if (testBusy || TestTab == null) return;
            testBusy = true;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                JObj s = null;
                try { s = SiteHome.FetchTestSection(); } catch (Exception e) { Log.Line("window: the Test section could not be asked: " + e.Message); }
                d.BeginInvoke(new Action(() => { testBusy = false; ShowTestSection(s); }));
            }) { IsBackground = true, Name = "test section" }.Start();
        }

        void ShowTestSection(JObj s)
        {
            if (s == null)
            {
                if (TestTab.Visibility == Visibility.Visible) Log.Line("window: the Test section is not offered (not an admin, or the site has none)");
                TestTab.Visibility = Visibility.Collapsed;
                testAvailable = false;
                return;
            }
            TestTab.Visibility = Visibility.Visible;
            testAvailable = J.Get(s, "available") is bool b && b;
            if (!testAvailable)
            {
                TestState.Text = string.Format(UiText.TestOff, J.Str(s, "reason") ?? "");
                TestPack.Text = "";
                TestPlayButton.IsEnabled = false;
                return;
            }
            var players = J.Int(s, "players", 0);
            TestState.Text = UiText.TestStateLine(J.Str(s, "state") ?? "?", players, J.Str(s, "address"));
            TestPack.Text = UiText.TestPackLine(J.Str(s, "pack"), J.Str(s, "serverPack"));
            TestPlayButton.IsEnabled = worker == null || !worker.IsAlive;
        }

        /// <summary>Play test: the Play tab shows the run, as for live; the run's target is "test".</summary>
        void OnTestPlay()
        {
            if (!testAvailable || (worker != null && worker.IsAlive)) return;
            TestError.Visibility = Visibility.Collapsed;
            Log.Line("window: Play test pressed");
            Tabs.SelectedItem = PlayTab;
            StartRun(test: true);
        }
    }
}

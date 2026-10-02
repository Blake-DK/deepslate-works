using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Controls.Primitives;
using System.Windows.Threading;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.2.0 (planner 2026-10-02): the app as the front door, and votes before play. The Play tab shows the server in the
    /// site's words (refreshed every 10 s while the window is open), who's online, the pinned news item and "Open the
    /// site"; an admin gets Start for a server that is switched off or crashed. A sleeping server is woken when the app
    /// opens and when Play is pressed. A must-vote poll not answered yet opens the Vote tab, oldest first, and keeps Play
    /// shut ("Vote first, it takes ten seconds") until it is answered; the install steps themselves are never held.
    /// </summary>
    sealed partial class AppUi
    {
        public TabItem VoteTab;
        Border ServerBox, NewsBox;
        Ellipse ServerDot;
        TextBlock ServerLineText, ServerHint, ServerOnline, NewsText, NewsMeta, VoteStep, VoteTitle, VoteNote, VoteError;
        Hyperlink SiteLink;
        Button StartButton, VoteButton;
        StackPanel VoteBody;

        public HomeInfo SiteNow;
        DispatcherTimer HomeTimer, VoteNextTimer;
        volatile bool homeBusy;
        bool homeSim;                                    // screenshots: what the site would say, no calls
        bool wokeAtOpen;
        readonly HashSet<string> answered = new HashSet<string>();
        int answeredThisRound;
        VoteItem VoteShown;
        List<string> VotePicked = new List<string>();
        bool voteResults, voteBusy, ballotOpened;
        bool extrasAfter;                                // the Extras tab's download, once the waiting run has ended

        public const int HomeEverySec = 10;

        /// <summary>Votes still to answer: the site lists them until they are answered (a ballot on the site, a poll here).</summary>
        List<VoteItem> PendingVotes => SiteNow != null && SiteNow.SignedIn ? SiteNow.Votes.Where(v => !answered.Contains(v.Id)).ToList() : new List<VoteItem>();
        public bool VotesBlock => PendingVotes.Count > 0;

        void WireHome()
        {
            var w = Window;
            T F<T>(string n) where T : class => w.FindName(n) as T ?? throw new InvalidOperationException("the window has no " + n);
            VoteTab = F<TabItem>("VoteTab"); ServerBox = F<Border>("ServerBox"); NewsBox = F<Border>("NewsBox"); ServerDot = F<Ellipse>("ServerDot");
            ServerLineText = F<TextBlock>("ServerLine"); ServerHint = F<TextBlock>("ServerHint"); ServerOnline = F<TextBlock>("ServerOnline");
            NewsText = F<TextBlock>("NewsText"); NewsMeta = F<TextBlock>("NewsMeta"); SiteLink = F<Hyperlink>("SiteLink");
            StartButton = F<Button>("StartButton"); VoteButton = F<Button>("VoteButton"); VoteBody = F<StackPanel>("VoteBody");
            VoteStep = F<TextBlock>("VoteStep"); VoteTitle = F<TextBlock>("VoteTitle"); VoteNote = F<TextBlock>("VoteNote"); VoteError = F<TextBlock>("VoteError");
            SiteLink.Click += (s, e) => OpenSite(SiteNow?.Site ?? Env.PortalUrl);
            StartButton.Click += (s, e) => OnStartServer();
            VoteButton.Click += (s, e) => OnVoteButton();
            HomeTimer = new DispatcherTimer(DispatcherPriority.Normal, w.Dispatcher) { Interval = TimeSpan.FromSeconds(HomeEverySec) };
            HomeTimer.Tick += (s, e) => RefreshHome();
            VoteNextTimer = new DispatcherTimer(DispatcherPriority.Normal, w.Dispatcher) { Interval = TimeSpan.FromSeconds(4) };
            VoteNextTimer.Tick += (s, e) => NextVote();
        }

        void StartHome() { RefreshHome(); HomeTimer.Start(); }
        void StopHome() { try { HomeTimer.Stop(); VoteNextTimer.Stop(); } catch { } }

        static void OpenSite(string url)
        {
            try { Engine.OpenUrl(url); } catch (Exception e) { Log.Line("window: could not open the site: " + e.Message); }
        }

        /// <summary>Asks the site (on a thread of its own; the window never waits for it) and shows the answer.</summary>
        public void RefreshHome()
        {
            if (homeSim || homeBusy) return;
            homeBusy = true;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                HomeInfo h = null; Exception err = null;
                try { h = SiteHome.Fetch(); } catch (Exception e) { err = e; }
                finally { homeBusy = false; }
                try
                {
                    d.BeginInvoke(new Action(() =>
                    {
                        if (h != null) ApplyHome(h);
                        else if (SiteNow == null) { ServerLineText.Text = "Can't reach " + Env.SiteHost + " right now."; Log.Line("window: the site's home could not be read: " + err?.Message); }
                    }));
                }
                catch { }
            }) { IsBackground = true, Name = "site home" }.Start();
        }

        void ApplyHome(HomeInfo h)
        {
            var first = SiteNow == null;
            SiteNow = h;
            ShowServer(h);
            // Wake on open: a sleeping server starts booting the moment the app opens (the site decides: Asleep only, for
            // members the door would let in, one start however often). The run's own wake is the same call.
            if (!homeSim && !wokeAtOpen && h.SignedIn && h.Server.Asleep) { wokeAtOpen = true; WakeNow("opened"); }
            if (first) Log.Line(string.Format("window: the server is {0}{1}", h.Server.State, h.SignedIn ? string.Format(", {0} vote(s) to answer", h.Votes.Count) : ", not signed in yet"));
            if (Guided > 0) return;   // the guided setup first; the votes come after it
            var pending = PendingVotes;
            if (pending.Count > 0)
            {
                if (VoteShown == null || (!voteResults && !pending.Any(v => v.Id == VoteShown.Id))) ShowVote(pending[0], VoteTab.Visibility != Visibility.Visible);
            }
            else if (VoteTab.Visibility == Visibility.Visible && !voteResults) FinishVotes();
            GatePlay();
        }

        void ShowServer(HomeInfo h)
        {
            var s = h.Server;
            ServerDot.Fill = NewBrush(SiteHome.ToneColour(s.Tone));
            ServerLineText.Text = SiteHome.ServerLine(s);
            var hint = s.State == "online" || s.Waking ? "" : s.Hint;
            ServerHint.Text = hint; ServerHint.Visibility = string.IsNullOrEmpty(hint) ? Visibility.Collapsed : Visibility.Visible;
            var online = SiteHome.OnlineLine(h);
            ServerOnline.Text = online; ServerOnline.Visibility = string.IsNullOrEmpty(online) ? Visibility.Collapsed : Visibility.Visible;
            StartButton.Visibility = h.Admin && s.CanStart ? Visibility.Visible : Visibility.Collapsed;
            if (h.News != null)
            {
                var body = h.News.Body.Length > 280 ? h.News.Body.Substring(0, 277) + "..." : h.News.Body;
                NewsText.Text = body;
                NewsMeta.Text = "Pinned news" + (string.IsNullOrEmpty(h.News.Author) ? "" : " · " + h.News.Author) + (string.IsNullOrEmpty(h.News.At) ? "" : " · " + h.News.At);
                NewsBox.Visibility = Visibility.Visible;
            }
            else NewsBox.Visibility = Visibility.Collapsed;
            VerServer = s.Line; UpdateAppFooter();
            ShowWakeHint();
        }

        /// <summary>Under the Play button while a wake runs: the game loads anyway, the server boots meanwhile.</summary>
        void ShowWakeHint()
        {
            if (Mode == "asking" || reviewing) return;   // 3.3.1: no Play hint on the question cards
            if (Count != null && Count.Running) return;   // "Click anywhere to stop" has the line
            if (VotesBlock && Guided == 0 && (Mode == "idle" || Mode == "ready")) return;   // GatePlay has it
            var waking = SiteNow != null && SiteNow.Server.Waking && (Mode == "ready" || Mode == "running" || Mode == "idle");
            if (waking) { PlayHint.Text = SiteHome.ServerLine(SiteNow.Server); PlayHint.Visibility = Visibility.Visible; }
            else if (PlayHint.Text != null && PlayHint.Text.StartsWith("Waking the server")) PlayHint.Visibility = Visibility.Collapsed;
        }

        /// <summary>The site's wake, from the app: when it opens on a sleeping server, and when Play is pressed.</summary>
        void WakeNow(string why)
        {
            if (homeSim) return;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                try { SiteHome.Wake(); Log.Line("wake (" + why + "): asked the site to wake the server"); }
                catch (Exception e) { Log.Line("wake (" + why + "): not started (" + SiteHome.Why(e) + ")"); }
                try { d.BeginInvoke(new Action(() => RefreshHome())); } catch { }
            }) { IsBackground = true, Name = "wake" }.Start();
        }

        void WakeIfAsleep(string why) { if (SiteNow != null && SiteNow.SignedIn && SiteNow.Server.Asleep) WakeNow(why); }

        // Admins: Start, for a server that is switched off or crashed (a wake never starts those). The site's audited start.
        void OnStartServer()
        {
            if (SiteNow == null || !SiteNow.Admin) return;
            var r = MessageBox.Show(Window, UiText.StartServerQuestion, Env.PackName, MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (r != MessageBoxResult.Yes) return;
            StartButton.IsEnabled = false;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                string err = null;
                try { SiteHome.Start(); Log.Line("window: Start sent to the server (admin)"); }
                catch (Exception e) { err = SiteHome.Why(e); Log.Line("window: Start refused: " + err); }
                try
                {
                    d.BeginInvoke(new Action(() =>
                    {
                        StartButton.IsEnabled = true;
                        if (err != null) { MessageBox.Show(Window, err, Env.PackName, MessageBoxButton.OK, MessageBoxImage.Warning); return; }
                        StartButton.Visibility = Visibility.Collapsed;
                        ServerLineText.Text = UiText.StartSent;
                        RefreshHome();
                    }));
                }
                catch { }
            }) { IsBackground = true, Name = "start" }.Start();
        }

        // ---- votes before play --------------------------------------------------------------------------------------

        /// <summary>Play stays shut while a vote waits (every tick: whatever else turned it on). The countdown stops.</summary>
        void GatePlay()
        {
            if (Guided > 0 || !(Mode == "idle" || Mode == "ready")) return;
            if (!VotesBlock) return;
            if (Count != null && Count.Running) { CancelCountdown("a vote to answer"); HideCountdown(); }
            var label = SiteNow?.VoteFirstButton ?? SiteHome.VoteFirstButton;
            if (PlayButton.IsEnabled || !Equals(PlayButton.Content, label)) { PlayButton.Content = label; PlayButton.IsEnabled = false; }
            if (PlayHint.Text != UiText.VoteFirstHint) PlayHint.Text = UiText.VoteFirstHint;
            PlayHint.Visibility = Visibility.Visible;
        }

        /// <summary>Back to the Vote tab (Play pressed, the website's Play, a relaunch asked for while a vote waits).</summary>
        void ShowVoteTab()
        {
            var p = PendingVotes;
            if (p.Count == 0) return;
            if (VoteShown == null || !p.Any(v => v.Id == VoteShown.Id)) ShowVote(p[0], true);
            VoteTab.Visibility = Visibility.Visible;
            Tabs.SelectedItem = VoteTab;
        }

        void ShowVote(VoteItem item, bool select)
        {
            VoteNextTimer.Stop();
            VoteShown = item; voteResults = false; voteBusy = false; ballotOpened = false;
            VotePicked = new List<string>(item.Poll?.Mine ?? new List<string>());
            VoteError.Text = "";
            VoteBody.Children.Clear();
            var left = PendingVotes.Count;
            VoteStep.Text = SiteHome.StepLine(answeredThisRound, answeredThisRound + Math.Max(1, left));
            VoteTab.Visibility = Visibility.Visible;
            if (item.Poll != null)
            {
                var p = item.Poll;
                VoteTitle.Text = p.Question;
                VoteNote.Text = SiteHome.PickNote(p);
                var group = "poll-" + p.Id;
                foreach (var o in p.Options) VoteBody.Children.Add(NewOptionCard(p, o, group));
                VoteButton.Content = UiText.VoteButton;
                VoteButton.IsEnabled = VotePicked.Count > 0;
            }
            else
            {
                var b = item.Ballot;
                VoteTitle.Text = b.Title;
                VoteNote.Text = UiText.BallotNote;
                VoteButton.Content = UiText.BallotOpen;
                VoteButton.IsEnabled = true;
            }
            Log.Line("window: a vote to answer before playing: " + (item.Poll?.Question ?? item.Ballot?.Title));
            if (select && Mode != "asking") Tabs.SelectedItem = VoteTab;
        }

        Border NewOptionCard(PollInfo p, PollOptionInfo o, string group)
        {
            var card = NewCard();
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var dontMind = o.Id == SiteHome.DontMind;
            ToggleButton pick = p.Multiple && !dontMind ? (ToggleButton)new CheckBox() : new RadioButton { GroupName = group };
            pick.VerticalAlignment = VerticalAlignment.Top; pick.Margin = new Thickness(0, 2, 10, 0);
            pick.IsChecked = VotePicked.Contains(o.Id);
            var id = o.Id;
            pick.Checked += (s, e) => OnPick(id, true);
            pick.Unchecked += (s, e) => OnPick(id, false);
            pick.Tag = id;
            Grid.SetColumn(pick, 0); g.Children.Add(pick);
            var sp = new StackPanel(); Grid.SetColumn(sp, 1);
            var row = new DockPanel();
            if (!string.IsNullOrEmpty(o.ImageUrl))
            {
                var img = new Image { Width = 72, Height = 48, Stretch = Stretch.UniformToFill, Margin = new Thickness(10, 0, 0, 0) };
                DockPanel.SetDock(img, Dock.Right);
                row.Children.Add(img);
                LoadPicture(img, o.ImageUrl);
            }
            var texts = new StackPanel();
            texts.Children.Add(NewText(o.Text, 14, "SemiBold", dontMind ? "#666" : "#222"));
            if (!string.IsNullOrEmpty(o.ModName)) { var m = NewText(o.ModName + ": " + (o.ModDescription ?? ""), 12, "Normal", "#555"); m.Margin = new Thickness(0, 2, 0, 0); texts.Children.Add(m); }
            var links = new WrapPanel { Margin = new Thickness(0, 2, 0, 0) };
            void AddLink(string text, string url)
            {
                var tb = new TextBlock { Margin = new Thickness(0, 0, 12, 0), FontSize = 12 };
                var hl = new Hyperlink(); hl.Inlines.Add(text); hl.Click += (s, e) => OpenSite(url);
                tb.Inlines.Add(hl); links.Children.Add(tb);
            }
            if (!string.IsNullOrEmpty(o.Link)) AddLink("Find out more", o.Link);
            if (!string.IsNullOrEmpty(o.ModSlug)) AddLink("Mod page", "https://modrinth.com/mod/" + o.ModSlug);
            if (links.Children.Count > 0) texts.Children.Add(links);
            row.Children.Add(texts);
            sp.Children.Add(row);
            g.Children.Add(sp);
            card.Child = g;
            if (dontMind) { card.BorderBrush = NewBrush("#C9CED3"); card.Background = NewBrush("#FAFBFC"); }
            // the whole card picks it, not only the round button
            card.Cursor = System.Windows.Input.Cursors.Hand;
            card.MouseLeftButtonUp += (s, e) => { if (e.OriginalSource is Hyperlink) return; pick.IsChecked = p.Multiple && !dontMind ? pick.IsChecked != true : true; };
            return card;
        }

        bool picking;
        void OnPick(string id, bool on)
        {
            if (picking || VoteShown?.Poll == null) return;
            var p = VoteShown.Poll;
            VotePicked = SiteHome.Pick(VotePicked, id, p.Multiple, on);
            // "I don't mind" and the others exclude each other with multiple choice: the boxes follow the list
            picking = true;
            try
            {
                foreach (var b in FindPicks(VoteBody)) b.IsChecked = VotePicked.Contains(b.Tag as string);
            }
            finally { picking = false; }
            VoteButton.IsEnabled = VotePicked.Count > 0 && !voteBusy;
            VoteError.Text = "";
        }

        static IEnumerable<ToggleButton> FindPicks(DependencyObject root)
        {
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
            {
                var c = VisualTreeHelper.GetChild(root, i);
                if (c is ToggleButton t && t.Tag is string) yield return t;
                foreach (var x in FindPicks(c)) yield return x;
            }
        }

        /// <summary>A poll option's picture, fetched with this PC's sign-in (pictures are for members only).</summary>
        void LoadPicture(Image img, string url)
        {
            if (homeSim) return;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                string tmp = null;
                try
                {
                    tmp = System.IO.Path.GetTempFileName();
                    Http.Download(url, tmp, 20);
                    var bytes = File.ReadAllBytes(tmp);
                    d.BeginInvoke(new Action(() =>
                    {
                        try { var b = new BitmapImage(); b.BeginInit(); b.CacheOption = BitmapCacheOption.OnLoad; b.StreamSource = new MemoryStream(bytes); b.EndInit(); img.Source = b; } catch { }
                    }));
                }
                catch (Exception e) { Log.Line("window: a poll picture could not be fetched: " + e.Message); }
                finally { try { if (tmp != null) File.Delete(tmp); } catch { } }
            }) { IsBackground = true, Name = "poll picture" }.Start();
        }

        void OnVoteButton()
        {
            var item = VoteShown; if (item == null) return;
            if (voteResults) { NextVote(); return; }
            if (item.Ballot != null)
            {
                if (!ballotOpened) { OpenSite(item.Ballot.Url ?? (Env.PortalUrl + "/pack?tab=vote")); ballotOpened = true; VoteButton.Content = UiText.BallotDone; return; }
                VoteNote.Text = UiText.BallotChecking;
                RefreshHome();
                return;
            }
            if (voteBusy || VotePicked.Count == 0) return;
            voteBusy = true;
            VoteButton.IsEnabled = false; VoteButton.Content = UiText.VoteSaving;
            var id = item.Poll.Id; var picked = VotePicked.ToList();
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                PollInfo back = null; string err = null;
                try { back = SiteHome.Vote(id, picked); } catch (Exception e) { err = SiteHome.Why(e); }
                try
                {
                    d.BeginInvoke(new Action(() =>
                    {
                        voteBusy = false;
                        if (back == null) { VoteError.Text = err ?? "That didn't work. Try again."; VoteButton.Content = UiText.VoteButton; VoteButton.IsEnabled = VotePicked.Count > 0; return; }
                        Log.Line("window: voted in '" + item.Poll.Question + "'");
                        answered.Add(id); answeredThisRound++;
                        ShowResults(back);
                    }));
                }
                catch { }
            }) { IsBackground = true, Name = "vote" }.Start();
        }

        /// <summary>After voting: how it stands, then on to the next vote or to the Play tab.</summary>
        public void ShowResults(PollInfo p)
        {
            voteResults = true;
            VoteBody.Children.Clear();
            VoteNote.Text = UiText.VoteThanks;
            var mine = p.Mine ?? VotePicked;
            foreach (var c in p.Counts)
            {
                var row = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
                var line = new DockPanel();
                var n = NewText(string.Format("{0} · {1}%", c.Votes, c.Percent), 12.5, "Normal", "#555"); DockPanel.SetDock(n, Dock.Right);
                line.Children.Add(n);
                line.Children.Add(NewText(c.Text + (mine.Contains(c.Id) ? "  ✓" : ""), 13.5, mine.Contains(c.Id) ? "SemiBold" : "Normal", c.Id == SiteHome.DontMind ? "#666" : "#222"));
                row.Children.Add(line);
                var bar = new Grid { Height = 8, Margin = new Thickness(0, 3, 0, 0) };
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, c.Percent), GridUnitType.Star) });
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, 100 - c.Percent), GridUnitType.Star) });
                var back = new Border { Background = NewBrush("#EEF0F2"), CornerRadius = new CornerRadius(4) }; Grid.SetColumnSpan(back, 2); bar.Children.Add(back);
                var fill = new Border { Background = NewBrush(c.Id == SiteHome.DontMind ? "#A0A7AE" : "#2E7D5B"), CornerRadius = new CornerRadius(4) }; Grid.SetColumn(fill, 0); bar.Children.Add(fill);
                row.Children.Add(bar);
                VoteBody.Children.Add(row);
            }
            var total = NewText(string.Format("{0} {1} so far.", p.Voters, p.Voters == 1 ? "vote" : "votes"), 12, "Normal", "#666"); total.Margin = new Thickness(0, 4, 0, 0);
            VoteBody.Children.Add(total);
            var more = PendingVotes.Count > 0;
            VoteButton.Content = more ? UiText.NextVote : UiText.GoToPlay;
            VoteButton.IsEnabled = true;
            if (!homeSim) { VoteNextTimer.Stop(); VoteNextTimer.Start(); }
        }

        void NextVote()
        {
            VoteNextTimer.Stop();
            var p = PendingVotes;
            if (p.Count > 0) { ShowVote(p[0], true); return; }
            FinishVotes();
        }

        /// <summary>Every vote answered: the Vote tab goes, Play opens, and the countdown rules decide as usual.</summary>
        void FinishVotes()
        {
            VoteNextTimer.Stop();
            VoteShown = null; voteResults = false; answeredThisRound = 0;
            var wasOn = Tabs.SelectedItem == VoteTab;
            VoteTab.Visibility = Visibility.Collapsed;
            if (wasOn || Tabs.SelectedItem == null) Tabs.SelectedItem = PlayTab;
            Log.Line("window: every vote answered: Play is open");
            if (Mode == "idle" || Mode == "ready")
            {
                PlayButton.Content = UiText.Play; PlayButton.IsEnabled = true; PlayHint.Visibility = Visibility.Collapsed;
                if (Mode == "ready" && runWaiting) OnReady();   // the game is ready: the countdown rules decide again
            }
            ShowWakeHint();
        }

        // ---- for the window tests ----------------------------------------------------------------------------------------
        internal bool PlayOpen => PlayButton.IsEnabled;
        internal string PlayLabel => PlayButton.Content as string;
        internal bool OnVoteTab => Tabs.SelectedItem == VoteTab && VoteTab.Visibility == Visibility.Visible;
        internal string VoteQuestion => VoteTitle.Text;
        internal string VoteButtonLabel => VoteButton.Content as string;
        internal string ServerLineShown => ServerLineText.Text;
        internal bool StartShown => StartButton.Visibility == Visibility.Visible;
        internal void Tick() => GatePlay();
        internal void Next() => NextVote();

        // ---- screenshots ------------------------------------------------------------------------------------------------
        /// <summary>Screenshots: the Play tab and the Vote tab as they would be with this answer from the site.</summary>
        public void SimHome(HomeInfo h, string mode = null)
        {
            homeSim = true;
            if (mode == "ready") { Mode = "ready"; runWaiting = false; ClearPlayBody(); PlayTitle.Text = UiText.ReadyToPlayTitle; PlayStatus.Text = UiText.ReadyToPlayStatus; PlayButton.Content = UiText.Play; PlayButton.IsEnabled = true; PlayHint.Visibility = Visibility.Collapsed; }
            if (mode == "idle") { ShowIdle(); PlayHint.Visibility = Visibility.Collapsed; }
            answered.Clear(); answeredThisRound = 0; VoteShown = null;
            if (h.Votes.Count == 0) { VoteTab.Visibility = Visibility.Collapsed; Tabs.SelectedItem = PlayTab; }
            ApplyHome(h);
        }
        public void SimPick(params string[] ids) { foreach (var id in ids) OnPick(id, true); }
        public void SimVoted(PollInfo p) { if (VoteShown != null) { answered.Add(VoteShown.Id); answeredThisRound++; } ShowResults(p); }
        public void SimDone() { homeSim = false; answered.Clear(); SiteNow = null; VoteTab.Visibility = Visibility.Collapsed; Tabs.SelectedItem = PlayTab; }
    }
}

using System;
using System.Collections.Generic;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.6.1: one Play view and everything that belongs to its server. The Play tab is the live server's, the Test tab
    /// (admins only) the test server's: the same view (AppWindow.PlayViewXaml, parsed once for each, so each copy has
    /// names of its own) and the same code. The window's Play code works on one pane at a time (AppUi.P): the one whose
    /// button was pressed, whose run sent the line, whose countdown ticked. Outside those it is the live one.
    /// </summary>
    sealed class PlayPane
    {
        public const string Live = "live", Test = "test";

        /// <summary>"live" or "test": the run's target (Run.Target), its game folder, its manifest and its wake.</summary>
        public readonly string Target;
        public readonly Grid Root;
        public bool IsLive => Target == Live;

        // ---- the view's controls ----
        public TextBlock PlayTitle, PlayStatus, PlayChanged, PlayChangedDetail, StepLabel, PlayHint, UpdateLine;
        public TextBlock ServerName, ServerLine, ServerHint, ServerOnline, NewsText, NewsMeta, NewsOpen, SiteLinkLine;
        public Hyperlink ReviewLink, SettingsLink, SiteLink;
        public Button PlayButton, UpdateButton, StartButton, AllowAllButton, ResetButton;
        public StackPanel PlayBody, OnlineHeads;
        public Border ServerBox, NewsBox, ChangedBox;
        public Ellipse ServerDot;
        public ScrollViewer NewsScroll, PlayScroll;

        // ---- its run: one run at a time in the window, so at most one pane is "running" or "ready" ----
        public string Mode = "idle";                    // idle | asking | running | ready
        public readonly ManualResetEvent GoEvent = new ManualResetEvent(false);
        public volatile bool GoAnswer;
        public bool Waiting, KeepScreen, FromWebsite, Pressed;
        public Run Run;                                 // the run in hand, while there is one
        /// <summary>What to start once the run that only waits has ended: the other server's Play (item 1).</summary>
        public Action After;
        public Countdown Count;
        public DispatcherTimer CountTimer;
        public string LastFail, Changed, ChangedDetail;
        public DateTime? Launched, WatchSince, WatchUntil;
        public ModsCheck GameProblem;
        public readonly Dictionary<string, int> Used = new Dictionary<string, int>();
        public TextBlock StepLine; public string StepTitle; public bool StepTicked;
        /// <summary>Play is shut because the other server's game is being installed or started (item 1).</summary>
        public bool HeldByOther;

        // ---- its server, and the footer while its tab is shown ----
        public ServerInfo Server;
        public int Players;
        public string VerLocal, VerCurrent, VerServer;

        PlayPane(string target, Grid root)
        {
            Target = target; Root = root;
            T F<T>(string n) where T : class => root.FindName(n) as T ?? throw new InvalidOperationException("the Play view has no " + n);
            PlayTitle = F<TextBlock>("PlayTitle"); PlayStatus = F<TextBlock>("PlayStatus"); PlayChanged = F<TextBlock>("PlayChanged"); PlayChangedDetail = F<TextBlock>("PlayChangedDetail");
            StepLabel = F<TextBlock>("StepLabel"); PlayHint = F<TextBlock>("PlayHint"); UpdateLine = F<TextBlock>("UpdateLine");
            ServerName = F<TextBlock>("ServerName"); ServerLine = F<TextBlock>("ServerLine"); ServerHint = F<TextBlock>("ServerHint"); ServerOnline = F<TextBlock>("ServerOnline");
            NewsText = F<TextBlock>("NewsText"); NewsMeta = F<TextBlock>("NewsMeta"); NewsOpen = F<TextBlock>("NewsOpen"); SiteLinkLine = F<TextBlock>("SiteLinkLine");
            ReviewLink = F<Hyperlink>("ReviewLink"); SettingsLink = F<Hyperlink>("SettingsLink"); SiteLink = F<Hyperlink>("SiteLink");
            PlayButton = F<Button>("PlayButton"); UpdateButton = F<Button>("UpdateButton"); StartButton = F<Button>("StartButton"); AllowAllButton = F<Button>("AllowAllButton"); ResetButton = F<Button>("ResetButton");
            PlayBody = F<StackPanel>("PlayBody"); OnlineHeads = F<StackPanel>("OnlineHeads");
            ServerBox = F<Border>("ServerBox"); NewsBox = F<Border>("NewsBox"); ChangedBox = F<Border>("ChangedBox");
            ServerDot = F<Ellipse>("ServerDot");
            NewsScroll = F<ScrollViewer>("NewsScroll"); PlayScroll = F<ScrollViewer>("PlayScroll");
            ServerName.Text = IsLive ? UiText.LiveServerName : UiText.TestServerName;
            if (!IsLive)
            {
                // the Test tab: the test server only. No news, no site link, no Start (test starts stay on the test site,
                // where they are logged), no Update (the app has one channel, the live site's), no Review (one set of answers)
                foreach (var e in new UIElement[] { NewsBox, SiteLinkLine, StartButton, UpdateButton, UpdateLine }) e.Visibility = Visibility.Collapsed;
                ((FrameworkElement)ReviewLink.Parent).Visibility = Visibility.Collapsed;
                Server = new ServerInfo { Line = UiText.TestAsking, Tone = "neutral" };
            }
        }

        /// <summary>A new copy of the Play view for a target.</summary>
        public static PlayPane Load(string target) => new PlayPane(target, (Grid)System.Windows.Markup.XamlReader.Parse(AppWindow.PlayViewXaml));

        /// <summary>A control of this copy by name (tests and the screenshots).</summary>
        public object Find(string name) => Root.FindName(name);
    }
}

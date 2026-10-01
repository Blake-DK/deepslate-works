using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Hyperlink = System.Windows.Documents.Hyperlink;
using TextRun = System.Windows.Documents.Run;

namespace DeepslateWorks
{
    /// <summary>
    /// The window itself: what 2.0.x kept in $script:App, and its functions (Show-App, Show-FirstRun, Start-Run, On-Tick,
    /// Show-Extras, On-Apply...). Everything here runs on the window's thread; the install steps run on a thread of their
    /// own and hand their status lines over with Dispatcher.BeginInvoke.
    /// </summary>
    sealed class AppUi
    {
        // the controls AppXaml names
        public Window Window;
        public TabControl Tabs;
        public TabItem PlayTab, ExtrasTab, LogTab;
        TextBlock PlayTitle, PlayStatus, PlayChanged, HeadlineText, ErrorLine, ExtrasStatus, ChecksTitle;
        Hyperlink ReviewLink, DetailsLink;
        Button ResetButton, AllowAllButton, PlayButton, HeadlineButton, CheckButton, ApplyButton;
        StackPanel PlayBody, ProgressBox, ExtrasBody, ChecksBody;
        Border HeadlineBox;
        TextRun ErrorText;
        ListBox LogList;
        StackPanel BrandBar; Image BrandLogo; TextBlock BrandName, BrandTagline, FooterApp, FooterPack, FooterServer;   // 2.1.1 / 2.1.2
        string VerApp = Env.Version, VerLocal, VerCurrent, VerServer;   // the footer's sources (2.1.2)

        // the state
        readonly Run first;            // what Program made: copied into each run (UpdatedFrom only into the first)
        bool firstUsed;
        public Dictionary<string, ConsentAnswer> Consent;
        Dictionary<string, string> Answers = new Dictionary<string, string>();
        List<RadioButton> AllowRadios = new List<RadioButton>();
        string Mode = "idle";          // idle | asking | running
        List<ConsentStep> Asking = new List<ConsentStep>();
        int AskLevel = 1;
        readonly Dictionary<string, int> Used = new Dictionary<string, int>();
        string LastFail, Changed;
        DateTime? Launched;                 // 2.1.0: when the engine opened the launcher (after checking every mod)
        DateTime? WatchSince, WatchUntil;   // 2.1.0: the game's log is watched for the session this launch starts
        ModsCheck GameProblem;
        RestartFlow Flow;              // the Apply -> restart flow in progress (planner H)
        bool GameRunning;
        DateTime NextGameCheck = DateTime.MinValue;
        readonly bool Weak;
        public EventWaitHandle ShowSignal;
        EventWaitHandle UpEvent;
        DispatcherTimer Timer;
        Thread worker;
        readonly ManualResetEvent repairDone = new ManualResetEvent(true);
        ExtrasManifest XManifest;
        public bool XRendered;
        Dictionary<string, CheckBox> XBoxes = new Dictionary<string, CheckBox>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, RadioButton> XShader = new Dictionary<string, RadioButton>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, StatusRow> XStatus = new Dictionary<string, StatusRow>(StringComparer.OrdinalIgnoreCase);
        string AskAnswer = "later";

        sealed class StatusRow { public Border Badge; public TextBlock Restart, Details; }

        public AppUi(Run run, bool shots)
        {
            first = run;
            Consent = Consents.Read(Env.ConsentPath);
            try { Weak = Extras.LocalWeakPc(); } catch { }

            var w = (Window)XamlReader.Parse(AppWindow.AppXaml);
            Window = w;
            T Find<T>(string n) where T : class => w.FindName(n) as T ?? throw new InvalidOperationException("the window has no " + n);
            Tabs = Find<TabControl>("Tabs"); PlayTab = Find<TabItem>("PlayTab"); ExtrasTab = Find<TabItem>("ExtrasTab"); LogTab = Find<TabItem>("LogTab");
            PlayTitle = Find<TextBlock>("PlayTitle"); PlayStatus = Find<TextBlock>("PlayStatus"); PlayChanged = Find<TextBlock>("PlayChanged");
            ReviewLink = Find<Hyperlink>("ReviewLink"); ResetButton = Find<Button>("ResetButton"); AllowAllButton = Find<Button>("AllowAllButton");
            PlayButton = Find<Button>("PlayButton"); PlayBody = Find<StackPanel>("PlayBody");
            BrandBar = Find<StackPanel>("BrandBar"); BrandLogo = Find<Image>("BrandLogo"); BrandName = Find<TextBlock>("BrandName"); BrandTagline = Find<TextBlock>("BrandTagline");
            FooterApp = Find<TextBlock>("FooterApp"); FooterPack = Find<TextBlock>("FooterPack"); FooterServer = Find<TextBlock>("FooterServer");
            HeadlineBox = Find<Border>("HeadlineBox"); HeadlineText = Find<TextBlock>("HeadlineText"); HeadlineButton = Find<Button>("HeadlineButton");
            ErrorLine = Find<TextBlock>("ErrorLine"); ErrorText = Find<TextRun>("ErrorText"); DetailsLink = Find<Hyperlink>("DetailsLink");
            ProgressBox = Find<StackPanel>("ProgressBox"); CheckButton = Find<Button>("CheckButton"); ApplyButton = Find<Button>("ApplyButton");
            ExtrasStatus = Find<TextBlock>("ExtrasStatus"); ExtrasBody = Find<StackPanel>("ExtrasBody"); ChecksTitle = Find<TextBlock>("ChecksTitle");
            ChecksBody = Find<StackPanel>("ChecksBody"); LogList = Find<ListBox>("LogList");
            try { w.Title = string.Format("{0} {1}", Env.PackName, Env.Version); } catch { }
            try
            {
                // 2.0.3: the Deepslate icon, never the host program's
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("DeepslateWorks.ico"))
                    if (s != null)
                    {
                        var ms = new MemoryStream(); s.CopyTo(ms); ms.Position = 0;
                        w.Icon = BitmapFrame.Create(ms, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
                    }
            }
            catch { }
            UpdateAppBrand();   // 2.1.1: the chosen logo instead, with the header's logo and tagline
            VerLocal = Footer.InstalledPack();
            UpdateAppFooter();
            new Thread(() =>
            {
                // the current pack and the server's state, from the site (public, a few seconds at most)
                string pack = null, status = null;
                try { var r = Http.GetJson(Env.PortalUrl + "/api/version", 4); pack = J.Str(r, "pack"); status = J.Str(r, "status"); }
                catch (Exception e) { Log.Line("the versions could not be read from the site: " + e.Message); }
                try { w.Dispatcher.BeginInvoke(new Action(() => { if (pack != null) VerCurrent = pack; if (status != null) VerServer = status; UpdateAppFooter(); })); } catch { }
            }) { IsBackground = true, Name = "site versions" }.Start();

            PlayButton.Click += (s, e) => OnPlayButton();
            AllowAllButton.Click += (s, e) => OnAllowAll();
            ResetButton.Click += (s, e) => OnResetAll();
            ReviewLink.Click += (s, e) => ShowReview();
            ApplyButton.Click += (s, e) => OnApply();
            CheckButton.Click += (s, e) => OnCheck();
            HeadlineButton.Click += (s, e) => OnHeadline();
            DetailsLink.Click += (s, e) => ShowLogDetails();
            Tabs.SelectionChanged += (s, e) =>
            {
                if (e.OriginalSource != Tabs) return;
                if (Tabs.SelectedItem == ExtrasTab) ShowExtras();
                else if (Tabs.SelectedItem == LogTab) UpdateLogBox();
            };
            // a handler that throws never ends the window (a PowerShell script block's error did not either)
            w.Dispatcher.UnhandledException += (s, e) => { Log.Line("window: " + e.Exception); e.Handled = true; };

            Timer = new DispatcherTimer(DispatcherPriority.Normal, w.Dispatcher) { Interval = TimeSpan.FromMilliseconds(250) };
            Timer.Tick += (s, e) => OnTick();
        }

        /// <summary>Show-App's ending: on screen until closed.</summary>
        public void Open()
        {
            Timer.Start();
            Action<string> live = line => { try { Window.Dispatcher.BeginInvoke(new Action(() => AddLiveLog(line))); } catch { } };
            Log.Written += live;
            Window.ContentRendered += (s, e) =>
            {
                ShowFront("opened");
                try { UpEvent = new EventWaitHandle(false, EventResetMode.ManualReset, Env.AppUpEvent); UpEvent.Set(); } catch { }   // Setup's wait may end now
                StartRepair();
                if (Consents.Unanswered(Consent).Count > 0) ShowFirstRun(); else StartRun();
            };
            Window.Closing += (s, e) =>
            {
                if (Mode == "running" || Flow != null)
                {
                    var r = MessageBox.Show(Window, UiText.CloseWhileBusy, Env.PackName, MessageBoxButton.YesNo, MessageBoxImage.Question);
                    if (r != MessageBoxResult.Yes) { e.Cancel = true; return; }
                    Log.Line("window: closed while busy; the install steps stop with it");
                }
            };
            Window.Closed += (s, e) =>
            {
                Timer.Stop();
                Log.Written -= live;
                try { UpEvent?.Dispose(); } catch { }
            };
            Window.ShowDialog();
        }

        // ---- drawing helpers (New-Brush, New-Text, New-Badge, New-Card, New-Button) ---------------------------------
        static Brush NewBrush(string hex) => (Brush)new BrushConverter().ConvertFromString(hex);
        static FontWeight Weight(string w) => w == "SemiBold" ? FontWeights.SemiBold : w == "Bold" ? FontWeights.Bold : FontWeights.Normal;
        static TextBlock NewText(string text, double size = 13, string weight = "Normal", string color = "#222")
            => new TextBlock { Text = text ?? "", FontSize = size, TextWrapping = TextWrapping.Wrap, Foreground = NewBrush(color), FontWeight = Weight(weight) };
        static Border NewBadge(string text, string bg, string fg)
            => new Border { Background = NewBrush(bg), CornerRadius = new CornerRadius(8), Padding = new Thickness(6, 1, 6, 1), Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Child = NewText(text, 11, "SemiBold", fg) };
        static Border NewCard()
            => new Border { BorderBrush = NewBrush("#D9DDE1"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(12), Margin = new Thickness(0, 0, 0, 8), Background = NewBrush("White") };
        Button NewButton(string text, bool primary = false) => new Button { Content = text, Style = (Style)Window.FindResource(primary ? "Primary" : "Plain") };
        public void Pump() { try { Window.Dispatcher.Invoke(new Action(() => { }), DispatcherPriority.Background); } catch { } }

        // One permission card: title, "Needed to play" when it is, the plain-English text, Allow / Not now.
        Border NewConsentCard(ConsentStep step, int level, string size)
        {
            var card = NewCard();
            var sp = new StackPanel();
            var head = new StackPanel { Orientation = Orientation.Horizontal };
            head.Children.Add(NewText(step.Title, 14, "SemiBold"));
            head.Children.Add(step.Required ? NewBadge(UiText.NeededBadge, "#E8F3EE", "#2E7D5B") : NewBadge(UiText.OptionalBadge, "#EEF0F2", "#555"));
            sp.Children.Add(head);
            var body = NewText(UiText.CardText(step, level, size), 13, "Normal", "#444"); body.Margin = new Thickness(0, 4, 0, 8);
            sp.Children.Add(body);
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            var group = "consent-" + step.Id;
            var allow = new RadioButton { Content = UiText.Allow, GroupName = group, Margin = new Thickness(0, 0, 18, 0) };
            var no = new RadioButton { Content = UiText.NotNow, GroupName = group };
            var warn = NewText("", 12, "Normal", "#B3261E"); warn.Margin = new Thickness(0, 6, 0, 0); warn.Visibility = Visibility.Collapsed;
            var id = step.Id;
            allow.Checked += (s, e) => { Answers[id] = "allow"; warn.Visibility = Visibility.Collapsed; UpdateContinueButton(); };
            no.Checked += (s, e) =>
            {
                Answers[id] = "decline";
                if (step.Required) { warn.Text = UiText.NeededWarning; warn.Visibility = Visibility.Visible; }
                UpdateContinueButton();
            };
            if (Answers.TryGetValue(id, out var had)) { if (had == "allow") allow.IsChecked = true; else no.IsChecked = true; }
            AllowRadios.Add(allow);
            row.Children.Add(allow); row.Children.Add(no);
            sp.Children.Add(row);
            sp.Children.Add(warn);
            card.Child = sp;
            return card;
        }

        // To the front (2.0.3): restored if minimised, activated, briefly topmost; when Windows still keeps another window
        // in front (a start from the browser has no right to the foreground), the input of the window in front is
        // borrowed for the moment it takes (Native.ForceForeground). The launching process grants the right where it can.
        void ShowFront(string why)
        {
            var w = Window;
            try
            {
                if (w.WindowState == WindowState.Minimized) w.WindowState = WindowState.Normal;
                if (!w.IsVisible) w.Show();
                w.Activate();
                w.Topmost = true; w.Topmost = false;
                var h = new WindowInteropHelper(w).Handle;
                var front = Native.ForceForeground(h);
                Log.Line(string.Format("window: {0}, in front: {1}", why, front ? "True" : "False"));
            }
            catch (Exception e) { Log.Line("window: could not bring it to the front: " + e.Message); }
        }

        // ---- the Play tab ----------------------------------------------------------------------------------------------
        void UpdateContinueButton()
        {
            if (Mode != "asking") return;
            PlayButton.IsEnabled = Asking.All(s => Answers.ContainsKey(s.Id));
        }

        void ClearPlayBody() { PlayBody.Children.Clear(); PlayChanged.Visibility = Visibility.Collapsed; AllowRadios = new List<RadioButton>(); }
        TextBlock AddPlayLine(string text, string color = "#222", string weight = "Normal")
        {
            var t = NewText(text, 13, weight, color); t.Margin = new Thickness(0, 2, 0, 2);
            PlayBody.Children.Add(t);
            return t;
        }
        void SetPromptButtons(bool asking, bool review = false)
        {
            AllowAllButton.Visibility = asking ? Visibility.Visible : Visibility.Collapsed;
            ResetButton.Visibility = review ? Visibility.Visible : Visibility.Collapsed;
        }

        // First run, a new step after an update, a bigger step: every question as a card, Continue and Allow all.
        public void ShowFirstRun(List<ConsentStep> only = null, int level = 1)
        {
            Mode = "asking";
            ClearPlayBody();
            var steps = only ?? Consents.Unanswered(Consent);
            Asking = steps;
            var firstTime = Consent.Count == 0;
            PlayTitle.Text = UiText.QuestionsTitle(firstTime, steps.Count);
            PlayStatus.Text = firstTime ? UiText.FirstStatus : UiText.LaterStatus;
            var size = Extras.DownloadSizeMb(ExtrasManifest.Read(Env.ExtrasManifestPath));
            foreach (var s in steps) PlayBody.Children.Add(NewConsentCard(s, level, size));
            PlayButton.Content = UiText.Continue;
            AskLevel = level;
            SetPromptButtons(true, false);
            UpdateContinueButton();
        }

        void SaveAnswers()
        {
            foreach (var s in Asking)
            {
                if (!Answers.TryGetValue(s.Id, out var a)) continue;
                Consents.SetAnswer(Consent, s.Id, a, UiText.SavedLevel(a, AskLevel, s.Top));
            }
            Consents.Save(Env.ConsentPath, Consent);
        }

        // Allow all: ticks Allow on every card shown (they stay on screen), then carries on as Continue would.
        void OnAllowAll()
        {
            if (Mode != "asking") return;
            foreach (var r in AllowRadios.ToList()) r.IsChecked = true;
            Consents.ApproveAll(Answers, Asking);
            Log.Line("permissions: Allow all on " + string.Join(", ", Asking.Select(s => s.Id)));
            Pump();
            OnPlayButton();
        }
        // Reset all (Review permissions): every answer forgotten; the first-run questions again.
        void OnResetAll()
        {
            Consents.ResetAll(Env.ConsentPath);
            Consent = new Dictionary<string, ConsentAnswer>();
            Answers = new Dictionary<string, string>();
            Log.Line("permissions: Reset all");
            ShowFirstRun();
        }

        void OnPlayButton()
        {
            if (Mode == "asking")
            {
                SaveAnswers();
                SetPromptButtons(false, false);
                var no = Asking.FirstOrDefault(s => s.Required && Answers.TryGetValue(s.Id, out var a) && a == "decline");
                if (no != null) { ShowStopped(no); return; }
                StartRun();
                return;
            }
            if (Mode == "idle") StartRun();
        }

        void ShowStopped(ConsentStep step)
        {
            Mode = "idle";
            ClearPlayBody();
            SetPromptButtons(false, false);
            PlayTitle.Text = UiText.StoppedTitle;
            PlayStatus.Text = string.Format(UiText.StoppedStatus, step?.Title ?? "");
            PlayButton.Content = UiText.Play;
            PlayButton.IsEnabled = true;
        }

        // Review permissions: every step with its current answer, changeable; Allow all and Reset all.
        void ShowReview()
        {
            if (Mode == "running") return;
            Answers = new Dictionary<string, string>();
            foreach (var k in Consent.Keys) Answers[k] = Consent[k].Answer;
            ShowFirstRun(Consents.Steps());
            PlayTitle.Text = UiText.ReviewTitle;
            PlayStatus.Text = UiText.ReviewStatus;
            PlayButton.Content = UiText.SaveAndPlay;
            SetPromptButtons(true, true);
        }

        // ---- the install steps -------------------------------------------------------------------------------------------

        /// <summary>A run of its own per press of Play, made like the one Program made: the same switches, this window's
        /// answers; "updated from" (said once) and what the first start found only on the first.</summary>
        Run NewRun(bool noLaunch)
        {
            var r = new Run
            {
                DryRun = first.DryRun, AllowAll = first.AllowAll, NoLaunch = first.NoLaunch || noLaunch,
                PretendRunning = first.PretendRunning ?? new string[0], RestartArgs = first.RestartArgs ?? new string[0], EntryPoint = first.EntryPoint ?? "",
            };
            foreach (var kv in Consent) r.Consent[kv.Key] = new ConsentAnswer { Answer = kv.Value.Answer, Level = kv.Value.Level, At = kv.Value.At };
            if (!firstUsed)
            {
                firstUsed = true;
                r.UpdatedFrom = first.UpdatedFrom;
                r.MigratedFrom = first.MigratedFrom;
            }
            return r;
        }

        /// <summary>Right after the window opens, once (3.0): the copy, the Play link, the shortcuts and the Apps entry put
        /// right when the shortcuts are allowed, so a 2.x PC is switched to the exe at once even if the run then fails.
        /// The first run waits for it, so the two never write the same things at the same time.</summary>
        void StartRepair()
        {
            if (Consents.Decision(Consent, "shortcuts") != "allow") return;
            repairDone.Reset();
            var t = new Thread(() =>
            {
                try
                {
                    var r = Home.RepairHere(first, true);
                    Log.Line(string.Format("window: home checked: {0}, Play link {1}{2}", r?.Exe, r != null && r.Linked ? "OK" : "not set", r != null && r.Problems.Count > 0 ? ", " + r.Problems.Count + " problem(s)" : ""));
                }
                catch (Exception e) { Log.Line("window: could not check the Play link and the shortcuts: " + e); }
                finally { repairDone.Set(); }
            }) { IsBackground = true, Name = "home" };
            t.Start();
        }

        void StartRun(bool noLaunch = false)
        {
            if (worker != null && worker.IsAlive) return;   // one run at a time (2.0.x only ever had one engine)
            Mode = "running";
            ClearPlayBody();
            SetPromptButtons(false, false);
            PlayTitle.Text = UiText.RunningTitle;
            PlayStatus.Text = noLaunch ? UiText.RunningExtrasStatus : UiText.RunningStatus;
            PlayButton.Content = UiText.Working;
            PlayButton.IsEnabled = false;
            Used.Clear();
            LastFail = null; Changed = null; Launched = null; WatchSince = null; WatchUntil = null; GameProblem = null;
            var isFirst = !firstUsed;
            var run = NewRun(noLaunch);
            Run.Current = run;
            Log.Line("window: starting the install steps" + (noLaunch ? " (extras only, no launcher)" : ""));
            var d = Window.Dispatcher;
            run.Sink = line => d.BeginInvoke(new Action(() => OnStatusLine(line)));
            worker = new Thread(() =>
            {
                string outcome = null; Exception err = null;
                try
                {
                    repairDone.WaitOne(TimeSpan.FromSeconds(60));
                    // what the first start and the check above found goes into the first run's report
                    if (isFirst && first.SetupChecked)
                    {
                        try { var found = first.SetupProblems.ToList(); run.SetupChecked = true; foreach (var p in found) run.SetupProblems.Add(p); } catch { }
                    }
                    outcome = Engine.Execute(run);
                }
                catch (Exception e) { err = e; }
                d.BeginInvoke(new Action(() => OnRunEnded(outcome, err)));   // after every status line it sent
            }) { IsBackground = true, Name = "install steps" };
            worker.Start();
        }

        // Read-StatusLines: what each line from the install steps does here.
        void OnStatusLine(JObj o)
        {
            var show = UiText.LineFor(o);
            if (show != null) AddPlayLine(show.Text, show.Color, show.Weight);
            switch (J.Str(o, "t"))
            {
                case "fail": LastFail = J.Str(o, "text"); break;
                case "used": var id = J.Str(o, "step"); if (id != null) Used[id] = J.Int(o, "level", 1); break;
                case "changed": Changed = J.Str(o, "text"); break;
                case "launched": Launched = DateTime.UtcNow; break;
                case "versions": { var a = J.Str(o, "app"); var p = J.Str(o, "pack"); if (!string.IsNullOrEmpty(a)) VerApp = a; if (!string.IsNullOrEmpty(p)) VerCurrent = p; UpdateAppFooter(); break; }
                case "installed": { var p = J.Str(o, "pack"); if (!string.IsNullOrEmpty(p)) VerLocal = p; UpdateAppFooter(); break; }
            }
        }

        void OnRunEnded(string outcome, Exception err)
        {
            Mode = "idle";
            PlayButton.Content = UiText.Play;
            PlayButton.IsEnabled = true;
            foreach (var kv in Used) Consents.SetUsed(Consent, kv.Key, kv.Value);
            if (Used.Count > 0) Consents.Save(Env.ConsentPath, Consent);
            Log.Line(string.Format("window: the install steps ended, exit code {0}{1}", UiText.ExitCodeFor(err), outcome == "updated" ? " (updated)" : ""));
            if (err is NeedAnswer na)
            {
                var s = Consents.Step(na.StepId);
                if (s != null)
                {
                    Answers = new Dictionary<string, string>();
                    ShowFirstRun(new List<ConsentStep> { s }, na.Level);
                    return;
                }
            }
            if (err is StepDeclined sd) { ShowStopped(Consents.Step(sd.StepId) ?? new ConsentStep { Id = sd.StepId, Title = sd.StepId }); return; }
            if (err != null)
            {
                if (!(err is RunFailed) && !(err is AlreadyRunning)) Log.Line("window: " + err);
                var t = UiText.EndedText(err, LastFail);
                PlayTitle.Text = t.Key; PlayStatus.Text = t.Value;
                return;
            }
            if (outcome == "updated")
            {
                // the new copy is in place and started (it waits for this process to end): it takes over
                Log.Line("window: updated; the new copy takes over, closing");
                Native.GrantForeground();   // its window may come to the front in place of this one
                Window.Close();
                return;
            }
            UpdateAppBrand();   // a run may have brought a new logo
            PlayTitle.Text = UiText.ReadyTitle;
            PlayStatus.Text = UiText.ReadyStatus;
            if (!string.IsNullOrEmpty(Changed)) { PlayChanged.Text = Changed; PlayChanged.Visibility = Visibility.Visible; }
            if (Tabs.SelectedItem == ExtrasTab) ShowExtras();
            // 2.1.0: watch the game's log for the session this launch starts
            if (Launched.HasValue) { WatchSince = Launched.Value.AddSeconds(-5); WatchUntil = Launched.Value.AddMinutes(30); }
        }

        // 2.1.1: the window's icon (taskbar too) and the header's logo and tagline, from what the last run put in the home
        // folder. Read from bytes, so the files are never held open while the next run replaces them.
        void UpdateAppBrand()
        {
            try
            {
                var dir = Env.AppHome;
                var ico = Brand.LogoIconPath(dir);
                if (File.Exists(ico)) Window.Icon = BitmapFrame.Create(new MemoryStream(File.ReadAllBytes(ico)), BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
                var m = Brand.ReadMarker(dir);
                var png = Path.Combine(dir, Brand.LogoPngName);
                if (m != null && File.Exists(png))
                {
                    var bmp = new BitmapImage();
                    bmp.BeginInit(); bmp.CacheOption = BitmapCacheOption.OnLoad; bmp.StreamSource = new MemoryStream(File.ReadAllBytes(png)); bmp.EndInit();
                    BrandLogo.Source = bmp;
                    // pixel art stays crisp: nearest-neighbour, never smoothed
                    RenderOptions.SetBitmapScalingMode(BrandLogo, J.Bool(m, "pixel") ? BitmapScalingMode.NearestNeighbor : BitmapScalingMode.HighQuality);
                    var name = J.Str(m, "name"); if (!string.IsNullOrEmpty(name)) BrandName.Text = name;
                    BrandTagline.Text = J.Str(m, "tagline") ?? "";
                    BrandBar.Visibility = Visibility.Visible;
                }
            }
            catch (Exception e) { Log.Line("the logo could not be shown: " + e.Message); }
        }

        // 2.1.2: "App x · Pack y · Server: z" under the tabs
        void UpdateAppFooter()
        {
            if (FooterApp == null) return;
            var f = Footer.Parts(VerApp, VerLocal, VerCurrent, VerServer);
            FooterApp.Text = f.App; FooterPack.Text = f.Pack; FooterServer.Text = f.Server;
            FooterPack.Foreground = NewBrush(f.PackTone);
        }

        // 2.1.0: every start of the game from the window goes through Play (the engine checks every mod, then opens the
        // launcher); nothing in the window opens the launcher itself. False when a run is already going.
        bool RequestPlay(string why)
        {
            Log.Line(string.Format("window: the game was asked for ({0}): through Play", why));
            if (Mode != "idle") return false;
            Tabs.SelectedItem = PlayTab;
            StartRun();
            return true;
        }

        // 2.1.0: after a launch, the game's own log: did it start with every mod of the pack? Every 2 s, for up to 30 minutes.
        void WatchGame()
        {
            if (!WatchSince.HasValue) return;
            if (DateTime.UtcNow > WatchUntil) { Log.Line("game check: no game session seen within 30 minutes of the launch"); WatchSince = null; return; }
            var list = Engine.ReadPackList(Engine.PackListPath);
            var files = J.Arr(list, "files");
            if (files.Count == 0) { WatchSince = null; return; }
            var host = (J.Str(list, "server") ?? "").Split(':')[0];
            var found = Engine.FindGameSession(Env.DataDir, Env.Minecraft, WatchSince.Value, host);
            if (found == null) return;
            WatchSince = null;
            var c = Engine.TestGameMods(found.Session, files, found.Elsewhere);
            if (c == null) { Log.Line("game check: the game's log lists no mod files; nothing to compare"); return; }
            Log.Line("game check: " + (c.Ok ? string.Format("the game started with all {0} mods", c.Checked) : string.Format("{0} ({1} not loaded{2})", Engine.MissingText(c), c.Missing.Count, c.Elsewhere ? ", another launcher profile" : "")));
            var pack = J.Str(list, "version") ?? "";
            var off = Consents.Decision(Consent, "reports") == "decline";
            new Thread(() => Engine.SendGameCheck(c, pack, off)) { IsBackground = true, Name = "game check" }.Start();
            if (c.Ok) return;
            GameProblem = c;
            if (Mode == "idle") ShowGameProblem();
        }

        void ShowGameProblem()
        {
            var c = GameProblem; if (c == null) return;
            ClearPlayBody();
            PlayTitle.Text = "Your game is missing mods";
            PlayStatus.Text = Engine.MissingText(c);
            if (c.Elsewhere) AddPlayLine("The Minecraft Launcher started another profile. Play puts Deepslate Works back as the one it starts.", "#8A5A00");
            foreach (var m in c.Missing.Take(8)) if (!string.IsNullOrEmpty(m.Name)) AddPlayLine("\u2717  " + m.Name, "#B3261E");
            PlayButton.Content = UiText.Play; PlayButton.IsEnabled = true;
            Tabs.SelectedItem = PlayTab;
            ShowFront("the game is missing mods");
        }

        void OnTick()
        {
            // a second start of the app (the Play button on the site, a shortcut): to the front, and Play when idle
            if (ShowSignal != null && ShowSignal.WaitOne(0))
            {
                Log.Line("window: started again (the Play button or a shortcut)");
                ShowFront("started again");
                Tabs.SelectedItem = PlayTab;
                if (Mode == "idle" && Flow == null) StartRun();
            }
            if (Flow != null) { StepFlow(); return; }
            // every 2 s: is the game running? Queued changes install the moment it closes (planner H, Later)
            if (DateTime.Now >= NextGameCheck)
            {
                NextGameCheck = DateTime.Now.AddSeconds(2);
                var was = GameRunning;
                GameRunning = Extras.GameRunning();
                if (WatchSince.HasValue) { try { WatchGame(); } catch (Exception e) { Log.Line("game check failed: " + e.Message); WatchSince = null; } }
                var done = Extras.InstallQueuedIfClosed(GameRunning, Mode == "running");
                if (done != null) AfterInstall(done);
                else if (Tabs.SelectedItem == ExtrasTab && (was != GameRunning || DateTime.Now.Second % 6 < 2)) ShowExtras(true);
            }
        }

        // ---- the Log tab: this PC's log, errors in red; Show details jumps to the last error ---------------------------
        static TextBlock LogItem(string l)
        {
            var t = new TextBlock { Text = l, TextWrapping = TextWrapping.NoWrap };
            if (UiText.IsErrorLine(l)) { t.Foreground = NewBrush("#B3261E"); t.FontWeight = FontWeights.SemiBold; } else t.Foreground = NewBrush("#222");
            return t;
        }

        static List<string> ReadLogTail(string path, int n)
        {
            var lines = new List<string>();
            if (!File.Exists(path)) return lines;
            // shared: this process (and the install steps' thread) keeps writing to it
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var sr = new StreamReader(fs, Encoding.UTF8))
            {
                string l;
                while ((l = sr.ReadLine()) != null) { lines.Add(l); if (lines.Count > n * 2) lines.RemoveRange(0, lines.Count - n); }
            }
            if (lines.Count > n) lines.RemoveRange(0, lines.Count - n);
            return lines;
        }

        void UpdateLogBox()
        {
            try
            {
                LogList.Items.Clear();
                foreach (var l in ReadLogTail(Env.LogFile, UiText.LogLines)) LogList.Items.Add(LogItem(l));
                if (LogList.Items.Count > 0) LogList.ScrollIntoView(LogList.Items[LogList.Items.Count - 1]);
            }
            catch { }
        }

        /// <summary>A line just written to the log (Log.Written; the extras' lines come through it too, as "extras: ..."):
        /// added while the Log tab is open; otherwise the tab reads the file when it is opened.</summary>
        void AddLiveLog(string line)
        {
            try
            {
                if (Tabs.SelectedItem != LogTab) return;
                int n = LogList.Items.Count;
                for (int i = Math.Max(0, n - 5); i < n; i++) if ((LogList.Items[i] as TextBlock)?.Text == line) return;   // already read from the file
                LogList.Items.Add(LogItem(line));
                while (LogList.Items.Count > UiText.LogLines) LogList.Items.RemoveAt(0);
                LogList.ScrollIntoView(LogList.Items[LogList.Items.Count - 1]);
            }
            catch { }
        }

        void ShowLogDetails()
        {
            Tabs.SelectedItem = LogTab;
            UpdateLogBox();
            for (int i = LogList.Items.Count - 1; i >= 0; i--)
            {
                if (UiText.IsDetailsLine((LogList.Items[i] as TextBlock)?.Text)) { LogList.SelectedIndex = i; LogList.ScrollIntoView(LogList.Items[i]); break; }
            }
        }

        // ---- the Extras tab --------------------------------------------------------------------------------------------
        // sim* (screenshots only): stand-ins for what the PC would say.
        public void ShowExtras(bool quiet = false, ExtrasState simState = null, bool simRunning = false, bool simInGameAll = false)
        {
            var sim = simState != null;
            var allowed = Consents.Decision(Consent, "extras") == "allow";
            var o = Extras.Overview(allowed, sim ? simRunning : GameRunning, simState, simInGameAll);
            XManifest = o.Manifest;
            if (o.NeedsDownload) { if (!quiet) ShowExtrasDownload(o.DownloadSizeMb); return; }
            // headline
            HeadlineText.Text = o.Headline.Text;
            HeadlineButton.Visibility = o.Headline.Action != null ? Visibility.Visible : Visibility.Collapsed;
            HeadlineButton.Content = o.Headline.Action == "restart" ? "Restart now" : "Play now";
            HeadlineButton.Tag = o.Headline.Action;
            HeadlineBox.Background = NewBrush(UiText.HeadlineBackground(o.HeadlineTone));
            // the last thing that went wrong, in one line
            if (o.ErrorLine != null) { ErrorText.Text = o.ErrorLine + " "; ErrorLine.Visibility = Visibility.Visible; } else ErrorLine.Visibility = Visibility.Collapsed;
            if (quiet && XRendered) { UpdateExtrasRows(o.Statuses); ShowChecks(o.CheckRows); return; }
            ExtrasBody.Children.Clear();
            ApplyButton.IsEnabled = true;
            XBoxes = new Dictionary<string, CheckBox>(StringComparer.OrdinalIgnoreCase);
            XShader = new Dictionary<string, RadioButton>(StringComparer.OrdinalIgnoreCase);
            XStatus = new Dictionary<string, StatusRow>(StringComparer.OrdinalIgnoreCase);
            var chosen = o.Chosen;
            foreach (var x in o.Switches)
            {
                var card = NewCard();
                var g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(52) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var img = new Image { Width = 40, Height = 40, VerticalAlignment = VerticalAlignment.Top };
                var pic = Path.Combine(Extras.Paths.Pictures, x.Id + ".png");
                if (File.Exists(pic))
                {
                    try { var bmp = new BitmapImage(); bmp.BeginInit(); bmp.CacheOption = BitmapCacheOption.OnLoad; bmp.UriSource = new Uri(pic); bmp.EndInit(); img.Source = bmp; } catch { }
                }
                Grid.SetColumn(img, 0); g.Children.Add(img);
                var sp = new StackPanel(); Grid.SetColumn(sp, 1);
                var head = new WrapPanel();
                head.Children.Add(NewText(x.Name, 14, "SemiBold"));
                var tone = UiText.FpsTone(x.Fps);
                head.Children.Add(NewBadge(string.Format("FPS cost: {0}", x.Fps), tone[0], tone[1]));
                if (o.New.Contains(x.Id)) head.Children.Add(NewBadge("New", "#E3F0FF", "#1A5FB4"));
                sp.Children.Add(head);
                var d = NewText(x.Description, 12.5, "Normal", "#555"); d.Margin = new Thickness(0, 2, 0, 0); sp.Children.Add(d);
                if (Weak && !string.Equals(x.Fps, "Low", StringComparison.OrdinalIgnoreCase)) { var wn = NewText(ExtrasText.WeakWarning, 12, "Normal", "#8A5A00"); wn.Margin = new Thickness(0, 4, 0, 0); sp.Children.Add(wn); }
                // the status, in words and a colour (planner G), with Restart now or Show details where they help
                var row = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
                var sb = NewBadge("", "#EEF0F2", "#555"); sb.Margin = new Thickness(0, 0, 8, 0);
                row.Children.Add(sb);
                var rb = new TextBlock { VerticalAlignment = VerticalAlignment.Center };
                var hl = new Hyperlink(); hl.Inlines.Add("Restart now"); hl.Click += (s, e) => OnHeadline("restart");
                rb.Inlines.Add(hl);
                var dl = new TextBlock { VerticalAlignment = VerticalAlignment.Center };
                var hd = new Hyperlink(); hd.Inlines.Add("Show details"); hd.Click += (s, e) => ShowLogDetails();
                dl.Inlines.Add(hd);
                row.Children.Add(rb); row.Children.Add(dl);
                sp.Children.Add(row);
                XStatus[x.Id] = new StatusRow { Badge = sb, Restart = rb, Details = dl };
                g.Children.Add(sp);
                var cb = new CheckBox { Content = "On", VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(12, 2, 0, 0), IsChecked = chosen != null && chosen.On(x.Id) };
                Grid.SetColumn(cb, 2); g.Children.Add(cb);
                XBoxes[x.Id] = cb;
                var outer = new StackPanel();
                outer.Children.Add(g);
                if (string.Equals(x.Id, "iris", StringComparison.OrdinalIgnoreCase))
                {
                    // Shaders: None / Light / Full, only with Iris on
                    var srow = new WrapPanel { Margin = new Thickness(52, 8, 0, 0) };
                    srow.Children.Add(NewText("Shaders:  ", 13, "SemiBold"));
                    foreach (var opt in ExtrasText.ShaderOptions)
                    {
                        var r = new RadioButton { Content = opt.Value, GroupName = "shaders", Margin = new Thickness(0, 0, 14, 0), IsChecked = string.Equals(chosen?.Shader, opt.Key, StringComparison.OrdinalIgnoreCase) };
                        var sx = o.Manifest.Extras.FirstOrDefault(e => string.Equals(e.Shader, opt.Key, StringComparison.OrdinalIgnoreCase));
                        if (sx != null && Weak && !string.Equals(sx.Fps, "Low", StringComparison.OrdinalIgnoreCase)) r.ToolTip = ExtrasText.WeakShaderTip;
                        srow.Children.Add(r);
                        XShader[opt.Key] = r;
                    }
                    srow.IsEnabled = cb.IsChecked == true;
                    cb.Checked += (s, e) => srow.IsEnabled = true;
                    cb.Unchecked += (s, e) => srow.IsEnabled = false;
                    outer.Children.Add(srow);
                }
                card.Child = outer;
                ExtrasBody.Children.Add(card);
            }
            XRendered = true;
            UpdateExtrasRows(o.Statuses);
            ShowChecks(o.CheckRows);
            // what has been shown counts as seen: "New" once
            if (!sim) { try { Extras.MarkSeen(o.Manifest); } catch (Exception e) { Log.Line("extras: could not save what was seen: " + e.Message); } }
        }

        void UpdateExtrasRows(Dictionary<string, ExtraStatus> statuses)
        {
            foreach (var kv in statuses)
            {
                if (!XStatus.TryGetValue(kv.Key, out var u)) continue;
                var s = kv.Value;
                var tone = UiText.Tone(s.Tone);
                u.Badge.Background = NewBrush(tone[0]);
                var t = (TextBlock)u.Badge.Child;
                t.Foreground = NewBrush(tone[1]);
                t.Text = s.Text;
                u.Restart.Visibility = s.ShowsRestart ? Visibility.Visible : Visibility.Collapsed;
                u.Details.Visibility = s.ShowsDetails ? Visibility.Visible : Visibility.Collapsed;
            }
        }

        // The tick list (planner C): Files, Settings, Dependencies, In game.
        void ShowChecks(List<ExtrasCheck> rows)
        {
            ChecksBody.Children.Clear();
            ChecksTitle.Visibility = Visibility.Visible;
            string group = null;
            foreach (var r in rows)
            {
                if (r.Group != group) { group = r.Group; ChecksBody.Children.Add(NewText(group, 13, "SemiBold", "#333")); }
                var mark = r.Ok == true ? "✓" : r.Ok == null ? "…" : "✗";
                var col = r.Ok == true ? "#2E7D5B" : r.Ok == null ? "#1A5FB4" : "#B3261E";
                ChecksBody.Children.Add(NewText(string.Format("  {0}  {1}", mark, r.Text), 12.5, "Normal", col));
            }
        }

        // Extras not downloaded yet: the question, with Download and Allow all.
        void ShowExtrasDownload(string size)
        {
            ExtrasBody.Children.Clear(); ChecksBody.Children.Clear(); ChecksTitle.Visibility = Visibility.Collapsed; XRendered = false;
            HeadlineText.Text = ExtrasText.NoExtrasYet;
            HeadlineButton.Visibility = Visibility.Collapsed;
            var card = NewCard();
            var sp = new StackPanel();
            sp.Children.Add(NewText(ExtrasText.DownloadQuestion, 14, "SemiBold"));
            var t = NewText(string.Format(ExtrasText.DownloadText, size), 13, "Normal", "#444"); t.Margin = new Thickness(0, 4, 0, 10);
            sp.Children.Add(t);
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            var b = NewButton(UiText.DownloadButton, true); b.Margin = new Thickness(0, 0, 8, 0);
            var all = NewButton(UiText.AllowAll);
            foreach (var btn in new[] { b, all })
            {
                btn.Click += (s, e) =>
                {
                    Consents.SetAnswer(Consent, "extras", "allow", 1);
                    Consents.Save(Env.ConsentPath, Consent);
                    Extras.XLog("download: the extras were allowed; fetching them");
                    Tabs.SelectedItem = PlayTab;
                    StartRun(true);
                };
            }
            row.Children.Add(b); row.Children.Add(all);
            sp.Children.Add(row);
            card.Child = sp;
            ExtrasBody.Children.Add(card);
            ApplyButton.IsEnabled = false;
        }

        ExtrasChoice ReadExtrasChoices()
        {
            var c = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in XBoxes) c[kv.Key] = kv.Value.IsChecked == true;
            var sh = "none";
            foreach (var kv in XShader) if (kv.Value.IsChecked == true) sh = kv.Key;
            return new ExtrasChoice(c, sh);
        }

        void OnCheck()
        {
            var m = XManifest; if (m == null) return;
            var r = Extras.CheckNow(m);
            ShowExtras();
            ExtrasStatus.Text = r.Value;
        }

        // Apply (planner H): asks first, touches files only while the game is closed.
        void OnApply()
        {
            if (Mode == "running" || Flow != null) { ExtrasStatus.Text = ExtrasText.Busy; return; }
            var m = XManifest; if (m == null) return;
            var pick = ReadExtrasChoices();
            GameRunning = Extras.GameRunning();
            var auto = Consents.Decision(Consent, "restart") == "allow";
            var plan = Extras.PressApply(m, pick, GameRunning, auto);
            if (plan.Route == "nothing") { ExtrasStatus.Text = plan.Say; ShowExtras(); return; }
            var route = plan.Route;
            if (route == "ask_restart")
            {
                var ans = ShowAsk(ExtrasText.RestartQuestion, ExtrasText.RestartWhy, ExtrasText.RestartAllNote);
                Extras.XLog("apply: restart choice: " + ans);
                if (ans == "all") { Consents.SetAnswer(Consent, "restart", "allow", 1); Consents.Save(Env.ConsentPath, Consent); ans = "yes"; }
                if (ans != "yes")
                {
                    ExtrasStatus.Text = Extras.QueueForLater(plan.State, pick);
                    ShowExtras();
                    return;
                }
                route = "restart";
            }
            if (route == "restart") { StartFlow(RestartFlow.Start(m, plan.State, pick, true)); return; }
            // the game is closed: install now, check, then ask to start it
            AfterInstall(Extras.InstallNow(m, plan.State, pick));
        }

        // Install-Now's ending (Apply with the game closed, or a queued install the moment it closed).
        void AfterInstall(InstallOutcome o)
        {
            if (Tabs.SelectedItem == ExtrasTab) ShowExtras();
            if (o.Say != null) { ExtrasStatus.Text = o.Say; return; }
            if (!o.StartNext) return;
            // planner H: Start the game now? Yes / Later / Allow all
            var auto = Consents.Decision(Consent, "launch") == "allow";
            if (Extras.AfterInstall(auto) == "ask_start")
            {
                var ans = ShowAsk(ExtrasText.StartQuestion, ExtrasText.StartWhy, ExtrasText.StartAllNote);
                Extras.XLog("apply: start the game? " + ans);
                if (ans == "all") { Consents.SetAnswer(Consent, "launch", "allow", 1); Consents.Save(Env.ConsentPath, Consent); ans = "yes"; }
                if (ans != "yes") { ExtrasStatus.Text = ExtrasText.InstalledLater; return; }
            }
            // 2.1.0: the game starts the way Play starts it: every mod checked first
            ExtrasStatus.Text = Extras.StartAfterInstall(() => RequestPlay("relaunch after Apply"));
        }

        // Yes with the game running: close it, install, check, start it again. One stage per tick of the timer, so the
        // window never freezes while the game takes its time to close.
        void StartFlow(RestartFlow f)
        {
            if (f == null) return;
            Flow = f;
            ProgressBox.Children.Clear(); ProgressBox.Visibility = Visibility.Visible;
            ApplyButton.IsEnabled = false;
            foreach (var p in f.Progress) AddProgress(p);
        }
        void AddProgress(string text) => ProgressBox.Children.Add(NewText(text, 13, "SemiBold", "#1A5FB4"));
        void StepFlow()
        {
            var f = Flow;
            var hadSay = f.Say != null;
            var line = f.Step(() => RequestPlay("restart after Apply"));   // 2.1.0: through Play, so every mod is checked first
            if (line != null) AddProgress(line);
            if (!hadSay && f.Say != null) ExtrasStatus.Text = f.Say;
            if (f.Finished)
            {
                Flow = null;
                ApplyButton.IsEnabled = true;
                ShowExtras();
            }
        }

        void OnHeadline(string action = "")
        {
            if (string.IsNullOrEmpty(action)) action = HeadlineButton.Tag as string ?? "";
            if (action == "play") { Tabs.SelectedItem = PlayTab; if (Mode == "idle") StartRun(); return; }
            if (action == "restart") StartFlow(Extras.RestartForQueue(XManifest));
        }

        // A question with Yes / Later / Allow all.
        public Window MakeAsk(string question, string why, string allNote)
        {
            var d = (Window)XamlReader.Parse(AppWindow.AskXaml);
            try { if (Window.IsVisible) d.Owner = Window; } catch { }
            ((TextBlock)d.FindName("Q")).Text = question;
            ((TextBlock)d.FindName("Why")).Text = why;
            ((TextBlock)d.FindName("AllNote")).Text = allNote;
            AskAnswer = "later";
            ((Button)d.FindName("Yes")).Click += (s, e) => { AskAnswer = "yes"; d.Close(); };
            ((Button)d.FindName("Later")).Click += (s, e) => { AskAnswer = "later"; d.Close(); };
            ((Button)d.FindName("All")).Click += (s, e) => { AskAnswer = "all"; d.Close(); };
            return d;
        }
        /// <summary>Show-Ask: "yes", "later" or "all" (closing it is Later).</summary>
        string ShowAsk(string question, string why, string allNote)
        {
            var d = MakeAsk(question, why, allNote);
            d.ShowDialog();
            return AskAnswer;
        }
    }
}

using System;
using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.4.0 (docs/21): the look. The deepslate ground, the banner with the name and the server pill, the Vote tab's
    /// badge, the blocks' text fitted to their label, the coloured stripe on a card. Colours come from Theme only.
    /// </summary>
    sealed partial class AppUi
    {
        Grid Hero;
        Image HeroImage;
        Rectangle GroundTile, HeroShade;
        Border HeroStatus, LogoFallback, VoteBadge;
        Ellipse HeroDot;
        TextBlock HeroLine, VoteBadgeText, PlayChangedDetail;
        string ChangedDetailText;   // the files a run changed, by name (Engine.ChangedDetail)
        TextBlock lastLog;          // the Log tab's last line, drawn in Fg

        void WireLook()
        {
            var w = Window;
            T F<T>(string n) where T : class => w.FindName(n) as T ?? throw new InvalidOperationException("the window has no " + n);
            Hero = F<Grid>("Hero"); HeroImage = F<Image>("HeroImage"); GroundTile = F<Rectangle>("GroundTile"); HeroShade = F<Rectangle>("HeroShade");
            HeroStatus = F<Border>("HeroStatus"); VoteBadge = F<Border>("VoteBadge");
            HeroDot = F<Ellipse>("HeroDot"); HeroLine = F<TextBlock>("HeroLine"); VoteBadgeText = F<TextBlock>("VoteBadgeText");
            PlayChangedDetail = F<TextBlock>("PlayChangedDetail");
            HeroShade.Fill = Theme.HeroShade;
            LogoFallback.Background = Theme.LogoFace;
            var tile = AppWindow.Picture(Assets.PathOf(Env.AppHome, Assets.Tile));
            if (tile != null) GroundTile.Fill = new ImageBrush(tile) { TileMode = TileMode.Tile, Viewport = new Rect(0, 0, 48, 48), ViewportUnits = BrushMappingMode.Absolute, Stretch = Stretch.Fill };
            HeroImage.Source = AppWindow.Picture(Assets.PathOf(Env.AppHome, Assets.Hero));
            // Play and Vote in the display face; a long label ("Vote first, it takes ten seconds") in Segoe UI so the row fits
            var content = DependencyPropertyDescriptor.FromProperty(ContentControl.ContentProperty, typeof(Button));
            foreach (var b in new[] { PlayButton, VoteButton }) { var btn = b; content.AddValueChanged(btn, (s, e) => FitBlock(btn)); FitBlock(btn); }
            SetHero(null, "Dim", "Asking the site...");
        }

        /// <summary>Labels up to this long are drawn in the display face; longer ones in Segoe UI SemiBold 15.</summary>
        public const int BlockFaceMaxChars = 14;

        static void FitBlock(Button b)
        {
            var t = b.Content as string ?? "";
            if (t.Length <= BlockFaceMaxChars) { b.ClearValue(Control.FontFamilyProperty); b.ClearValue(Control.FontSizeProperty); b.ClearValue(Control.FontWeightProperty); }
            else { b.FontFamily = new FontFamily("Segoe UI"); b.FontSize = 15; b.FontWeight = FontWeights.SemiBold; }
        }

        /// <summary>The pill on the banner: what ShowServer writes on the Play tab, shortened (SiteHome.HeroLine).</summary>
        void SetHero(HomeInfo h, string dot = null, string line = null)
        {
            HeroDot.Fill = Theme.Brush(dot ?? SiteHome.HeroDot(h));
            HeroLine.Text = line ?? SiteHome.HeroLine(h);
        }

        /// <summary>The Vote tab's badge: how many votes wait, hidden when none.</summary>
        void UpdateVoteBadge()
        {
            var n = PendingVotes.Count;
            var text = n.ToString();
            if (VoteBadgeText.Text != text) VoteBadgeText.Text = text;
            var v = n > 0 ? Visibility.Visible : Visibility.Collapsed;
            if (VoteBadge.Visibility != v) VoteBadge.Visibility = v;
        }

        /// <summary>"Since last time" in its own card (docs/21 §4): what a run changed, and under it the files by name.</summary>
        void ShowChanged()
        {
            if (string.IsNullOrEmpty(Changed)) return;
            PlayChanged.Text = Changed; PlayChanged.Visibility = Visibility.Visible;
            PlayChangedDetail.Text = ChangedDetailText ?? "";
            PlayChangedDetail.Visibility = string.IsNullOrEmpty(ChangedDetailText) ? Visibility.Collapsed : Visibility.Visible;
        }

        /// <summary>A footer part (docs/21 §4): the label ("App", "Pack", "Server:") in Dim, the value in Muted, or the whole
        /// value in Copper when the pack has an update.</summary>
        static void FooterLine(TextBlock t, string text, string tone)
        {
            text = text ?? "";
            var cut = text.IndexOf(' ');
            t.Inlines.Clear();
            if (cut < 0) { t.Inlines.Add(new System.Windows.Documents.Run(text) { Foreground = Theme.Brush("Muted") }); return; }
            t.Inlines.Add(new System.Windows.Documents.Run(text.Substring(0, cut + 1)));
            t.Inlines.Add(new System.Windows.Documents.Run(text.Substring(cut + 1)) { Foreground = Theme.Brush(tone == "Copper" ? "Copper" : "Muted") });
        }

        /// <summary>The Log tab (docs/21 §4): every line Muted, the last one Fg; error lines stay Red, good ones GreenText.</summary>
        void MarkLastLog()
        {
            if (lastLog != null) lastLog.Foreground = Theme.Brush(UiText.LogTone(lastLog.Text, false));
            lastLog = LogList.Items.Count > 0 ? LogList.Items[LogList.Items.Count - 1] as TextBlock : null;
            if (lastLog != null) lastLog.Foreground = Theme.Brush(UiText.LogTone(lastLog.Text, true));
        }

        /// <summary>A card's tone (docs/21 §3): no tinted boxes; the card stays a card and a 3 px stripe on its left says
        /// ok (GreenText), later (Amber), failed (Red) or a step (Blue). Null: the plain card with its 1 px Line.</summary>
        static void Stripe(Border b, string key)
        {
            if (key == null) { b.BorderBrush = Theme.Brush("Line"); b.BorderThickness = new Thickness(1); }
            else { b.BorderBrush = Theme.Brush(key); b.BorderThickness = new Thickness(3, 0, 0, 0); }
        }

        // ---- for the window tests ---------------------------------------------------------------------------------------
        internal double HeroHeightNow => Hero.Height;
        internal bool GroundTiled => GroundTile.Fill is ImageBrush ib && ib.TileMode == TileMode.Tile;
        internal bool HeroPictured => HeroImage.Source != null;
        internal bool BrandShown => BrandBar.Visibility == Visibility.Visible;
        internal bool LogoFallbackShown => LogoFallback.Visibility == Visibility.Visible;
        internal bool BrandLogoShown => BrandLogo.Visibility == Visibility.Visible;
        internal string HeroLineText => HeroLine.Text;
        internal Color HeroDotColour => (HeroDot.Fill as SolidColorBrush)?.Color ?? Colors.Transparent;
        internal bool VoteBadgeShown => VoteBadge.Visibility == Visibility.Visible;
        internal string VoteBadgeNumber => VoteBadgeText.Text;
        public void SimChanged(string text, string detail = null) { Changed = text; ChangedDetailText = detail; ShowChanged(); }
        internal int OptionBoxesDrawn
        {
            get
            {
                int n = 0;
                foreach (var b in FindPicks(VoteBody)) if (ReferenceEquals(b.Style, Window.TryFindResource("PickBox"))) n++;
                return n;
            }
        }
        internal Color LastLogColour => (lastLog?.Foreground as SolidColorBrush)?.Color ?? Colors.Transparent;
        internal string ChangedDetailNow => PlayChangedDetail.Visibility == Visibility.Visible ? PlayChangedDetail.Text : null;
        internal void SimSiteDown() { homeSim = true; SiteNow = null; SetHero(null); }
    }

    public static partial class AppWindow
    {
        /// <summary>A window from its XAML, with Theme's brushes and the display face in its resources.</summary>
        public static Window Load(string xaml)
        {
            var w = (Window)System.Windows.Markup.XamlReader.Parse(xaml);
            Theme.Apply(w.Resources);
            return w;
        }

        /// <summary>The banner's height, always (3.4.1, docs/21 §11: the 160/110 rule went with the landscape window).</summary>
        public const double BannerHeight = 128;

        /// <summary>The Vote tab's options and the Extras tab's rows, two to a row (docs/21 §11: the window is never under
        /// 900 wide). Cards keep their 8 px gap under them and get 8 px on the right; the grid hands that back.</summary>
        public const int CardColumns = 2;

        public static System.Windows.Controls.Primitives.UniformGrid CardGrid()
            => new System.Windows.Controls.Primitives.UniformGrid { Columns = CardColumns, Margin = new Thickness(0, 0, -8, 0) };

        public static T InGrid<T>(T card) where T : FrameworkElement
        {
            var m = card.Margin; card.Margin = new Thickness(m.Left, m.Top, 8, m.Bottom);
            return card;
        }

        /// <summary>The pictures and the display face from &lt;home&gt;\assets\ (docs/21 §5), written there first when needed. When
        /// they cannot be, the window uses Segoe UI and says so once in the log; nothing else changes.</summary>
        public static Assets.Outcome PrepareAssets(string home)
        {
            var o = Assets.Ensure(home, Env.Version);
            Theme.PixelFont = new FontFamily("Segoe UI");
            if (!o.Ready) { Log.Line("Pixel font not available: " + (o.Why ?? "the files are missing")); return o; }
            try
            {
                var dir = Assets.Dir(home).TrimEnd('\\', '/') + System.IO.Path.DirectorySeparatorChar;
                Theme.PixelFont = new FontFamily(new Uri(dir), "./#" + Assets.FontName);
                if (o.Why != null) Log.Line("assets: not refreshed (" + o.Why + "); the ones from before are used");
                Log.Line(Assets.FontsLogLine);
            }
            catch (Exception e) { Theme.PixelFont = new FontFamily("Segoe UI"); o.Ready = false; Log.Line("Pixel font not available: " + e.Message); }
            return o;
        }

        /// <summary>A picture read whole (never held open), or null when it is not there or not a picture.</summary>
        public static BitmapImage Picture(string file)
        {
            try
            {
                if (!File.Exists(file)) return null;
                var b = new BitmapImage();
                b.BeginInit(); b.CacheOption = BitmapCacheOption.OnLoad; b.StreamSource = new MemoryStream(File.ReadAllBytes(file)); b.EndInit();
                b.Freeze();
                return b;
            }
            catch (Exception e) { Log.Line("window: " + System.IO.Path.GetFileName(file) + " could not be shown: " + e.Message); return null; }
        }
    }
}

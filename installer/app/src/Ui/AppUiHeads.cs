using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.4.0 (docs/21 §7): a 24 px head before each name in "Online now". The grey placeholder shows at once; the real
    /// head comes from this app's own site (GET /api/app/head/&lt;uuid&gt;.png, which fetches it from Crafatar) and replaces
    /// it when it arrives. A head that cannot be fetched keeps the placeholder and is logged once.
    /// </summary>
    sealed partial class AppUi
    {
        StackPanel OnlineHeads => LivePane.OnlineHeads;   // 3.6.1: the live server's players (the test card has a count)
        readonly Dictionary<string, BitmapSource> headPics = new Dictionary<string, BitmapSource>(StringComparer.OrdinalIgnoreCase);
        readonly HashSet<string> headAsked = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly HashSet<string> headFailed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        List<OnlinePlayer> headsShown = new List<OnlinePlayer>();
        static BitmapSource headPlaceholder;

        void WireHeads() { }   // 3.6.1: the heads' row is the live Play view's own (PlayPane)

        /// <summary>The placeholder from the exe (branding/launcher/head-placeholder.png); null when it is not there.</summary>
        static BitmapSource HeadPlaceholder()
        {
            if (headPlaceholder != null) return headPlaceholder;
            try
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("assets/head-placeholder.png"))
                {
                    if (s == null) return null;
                    var ms = new MemoryStream(); s.CopyTo(ms); ms.Position = 0;
                    var b = new BitmapImage(); b.BeginInit(); b.CacheOption = BitmapCacheOption.OnLoad; b.StreamSource = ms; b.EndInit(); b.Freeze();
                    headPlaceholder = b;
                }
            }
            catch (Exception e) { Log.Line("window: the head placeholder could not be read: " + e.Message); }
            return headPlaceholder;
        }

        /// <summary>The heads for who is online now (SiteHome.HeadsFor). Redrawn only when the players change, so the
        /// row does not flicker every 10 s.</summary>
        void ShowHeads(HomeInfo h)
        {
            var players = SiteHome.HeadsFor(h);
            var same = players.Count == headsShown.Count && players.Zip(headsShown, (a, b) => a.Name == b.Name && a.Uuid == b.Uuid).All(x => x);
            if (!same) { headsShown = players; DrawHeads(); }
            foreach (var p in players) if (p.Uuid != null) FetchHead(p.Uuid);
        }

        void DrawHeads()
        {
            OnlineHeads.Children.Clear();
            foreach (var p in headsShown)
            {
                var pic = p.Uuid != null && headPics.TryGetValue(p.Uuid, out var got) ? got : HeadPlaceholder();
                var img = new Image { Width = 24, Height = 24, Source = pic, Stretch = Stretch.Fill };
                RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.NearestNeighbor);   // pixel art stays crisp
                OnlineHeads.Children.Add(new Border { BorderBrush = Theme.Brush("Black"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(2), Margin = new Thickness(0, 0, 6, 0), Child = img, ToolTip = p.Name, Tag = p.Uuid });
            }
            OnlineHeads.Visibility = headsShown.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>Once per player per window: the site answers a real head or its placeholder (both are PNGs).</summary>
        void FetchHead(string uuid)
        {
            if (homeSim || !SiteHome.IsUuid(uuid) || !headAsked.Add(uuid)) return;
            var d = Window.Dispatcher;
            new Thread(() =>
            {
                string tmp = null;
                try
                {
                    tmp = Path.GetTempFileName();
                    Http.Download(SiteHome.HeadUrl(uuid), tmp, 15);
                    var bytes = File.ReadAllBytes(tmp);
                    d.BeginInvoke(new Action(() => GotHead(uuid, bytes)));
                }
                catch (Exception e) { d.BeginInvoke(new Action(() => HeadFailed(uuid, e.Message))); }
                finally { try { if (tmp != null) File.Delete(tmp); } catch { } }
            }) { IsBackground = true, Name = "head" }.Start();
        }

        void GotHead(string uuid, byte[] bytes)
        {
            try
            {
                var b = new BitmapImage(); b.BeginInit(); b.CacheOption = BitmapCacheOption.OnLoad; b.StreamSource = new MemoryStream(bytes); b.EndInit(); b.Freeze();
                headPics[uuid] = b;
                foreach (var border in OnlineHeads.Children.OfType<Border>())
                    if (string.Equals(border.Tag as string, uuid, StringComparison.OrdinalIgnoreCase) && border.Child is Image img) img.Source = b;
            }
            catch (Exception e) { HeadFailed(uuid, "not a picture (" + e.Message + ")"); }
        }

        /// <summary>The placeholder stays; the log says so once per player.</summary>
        void HeadFailed(string uuid, string why)
        {
            if (headFailed.Add(uuid)) Log.Line(string.Format("window: a player's head could not be fetched ({0}): {1}", uuid, why));
        }

        // ---- for the window tests ---------------------------------------------------------------------------------------
        internal int HeadsDrawn => OnlineHeads.Visibility == Visibility.Visible ? OnlineHeads.Children.Count : 0;
        internal bool HeadIsPlaceholder(int i) => ((OnlineHeads.Children[i] as Border)?.Child as Image)?.Source == HeadPlaceholder();
        internal void SimGotHead(string uuid, byte[] png) => GotHead(uuid, png);
        internal void SimHeadFailed(string uuid, string why) => HeadFailed(uuid, why);
    }
}

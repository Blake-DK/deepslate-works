using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Media;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.4.0 (docs/21 §3): every colour of the window, by name. The only file under Ui/ with a hex colour in it; everything
    /// else asks for a key ("Card", "Muted", "Copper"...). The brushes are frozen and go into each window's resources
    /// (Apply), where the XAML reaches them as {DynamicResource Key}.
    /// </summary>
    public static class Theme
    {
        // The portal's dark theme plus the deepslate greys (docs/21 §3). Deviations from the spec's table, so that every
        // text/background pair reaches 4.5:1 (ThemeTests): Dim #6F6D66 -> #908D85 (it was 3.6:1 on Panel), Red #E5484D ->
        // #F06A6E (4.1:1 on Card), DisabledText #A09D95 -> #BDBAB3 (3.6:1 on Disabled), and the Vote block's text is
        // OnCopper, not white (white on Copper is 2.7:1).
        static readonly string[][] Table =
        {
            new[] { "Ground", "#16171A" },      // the window, under the tile
            new[] { "Panel", "#121316" },       // tab strip, footer
            new[] { "Card", "#202226" },        // every box
            new[] { "Card2", "#262930" },       // the Plain buttons' face, raised cards, badges
            new[] { "Line", "#33363C" },        // borders, dividers
            new[] { "Fg", "#F2F0EB" },          // body text (3.4.1, docs/21 §11: was #EBE9E4)
            new[] { "Muted", "#B5B2AA" },       // secondary text, hints (3.4.1: was #A09D95; 8.6:1 on Card)
            new[] { "Dim", "#908D85" },         // footer, timestamps
            new[] { "Copper", "#E8833A" },      // tagline, tab underline, Vote, badge, "update available"
            new[] { "CopperHi", "#FFB26B" },
            new[] { "CopperLo", "#B8652C" },
            new[] { "OnCopper", "#16171A" },    // text on a copper face (the Vote block, the tab badge)
            new[] { "Green", "#2E7D5B" },       // the Play face
            new[] { "GreenHi", "#3A9A70" },
            new[] { "GreenLo", "#1F5C42" },
            new[] { "GreenText", "#8FD4B3" },   // green text on a dark card (Green itself is too dark for text)
            new[] { "Blue", "#6AA7E6" },        // links, step labels
            new[] { "Red", "#F06A6E" },         // errors
            new[] { "Amber", "#F2B35C" },       // waiting, later, warnings
            new[] { "Disabled", "#3E444D" },    // a shut block's face; the Plain blocks' highlight
            new[] { "DisabledText", "#BDBAB3" },
            new[] { "White", "#FFFFFF" },
            new[] { "Black", "#000000" },       // the blocks' outline and drop
            new[] { "Shadow", "#1C1F24" },      // the name's shadow on the banner, the vote's check box
            new[] { "BoxLine", "#565C66" },     // the vote's check box, the drawn logo's frame
            new[] { "LogoLo", "#23272D" },      // the drawn logo's gradient, with Disabled
            new[] { "HeroFade", "#D90A0C10" },  // the banner's bottom, so the name reads on any part of the picture
            new[] { "Pill", "#C70C0D10" },      // the server pill on the banner
        };

        static readonly Dictionary<string, SolidColorBrush> brushes = Table.ToDictionary(r => r[0], r => Freeze(r[1]), StringComparer.Ordinal);

        static SolidColorBrush Freeze(string hex)
        {
            var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            b.Freeze();
            return b;
        }

        /// <summary>Every colour's key, in the table's order.</summary>
        public static IEnumerable<string> Keys => Table.Select(r => r[0]);

        public static bool Has(string key) => key != null && brushes.ContainsKey(key);

        /// <summary>The frozen brush for a key; an unknown key gets Fg (never an exception in the middle of drawing).</summary>
        public static SolidColorBrush Brush(string key) => key != null && brushes.TryGetValue(key, out var b) ? b : brushes["Fg"];

        public static Color ColorOf(string key) => Brush(key).Color;

        /// <summary>The display face (Pixelify Sans) once Assets has written it out; Segoe UI until then or when it could
        /// not be (docs/21 §5).</summary>
        public static FontFamily PixelFont = new FontFamily("Segoe UI");

        /// <summary>Every brush, and PixelFont, into a window's resources.</summary>
        public static void Apply(ResourceDictionary r)
        {
            foreach (var kv in brushes) r[kv.Key] = kv.Value;
            r["PixelFont"] = PixelFont;
        }

        /// <summary>The banner's shade: clear down to 40 %, then HeroFade at the bottom, so the name reads on any part of
        /// the picture.</summary>
        public static readonly LinearGradientBrush HeroShade = Gradient(new Point(0, 0), new Point(0, 1),
            Color.FromArgb(0, ColorOf("HeroFade").R, ColorOf("HeroFade").G, ColorOf("HeroFade").B), 0.4, ColorOf("HeroFade"), 1);

        /// <summary>The drawn logo's face (LogoFallback), top left to bottom right.</summary>
        public static readonly LinearGradientBrush LogoFace = Gradient(new Point(0, 0), new Point(1, 1), ColorOf("Disabled"), 0, ColorOf("LogoLo"), 1);

        static LinearGradientBrush Gradient(Point from, Point to, Color a, double at, Color b, double bt)
        {
            var g = new LinearGradientBrush { StartPoint = from, EndPoint = to };
            g.GradientStops.Add(new GradientStop(a, at));
            g.GradientStops.Add(new GradientStop(b, bt));
            g.Freeze();
            return g;
        }

        /// <summary>The server's dot by the site's tone: up green, waking copper, off or unknown dim, unreachable red.</summary>
        public static string ToneKey(string tone)
            => tone == "good" ? "GreenHi" : tone == "info" ? "Blue" : tone == "warn" ? "Copper" : tone == "bad" ? "Red" : "Dim";

        /// <summary>The WCAG 2 contrast ratio of two keys' colours (1 to 21).</summary>
        public static double Contrast(string a, string b)
        {
            double l1 = Luminance(ColorOf(a)), l2 = Luminance(ColorOf(b));
            return (Math.Max(l1, l2) + 0.05) / (Math.Min(l1, l2) + 0.05);
        }

        /// <summary>The same for two colours (the window test that reads every text on every tab).</summary>
        public static double Contrast(Color a, Color b)
        {
            double l1 = Luminance(a), l2 = Luminance(b);
            return (Math.Max(l1, l2) + 0.05) / (Math.Min(l1, l2) + 0.05);
        }

        static double Luminance(Color c)
        {
            double Lin(byte v) { var s = v / 255.0; return s <= 0.03928 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4); }
            return 0.2126 * Lin(c.R) + 0.7152 * Lin(c.G) + 0.0722 * Lin(c.B);
        }
    }
}

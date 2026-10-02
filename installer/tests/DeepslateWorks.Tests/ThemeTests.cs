using System;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.4.0 (docs/21 §3, §8): every colour in one class, readable on its background, and nothing a weak PC pays for.
    public class ThemeTests
    {
        /// <summary>installer/app/src, from where this file was compiled (the checkout the tests run in).</summary>
        static string Src([CallerFilePath] string me = "") => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(me), "..", "..", "app", "src"));

        static readonly string[] SpecKeys =
        {
            "Ground", "Panel", "Card", "Card2", "Line", "Fg", "Muted", "Dim", "Copper", "CopperHi", "CopperLo",
            "Green", "GreenHi", "GreenLo", "GreenText", "Blue", "Red", "Amber", "Disabled", "DisabledText",
        };

        [Fact] public void Every_key_of_docs_21_is_in_Theme_and_frozen()
        {
            foreach (var k in SpecKeys) { Assert.True(Theme.Has(k), k); Assert.True(Theme.Brush(k).IsFrozen, k); }
            foreach (var k in Theme.Keys) Assert.True(Theme.Brush(k).IsFrozen, k);
            Assert.Equal(Theme.Brush("Fg"), Theme.Brush("no such key"));   // never an exception while drawing
        }

        [Fact] public void No_colour_is_written_anywhere_under_Ui_or_in_ExtrasApp_but_Theme()
        {
            var src = Src();
            Assert.True(File.Exists(Path.Combine(src, "Ui", "Theme.cs")), "the sources are not at " + src);
            var files = Directory.GetFiles(Path.Combine(src, "Ui"), "*.cs", SearchOption.AllDirectories)
                .Where(f => !string.Equals(Path.GetFileName(f), "Theme.cs", StringComparison.OrdinalIgnoreCase))
                .Concat(new[] { Path.Combine(src, "Extras", "ExtrasApp.cs") });
            var hex = new Regex(@"#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?\b|""#[0-9A-Fa-f]{3}""");
            var found = files.SelectMany(f => File.ReadAllLines(f).Select((l, i) => new { f, i, l }))
                .Where(x => hex.IsMatch(x.l)).Select(x => string.Format("{0}:{1}: {2}", Path.GetFileName(x.f), x.i + 1, x.l.Trim())).ToList();
            Assert.True(found.Count == 0, "colours outside Theme.cs:\n" + string.Join("\n", found));
        }

        [Fact] public void No_effect_classes_anywhere_in_the_app()
        {
            var effects = new Regex(@"\b(DropShadowEffect|BlurEffect)\b");
            var found = Directory.GetFiles(Src(), "*.cs", SearchOption.AllDirectories).Where(f => effects.IsMatch(File.ReadAllText(f))).Select(Path.GetFileName).ToList();
            Assert.True(found.Count == 0, "effects in: " + string.Join(", ", found));
        }

        // every text colour on every background it is drawn on (docs/21 §3), WCAG 2: at least 4.5:1
        static readonly string[][] Pairs =
        {
            new[] { "Fg", "Ground" }, new[] { "Fg", "Panel" }, new[] { "Fg", "Card" }, new[] { "Fg", "Card2" },
            new[] { "Muted", "Ground" }, new[] { "Muted", "Panel" }, new[] { "Muted", "Card" }, new[] { "Muted", "Card2" },
            new[] { "Dim", "Panel" }, new[] { "Dim", "Card" }, new[] { "Dim", "Ground" },
            new[] { "GreenText", "Card" }, new[] { "GreenText", "Card2" }, new[] { "GreenText", "Ground" },
            new[] { "Blue", "Card" }, new[] { "Blue", "Card2" }, new[] { "Blue", "Ground" },
            new[] { "Red", "Card" }, new[] { "Red", "Card2" }, new[] { "Red", "Ground" }, new[] { "Red", "Panel" },
            new[] { "Amber", "Card" }, new[] { "Amber", "Card2" },
            new[] { "Copper", "Panel" }, new[] { "Copper", "Card" }, new[] { "CopperHi", "Ground" },
            new[] { "White", "Green" }, new[] { "White", "Panel" }, new[] { "OnCopper", "Copper" },
            new[] { "DisabledText", "Disabled" },
        };

        [Fact] public void Every_text_and_background_pair_is_at_least_4_5_to_1()
        {
            var low = Pairs.Select(p => new { p, r = Theme.Contrast(p[0], p[1]) }).Where(x => x.r < 4.5)
                .Select(x => string.Format("{0} on {1}: {2:0.00}", x.p[0], x.p[1], x.r)).ToList();
            Assert.True(low.Count == 0, string.Join("\n", low));
            Assert.Equal(21.0, Theme.Contrast("White", "Black"), 1);   // the formula itself
        }

        [Fact] public void The_server_dot_follows_the_site_tone_and_state()
        {
            Assert.Equal("GreenHi", Theme.ToneKey("good"));
            Assert.Equal("Copper", Theme.ToneKey("warn"));
            Assert.Equal("Red", Theme.ToneKey("bad"));
            Assert.Equal("Dim", Theme.ToneKey("neutral"));
            Assert.Equal("GreenHi", SiteHome.HeroDot(SiteHome.Parse(Json.Parse(HomeSamples.Up))));
            Assert.Equal("Copper", SiteHome.HeroDot(SiteHome.Parse(Json.Parse(HomeSamples.Waking))));
            Assert.Equal("Dim", SiteHome.HeroDot(SiteHome.Parse(Json.Parse(HomeSamples.Asleep))));
            Assert.Equal("Dim", SiteHome.HeroDot(SiteHome.Parse(Json.Parse(HomeSamples.OffAdmin))));
            Assert.Equal("Red", SiteHome.HeroDot(null));
        }

        [Fact] public void The_banner_pill_says_the_server_line_shortened()
        {
            Assert.Equal("Server is up · 2 playing", SiteHome.HeroLine(SiteHome.Parse(Json.Parse(HomeSamples.Up))));
            Assert.Equal("Server is asleep", SiteHome.HeroLine(SiteHome.Parse(Json.Parse(HomeSamples.Asleep))));
            Assert.Equal("Waking, about 30 s", SiteHome.HeroLine(SiteHome.Parse(Json.Parse(HomeSamples.Waking))));
            Assert.Equal("Server: Switched off", SiteHome.HeroLine(SiteHome.Parse(Json.Parse(HomeSamples.OffAdmin))));
            Assert.Equal("Can't reach the site", SiteHome.HeroLine(null));
        }

        [Fact] public void The_banner_is_160_tall_and_110_in_a_short_window()
        {
            Assert.Equal(160, AppWindow.HeroHeight(740));
            Assert.Equal(160, AppWindow.HeroHeight(660));
            Assert.Equal(110, AppWindow.HeroHeight(600));
            Assert.Equal(110, AppWindow.HeroHeight(560));
        }

        [Fact] public void Every_window_carries_the_shared_styles_and_no_colour()
        {
            foreach (var x in new[] { AppWindow.AppXaml, AppWindow.AskXaml, AppWindow.SettingsXaml })
            {
                Assert.Contains("x:Key=\"Primary\"", x);
                Assert.Contains("x:Key=\"Plain\"", x);
                Assert.DoesNotMatch(new Regex(@"=""#[0-9A-Fa-f]{3,8}"""), x);
            }
            Assert.Contains("Style=\"{StaticResource PlayBlock}\"", AppWindow.AppXaml);
            Assert.Contains("Style=\"{StaticResource VoteBlock}\"", AppWindow.AppXaml);
        }
    }
}

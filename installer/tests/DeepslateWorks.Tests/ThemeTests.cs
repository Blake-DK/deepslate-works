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
            // 3.5.0 (docs/30): the Settings tab's words are pairs above (Fg, Muted, Copper and Dim on Card; Muted, GreenText
            // and Red on Ground for the status line); new are the tick and the dot of a switch and a choice
            new[] { "CopperHi", "Shadow" },
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

        [Fact] public void The_banner_is_128_tall_always()
        {
            Assert.Equal(128, AppWindow.BannerHeight);
            Assert.Contains("x:Name=\"Hero\" DockPanel.Dock=\"Top\" Height=\"128\"", AppWindow.AppXaml);
        }

        [Fact] public void The_window_is_landscape_with_crisp_text()
        {
            // 3.4.1 (docs/21 §11): landscape, never under 900x560 (3.5.3: 980x720, so the Play steps fit); Display formatting, ClearType, layout rounding
            var x = AppWindow.AppXaml;
            Assert.Contains("Width=\"980\" Height=\"720\" MinWidth=\"900\" MinHeight=\"560\"", x);
            foreach (var w in new[] { AppWindow.AppXaml, AppWindow.AskXaml })
            {
                Assert.Contains("FontSize=\"14\"", w);
                Assert.Contains("TextOptions.TextFormattingMode=\"Display\" TextOptions.TextRenderingMode=\"ClearType\" UseLayoutRounding=\"True\" SnapsToDevicePixels=\"True\"", w);
            }
        }

        [Fact] public void The_pixel_face_is_named_only_for_the_name_Play_and_Vote_and_drawn_aliased()
        {
            // in the XAML: the name and its shadow, the PlayBlock and VoteBlock styles; each one aliased (square pixels)
            var x = AppWindow.AppXaml;
            var uses = Regex.Matches(x, @"\{DynamicResource PixelFont\}").Count;
            Assert.Equal(4, uses);
            foreach (Match m in Regex.Matches(x, @"\{DynamicResource PixelFont\}"))
            {
                var after = x.Substring(m.Index, Math.Min(120, x.Length - m.Index));
                Assert.Matches(@"TextOptions\.TextRenderingMode""*( Value)?=""+Aliased", after);
            }
            foreach (var key in new[] { "x:Name=\"BrandName\"", "x:Name=\"BrandShade\"" })
                Assert.Matches(new Regex(Regex.Escape(key) + @"[^>]*\{DynamicResource PixelFont\}"), x);
            // nothing in code sets the face on anything
            var code = Directory.GetFiles(Path.Combine(Src(), "Ui"), "*.cs").Where(f => !f.EndsWith("Theme.cs") && !f.EndsWith("UiXaml.cs") && !f.EndsWith("AppUiLook.cs"))
                .Where(f => File.ReadAllText(f).Contains("PixelFont")).Select(Path.GetFileName).ToList();
            Assert.True(code.Count == 0, "PixelFont used in: " + string.Join(", ", code));
        }

        [Fact] public void The_Update_buttons_mark_is_split_from_its_words()
        {
            Assert.Equal("✓", MarkSplit.Mark("✓ Up to date")); Assert.Equal(" Up to date", MarkSplit.Rest("✓ Up to date"));
            Assert.Equal("●", MarkSplit.Mark("● Update")); Assert.Equal(" Update", MarkSplit.Rest("● Update"));
            Assert.Equal("", MarkSplit.Mark("Updating…")); Assert.Equal("Updating…", MarkSplit.Rest("Updating…"));
            Assert.Equal("", MarkSplit.Mark("Update")); Assert.Equal("", MarkSplit.Mark(null)); Assert.Equal("", MarkSplit.Rest(null));
            foreach (var label in new[] { UpdateCheck.Button(null, false), UpdateCheck.Button(null, true), UpdateCheck.Button(new Waiting { ModsChanged = 1 }, false) })
                Assert.Equal(label, MarkSplit.Mark(label) + MarkSplit.Rest(label));   // nothing lost
        }

        [Fact] public void What_changed_is_named_under_Since_last_time()
        {
            Assert.Equal("fallingtree-1.2.9, jade-15.8, tabtps-1.3 (removed)", Engine.ChangedDetail(new[] { "fallingtree-1.2.9.jar", "jade-15.8.jar" }, new[] { "tabtps-1.3.jar" }));
            Assert.Equal("", Engine.ChangedDetail(new string[0], null));
            Assert.Equal("a, b, c, d, e, f and 2 more", Engine.ChangedDetail(new[] { "a.jar", "b.jar", "c.jar", "d.jar", "e.jar", "f.jar", "g.jar", "h.jar" }, null));
        }

        [Fact] public void Every_window_carries_the_shared_styles_and_no_colour()
        {
            foreach (var x in new[] { AppWindow.AppXaml, AppWindow.AskXaml })
            {
                Assert.Contains("x:Key=\"Primary\"", x);
                Assert.Contains("x:Key=\"Plain\"", x);
                Assert.DoesNotMatch(new Regex(@"=""#[0-9A-Fa-f]{3,8}"""), x);
            }
            Assert.Contains("Style=\"{StaticResource PlayBlock}\"", AppWindow.AppXaml);
            Assert.Contains("Style=\"{StaticResource VoteBlock}\"", AppWindow.AppXaml);
            Assert.Contains("x:Key=\"PickBox\"", AppWindow.AppXaml);
            // 3.5.0: the Settings tab's slider, switch and choice are drawn by the theme, not by Windows
            foreach (var k in new[] { "x:Key=\"Switch\"", "x:Key=\"Choice\"", "x:Key=\"SliderThumb\"", "<Style TargetType=\"Slider\">" }) Assert.Contains(k, AppWindow.AppXaml);
            Assert.Contains("ContentTemplate=\"{StaticResource MarkedLabel}\"", AppWindow.AppXaml);
        }
    }
}

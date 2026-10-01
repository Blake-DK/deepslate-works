using System;
using System.Collections.Generic;
using System.IO;
using Xunit;

namespace DeepslateWorks.Tests
{
    // The self test's "the logo" (2.1.1) and "the footer" (2.1.2) checks, ported to 3.0. Same expected words.

    [Collection("env")]
    public class BrandFooterTests
    {
        static readonly byte[] Ico = { 0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 4, 0, 0, 0, 22, 0, 0, 0, 1, 2, 3, 4 };
        const string Png64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        static JObj BrandBlock(string hash = "0123456789ab", string tagline = "Modded Minecraft with friends") =>
            J.O("hash", hash, "name", "Deepslate Works", "tagline", tagline, "pixel", true, "icon128", Png64);

        [Fact] public void The_logo_is_fetched_from_this_site_by_its_hash_kept_and_used()
        {
            using (var s = new Scratch())
            {
                var dir = s.P("home"); Directory.CreateDirectory(dir);
                var exe = Path.Combine(dir, "DeepslateWorks.exe"); File.WriteAllBytes(exe, new byte[] { 0x4D, 0x5A });
                var asked = new List<string>();
                Func<string, byte[]> fetch = u => { asked.Add(u); return Ico; };

                Assert.Equal("none", Brand.Save(null, dir, fetch));   // no logo picked: nothing fetched, the built-in icon stays
                Assert.Empty(asked); Assert.Equal(exe, Brand.IconFile(exe));

                Assert.Equal("saved", Brand.Save(BrandBlock(), dir, fetch));
                Assert.Equal("https://deepslate.example/brand/logo.ico?v=0123456789ab", asked[0]);
                Assert.True(File.Exists(Path.Combine(dir, "logo.ico"))); Assert.True(File.Exists(Path.Combine(dir, "logo.png")));
                Assert.Equal(Path.Combine(dir, "logo.ico"), Brand.IconFile(exe));   // the shortcuts and Settings -> Apps use it
                Assert.Equal("\"" + Path.Combine(dir, "logo.ico") + "\",0", Home.IconLocation(exe));
                Assert.Equal(Path.Combine(dir, "logo.ico"), Home.ShortcutSpec(exe).IconPath);

                Assert.Equal("same", Brand.Save(BrandBlock(tagline: "New words"), dir, fetch));   // not fetched again; the new tagline kept
                Assert.Single(asked);
                Assert.Equal("New words", J.Str(Brand.ReadMarker(dir), "tagline"));
            }
        }

        [Fact] public void A_hash_that_is_not_one_or_bytes_that_are_not_an_icon_change_nothing()
        {
            using (var s = new Scratch())
            {
                var dir = s.P("home"); Directory.CreateDirectory(dir);
                var asked = new List<string>();
                Assert.Equal("none", Brand.Save(J.O("hash", "../../x"), dir, u => { asked.Add(u); return Ico; }));
                Assert.Empty(asked);
                Assert.StartsWith("failed", Brand.Save(BrandBlock("fffffffffff0"), dir, u => new byte[] { 1, 2, 3 }));
                Assert.False(File.Exists(Path.Combine(dir, "logo.ico")));
            }
        }

        [Fact] public void The_launcher_profile_gets_the_logo_as_a_data_png_or_keeps_its_block()
        {
            Assert.Equal<object>("data:image/png;base64," + Png64, Brand.ProfileIcon(BrandBlock(), "Furnace"));
            Assert.Equal<object>("Furnace", Brand.ProfileIcon(null, "Furnace"));
            Assert.Equal<object>("Furnace", Brand.ProfileIcon(J.O("hash", "0123456789ab", "icon128", "not a png"), "Furnace"));
        }

        [Fact] public void The_footer_says_app_pack_and_server()
        {
            var f1 = Footer.Parts("9.9.9", "0.1.0+aaaa1111", "0.1.0+aaaa1111", "Online");
            Assert.Equal("App 9.9.9", f1.App); Assert.Equal("Pack 0.1.0+aaaa1111", f1.Pack); Assert.Equal("Server: Online", f1.Server); Assert.Equal("#666", f1.PackTone);
            var f2 = Footer.Parts("9.9.9", "0.1.0+aaaa1111", "0.1.0+bbbb2222", "Asleep");
            Assert.EndsWith("Pack update available", f2.Pack); Assert.Equal("#B26A00", f2.PackTone);   // differs from the site's: amber
            var f3 = Footer.Parts("9.9.9", null, "0.1.0+bbbb2222", null);
            Assert.Equal("Pack update available", f3.Pack); Assert.Equal("Server: ?", f3.Server);   // never installed, site not reached
            Assert.Equal("Pack not installed yet", Footer.Parts("9.9.9", null, null, null).Pack);
        }

        [Fact] public void The_window_has_the_logo_bar_and_the_footer()
        {
            foreach (var n in new[] { "BrandBar", "BrandLogo", "BrandName", "BrandTagline", "Footer", "FooterApp", "FooterPack", "FooterServer" })
            {
                Assert.Contains("x:Name=\"" + n + "\"", AppWindow.AppXaml);
                Assert.Contains(n, AppWindow.Names);
            }
        }
    }
}

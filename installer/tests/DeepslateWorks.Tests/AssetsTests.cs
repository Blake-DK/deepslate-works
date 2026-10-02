using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.4.0 (docs/21 §5, §8): the banner, the tile and the font with its licence, written out of the exe to <home>\assets\
    // once per version; a home that cannot take them still opens the window, in Segoe UI.
    [Collection("env")]
    public class AssetsTests
    {
        static readonly DateTime Old = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        static void Age(string home)
        {
            foreach (var f in Assets.Files.Concat(new[] { Assets.VersionFile })) File.SetLastWriteTimeUtc(Assets.PathOf(home, f), Old);
        }

        [Fact] public void A_fresh_home_gets_all_five_files_and_the_version()
        {
            using (new Scratch())
            {
                var o = Assets.Ensure(Env.AppHome, "9.9.9");
                Assert.True(o.Ready); Assert.True(o.Wrote); Assert.Null(o.Why);
                Assert.Equal(5, Assets.Files.Length);
                foreach (var f in Assets.Files) Assert.True(new FileInfo(Assets.PathOf(Env.AppHome, f)).Length > 100, f);
                Assert.Equal("9.9.9", File.ReadAllText(Assets.PathOf(Env.AppHome, Assets.VersionFile)));
                Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, File.ReadAllBytes(Assets.PathOf(Env.AppHome, Assets.Hero)).Take(4).ToArray());
                Assert.Equal(new byte[] { 0, 1, 0, 0 }, File.ReadAllBytes(Assets.PathOf(Env.AppHome, Assets.FontBold)).Take(4).ToArray());
                Assert.Contains("SIL OPEN FONT LICENSE", File.ReadAllText(Assets.PathOf(Env.AppHome, Assets.Licence)));
                Assert.Empty(Directory.GetFiles(Assets.Dir(Env.AppHome), "*.new"));
            }
        }

        [Fact] public void The_same_version_writes_nothing()
        {
            using (new Scratch())
            {
                Assets.Ensure(Env.AppHome, "9.9.9");
                Age(Env.AppHome);
                var o = Assets.Ensure(Env.AppHome, "9.9.9");
                Assert.True(o.Ready); Assert.False(o.Wrote);
                foreach (var f in Assets.Files) Assert.Equal(Old, File.GetLastWriteTimeUtc(Assets.PathOf(Env.AppHome, f)));
            }
        }

        [Fact] public void A_new_version_writes_them_again()
        {
            using (new Scratch())
            {
                Assets.Ensure(Env.AppHome, "3.3.1");
                Age(Env.AppHome);
                var o = Assets.Ensure(Env.AppHome, "3.4.0");
                Assert.True(o.Ready); Assert.True(o.Wrote);
                foreach (var f in Assets.Files) Assert.True(File.GetLastWriteTimeUtc(Assets.PathOf(Env.AppHome, f)) > Old, f);
                Assert.Equal("3.4.0", File.ReadAllText(Assets.PathOf(Env.AppHome, Assets.VersionFile)));
            }
        }

        [Fact] public void A_missing_file_is_written_again_even_with_the_same_version()
        {
            using (new Scratch())
            {
                Assets.Ensure(Env.AppHome, "9.9.9");
                File.Delete(Assets.PathOf(Env.AppHome, Assets.Tile));
                var o = Assets.Ensure(Env.AppHome, "9.9.9");
                Assert.True(o.Wrote); Assert.True(File.Exists(Assets.PathOf(Env.AppHome, Assets.Tile)));
            }
        }

        /// <summary>A home where assets\ cannot be made: a file stands where the folder would go (the same failure as a
        /// read-only folder or an antivirus refusing the write, without changing the runner's permissions).</summary>
        static void Block(string home)
        {
            Directory.CreateDirectory(home);
            File.WriteAllText(Assets.Dir(home), "in the way");
        }

        [Fact] public void A_home_that_cannot_take_them_is_not_an_error()
        {
            using (new Scratch())
            {
                Block(Env.AppHome);
                var o = Assets.Ensure(Env.AppHome, "9.9.9");
                Assert.False(o.Ready); Assert.False(o.Wrote); Assert.False(string.IsNullOrEmpty(o.Why));
            }
        }

        static void OnSta(Action a)
        {
            Exception err = null;
            var t = new Thread(() => { try { a(); } catch (Exception e) { err = e; } finally { System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); } });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            Assert.True(t.Join(TimeSpan.FromMinutes(2)), "the window did not finish");
            if (err != null) throw new Exception("the window failed: " + err, err);
        }

        [WindowsFact] public void Without_the_assets_the_window_opens_in_Segoe_UI_and_says_so_once()
        {
            using (new Scratch())
            {
                Block(Env.AppHome);
                var lines = new List<string>();
                Action<string> grab = l => { lock (lines) lines.Add(l); };
                Log.Written += grab;
                try
                {
                    OnSta(() =>
                    {
                        var ui = new AppUi(new Run(), true);
                        var w = ui.Window;
                        w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                        try
                        {
                            w.Show(); ui.Pump();
                            Assert.Equal("Segoe UI", Theme.PixelFont.Source);
                            Assert.Equal(Theme.PixelFont, w.Resources["PixelFont"]);
                            Assert.False(ui.HeroPictured);
                            Assert.True(ui.BrandShown);
                        }
                        finally { w.Close(); }
                    });
                }
                finally { Log.Written -= grab; }
                lock (lines) Assert.Single(lines.Where(l => l.Contains("Pixel font not available")));
            }
        }

        [WindowsFact] public void With_the_assets_the_window_has_the_display_face_and_the_pictures()
        {
            using (new Scratch())
            {
                var lines = new List<string>();
                Action<string> grab = l => { lock (lines) lines.Add(l); };
                Log.Written += grab;
                try
                {
                    OnSta(() =>
                    {
                        var ui = new AppUi(new Run(), true);
                        var w = ui.Window;
                        w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                        try
                        {
                            w.Show(); ui.Pump();
                            Assert.EndsWith("#" + Assets.FontName, Theme.PixelFont.Source);
                            Assert.True(ui.HeroPictured);
                            Assert.True(ui.GroundTiled);
                        }
                        finally { w.Close(); }
                    });
                }
                finally { Log.Written -= grab; }
                lock (lines) Assert.Contains(lines, l => l.Contains(Assets.FontsLogLine));
            }
        }
    }
}

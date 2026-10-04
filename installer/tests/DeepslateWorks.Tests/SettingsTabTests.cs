using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using Xunit;

namespace DeepslateWorks.Tests
{
    // 3.5.0 (docs/30 §3, §8): the Settings tab in the real window, off screen, drawn from sample files.
    [Collection("env")]
    public class SettingsTabTests
    {
        static void OnSta(Action a)
        {
            Exception err = null;
            var t = new Thread(() => { try { a(); } catch (Exception e) { err = e; } finally { System.Windows.Threading.Dispatcher.CurrentDispatcher.InvokeShutdown(); } });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            Assert.True(t.Join(TimeSpan.FromMinutes(2)), "the window did not finish");
            if (err != null) throw new Exception("the window failed: " + err, err);
        }

        static void WithWindow(Action<AppUi> body)
        {
            var c = new Dictionary<string, ConsentAnswer>();
            foreach (var st in Consents.Steps()) Consents.SetAnswer(c, st.Id, "allow", 1);
            Consents.Save(Env.ConsentPath, c);
            OnSta(() =>
            {
                var ui = new AppUi(new Run(), true);
                var w = ui.Window;
                w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = -20000; w.Top = 0; w.ShowInTaskbar = false;
                try { w.Show(); ui.Pump(); body(ui); }
                finally { w.Close(); }
            });
        }

        static void Resize(AppUi ui, double width, double height)
        {
            ui.Window.Width = width; ui.Window.Height = height;
            ui.Pump(); ui.Window.UpdateLayout(); ui.Pump();
        }

        static string Pack(string dir)
        {
            Directory.CreateDirectory(dir);
            var zip = Path.Combine(dir, GameSettings.VillagerPack);
            if (!File.Exists(zip)) using (System.IO.Compression.ZipFile.Open(zip, System.IO.Compression.ZipArchiveMode.Create)) { }
            return zip;
        }

        static IEnumerable<DependencyObject> Tree(DependencyObject root)
        {
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
            {
                var c = VisualTreeHelper.GetChild(root, i);
                yield return c;
                foreach (var d in Tree(c)) yield return d;
            }
        }

        [WindowsFact] public void The_cog_selects_the_tab_and_stops_a_countdown()
        {
            using (new Scratch())
                WithWindow(ui =>
                {
                    ui.SimReady(true, 5);
                    Assert.True(ui.Count.Running);
                    ui.PressSettingsLink(); ui.Pump();
                    Assert.Same(ui.SettingsTab, ui.Tabs.SelectedItem);
                    Assert.False(ui.Count.Running);
                    Assert.Equal("⚙ Settings", UiText.SettingsLink);
                    ui.PressTab("play"); ui.SimReady(true, 5);
                    ui.PressTab("settings"); ui.Pump();   // selected any other way: stopped too
                    Assert.False(ui.Count.Running);
                });
        }

        [WindowsFact] public void It_fits_at_980x620_and_900x560_with_nothing_clipped()
        {
            using (var s = new Scratch())
                WithWindow(ui =>
                {
                    var dir = s.P("sample"); Pack(dir);
                    ui.SimSettings(dir, SettingsSamples.Options, SettingsSamples.Settings, SettingsSamples.PackList, 16, true, false);
                    foreach (var size in new[] { new Size(980, 620), new Size(900, 560) })
                    {
                        Resize(ui, size.Width, size.Height);
                        var w = ui.Window;
                        FrameworkElement F(string n) => (FrameworkElement)w.FindName(n);
                        Rect At(FrameworkElement e) => e.TransformToAncestor(w).TransformBounds(new Rect(0, 0, e.ActualWidth, e.ActualHeight));
                        Assert.Equal(340, F("SettingsLeft").ActualWidth, 0);
                        Assert.True(At(F("GraphicsCard")).Left >= At(F("SettingsLeft")).Right + 15, size + ": the graphics card overlaps the left column");
                        var right = At(F("SettingsScroll")).Right;
                        foreach (var e in Tree(F("SettingsPanel")).OfType<FrameworkElement>().Where(e => e.IsVisible && (e is ButtonBase || e is Slider || e is TextBlock tb && tb.Text.Length > 0)))
                        {
                            var r = At(e);
                            Assert.True(r.Right <= right + 0.5, string.Format("{0}: {1} '{2}' ends at {3:0}, past the tab's edge {4:0}", size, e.GetType().Name, (e as TextBlock)?.Text ?? e.Name, r.Right, right));
                            if (e is Button b) Assert.True(b.ActualWidth + b.Margin.Left + b.Margin.Right >= b.DesiredSize.Width - 0.5, size + ": " + b.Content + " is squeezed");
                        }
                        Assert.True(At(F("SettingsSave")).Right <= At(F("SettingsRow")).Right + 0.5, size + ": Save is cut off");
                    }
                });
        }

        [WindowsFact] public void A_memory_choice_saved_on_the_tab_goes_to_settings_json_and_nothing_else()
        {
            using (var s = new Scratch())
                WithWindow(ui =>
                {
                    var dir = s.P("sample"); Pack(dir);
                    ui.SimSettings(dir, SettingsSamples.Options, null, SettingsSamples.PackList, 16, false, false);
                    var options = Path.Combine(dir, "options.txt");
                    var before = File.ReadAllBytes(options);
                    Assert.False(ui.SaveEnabled);
                    Assert.Equal(UiText.RamNote(16, 6), ui.RamNoteText);
                    Assert.Equal(12, ui.RamMax);
                    ui.SetRam(8); ui.Pump();
                    Assert.True(ui.SaveEnabled);
                    Assert.Null(ui.RamWarnText);
                    ui.SetRam(10); ui.Pump();
                    Assert.Equal(UiText.RamWarnHalf, ui.RamWarnText);
                    ui.SetRam(8); ui.PressSave(); ui.Pump();
                    Assert.Equal(8, AppSettings.RamGb(Path.Combine(dir, AppSettings.FileName)));
                    Assert.Equal("Saved. The game gets 8 GB from the next time you press Play.", ui.SettingsStatusText);
                    Assert.Equal(before, File.ReadAllBytes(options));
                    Assert.False(ui.SaveEnabled);
                    ui.SetRam(null); ui.PressSave(); ui.Pump();
                    Assert.Null(AppSettings.RamGb(Path.Combine(dir, AppSettings.FileName)));
                    Assert.Equal(UiText.SettingsSavedAuto, ui.SettingsStatusText);
                });
        }

        [WindowsFact] public void A_PC_with_8_GB_cannot_choose_more_than_4_and_one_with_6_has_no_choice()
        {
            using (var s = new Scratch())
                WithWindow(ui =>
                {
                    var dir = s.P("sample"); Pack(dir);
                    ui.SimSettings(dir, SettingsSamples.Options, null, SettingsSamples.PackList, 8, true, false);
                    Assert.Equal(4, ui.RamMax);
                    ui.SimSettings(dir, SettingsSamples.Options, null, SettingsSamples.PackList, 6, true, false);
                    Assert.False(ui.RamSliderEnabled);
                    Assert.Equal(UiText.RamFixed(6, 3), ui.RamNoteText);
                });
        }

        [WindowsFact] public void With_the_game_open_Save_keeps_the_changes_for_the_next_Play()
        {
            using (var s = new Scratch())
                WithWindow(ui =>
                {
                    var dir = s.P("sample"); Pack(dir);
                    ui.SimSettings(dir, SettingsSamples.Options, null, SettingsSamples.PackList, 16, false, true);
                    var options = Path.Combine(dir, "options.txt");
                    var before = File.ReadAllBytes(options);
                    ui.SetOption("renderDistance", 14); ui.SetVillagers(false); ui.Pump();
                    Assert.True(ui.SaveEnabled);
                    ui.PressSave(); ui.Pump();
                    Assert.Equal(before, File.ReadAllBytes(options));
                    var p = AppSettings.Pending(Path.Combine(dir, AppSettings.FileName));
                    Assert.Equal("14", p.Options["renderDistance"]); Assert.False(p.Villagers);
                    Assert.Equal(UiText.SettingsGameOpen, ui.SettingsStatusText);
                    Assert.Equal(14, ui.OptionShown("renderDistance"));   // what waits is what the tab shows
                });
        }

        [WindowsFact] public void A_value_set_in_game_is_shown_beside_the_nearest_and_Back_to_recommended_fills_every_control()
        {
            using (var s = new Scratch())
                WithWindow(ui =>
                {
                    var dir = s.P("sample"); Pack(dir);
                    ui.SimSettings(dir, SettingsSamples.Options, null, SettingsSamples.PackList, 16, false, false);
                    Assert.Contains(UiText.SetInGame("Fabulous"), ui.OptionNote("graphicsMode"));
                    ui.SetOption("renderDistance", 14); ui.Pump();
                    Assert.Contains(UiText.ServerShows(12), ui.OptionNote("renderDistance"));
                    var options = Path.Combine(dir, "options.txt");
                    var before = File.ReadAllBytes(options);
                    ui.PressRecommended(); ui.Pump();
                    var m = SettingsModel.Load(options, Path.Combine(dir, GameSettings.VillagerPack), Path.Combine(dir, AppSettings.FileName), SettingsSamples.PackList, 16, false);
                    foreach (var kv in m.Recommended) Assert.Equal(kv.Value, ui.OptionShown(kv.Key));
                    Assert.Equal(before, File.ReadAllBytes(options));   // nothing until Save
                    Assert.True(ui.SaveEnabled);
                    ui.PressSave(); ui.Pump();
                    var now = GameOptions.Read(options);
                    Assert.Equal("10", now["renderDistance"]); Assert.Equal("1", now["graphicsMode"]); Assert.Equal("\"fast\"", now["renderClouds"]);
                    Assert.True(GameSettings.VillagersOn(options));   // the villagers are left as they are
                });
        }

        [WindowsFact] public void Before_the_first_Play_graphics_wait_and_without_the_pack_the_switch_is_shut()
        {
            using (var s = new Scratch())
                WithWindow(ui =>
                {
                    var dir = s.P("sample");
                    ui.SimSettings(dir, null, null, null, 16, false, false, villagerPack: false);
                    Assert.False(ui.GraphicsShown);
                    Assert.False(ui.VillagerSwitchEnabled);
                    ui.SimSettings(dir, SettingsSamples.Options, null, SettingsSamples.PackList, 16, false, false);
                    Assert.True(ui.GraphicsShown);
                });
        }

        [WindowsFact] public void The_websites_Play_choice_saves_the_moment_it_is_picked()
        {
            using (var s = new Scratch())
                WithWindow(ui =>
                {
                    var dir = s.P("sample"); Pack(dir);
                    ui.SimSettings(dir, SettingsSamples.Options, SettingsSamples.Settings, SettingsSamples.PackList, 16, false, false);
                    var radios = ((StackPanel)ui.Window.FindName("WebsiteChoices")).Children.OfType<RadioButton>().ToList();
                    Assert.Equal(UiText.WebsitePlayLabels.Select(l => l.Value), radios.Select(r => (string)r.Content));
                    radios[1].IsChecked = true; ui.Pump();
                    var path = Path.Combine(dir, AppSettings.FileName);
                    Assert.Equal(AppSettings.Wait, AppSettings.WebsitePlay(path));
                    Assert.Equal(8, AppSettings.RamGb(path));   // the memory choice kept
                    Assert.False(ui.SaveEnabled);
                });
        }
    }
}

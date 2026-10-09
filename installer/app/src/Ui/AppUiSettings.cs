using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.5.0 (docs/30): the Settings tab. Memory, the prisoner villagers and the website's Play button on the left,
    /// graphics and sound on the right. What it shows is read fresh each time the tab is opened (SettingsModel); nothing
    /// is written until Save, except the website's Play choice, which saves the moment it is picked. Leaving the tab
    /// with unsaved changes keeps them on screen until the window closes.
    /// </summary>
    sealed partial class AppUi
    {
        public TabItem SettingsTab;
        Button SettingsSave, SettingsRecommended;
        TextBlock SettingsStatus, RamValue, RamNote, RamWarn, VillagerNote, VillagerMissing, GraphicsEmpty, WebsiteQuestion, WebsiteNote;
        CheckBox RamAuto, VillagerSwitch;
        Slider RamSlider;
        Image VillagerPreview;
        Grid GraphicsBody;
        StackPanel WebsiteChoices;

        SettingsModel SModel;
        bool sFilling;                                   // the controls are being filled in: not a change by the player
        int sTotalGb = -1;                               // the PC's memory, read once (WMI)
        readonly HashSet<string> STouched = new HashSet<string>(StringComparer.Ordinal);
        readonly Dictionary<string, Func<int>> SGet = new Dictionary<string, Func<int>>(StringComparer.Ordinal);
        readonly Dictionary<string, Action<int>> SPut = new Dictionary<string, Action<int>>(StringComparer.Ordinal);
        readonly Dictionary<string, Action> SRowNotes = new Dictionary<string, Action>(StringComparer.Ordinal);
        // where the tab reads and writes (the real files; the screenshots point them at samples)
        string SOptions => sSim?.Options ?? GameSettings.LiveOptionsPath;
        string SPack => sSim?.Pack ?? GameSettings.LiveVillagerPackPath;
        string SSettings => sSim?.Settings ?? AppSettings.Path;
        SimFiles sSim;
        sealed class SimFiles { public string Options, Pack, Settings; public object PackList; public int TotalGb; public bool Weak; public bool Running; }

        void WireSettings()
        {
            var w = Window;
            T F<T>(string n) where T : class => w.FindName(n) as T ?? throw new InvalidOperationException("the window has no " + n);
            SettingsTab = F<TabItem>("SettingsTab");
            SettingsSave = F<Button>("SettingsSave"); SettingsRecommended = F<Button>("SettingsRecommended"); SettingsStatus = F<TextBlock>("SettingsStatus");
            RamAuto = F<CheckBox>("RamAuto"); RamSlider = F<Slider>("RamSlider"); RamValue = F<TextBlock>("RamValue"); RamNote = F<TextBlock>("RamNote"); RamWarn = F<TextBlock>("RamWarn");
            VillagerSwitch = F<CheckBox>("VillagerSwitch"); VillagerNote = F<TextBlock>("VillagerNote"); VillagerMissing = F<TextBlock>("VillagerMissing"); VillagerPreview = F<Image>("VillagerPreview");
            WebsiteQuestion = F<TextBlock>("WebsiteQuestion"); WebsiteChoices = F<StackPanel>("WebsiteChoices"); WebsiteNote = F<TextBlock>("WebsiteNote");
            GraphicsEmpty = F<TextBlock>("GraphicsEmpty"); GraphicsBody = F<Grid>("GraphicsBody");

            F<TextBlock>("MemoryTitle").Text = UiText.MemoryTitle; F<TextBlock>("RamAutoText").Text = UiText.RamAuto;
            F<TextBlock>("VillagerTitle").Text = UiText.VillagerTitle; VillagerSwitch.Content = UiText.VillagerSwitch;
            VillagerNote.Text = UiText.VillagerNote; VillagerMissing.Text = UiText.VillagerMissing;
            F<TextBlock>("WebsiteTitle").Text = UiText.WebsiteTitle; WebsiteQuestion.Text = UiText.SettingsQuestion; WebsiteNote.Text = UiText.SettingsNote;
            F<TextBlock>("GraphicsTitle").Text = UiText.GraphicsTitle; GraphicsEmpty.Text = UiText.GraphicsBeforeFirstPlay;
            SettingsRecommended.Content = UiText.BackToRecommended; SettingsSave.Content = UiText.Save;
            foreach (var e in new FrameworkElement[] { F<TextBlock>("MemoryTitle"), RamAuto, RamSlider }) e.ToolTip = UiText.RamTip;

            RamAuto.Checked += (s, e) => OnRamChanged(); RamAuto.Unchecked += (s, e) => OnRamChanged();
            RamSlider.ValueChanged += (s, e) => OnRamChanged();
            VillagerSwitch.Checked += (s, e) => OnSettingChanged(); VillagerSwitch.Unchecked += (s, e) => OnSettingChanged();
            SettingsSave.Click += (s, e) => SaveSettings();
            SettingsRecommended.Click += (s, e) => BackToRecommended();
            BuildGraphicsRows();
        }

        /// <summary>The cog on the Play tab (docs/30 §3): stops a countdown and selects this tab.</summary>
        void OpenSettingsTab()
        {
            CancelCountdown("a setting");
            if (SettingsTab.IsEnabled) Tabs.SelectedItem = SettingsTab;
        }

        /// <summary>Shut in the guided setup and while the install steps run (docs/30 §3).</summary>
        void SyncSettingsTab()
        {
            var busy = AnyRunning || updating;   // 3.6.1: either tab's run
            var on = Guided == 0 && !busy;
            if (SettingsTab.IsEnabled != on) SettingsTab.IsEnabled = on;
            var tip = Guided == 0 && busy ? UiText.SettingsBusy : null;
            if (!Equals(SettingsTab.ToolTip, tip)) SettingsTab.ToolTip = tip;
        }

        // ---- reading -----------------------------------------------------------------------------------------------------
        /// <summary>The tab opened: what is on disk now, unless the player left changes on it.</summary>
        public void ShowSettingsTab()
        {
            if (SModel != null && SettingsDiffer()) return;   // unsaved changes stay on screen
            LoadSettings();
        }

        void LoadSettings(string status = null, string tone = "Muted")
        {
            try
            {
                if (sTotalGb < 0) sTotalGb = sSim?.TotalGb ?? Memory.TotalGb();
                var packList = sSim != null ? sSim.PackList : Engine.ReadPackList(Engine.LivePackListPath);
                SModel = SettingsModel.Load(SOptions, SPack, SSettings, packList, sSim?.TotalGb ?? sTotalGb, sSim?.Weak ?? Weak);
            }
            catch (Exception e)
            {
                Log.Line("settings: could not be read: " + e.Message);
                SModel = SettingsModel.Load(null, null, null, null, Memory.UnknownTotalGb, Weak);
            }
            sFilling = true;
            try
            {
                STouched.Clear();
                ramMoved = false;
                FillMemory();
                FillVillagers();
                FillWebsite();
                var show = SModel.HasOptions || SModel.PendingShown;
                GraphicsEmpty.Visibility = show ? Visibility.Collapsed : Visibility.Visible;
                GraphicsBody.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
                foreach (var kv in SModel.Shown) if (SPut.TryGetValue(kv.Key, out var put)) put(kv.Value.Value);
            }
            finally { sFilling = false; }
            foreach (var n in SRowNotes.Values) n();
            SetSettingsStatus(status ?? (SModel.PendingShown ? UiText.SettingsGameOpen : ""), tone);
            SettingsSave.IsEnabled = false;
        }

        void FillMemory()
        {
            var b = SModel.Ram;
            RamSlider.Minimum = b.Low; RamSlider.Maximum = Math.Max(b.Low, b.High);
            RamSlider.Value = SModel.RamAtOpen.HasValue ? Math.Max(b.Low, Math.Min(b.High, SModel.RamAtOpen.Value)) : Math.Max(b.Low, Math.Min(b.High, b.Auto));
            RamAuto.IsChecked = !SModel.RamAtOpen.HasValue || b.Fixed;
            RamAuto.IsEnabled = !b.Fixed;
            ShowRam();
        }

        void ShowRam()
        {
            var b = SModel.Ram;
            var auto = RamAuto.IsChecked == true;
            RamSlider.IsEnabled = !auto && !b.Fixed;
            var gb = auto ? b.Auto : (int)Math.Round(RamSlider.Value);
            RamValue.Text = UiText.GbText(gb);
            RamNote.Text = b.Fixed ? UiText.RamFixed(b.TotalGb, b.Auto) : UiText.RamNote(b.TotalGb, b.Auto);
            var warn = auto ? null : Memory.Warning(gb, b.TotalGb);
            RamWarn.Text = warn ?? ""; RamWarn.Visibility = warn != null ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>The memory to save: what settings.json holds until the player touches the card (a choice above what
        /// this PC may give now is shown clamped, and kept as it is); then automatic or the slider.</summary>
        int? RamChosen => !ramMoved || SModel.Ram.Fixed ? SModel.RamAtOpen : RamAuto.IsChecked == true ? (int?)null : (int)Math.Round(RamSlider.Value);
        bool ramMoved;

        void FillVillagers()
        {
            VillagerSwitch.IsChecked = SModel.VillagersAtOpen;
            VillagerSwitch.IsEnabled = SModel.VillagerPackHere;
            VillagerMissing.Visibility = SModel.VillagerPackHere ? Visibility.Collapsed : Visibility.Visible;
            var face = VillagerFace(SPack);
            VillagerPreview.Source = face;
            VillagerPreview.Visibility = face != null ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>The front of the villager's head (8×10 at 8,8 in the 64×64 layout) from the pack's villager.png;
        /// null when the pack or the picture is not there.</summary>
        static BitmapSource VillagerFace(string pack)
        {
            try
            {
                if (pack == null || !File.Exists(pack)) return null;
                using (var z = ZipFile.OpenRead(pack))
                {
                    var e = z.GetEntry("assets/minecraft/textures/entity/villager/villager.png");
                    if (e == null) return null;
                    var ms = new MemoryStream();
                    using (var s = e.Open()) s.CopyTo(ms);
                    ms.Position = 0;
                    var bmp = new BitmapImage();
                    bmp.BeginInit(); bmp.CacheOption = BitmapCacheOption.OnLoad; bmp.StreamSource = ms; bmp.EndInit();
                    var k = bmp.PixelWidth / 64;   // a 128 px picture has the same layout at twice the size
                    if (k < 1 || bmp.PixelHeight < 18 * k) return null;
                    var face = new CroppedBitmap(bmp, new Int32Rect(8 * k, 8 * k, 8 * k, 10 * k));
                    face.Freeze();
                    return face;
                }
            }
            catch (Exception e) { Log.Line("settings: the villager picture could not be shown: " + e.Message); return null; }
        }

        void FillWebsite()
        {
            WebsiteChoices.Children.Clear();
            var now = AppSettings.WebsitePlay(SSettings);
            foreach (var kv in UiText.WebsitePlayLabels)
            {
                var r = new RadioButton { Content = kv.Value, GroupName = "websitePlay", Margin = new Thickness(0, 0, 0, 6), IsChecked = kv.Key == now, Style = (Style)Window.FindResource("Choice") };
                var v = kv.Key;
                r.Checked += (s, e) =>
                {
                    if (sFilling) return;
                    try { AppSettings.SetWebsitePlay(v, SSettings); Log.Line("settings: when Play is pressed on the website: " + v); }
                    catch (Exception x) { Log.Line("settings: could not be saved: " + x.Message); }
                };
                WebsiteChoices.Children.Add(r);
            }
        }

        // ---- the graphics rows ---------------------------------------------------------------------------------------------
        static string ValueText(string key, int v)
        {
            switch (key)
            {
                case "renderDistance": return v + " chunks";
                case "maxFps": return v >= GameOptions.UnlimitedFps ? UiText.Unlimited : v.ToString();
                case "fov": return v + "°";
                default: return v + " %";
            }
        }

        void BuildGraphicsRows()
        {
            var g = GraphicsBody;
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(78) });
            var labels = UiText.GraphicsLabels.ToDictionary(kv => kv.Key, kv => kv.Value);
            int row = 0;
            foreach (var o in GameOptions.Known)
            {
                g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                var key = o.Key;
                var label = NewText(labels[key], 13, "Normal", "Fg"); label.Margin = new Thickness(0, 6, 8, 4); label.VerticalAlignment = VerticalAlignment.Top;
                Grid.SetRow(label, row); g.Children.Add(label);
                var cell = new StackPanel { Margin = new Thickness(0, 4, 0, 4) };
                Grid.SetRow(cell, row); Grid.SetColumn(cell, 1); g.Children.Add(cell);
                TextBlock value = null;
                if (o.Choices != null)
                {
                    var wrap = new WrapPanel();
                    var radios = new List<RadioButton>();
                    for (int i = 0; i < o.Choices.Length; i++)
                    {
                        var r = new RadioButton { Content = o.Choices[i], GroupName = "opt-" + key, Style = (Style)Window.FindResource("Choice"), Margin = new Thickness(0, 3, 14, 3) };
                        r.Checked += (s, e) => OnOptionMoved(key);
                        radios.Add(r); wrap.Children.Add(r);
                    }
                    cell.Children.Add(wrap);
                    SGet[key] = () => Math.Max(0, radios.FindIndex(r => r.IsChecked == true));
                    SPut[key] = v => radios[Math.Max(0, Math.Min(radios.Count - 1, v))].IsChecked = true;
                }
                else if (o.Switch)
                {
                    var cb = new CheckBox { Content = "On", Style = (Style)Window.FindResource("Switch"), Margin = new Thickness(0, 3, 0, 3) };
                    cb.Checked += (s, e) => OnOptionMoved(key); cb.Unchecked += (s, e) => OnOptionMoved(key);
                    cell.Children.Add(cb);
                    SGet[key] = () => cb.IsChecked == true ? 1 : 0;
                    SPut[key] = v => cb.IsChecked = v != 0;
                }
                else
                {
                    var sl = new Slider { Minimum = o.Min, Maximum = o.Max, TickFrequency = o.Step, SmallChange = o.Step, LargeChange = o.Step };
                    value = NewText("", 13, "SemiBold"); value.Margin = new Thickness(8, 5, 0, 0); value.TextAlignment = TextAlignment.Right; value.VerticalAlignment = VerticalAlignment.Top;
                    Grid.SetRow(value, row); Grid.SetColumn(value, 2); g.Children.Add(value);
                    var vt = value;
                    sl.ValueChanged += (s, e) => { vt.Text = ValueText(key, (int)Math.Round(sl.Value)); OnOptionMoved(key); };
                    cell.Children.Add(sl);
                    SGet[key] = () => (int)Math.Round(sl.Value);
                    SPut[key] = v => { sl.Value = v; vt.Text = ValueText(key, v); };
                    if (key == "renderDistance") { label.ToolTip = UiText.RenderTip; sl.ToolTip = UiText.RenderTip; }
                    if (key == "entityDistanceScaling") { label.ToolTip = UiText.EntityTip; sl.ToolTip = UiText.EntityTip; }
                }
                // under the control: "(set in game: 24)", the server's view distance, a weak PC's warning
                var inGame = NewText("", 12, "Normal", "Muted"); inGame.Visibility = Visibility.Collapsed; cell.Children.Add(inGame);
                var note = NewText("", 12, "Normal", "Muted"); note.Visibility = Visibility.Collapsed; cell.Children.Add(note);
                var warn = NewText(UiText.WeakStruggle, 12, "Normal", "Copper"); warn.Visibility = Visibility.Collapsed; cell.Children.Add(warn);
                SRowNotes[key] = () =>
                {
                    if (SModel == null || !SModel.Shown.TryGetValue(key, out var shown)) return;
                    var v = SGet[key]();
                    var odd = !shown.Fits && v == shown.Value && !STouched.Contains(key);
                    inGame.Text = odd ? UiText.SetInGame(shown.InGame) : "";
                    inGame.Visibility = odd ? Visibility.Visible : Visibility.Collapsed;
                    var n = key == "renderDistance" ? SModel.RenderNote(v) : null;
                    note.Text = n ?? ""; note.Visibility = n != null ? Visibility.Visible : Visibility.Collapsed;
                    var struggle = key == "renderDistance" ? SModel.RenderStruggles(v) : key == "graphicsMode" && SModel.GraphicsStruggles(v);
                    warn.Visibility = struggle ? Visibility.Visible : Visibility.Collapsed;
                };
                row++;
            }
        }

        // ---- changes -----------------------------------------------------------------------------------------------------
        void OnOptionMoved(string key)
        {
            if (sFilling) return;
            STouched.Add(key);
            if (SRowNotes.TryGetValue(key, out var n)) n();
            OnSettingChanged();
        }

        void OnRamChanged()
        {
            if (SModel == null) return;
            if (!sFilling) ramMoved = true;
            ShowRam();
            OnSettingChanged();
        }

        void OnSettingChanged()
        {
            if (sFilling || SModel == null) return;
            SettingsSave.IsEnabled = SettingsDiffer();
            if (SettingsStatus.Foreground == NewBrush("GreenText") || SettingsStatus.Foreground == NewBrush("Red")) SetSettingsStatus(SModel.PendingShown ? UiText.SettingsGameOpen : "", "Muted");
        }

        Dictionary<string, int> SettingsNow() => SGet.ToDictionary(kv => kv.Key, kv => kv.Value(), StringComparer.Ordinal);

        bool SettingsDiffer() => SModel != null && SModel.Differs(SettingsNow(), STouched, RamChosen, VillagerSwitch.IsChecked == true);

        void SetSettingsStatus(string text, string tone)
        {
            SettingsStatus.Text = text ?? "";
            SettingsStatus.Foreground = NewBrush(tone);
        }

        /// <summary>"Back to recommended" (docs/30 §7): every control to its recommended value, memory back to automatic;
        /// the villagers and the website's Play choice stay as they are. Nothing is written until Save.</summary>
        void BackToRecommended()
        {
            if (SModel == null) return;
            foreach (var kv in SModel.Recommended)
            {
                if (!SPut.TryGetValue(kv.Key, out var put)) continue;
                sFilling = true;
                try { put(kv.Value); } finally { sFilling = false; }
                STouched.Add(kv.Key);
            }
            if (RamAuto.IsEnabled) RamAuto.IsChecked = true;
            foreach (var n in SRowNotes.Values) n();
            ShowRam();
            OnSettingChanged();
            Log.Line("settings: back to recommended (not saved yet)");
        }

        void SaveSettings()
        {
            if (SModel == null) return;
            var was = SModel.RamAtOpen;
            var ram = RamChosen;
            var changes = SModel.Changes(SettingsNow(), STouched);
            bool? villagers = SModel.VillagerPackHere && (VillagerSwitch.IsChecked == true) != SModel.VillagersAtOpen ? VillagerSwitch.IsChecked == true : (bool?)null;
            try
            {
                var running = sSim != null ? sSim.Running : Engine.GameRunningNow();
                if (ram != was) { AppSettings.SetRamGb(ram, SSettings); Log.Line(GameSettings.MemoryLine(ram, was)); }
                var r = GameSettings.Save(SOptions, changes, villagers, running, SSettings);
                var xmx = Memory.Xmx(ram, SModel.Ram, out _);
                var said = SettingsModel.SavedText(r.Status, ram, was, xmx);
                LoadSettings(said, r.Status == "pending" ? "Muted" : "GreenText");
            }
            catch (Exception e)
            {
                Log.Line("settings: could not be saved: " + e);
                SetSettingsStatus(string.Format(UiText.SettingsNotSaved, e.Message), "Red");
            }
        }

        // ---- the screenshots' and the tests' stand-ins ------------------------------------------------------------------
        /// <summary>The tab drawn from sample files (never the PC's own): options.txt text, settings.json text, the mod
        /// list's settings, the PC's memory, whether the game counts as running on Save.</summary>
        internal void SimSettings(string dir, string optionsText, string settingsJson, object packList, int totalGb, bool weak, bool running, bool villagerPack = true)
        {
            Directory.CreateDirectory(dir);
            var f = new SimFiles { Options = Path.Combine(dir, "options.txt"), Pack = Path.Combine(dir, GameSettings.VillagerPack), Settings = Path.Combine(dir, AppSettings.FileName), PackList = packList, TotalGb = totalGb, Weak = weak, Running = running };
            if (optionsText != null) File.WriteAllText(f.Options, optionsText); else if (File.Exists(f.Options)) File.Delete(f.Options);
            if (settingsJson != null) File.WriteAllText(f.Settings, settingsJson); else if (File.Exists(f.Settings)) File.Delete(f.Settings);
            if (!villagerPack && File.Exists(f.Pack)) File.Delete(f.Pack);
            sSim = f; sTotalGb = totalGb; SModel = null;
            Tabs.SelectedItem = SettingsTab;
            LoadSettings();
        }
        internal void SimSettingsOff() { sSim = null; sTotalGb = -1; SModel = null; }
        internal string SimPackPath => SPack;
        internal void SetOption(string key, int v) { SPut[key](v); }
        internal int OptionShown(string key) => SGet[key]();
        internal string OptionNote(string key)
        {
            SRowNotes[key]();
            var cell = GraphicsBody.Children.OfType<StackPanel>().ElementAt(GameOptions.Known.ToList().FindIndex(o => o.Key == key));
            return string.Join(" | ", cell.Children.OfType<TextBlock>().Where(t => t.Visibility == Visibility.Visible && t.Text.Length > 0).Select(t => t.Text));
        }
        internal void SetRam(int? gb) { if (gb.HasValue) { RamAuto.IsChecked = false; RamSlider.Value = gb.Value; } else RamAuto.IsChecked = true; }
        internal void SetVillagers(bool on) => VillagerSwitch.IsChecked = on;
        internal void PressSave() => SaveSettings();
        internal void PressRecommended() => BackToRecommended();
        internal bool SaveEnabled => SettingsSave.IsEnabled;
        internal string SettingsStatusText => SettingsStatus.Text;
        internal bool VillagerSwitchEnabled => VillagerSwitch.IsEnabled;
        internal bool RamSliderEnabled => RamSlider.IsEnabled;
        internal string RamWarnText => RamWarn.Visibility == Visibility.Visible ? RamWarn.Text : null;
        internal string RamNoteText => RamNote.Text;
        internal double RamMax => RamSlider.Maximum;
        internal bool GraphicsShown => GraphicsBody.Visibility == Visibility.Visible;
        internal bool SettingsTabEnabled => SettingsTab.IsEnabled;
        internal void PressSettingsLink() => OpenSettingsTab();
    }
}

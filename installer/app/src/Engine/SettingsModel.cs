using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.5.0 (docs/30 §3, §4): what the Settings tab shows when it is opened, and what a Save would change. Read fresh
    /// every time: options.txt (with what waits for the next Play laid over it), settings.json, the mod list the last
    /// run kept (packlist.json: the tier's render distance, the memory limits, the server's view distance). Pure: the
    /// window (AppUiSettings.cs) only draws it.
    /// </summary>
    public sealed class SettingsModel
    {
        public bool HasOptions;              // options.txt is there (not before the first Play)
        public bool PendingShown;            // something saved while Minecraft was open waits for the next Play
        public bool VillagerPackHere;        // resourcepacks\deepslate-textures.zip
        public bool VillagersAtOpen;
        public bool Weak;                    // the Extras tab's test: under 8 GB or no graphics card of its own
        public string Tier = "MID";          // LOW | MID | HIGH
        public int? ServerViewDistance;
        public Memory.Bounds Ram;
        public int? RamAtOpen;               // settings.json's ramGb (null: automatic)
        public readonly Dictionary<string, GameOptions.Shown> Shown = new Dictionary<string, GameOptions.Shown>(StringComparer.Ordinal);
        public readonly Dictionary<string, int> Recommended = new Dictionary<string, int>(StringComparer.Ordinal);

        /// <summary>The game's own value for a key options.txt does not have (what 1.21.1 writes on its first start;
        /// checked against tests/fixtures/options-1.21.1.txt).</summary>
        public static readonly Dictionary<string, string> GameDefaults = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "renderDistance", "12" }, { "entityDistanceScaling", "1.0" }, { "maxFps", "120" }, { "enableVsync", "true" }, { "fullscreen", "false" },
            { "graphicsMode", "1" }, { "renderClouds", "\"true\"" }, { "particles", "0" }, { "ao", "true" }, { "entityShadows", "true" },
            { "fov", "0.0" }, { "gamma", "0.5" }, { "guiScale", "0" }, { "soundCategory_master", "1.0" }, { "soundCategory_music", "1.0" },
        };

        public static SettingsModel Load(string options, string villagerPack, string settingsPath, object packList, int totalGb, bool weak)
        {
            var m = new SettingsModel { Weak = weak };
            var st = J.Obj(packList, "settings");
            var tier = J.Str(st, "tier");
            m.Tier = tier == "LOW" || tier == "MID" || tier == "HIGH" ? tier : weak ? "LOW" : "MID";
            var svd = J.Long(st, "serverViewDistance");
            m.ServerViewDistance = svd.HasValue && svd.Value > 0 ? (int)svd.Value : (int?)null;
            m.Ram = Memory.Range(totalGb, J.Num(st, "ram.min_gb") ?? 3, J.Num(st, "ram.max_gb") ?? 6, J.Num(st, "ram.user_max_gb"));
            m.RamAtOpen = AppSettings.RamGb(settingsPath);
            var rd = J.Long(st, "renderDistance");
            m.Recommend(rd.HasValue && rd.Value > 0 ? (int)rd.Value : 8);

            m.HasOptions = File.Exists(options);
            var file = GameOptions.Read(options);
            var pending = AppSettings.Pending(settingsPath);
            m.PendingShown = pending.Any;
            foreach (var kv in pending.Options) file[kv.Key] = kv.Value;
            foreach (var o in GameOptions.Known)
            {
                var have = file.TryGetValue(o.Key, out var t);
                var s = GameOptions.Show(o.Key, have ? t : GameDefaults[o.Key], m.Recommended[o.Key]);
                m.Shown[o.Key] = s;
            }
            m.VillagerPackHere = File.Exists(villagerPack);
            m.VillagersAtOpen = pending.Villagers ?? GameSettings.VillagersOn(options);
            return m;
        }

        /// <summary>docs/30 §4.2's Recommended column for this PC's tier.</summary>
        void Recommend(int tierRender)
        {
            var low = Tier == "LOW";
            void R(string k, int v) => Recommended[k] = GameOptions.Snap(GameOptions.Find(k), v);
            R("renderDistance", tierRender);
            R("entityDistanceScaling", 100);
            R("maxFps", 120);
            R("enableVsync", 1);
            R("fullscreen", 0);
            R("graphicsMode", low ? 0 : 1);
            R("renderClouds", low ? 0 : 1);
            R("particles", low ? 1 : 0);
            R("ao", 1);
            R("entityShadows", low ? 0 : 1);
            R("fov", 70);
            R("gamma", 50);
            R("guiScale", 0);
            R("soundCategory_master", 100);
            R("soundCategory_music", 100);
        }

        /// <summary>
        /// options.txt lines a Save writes: a control whose value differs from what the tab showed, or one showing a
        /// value it cannot hold (Fabulous, 24 chunks typed in by hand) that the player touched (moved, or "Back to
        /// recommended"). A value the tab cannot show is left alone otherwise.
        /// </summary>
        public Dictionary<string, string> Changes(IDictionary<string, int> now, ICollection<string> touched)
        {
            var r = new Dictionary<string, string>(StringComparer.Ordinal);
            if (!HasOptions && !PendingShown) return r;
            foreach (var o in GameOptions.Known)
            {
                if (!now.TryGetValue(o.Key, out var v)) continue;
                var s = Shown[o.Key];
                if (v != s.Value || (!s.Fits && touched != null && touched.Contains(o.Key))) r[o.Key] = GameOptions.ToFile(o.Key, v);
            }
            return r;
        }

        /// <summary>Save is enabled while something differs from what is on disk.</summary>
        public bool Differs(IDictionary<string, int> now, ICollection<string> touched, int? ramGb, bool villagers)
            => Changes(now, touched).Count > 0 || ramGb != RamAtOpen || (VillagerPackHere && villagers != VillagersAtOpen);

        /// <summary>The line under the render distance slider, or null: the server's view distance (above it), then a
        /// weak PC (above 10).</summary>
        public string RenderNote(int chunks)
        {
            if (ServerViewDistance.HasValue && chunks > ServerViewDistance.Value) return UiText.ServerShows(ServerViewDistance.Value);
            return null;
        }
        public bool RenderStruggles(int chunks) => Weak && chunks > 10;
        public bool GraphicsStruggles(int mode) => Weak && mode >= 1;

        /// <summary>What the status line says after a Save.</summary>
        public static string SavedText(string status, int? ramNow, int? ramWas, int xmx)
        {
            if (status == "pending") return UiText.SettingsGameOpen;
            if (ramNow != ramWas) return ramNow.HasValue ? UiText.SettingsSaved(ramNow, xmx) : UiText.SettingsSavedAuto;
            return UiText.SettingsSaved(null, xmx);
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.5.0 (docs/30): what the Settings tab saves and what the engine does with it. Save writes options.txt when the
    /// game is closed; while Minecraft is open (it holds its options in memory and writes the whole file again, so a
    /// write now would be lost) the changes go to settings.json's pending and the engine's Settings step applies them at
    /// the next Play. The prisoner villagers are the Deepslate texture pack (modpack/resourcepack, docs/06), switched on
    /// in resourcePacks and kept on top of every other pack.
    /// </summary>
    public static class GameSettings
    {
        public const string VillagerPack = "deepslate-textures.zip";
        public const string VillagerId = "file/" + VillagerPack;

        public static string OptionsPath => Path.Combine(Env.DataDir, "options.txt");
        public static string VillagerPackPath => Path.Combine(Env.DataDir, "resourcepacks", VillagerPack);
        /// <summary>docs/45: what the Settings tab reads and writes: the live game's, whatever run is going.</summary>
        public static string LiveOptionsPath => Path.Combine(Env.LiveDataDir, "options.txt");
        public static string LiveVillagerPackPath => Path.Combine(Env.LiveDataDir, "resourcepacks", VillagerPack);

        public static bool VillagersOn(string options) => GameOptions.HasResourcePack(options, VillagerId);

        /// <summary>The pack in or out of resourcePacks (the player's own packs and their order stay); on, it is moved to
        /// the end, on top of the extras' packs. True when options.txt changed.</summary>
        public static bool SetVillagers(string options, bool on)
        {
            var r = Extras.SetResourcePackList(options, on ? new[] { VillagerPack } : new string[0], new[] { VillagerPack });
            var top = on && GameOptions.KeepOnTop(options, VillagerId);
            return r.Status == "changed" || top;
        }

        /// <summary>"settings: renderDistance 10 → 14, renderClouds "fast" → "false"" (old values from the file).</summary>
        public static string ChangeLine(IDictionary<string, string> before, IDictionary<string, string> after)
            => "settings: " + string.Join(", ", after.Select(kv => string.Format("{0} {1} {2} {3}", kv.Key, before != null && before.TryGetValue(kv.Key, out var o) ? o : "(none)", '→', kv.Value)));

        public static string MemoryLine(int? now, int? was)
            => string.Format("settings: memory {0} (was {1})", now.HasValue ? now.Value + " GB" : "automatic", was.HasValue ? was.Value + " GB" : "automatic");

        public static string VillagerLine(bool on) => "settings: prisoner villagers " + (on ? "on" : "off");

        /// <summary>What Save did: written (options.txt), pending (Minecraft is open) or nothing.</summary>
        public sealed class SaveResult { public string Status = "nothing"; }

        /// <summary>
        /// The tab's Save for options.txt and the villagers (memory is saved on its own: it is not in options.txt). With the
        /// game closed, what was waiting goes in too (the tab showed it) and pending is cleared.
        /// </summary>
        public static SaveResult Save(string options, IDictionary<string, string> changed, bool? villagers, bool gameRunning, string settingsPath = null)
        {
            changed = changed ?? new Dictionary<string, string>();
            if (changed.Count == 0 && !villagers.HasValue) return new SaveResult();
            var before = GameOptions.Read(options);
            if (changed.Count > 0) Log.Line(ChangeLine(before, changed));
            if (villagers.HasValue) Log.Line(VillagerLine(villagers.Value));
            if (gameRunning)
            {
                var p = new AppSettings.PendingSettings { Villagers = villagers };
                foreach (var kv in changed) p.Options[kv.Key] = kv.Value;
                AppSettings.SetPending(p, settingsPath);
                Log.Line("settings: kept for the next Play (Minecraft is open)");
                return new SaveResult { Status = "pending" };
            }
            var waiting = AppSettings.Pending(settingsPath);
            var all = new Dictionary<string, string>(waiting.Options, StringComparer.Ordinal);
            foreach (var kv in changed) all[kv.Key] = kv.Value;
            GameOptions.Set(options, all);
            var v = villagers ?? waiting.Villagers;
            if (v.HasValue) SetVillagers(options, v.Value);
            AppSettings.ClearPending(settingsPath);
            return new SaveResult { Status = "written" };
        }

        /// <summary>
        /// The engine, at the start of its Settings step: what the tab kept for this Play, written into options.txt once
        /// and cleared. Null when nothing waited (or the game is still open: then it keeps waiting); otherwise the tick
        /// line, "Your settings from the Settings tab applied (render distance 14, clouds off)".
        /// </summary>
        public static string ApplyPending(string options, bool gameRunning, string settingsPath = null)
        {
            var p = AppSettings.Pending(settingsPath);
            if (!p.Any) return null;
            if (gameRunning) { Log.Line("settings: Minecraft is open, so the Settings tab's changes wait for the next Play"); return null; }
            var before = GameOptions.Read(options);
            if (p.Options.Count > 0) { Log.Line(ChangeLine(before, p.Options)); GameOptions.Set(options, p.Options); }
            if (p.Villagers.HasValue) { Log.Line(VillagerLine(p.Villagers.Value)); SetVillagers(options, p.Villagers.Value); }
            AppSettings.ClearPending(settingsPath);
            var what = p.Options.Select(kv => GameOptions.Describe(kv.Key, kv.Value)).ToList();
            if (p.Villagers.HasValue) what.Add("prisoner villagers " + (p.Villagers.Value ? "on" : "off"));
            return string.Format("Your settings from the Settings tab applied ({0})", string.Join(", ", what));
        }

        /// <summary>The report's settings block (docs/30 §6): the memory chosen (null: automatic), what the profile got,
        /// the render distance in options.txt now, and whether the prisoner villagers are on.</summary>
        public static JObj ReportBlock(int? ramGb, int xmxGb, string options)
        {
            int? rd = null;
            try { if (GameOptions.Read(options).TryGetValue("renderDistance", out var t) && int.TryParse(t, out var i)) rd = i; } catch { }
            bool villagers = false;
            try { villagers = VillagersOn(options); } catch { }
            return J.O("ramGb", ramGb, "xmxGb", xmxGb, "renderDistance", rd, "villagers", villagers);
        }
    }
}

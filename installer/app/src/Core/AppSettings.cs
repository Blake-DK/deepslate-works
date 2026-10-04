using System;
using System.Collections.Generic;

namespace DeepslateWorks
{
    /// <summary>
    /// The app's own settings on this PC (3.1.0, planner 2026-10-02): settings.json in %LOCALAPPDATA%\DeepslateWorks.
    /// What pressing Play on the website does once the game is ready; 3.5.0 (docs/30 §5, version 2): the memory chosen
    /// on the Settings tab, and the game settings saved while Minecraft was open, waiting for the next Play. Everything
    /// else the tab shows lives in the game's own options.txt. Every writer reads the file, changes its own key and
    /// writes it back, so one setting never wipes another; a file that cannot be read counts as empty.
    /// </summary>
    public static class AppSettings
    {
        public const string FileName = "settings.json";
        public const int Version = 2;
        public static string Path => System.IO.Path.Combine(Env.AppHome, FileName);

        /// <summary>start after 5 seconds (the default) | wait for me to press Play | start straight away.</summary>
        public const string Countdown = "countdown", Wait = "wait", Now = "now";
        public static readonly string[] WebsitePlayChoices = { Countdown, Wait, Now };
        public const int CountdownSeconds = 5;

        static JObj Read(string path) => Json.ReadFile(path ?? Path) as JObj;

        /// <summary>The file read, changed by one writer, written back as version 2 (a version 1 file keeps websitePlay).</summary>
        static void Change(string path, Action<JObj> change)
        {
            var p = path ?? Path;
            var j = Read(p) ?? new JObj();
            j["version"] = Version;
            change(j);
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(p));
            Json.WriteFile(p, j);
        }

        public static string WebsitePlay(string path = null)
        {
            var v = J.Str(Read(path), "websitePlay");
            return Array.IndexOf(WebsitePlayChoices, v) >= 0 ? v : Countdown;
        }

        public static void SetWebsitePlay(string value, string path = null)
        {
            if (Array.IndexOf(WebsitePlayChoices, value) < 0) throw new ArgumentException("not a choice: " + value);
            Change(path, j => j["websitePlay"] = value);
        }

        // ---- 3.5.0: memory -----------------------------------------------------------------------------------------------
        /// <summary>The memory chosen on the Settings tab in whole GB; null for automatic (absent, null, or not a whole
        /// number from 1 to 64).</summary>
        public static int? RamGb(string path = null)
        {
            var j = Read(path);
            var v = J.Get(j, "ramGb");
            if (v is long l && l >= 1 && l <= 64) return (int)l;
            return null;
        }

        public static void SetRamGb(int? gb, string path = null)
        {
            if (gb.HasValue && (gb.Value < 1 || gb.Value > 64)) throw new ArgumentException("not a memory size: " + gb.Value);
            Change(path, j => { if (gb.HasValue) j["ramGb"] = gb.Value; else j.Remove("ramGb"); });
        }

        // ---- 3.5.0: settings waiting for the next Play (saved while Minecraft was open) ---------------------------------
        public sealed class PendingSettings
        {
            /// <summary>options.txt keys and the file's own text for each ("renderClouds": "\"false\"").</summary>
            public Dictionary<string, string> Options = new Dictionary<string, string>(StringComparer.Ordinal);
            /// <summary>Prisoner villagers on or off; null: no change waiting.</summary>
            public bool? Villagers;
            public bool Any => Options.Count > 0 || Villagers.HasValue;
        }

        /// <summary>What waits for the next Play. Only keys GameOptions knows are taken; anything else is dropped and
        /// logged, and so is a value with a line break in it.</summary>
        public static PendingSettings Pending(string path = null)
        {
            var r = new PendingSettings();
            var p = J.Obj(Read(path), "pending");
            if (p == null) return r;
            var o = J.Obj(p, "options");
            if (o != null)
                foreach (var k in o.OrderedKeys)
                {
                    var v = o[k] as string;
                    if (!GameOptions.IsKnown(k) || v == null || v.IndexOfAny(new[] { '\r', '\n' }) >= 0) { Log.Line("settings: a waiting setting was dropped (not one the Settings tab writes): " + k); continue; }
                    r.Options[k] = v;
                }
            if (J.Get(p, "villagers") is bool b) r.Villagers = b;
            return r;
        }

        /// <summary>Adds to what waits: a key saved again replaces its earlier value; villagers when given.</summary>
        public static void SetPending(PendingSettings add, string path = null)
        {
            if (add == null || !add.Any) return;
            var now = Pending(path);
            foreach (var kv in add.Options) now.Options[kv.Key] = kv.Value;
            if (add.Villagers.HasValue) now.Villagers = add.Villagers;
            Change(path, j =>
            {
                var opts = new JObj();
                foreach (var kv in now.Options) opts[kv.Key] = kv.Value;
                var p = new JObj();
                if (opts.Count > 0) p["options"] = opts;
                if (now.Villagers.HasValue) p["villagers"] = now.Villagers.Value;
                j["pending"] = p;
            });
        }

        public static void ClearPending(string path = null)
        {
            if (!J.Has(Read(path), "pending")) return;
            Change(path, j => j.Remove("pending"));
        }
    }
}

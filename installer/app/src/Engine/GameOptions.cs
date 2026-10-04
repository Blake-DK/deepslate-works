using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.5.0 (docs/30 §2, §6): the game's own options.txt, for the Settings tab and the engine. The file is the truth: it is
    /// read every time and only the named lines change (every other line, the order and the line endings stay; a missing
    /// line is added at the end; written to options.txt.new, then moved over). The keys the tab shows (Known) were
    /// checked against a file written by Minecraft 1.21.1 with this pack's Sodium (tests/fixtures/options-1.21.1.txt).
    /// Pure: no WPF. SetRenderDistance and SetChatLinks (Files.cs) stay as they are.
    /// </summary>
    public static class GameOptions
    {
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        /// <summary>One line of options.txt as the tab shows it: a whole number in the tab's units (chunks, %, degrees,
        /// or the index of a choice), from Min to Max in steps of Step, and how it is written in the file.</summary>
        public sealed class Option
        {
            public string Key, Label;          // Label: lower case, for the log and the engine's tick line
            public int Min, Max, Step = 1;
            public string[] Choices;           // a choice: the words, by index (null for a number or a switch)
            public bool Switch;                // true / false
            internal Func<string, double?> Parse;   // the file's text in the tab's units (null: not readable)
            internal Func<int, string> Write;       // the tab's units in the file's text
            internal Func<double, string> Say;      // a value in the tab's units, in words ("24", "150 %", "unlimited")
        }

        /// <summary>docs/30 §4.2, in the tab's order.</summary>
        public static readonly Option[] Known =
        {
            Number("renderDistance", "render distance", 4, 16, 1),
            Percent("entityDistanceScaling", "entity distance", 50, 500, 25),
            new Option { Key = "maxFps", Label = "frame rate limit", Min = 30, Max = UnlimitedFps, Step = 10, Parse = Whole, Write = v => v.ToString(Inv), Say = v => v >= UnlimitedFps ? "unlimited" : Fmt(v) },
            Toggle("enableVsync", "VSync"),
            Toggle("fullscreen", "full screen"),
            Choice("graphicsMode", "graphics", new[] { "Fast", "Fancy" }, new[] { "0", "1" }, new Dictionary<string, string> { { "2", "Fabulous" } }),
            Choice("renderClouds", "clouds", new[] { "Off", "Fast", "Fancy" }, new[] { "\"false\"", "\"fast\"", "\"true\"" }, null),
            Choice("particles", "particles", new[] { "All", "Fewer", "Fewest" }, new[] { "0", "1", "2" }, null),
            Toggle("ao", "smooth lighting"),
            Toggle("entityShadows", "entity shadows"),
            new Option { Key = "fov", Label = "field of view", Min = 30, Max = 110, Parse = t => Dbl(t) is double d ? d * 40 + 70 : (double?)null, Write = FovToFile, Say = Fmt },
            Percent("gamma", "brightness", 0, 100, 1),
            Choice("guiScale", "menu and text size", new[] { "Auto", "1", "2", "3", "4" }, new[] { "0", "1", "2", "3", "4" }, null),
            Percent("soundCategory_master", "volume", 0, 100, 1),
            Percent("soundCategory_music", "music", 0, 100, 1),
        };

        public const int UnlimitedFps = 260;

        public static Option Find(string key) => Known.FirstOrDefault(o => o.Key == key);
        public static bool IsKnown(string key) => key != null && Find(key) != null;

        // ---- the kinds ------------------------------------------------------------------------------------------------
        static Option Number(string key, string label, int min, int max, int step)
            => new Option { Key = key, Label = label, Min = min, Max = max, Step = step, Parse = Whole, Write = v => v.ToString(Inv), Say = Fmt };
        static Option Percent(string key, string label, int min, int max, int step)
            => new Option { Key = key, Label = label, Min = min, Max = max, Step = step, Parse = t => Dbl(t) is double d ? d * 100 : (double?)null, Write = PercentToFile, Say = v => Fmt(v) + " %" };
        static Option Toggle(string key, string label)
            => new Option { Key = key, Label = label, Min = 0, Max = 1, Switch = true, Parse = t => t == "true" ? 1 : t == "false" ? 0 : (double?)null, Write = v => v != 0 ? "true" : "false", Say = v => v != 0 ? "on" : "off" };
        /// <summary>A choice: file texts by index; others: file texts the game knows but the tab does not offer, in words.</summary>
        static Option Choice(string key, string label, string[] words, string[] file, Dictionary<string, string> others)
            => new Option
            {
                Key = key, Label = label, Min = 0, Max = words.Length - 1, Choices = words,
                Parse = t => { var i = Array.IndexOf(file, t); if (i >= 0) return i; if (others != null && others.ContainsKey(t)) return words.Length; return Whole(t); },
                Write = v => file[Math.Max(0, Math.Min(file.Length - 1, v))],
                Say = v => { var i = (int)v; if (i >= 0 && i < words.Length) return words[i].ToLowerInvariant(); return null; },
            };

        static double? Dbl(string t) => double.TryParse(t, NumberStyles.Float, Inv, out var d) && !double.IsNaN(d) && !double.IsInfinity(d) ? d : (double?)null;
        static double? Whole(string t) => int.TryParse(t, NumberStyles.Integer, Inv, out var i) ? i : (double?)null;
        static string Fmt(double v) => Math.Round(v, 2).ToString("0.##", Inv);

        /// <summary>A number as Java's Double.toString writes it in this range: always with a decimal point ("1.0", "0.25").</summary>
        public static string JavaDouble(double d)
        {
            var s = d.ToString("R", Inv);
            if (s == "-0") s = "0";
            return s.IndexOf('.') >= 0 || s.IndexOf('E') >= 0 ? s : s + ".0";
        }

        // ---- the two conversions (docs/30 §4.2) ------------------------------------------------------------------------
        /// <summary>Field of view: the file holds (degrees − 70) / 40, so 70 is 0.0, 30 is -1.0 and 110 is 1.0.</summary>
        public static string FovToFile(int degrees) => JavaDouble((degrees - 70) / 40.0);
        public static int FovFromFile(string text) => Dbl(text) is double d ? (int)Math.Round(d * 40 + 70) : 70;
        /// <summary>A percentage: the file holds 0.0 to 1.0 (100 % is 1.0; entity distance 50 % to 500 % is 0.5 to 5.0).</summary>
        public static string PercentToFile(int percent) => JavaDouble(percent / 100.0);
        public static int PercentFromFile(string text) => Dbl(text) is double d ? (int)Math.Round(d * 100) : 100;

        // ---- shown on the tab -------------------------------------------------------------------------------------------
        /// <summary>A line as the tab shows it: the nearest value it can show, and, when that is not what the file holds
        /// (Fabulous, a render distance of 24, a guiScale of 6, something unreadable), the file's value in words.</summary>
        public sealed class Shown
        {
            public int Value;
            public bool Fits = true;
            public string InGame;   // "(set in game: 24)" says this; null when it fits
        }

        public static Shown Show(string key, string fileText, int fallback)
        {
            var o = Find(key) ?? throw new ArgumentException("not a known option: " + key);
            var p = fileText == null ? null : o.Parse(fileText);
            if (!p.HasValue) return new Shown { Value = Snap(o, fallback), Fits = fileText == null, InGame = fileText == null ? null : Unquote(fileText) };
            var v = Snap(o, p.Value);
            var fits = Math.Abs(v - p.Value) < 1e-6;
            return new Shown { Value = v, Fits = fits, InGame = fits ? null : InWords(o, fileText, p.Value) };
        }

        /// <summary>The nearest value the control can take.</summary>
        public static int Snap(Option o, double v)
        {
            var c = Math.Max(o.Min, Math.Min(o.Max, v));
            var steps = Math.Round((c - o.Min) / o.Step, MidpointRounding.AwayFromZero);
            return (int)Math.Min(o.Max, o.Min + steps * o.Step);
        }

        static string Unquote(string t) => t.Length >= 2 && t[0] == '"' && t[t.Length - 1] == '"' ? t.Substring(1, t.Length - 2) : t;

        static string InWords(Option o, string fileText, double parsed)
        {
            if (o.Choices != null)
            {
                if (o.Key == "graphicsMode" && fileText == "2") return "Fabulous";
                return Unquote(fileText);
            }
            if (o.Switch) return fileText;
            if (o.Key == "maxFps" && parsed >= UnlimitedFps) return "unlimited";
            return o.Say(parsed);
        }

        /// <summary>The file's text for a value of the tab.</summary>
        public static string ToFile(string key, int value) => (Find(key) ?? throw new ArgumentException("not a known option: " + key)).Write(value);

        /// <summary>"render distance 14", "clouds off", "entity distance 150 %": a line of the file in words.</summary>
        public static string Describe(string key, string fileText)
        {
            var o = Find(key);
            if (o == null) return key + " " + fileText;
            var p = o.Parse(fileText ?? "");
            var w = p.HasValue ? (o.Choices != null && (p.Value < 0 || p.Value >= o.Choices.Length) ? InWords(o, fileText, p.Value) : o.Say(p.Value)) : Unquote(fileText ?? "");
            return o.Label + " " + (w ?? Unquote(fileText ?? ""));
        }

        // ---- the file ---------------------------------------------------------------------------------------------------
        static readonly Regex LineRe = new Regex(@"(?m)^([^:\r\n]+):(.*?)(?=\r?$)", RegexOptions.Compiled);

        /// <summary>The known keys' values as the file holds them (the last line wins, as in the game). Empty when there
        /// is no file.</summary>
        public static Dictionary<string, string> Read(string path)
        {
            var r = new Dictionary<string, string>(StringComparer.Ordinal);
            if (!File.Exists(path)) return r;
            foreach (Match m in LineRe.Matches(File.ReadAllText(path)))
                if (IsKnown(m.Groups[1].Value)) r[m.Groups[1].Value] = m.Groups[2].Value;
            return r;
        }

        /// <summary>
        /// The named lines set to the given file texts, nothing else touched: every other line, the order and the line
        /// endings stay; a key the file lacks is added at the end (with the file's own line ending, CRLF for a new file).
        /// Only Known keys; a value with a line break is refused. Returns the keys whose text changed (empty: the file
        /// was not written at all).
        /// </summary>
        public static List<string> Set(string path, IDictionary<string, string> values)
        {
            var changed = new List<string>();
            if (values == null || values.Count == 0) return changed;
            foreach (var kv in values)
            {
                if (!IsKnown(kv.Key)) throw new ArgumentException("not a known option: " + kv.Key);
                if (kv.Value == null || kv.Value.IndexOfAny(new[] { '\r', '\n' }) >= 0) throw new ArgumentException("not a value for " + kv.Key);
            }
            var text = File.Exists(path) ? File.ReadAllText(path) : "";
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var neu = LineRe.Replace(text, m =>
            {
                var k = m.Groups[1].Value;
                if (!values.TryGetValue(k, out var v)) return m.Value;
                seen.Add(k);
                if (m.Groups[2].Value == v) return m.Value;
                if (!changed.Contains(k)) changed.Add(k);
                return k + ":" + v;
            });
            var nl = Newline(text);
            foreach (var kv in values)
            {
                if (seen.Contains(kv.Key)) continue;
                if (neu.Length > 0 && !neu.EndsWith("\n", StringComparison.Ordinal)) neu += nl;
                neu += kv.Key + ":" + kv.Value + nl;
                changed.Add(kv.Key);
            }
            if (changed.Count == 0) return changed;
            WriteOver(path, neu);
            return changed;
        }

        static string Newline(string text) => text.Length > 0 && !text.Contains("\r\n") && text.Contains("\n") ? "\n" : "\r\n";

        static void WriteOver(string path, string text)
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var tmp = path + ".new";
            File.WriteAllText(tmp, text, new UTF8Encoding(false));
            Engine.MoveOver(tmp, path);   // 3.5.1 (docs/31 B-63): replaced in one step, never deleted first
        }

        // ---- the resource pack list -------------------------------------------------------------------------------------
        /// <summary>resourcePacks as a list (bottom first: the last entry is on top), or null when the file has none or
        /// it cannot be read.</summary>
        public static List<string> ResourcePacks(string path)
        {
            if (!File.Exists(path)) return null;
            var m = Regex.Match(File.ReadAllText(path), @"(?m)^resourcePacks:(.*?)(?=\r?$)");
            if (!m.Success) return null;
            try { return Extras.ParseList(m.Groups[1].Value); } catch { return null; }
        }

        public static bool HasResourcePack(string path, string id) => (ResourcePacks(path) ?? new List<string>()).Contains(id);

        /// <summary>
        /// docs/30 §4.3: the pack named last in resourcePacks (on top of every other), when it is in the list; a no-op when
        /// it is absent or already last. Only that line changes. True when the file was written.
        /// </summary>
        public static bool KeepOnTop(string path, string id)
        {
            if (!File.Exists(path)) return false;
            var text = File.ReadAllText(path);
            var m = Regex.Match(text, @"(?m)^resourcePacks:(.*?)(?=\r?$)");
            if (!m.Success) return false;
            List<string> list;
            try { list = Extras.ParseList(m.Groups[1].Value); } catch { return false; }
            if (!list.Contains(id) || list[list.Count - 1] == id) return false;
            list.RemoveAll(x => x == id);
            list.Add(id);
            var line = "resourcePacks:" + PackListText(list);
            WriteOver(path, text.Substring(0, m.Index) + line + text.Substring(m.Index + m.Length));
            return true;
        }

        /// <summary>A pack list as the game writes it: ["vanilla","file/x.zip"], no spaces.</summary>
        public static string PackListText(IEnumerable<string> list)
            => "[" + string.Join(",", list.Select(x => "\"" + x.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"")) + "]";
    }
}

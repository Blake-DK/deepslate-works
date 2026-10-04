using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>What a settings file change did: status changed | same | left, and a line for the person.</summary>
    public sealed class SettingResult
    {
        public string Status = "", Text = "";
        public SettingResult(string status, string text) { Status = status; Text = text; }
    }

    public static partial class Extras
    {
        // ---- visual extras (1.6.0, planner 2026-10-01) ----------------------------------------------------------
        // Resource packs and shader packs live in resourcepacks\ and shaderpacks\. Only files the pack itself put there
        // are ever taken out; a player's own packs are never touched.

        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        /// <summary>Written to .new, then moved over the file (Move-Item -Force). 3.5.1 (docs/31 B-63): replaced in one step,
        /// never deleted first, so a stop half-way cannot lose options.txt and its keybinds.</summary>
        static void WriteOver(string path, string text)
        {
            var tmp = path + ".new";
            File.WriteAllText(tmp, text, Utf8);
            Engine.MoveOver(tmp, path);
        }

        /// <summary>A JSON list read the way @((ConvertFrom-Json $t) | % { [string]$_ }) read it; throws when it is not JSON.</summary>
        internal static List<string> ParseList(string t)
        {
            if (string.IsNullOrWhiteSpace(t)) throw new FormatException("empty");
            var v = Json.Parse(t);
            var r = new List<string>();
            foreach (var x in ExtrasManifest.Many(v)) r.Add(x == null ? "" : x is bool b ? (b ? "True" : "False") : Convert.ToString(x, CultureInfo.InvariantCulture));
            return r;
        }

        /// <summary>
        /// Set-ResourcePackList: options.txt "resourcePacks": ours that are wanted are added at the end (on top), ours that
        /// are not are taken out. Everything else in the list, and its order, stays. want and ours are file names.
        /// </summary>
        public static SettingResult SetResourcePackList(string path, IEnumerable<string> want, IEnumerable<string> ours)
        {
            var wantL = (want ?? new string[0]).Where(x => !string.IsNullOrEmpty(x)).ToList();
            var wantIds = wantL.Select(x => "file/" + x).ToList();
            var oursIds = (ours ?? new string[0]).Concat(wantL).Where(x => !string.IsNullOrEmpty(x)).Select(x => "file/" + x).ToList();
            var text = File.Exists(path) ? File.ReadAllText(path) : "";
            var nl = "\r\n";
            if (text.Length > 0 && !text.Contains("\r\n") && text.Contains("\n")) nl = "\n";
            var m = Regex.Match(text, @"(?m)^resourcePacks:(.*?)(?=\r?$)");
            var list = new List<string> { "vanilla" };
            if (m.Success)
            {
                try { list = ParseList(m.Groups[1].Value); }
                catch { return new SettingResult("left", "Resource packs left as they are (options.txt has a list this cannot read)"); }
            }
            else if (wantIds.Count == 0) return new SettingResult("same", "No resource packs to switch on");
            var neu = new List<string>();
            foreach (var x in list) if ((!Extras_.Has(oursIds, x) || Extras_.Has(wantIds, x)) && !neu.Contains(x)) neu.Add(x);
            foreach (var x in wantIds) if (!neu.Contains(x)) neu.Add(x);
            if (m.Success && Extras_.Same(string.Join("\n", neu), string.Join("\n", list))) return new SettingResult("same", "Resource packs already as chosen");
            var line = "resourcePacks:[" + string.Join(",", neu.Select(x => "\"" + x.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"")) + "]";
            string outText;
            if (m.Success) outText = text.Substring(0, m.Index) + line + text.Substring(m.Index + m.Length);
            else { outText = text; if (outText.Length > 0 && !outText.EndsWith("\n", StringComparison.Ordinal)) outText += nl; outText += line + nl; }
            WriteOver(path, outText);
            if (wantIds.Count > 0) return new SettingResult("changed", "Resource pack switched on: " + string.Join(", ", wantL));
            return new SettingResult("changed", "Visual extras' resource pack switched off");
        }

        /// <summary>Set-IrisShader: config\iris.properties: the shader pack chosen, or shaders off ("" = None). Other settings stay.</summary>
        public static void SetIrisShader(string path, string pack)
        {
            var text = File.Exists(path) ? File.ReadAllText(path) : "";
            var nl = "\r\n";
            if (text.Length > 0 && !text.Contains("\r\n") && text.Contains("\n")) nl = "\n";
            var set = new List<KeyValuePair<string, string>> { new KeyValuePair<string, string>("enableShaders", string.IsNullOrEmpty(pack) ? "false" : "true") };
            if (!string.IsNullOrEmpty(pack)) set.Add(new KeyValuePair<string, string>("shaderPack", pack));
            foreach (var kv in set)
            {
                var re = "(?m)^" + Regex.Escape(kv.Key) + @"\s*[=:].*?(?=\r?$)";
                if (Regex.IsMatch(text, re)) text = Regex.Replace(text, re, (kv.Key + "=" + kv.Value).Replace("$", "$$"));
                else { if (text.Length > 0 && !text.EndsWith("\n", StringComparison.Ordinal)) text += nl; text += kv.Key + "=" + kv.Value + nl; }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            WriteOver(path, text);
        }
    }
}

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>Where the extras live in the game folder (Get-ExtrasPaths).</summary>
    public sealed class ExtrasPaths
    {
        public string Extras, Pictures, Mods, ResourcePacks, ShaderPacks, Options, Iris, Staging, LatestLog;

        /// <summary>One of the three folders an extra's file goes into: "mods" | "resourcepacks" | "shaderpacks".</summary>
        public string this[string folder]
        {
            get
            {
                switch (folder)
                {
                    case "mods": return Mods;
                    case "resourcepacks": return ResourcePacks;
                    case "shaderpacks": return ShaderPacks;
                    default: throw new ArgumentException("not an extras folder: " + folder);
                }
            }
        }
    }

    /// <summary>One file of an extra, as the site's list (GET /api/modpack/extras) has it.</summary>
    public sealed class ExtraFile
    {
        public string Filename = "", Kind = "", Url = "", Sha512 = "";
        public long Size;
    }

    /// <summary>One extra from the site's list: id, name, one-line description, FPS cost, shader (light|full for the two
    /// shader packs, else null), what it requires, its mod ids (to find loading errors about it), its files, its picture.</summary>
    public sealed class ExtraItem
    {
        public string Id = "", Name, Description = "", Fps = "", Shader, Picture;
        public List<string> Requires = new List<string>();
        public List<string> ModIds = new List<string>();
        public List<ExtraFile> Files = new List<ExtraFile>();
        /// <summary>A shader pack (the Shaders choice under Iris), not a switch of its own.</summary>
        public bool IsShader => !string.IsNullOrEmpty(Shader);
    }

    /// <summary>The site's extras list (extras-manifest.json is the copy kept for the tab to work offline).</summary>
    public sealed class ExtrasManifest
    {
        public List<ExtraItem> Extras = new List<ExtraItem>();
        /// <summary>All the extras together, in bytes (null when the list does not say).</summary>
        public double? Size;
        /// <summary>The JSON as the site sent it: what is saved to extras-manifest.json.</summary>
        public object Raw;

        public ExtraItem Find(string id) => Extras.FirstOrDefault(x => Extras_.Same(x.Id, id));

        public static ExtrasManifest FromJson(object j)
        {
            if (j == null) return null;
            var m = new ExtrasManifest { Raw = j, Size = J.Num(j, "size") };
            foreach (var o in Many(J.Get(j, "extras")))
            {
                if (!(o is JObj xo)) continue;
                var x = new ExtraItem
                {
                    Id = J.Str(xo, "id") ?? "",
                    Name = J.Str(xo, "name"),
                    Description = J.Str(xo, "description") ?? "",
                    Fps = J.Str(xo, "fps") ?? "",
                    Shader = J.Str(xo, "shader"),
                    Picture = J.Str(xo, "picture"),
                };
                foreach (var r in Many(J.Get(xo, "requires"))) if (r != null) x.Requires.Add(Convert.ToString(r, CultureInfo.InvariantCulture));
                foreach (var r in Many(J.Get(xo, "modIds"))) if (r != null) x.ModIds.Add(Convert.ToString(r, CultureInfo.InvariantCulture));
                foreach (var f in Many(J.Get(xo, "files")))
                {
                    if (!(f is JObj fo)) continue;
                    x.Files.Add(new ExtraFile
                    {
                        Filename = J.Str(fo, "filename") ?? "",
                        Kind = J.Str(fo, "kind") ?? "",
                        Url = J.Str(fo, "url") ?? "",
                        Sha512 = J.Str(fo, "sha512") ?? "",
                        Size = J.Long(fo, "size") ?? 0,
                    });
                }
                m.Extras.Add(x);
            }
            return m;
        }

        /// <summary>extras-manifest.json, or null when there is none (or it cannot be read).</summary>
        public static ExtrasManifest Read(string path) => FromJson(Json.ReadFile(path));

        /// <summary>@($x) in PowerShell: a list stays a list, one value becomes a list of one, null none.</summary>
        internal static List<object> Many(object v)
        {
            if (v == null) return new List<object>();
            if (v is List<object> l) return l;
            return new List<object> { v };
        }
    }

    /// <summary>A set of switches: the extras switched on, and the shader (none | light | full). Also the queue ("Later"),
    /// which has the time it was queued.</summary>
    public sealed class ExtrasChoice
    {
        public Dictionary<string, bool> Choices = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        public string Shader = "none";
        public string At;

        public ExtrasChoice() { }
        public ExtrasChoice(IDictionary<string, bool> choices, string shader, string at = null)
        {
            if (choices != null) foreach (var kv in choices) Choices[kv.Key] = kv.Value;
            Shader = shader ?? "none"; At = at;
        }
        public bool On(string id) => id != null && Choices.TryGetValue(id, out var b) && b;
    }

    /// <summary>The last Apply: when, whether it worked, and why not in plain English (lastApply in extras.json).</summary>
    public sealed class ExtrasLastApply
    {
        public string At;
        public bool Ok;
        public string Error = "";
        public string Summary = "";
    }

    /// <summary>The extras' file names that are in place now, per folder (applied in extras.json).</summary>
    public sealed class ExtrasApplied
    {
        public List<string> Mods = new List<string>(), ResourcePacks = new List<string>(), ShaderPacks = new List<string>();
        public List<string> this[string folder]
        {
            get
            {
                switch (folder)
                {
                    case "mods": return Mods;
                    case "resourcepacks": return ResourcePacks;
                    case "shaderpacks": return ShaderPacks;
                    default: throw new ArgumentException("not an extras folder: " + folder);
                }
            }
            set
            {
                switch (folder)
                {
                    case "mods": Mods = value; break;
                    case "resourcepacks": ResourcePacks = value; break;
                    case "shaderpacks": ShaderPacks = value; break;
                    default: throw new ArgumentException("not an extras folder: " + folder);
                }
            }
        }
    }

    /// <summary>
    /// extras.json in %LOCALAPPDATA%\DeepslateWorks (New/Read/Save-ExtrasState). 2.0.x and 3.0 share it, so it reads and
    /// writes exactly the shape 2.0.x wrote: {version:2, choices:{id:bool}, shader, applied:{mods,resourcepacks,shaderpacks},
    /// seen:[ids], downloaded, queued:{choices, shader, at}|null, lastApply:{at, ok, error, summary}|null, installedAt}.
    /// Choices / Shader are what is wanted; Applied is what is in place now.
    /// </summary>
    public sealed class ExtrasState
    {
        public Dictionary<string, bool> Choices = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        public string Shader = "none";
        public ExtrasApplied Applied = new ExtrasApplied();
        public List<string> Seen = new List<string>();
        public bool Downloaded;
        public ExtrasChoice Queued;
        public ExtrasLastApply LastApply;
        public string InstalledAt;

        public bool On(string id) => id != null && Choices.TryGetValue(id, out var b) && b;

        static readonly string[] Shaders = { "none", "light", "full" };
        static bool ShaderOk(string s) => s != null && Shaders.Any(x => string.Equals(x, s, StringComparison.OrdinalIgnoreCase));

        /// <summary>[bool] of a JSON value, the way PowerShell casts it.</summary>
        static bool Truthy(object v)
        {
            if (v == null) return false;
            if (v is bool b) return b;
            if (v is string s) return s.Length > 0;
            if (v is long l) return l != 0;
            if (v is double d) return d != 0;
            return true;
        }
        static Dictionary<string, bool> ReadChoices(object o)
        {
            var c = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            if (o is JObj jo) foreach (var k in jo.OrderedKeys) c[k] = Truthy(jo[k]);
            return c;
        }
        static List<string> Strings(object v, bool dropEmpty)
        {
            var r = new List<string>();
            foreach (var x in ExtrasManifest.Many(v))
            {
                var s = x == null ? "" : Convert.ToString(x, CultureInfo.InvariantCulture);
                if (dropEmpty && !Truthy(x)) continue;
                r.Add(s);
            }
            return r;
        }

        /// <summary>Read-ExtrasState: a new state (nothing on) when the file is missing or cannot be read.</summary>
        public static ExtrasState Read(string path)
        {
            var s = new ExtrasState();
            var j = Json.ReadFile(path) as JObj;
            if (j == null) return s;
            if (Truthy(j["choices"])) s.Choices = ReadChoices(j["choices"]);
            var sh = J.Str(j, "shader");
            if (ShaderOk(sh)) s.Shader = sh;
            if (j["applied"] is JObj ap)
                foreach (var k in new[] { "mods", "resourcepacks", "shaderpacks" })
                    if (ap.ContainsKey(k)) s.Applied[k] = Strings(ap[k], true);
            if (j.ContainsKey("seen")) s.Seen = Strings(j["seen"], false);
            if (j.ContainsKey("downloaded")) s.Downloaded = Truthy(j["downloaded"]);
            if (j["queued"] is JObj q)
            {
                var qc = new ExtrasChoice { At = Extras.IsoText(q["at"]) };
                if (q["choices"] is JObj) qc.Choices = ReadChoices(q["choices"]);
                var qs = J.Str(q, "shader");
                if (ShaderOk(qs)) qc.Shader = qs;
                s.Queued = qc;
            }
            if (j["lastApply"] is JObj la)
                s.LastApply = new ExtrasLastApply { At = Extras.IsoText(la["at"]), Ok = Truthy(la["ok"]), Error = J.Str(la, "error") ?? "", Summary = J.Str(la, "summary") ?? "" };
            if (Truthy(j["installedAt"])) s.InstalledAt = Extras.IsoText(j["installedAt"]);
            return s;
        }

        static JObj ChoicesJson(Dictionary<string, bool> c) { var o = new JObj(); foreach (var kv in c) o[kv.Key] = kv.Value; return o; }

        /// <summary>The JSON Save-ExtrasState writes.</summary>
        public JObj ToJson()
        {
            return J.O(
                "version", 2,
                "choices", ChoicesJson(Choices),
                "shader", Shader,
                "applied", J.O("mods", new List<string>(Applied.Mods), "resourcepacks", new List<string>(Applied.ResourcePacks), "shaderpacks", new List<string>(Applied.ShaderPacks)),
                "seen", new List<string>(Seen),
                "downloaded", Downloaded,
                "queued", Queued == null ? null : J.O("choices", ChoicesJson(Queued.Choices), "shader", Queued.Shader, "at", Queued.At),
                "lastApply", LastApply == null ? null : J.O("at", LastApply.At, "ok", LastApply.Ok, "error", LastApply.Error ?? "", "summary", LastApply.Summary ?? ""),
                "installedAt", InstalledAt);
        }

        /// <summary>Save-ExtrasState (written to .new, then moved over).</summary>
        public void Save(string path) => Json.WriteFile(path, ToJson());

        /// <summary>Get-ChosenState: the choices that count now: the queued ones (chosen with Later), else the saved ones.
        /// A view: Applied is shared, nothing else is.</summary>
        public ExtrasState Chosen()
        {
            if (Queued == null) return this;
            return new ExtrasState { Choices = Queued.Choices, Shader = Queued.Shader, Applied = Applied };
        }

        /// <summary>This state's applied files and installed time, with other switches (what Apply is about to install).</summary>
        public ExtrasState With(ExtrasChoice pick) => new ExtrasState { Choices = pick.Choices, Shader = pick.Shader, Applied = Applied };
    }

    /// <summary>Get-ExtrasWanted's answer: per folder the files that should be there for what is on, every file the list
    /// knows per folder, each file's sha512 and its extra, and the chosen shader pack's file ("" for none).</summary>
    public sealed class ExtrasWanted
    {
        public readonly Dictionary<string, List<string>> In = NewFolders();
        public readonly Dictionary<string, List<string>> Known = NewFolders();
        public readonly Dictionary<string, string> Sha = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public readonly Dictionary<string, ExtraItem> Owner = new Dictionary<string, ExtraItem>(StringComparer.OrdinalIgnoreCase);
        public string ShaderFile = "";
        public List<string> Mods => In["mods"];
        public List<string> ResourcePacks => In["resourcepacks"];
        public List<string> ShaderPacks => In["shaderpacks"];
        public ExtraItem OwnerOf(string file) => file != null && Owner.TryGetValue(file, out var x) ? x : null;
        static Dictionary<string, List<string>> NewFolders() => new Dictionary<string, List<string>> { { "mods", new List<string>() }, { "resourcepacks", new List<string>() }, { "shaderpacks", new List<string>() } };
    }

    /// <summary>What Invoke-ExtrasApply answered: ok, files moved, the error (as thrown) and the plain-English line.</summary>
    public sealed class ApplyResult
    {
        public bool Ok;
        public int Moved;
        public string Error;
        public string Summary = "";
    }

    /// <summary>What Sync-ExtrasFiles did: files downloaded, old files removed, and the install it ran (null: none).</summary>
    public sealed class SyncResult
    {
        public int Downloaded, Removed;
        public ApplyResult Applied;
    }

    /// <summary>One check (planner C). Group: Files | Settings | Dependencies | In game. Id: the extra's id or "".
    /// Ok: true, false, or null (waiting).</summary>
    public sealed class ExtrasCheck
    {
        public string Group = "", Id = "", Text = "";
        public bool? Ok;
        public ExtrasCheck() { }
        public ExtrasCheck(string group, string id, bool? ok, string text) { Group = group; Id = id ?? ""; Ok = ok; Text = text ?? ""; }
        public override string ToString() => string.Format("[{0}] {1}: {2}", Ok == true ? "OK" : Ok == null ? "WAIT" : "FAIL", Group, Text);
    }

    /// <summary>The game's last session from logs\latest.log (Read-GameSession).</summary>
    public sealed class GameSession
    {
        public DateTime? StartedAt;   // UTC
        public readonly HashSet<string> Found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public List<string> Packs = new List<string>();
        public bool Failed;
        public readonly List<string> Errors = new List<string>();
        public bool Loaded;
        // 2.1.0: servers it went for ("Connecting to host, port"); refused = the server refused it at the handshake
        public readonly List<string> Connects = new List<string>();
        public bool Refused;
        public string RefusedMod, RefusedChannel;
    }

    /// <summary>Per extra in game: active | waiting | problem (with Reason) | off | off-loaded.</summary>
    public sealed class InGameState
    {
        public string State = "", Reason = "";
        public InGameState() { }
        public InGameState(string state, string reason = "") { State = state; Reason = reason ?? ""; }
    }

    /// <summary>One extra's status in words and a tone: grey | blue | amber | green | red (planner G).</summary>
    public sealed class ExtraStatus
    {
        public string Text = "", Tone = "";
        public ExtraStatus() { }
        public ExtraStatus(string text, string tone) { Text = text; Tone = tone; }
        /// <summary>The status row shows "Restart now" (the change waits for the game to close).</summary>
        public bool ShowsRestart => Text == "Waiting for the game to close" || Text == "Off, removed when the game closes";
        /// <summary>The status row shows "Show details" (red).</summary>
        public bool ShowsDetails => Tone == "red";
    }

    /// <summary>The line at the top of the Extras tab, and its button: Action "play" (Play now), "restart" (Restart now) or null.</summary>
    public sealed class ExtrasHeadline
    {
        public string Text = "", Action;
        public ExtrasHeadline() { }
        public ExtrasHeadline(string text, string action) { Text = text; Action = action; }
    }

    /// <summary>After a Yes to the restart question (Get-AfterRestartInstall): start the game again (always), and what to say.</summary>
    public sealed class AfterRestart
    {
        public bool Relaunch;
        public string Say = "";
    }

    /// <summary>A java process: id, image name, command line (Win32_Process; made up in tests).</summary>
    public sealed class GameProcess
    {
        public int Id;
        public string Name = "", CommandLine = "";
    }

    /// <summary>Comparisons the way PowerShell made them (-eq, -contains, hashtable keys: case-insensitive).</summary>
    internal static class Extras_
    {
        public static bool Same(string a, string b) => string.Equals(a ?? "", b ?? "", StringComparison.OrdinalIgnoreCase);
        public static bool Has(IEnumerable<string> list, string v) => list != null && list.Any(x => Same(x, v));
        /// <summary>Sort-Object on text: culture order, case ignored.</summary>
        public static List<string> Sorted(IEnumerable<string> list) => list.OrderBy(x => x, StringComparer.InvariantCultureIgnoreCase).ToList();
        public static string Join(IEnumerable<string> list, string sep) => string.Join(sep, list);
        public static string ReadText(string path) => File.Exists(path) ? File.ReadAllText(path) : null;
    }
}

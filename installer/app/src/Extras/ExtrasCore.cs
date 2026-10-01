using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>
    /// The visual extras (2.0.0, 2.0.1, planner 2026-10-01): downloaded into the game folder's extras\, switched on and off
    /// in the Extras tab by moving files, checked after every install, confirmed from the game's own latest.log, shown per
    /// extra as one status in words. Every action is logged (the Log tab + %LOCALAPPDATA%\DeepslateWorks\logs\
    /// extras-&lt;date&gt;.log). Changes are installed only while the game is closed (Windows locks the jars of a running
    /// game): "Later" queues them.
    /// </summary>
    public static partial class Extras
    {
        static readonly string[] FolderNames = { "mods", "resourcepacks", "shaderpacks" };

        /// <summary>Get-ExtrasPaths: where the extras live under the game folder.</summary>
        public static ExtrasPaths GetPaths(string gameDir)
        {
            var extras = Path.Combine(gameDir, "extras");
            return new ExtrasPaths
            {
                Extras = extras, Pictures = Path.Combine(extras, "pictures"),
                Mods = Path.Combine(gameDir, "mods"), ResourcePacks = Path.Combine(gameDir, "resourcepacks"), ShaderPacks = Path.Combine(gameDir, "shaderpacks"),
                Options = Path.Combine(gameDir, "options.txt"), Iris = Path.Combine(gameDir, "config", "iris.properties"),
                Staging = Path.Combine(gameDir, ".downloading"), LatestLog = Path.Combine(gameDir, "logs", "latest.log"),
            };
        }

        /// <summary>$ExtraFolders / Get-ExtraFolder: the folder a file kind goes into (mod -> mods, resourcepack ->
        /// resourcepacks, shader -> shaderpacks; anything else mods).</summary>
        public static string FolderFor(string kind)
        {
            switch ((kind ?? "").ToLowerInvariant())
            {
                case "resourcepack": return "resourcepacks";
                case "shader": return "shaderpacks";
                default: return "mods";
            }
        }

        // ---- the extras log ---------------------------------------------------------------------------------------
        static readonly object LogGate = new object();
        static readonly List<string> XLogLines = new List<string>();

        /// <summary>Every extras log line as it is written ("[yyyy-MM-dd HH:mm:ss] [ERROR ]text", error): the Log tab.</summary>
        public static event Action<string, bool> Logged;
        /// <summary>The extras log lines of this process ($script:XLogLines).</summary>
        public static string[] LogLines { get { lock (LogGate) return XLogLines.ToArray(); } }
        /// <summary>Tests: forget the lines so far.</summary>
        public static void ClearLogLines() { lock (LogGate) XLogLines.Clear(); }

        /// <summary>XLog: one line per thing done, with the time, into the extras log and the main log; errors marked
        /// "ERROR " (red in the Log tab).</summary>
        public static void XLog(string msg, bool err = false)
        {
            var now = DateTime.Now;
            var line = string.Format(CultureInfo.InvariantCulture, "[{0:yyyy-MM-dd HH:mm:ss}] {1}{2}", now, err ? "ERROR " : "", msg);
            lock (LogGate) XLogLines.Add(line);
            DeepslateWorks.Log.Line("extras: " + (err ? "ERROR " : "") + msg);
            try
            {
                var dir = Path.Combine(Env.AppHome, "logs");
                Directory.CreateDirectory(dir);
                lock (LogGate) File.AppendAllText(Path.Combine(dir, string.Format(CultureInfo.InvariantCulture, "extras-{0:yyyy-MM-dd}.log", now)), line + "\r\n", Utf8);
            }
            catch { }
            try { Logged?.Invoke(line, err); } catch { }
        }

        /// <summary>ConvertTo-IsoText: a time read back from JSON, always ISO text (null when there is none).</summary>
        public static string IsoText(object v)
        {
            if (v is DateTime dt) return dt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            if (v == null || (v is string s && s.Length == 0) || (v is bool b && !b)) return null;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }
        /// <summary>Get-NowIso: now, UTC, ISO with milliseconds.</summary>
        public static string NowIso() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

        /// <summary>Read-ExtrasState (also ExtrasState.Read).</summary>
        public static ExtrasState ReadState(string path) => ExtrasState.Read(path);
        /// <summary>Save-ExtrasState (also ExtrasState.Save).</summary>
        public static void SaveState(string path, ExtrasState s) => s.Save(path);

        // ---- what is on, and which files that means --------------------------------------------------------------

        /// <summary>Get-ExtrasOn: which extras are on: a switch that is on, the shader pack for the Shaders choice (only
        /// with Iris on), and whatever an extra that is on requires. The ids, sorted.</summary>
        public static List<string> GetOn(ExtrasManifest m, ExtrasState s) => GetOn(m, s.Choices, s.Shader);
        static List<string> GetOn(ExtrasManifest m, Dictionary<string, bool> choices, string shader)
        {
            var on = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            bool C(string id) => id != null && choices.TryGetValue(id, out var b) && b;
            foreach (var x in m.Extras)
            {
                if (x.IsShader) { if (C("iris") && Extras_.Same(shader, x.Shader)) on.Add(x.Id); }
                else if (C(x.Id)) on.Add(x.Id);
            }
            foreach (var x in m.Extras) if (on.Contains(x.Id)) foreach (var r in x.Requires) if (!string.IsNullOrEmpty(r)) on.Add(r);
            return Extras_.Sorted(on);
        }

        /// <summary>Get-ExtrasWanted: the files that should be in mods\, resourcepacks\, shaderpacks\ for what is on, and
        /// the shader pack's file.</summary>
        public static ExtrasWanted GetWanted(ExtrasManifest m, ExtrasState s)
        {
            var w = new ExtrasWanted();
            var on = GetOn(m, s);
            foreach (var x in m.Extras)
                foreach (var f in x.Files)
                {
                    var folder = FolderFor(f.Kind);
                    w.Known[folder].Add(f.Filename);
                    w.Sha[f.Filename] = f.Sha512;
                    w.Owner[f.Filename] = x;
                    if (Extras_.Has(on, x.Id))
                    {
                        w.In[folder].Add(f.Filename);
                        if (Extras_.Same(f.Kind, "shader")) w.ShaderFile = f.Filename;
                    }
                }
            return w;
        }

        /// <summary>Get-Sha512: the file's SHA-512, lower-case hex.</summary>
        public static string Sha512(string file)
        {
            using (var sha = SHA512.Create())
            using (var fs = File.OpenRead(file))
                return BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
        }
        static bool ShaIs(string file, string expected) => Extras_.Same(Sha512(file), expected);

        /// <summary>Move-ExtraFile: moves a file, replacing what is there.</summary>
        public static void MoveFile(string from, string to)
        {
            if (File.Exists(to)) File.Delete(to);
            File.Move(from, to);
        }

        /// <summary>Get-ExtraName: the extra's name without " (shaders)", else its id, else "an extra".</summary>
        public static string NameOf(ExtraItem x)
        {
            if (x != null && !string.IsNullOrEmpty(x.Name)) return Regex.Replace(x.Name, @"\s*\(shaders\)$", "", RegexOptions.IgnoreCase);
            if (x != null) return x.Id;
            return "an extra";
        }

        /// <summary>Get-PlainReason: a plain-English reason for what went wrong.</summary>
        public static string PlainReason(string message)
        {
            message = message ?? "";
            bool M(string re) => Regex.IsMatch(message, re, RegexOptions.IgnoreCase);
            if (M("being used by another process|used by another|locked|sharing violation|in use")) return "file in use";
            if (M("not downloaded")) return "not downloaded yet";
            if (M("damaged|hash")) return "the file is damaged";
            if (M("did not arrive|still in")) return "the file could not be moved";
            if (M("denied")) return "Windows refused access to the file";
            return message;
        }

        /// <summary>Format-Switches: "iris=on, fresh-animations=off, ..., shaders=light" (for the log).</summary>
        public static string FormatSwitches(ExtrasManifest m, ExtrasState s)
        {
            var on = GetOn(m, s);
            var parts = m.Extras.Where(x => !x.IsShader).Select(x => string.Format("{0}={1}", x.Id, Extras_.Has(on, x.Id) ? "on" : "off"));
            return string.Join(", ", parts) + ", shaders=" + (s.On("iris") ? s.Shader : "none");
        }

        // ---- install ----------------------------------------------------------------------------------------------

        sealed class Moving { public ExtraItem X; public bool On; }

        /// <summary>
        /// Invoke-ExtrasApply: moves the chosen extras' files from extras\ into the game's folders and the others back, sets
        /// options.txt (Fresh Animations) and Iris's shader, then checks every file. Any error, or a check that fails:
        /// everything is put back as it was, files and settings, and the answer says why in plain English. state.Choices /
        /// state.Shader are what is wanted; state.Applied is what is in place now (updated, with InstalledAt and LastApply).
        /// move: the self test's $io.move (null = MoveFile); the rollback always uses MoveFile.
        /// </summary>
        public static ApplyResult Apply(ExtrasPaths paths, ExtrasManifest m, ExtrasState state, Action<string, string> move = null)
        {
            move = move ?? MoveFile;
            var want = GetWanted(m, state);
            var journal = new List<string[]>();
            var before = new Dictionary<string, string> { { "options", Extras_.ReadText(paths.Options) }, { "iris", Extras_.ReadText(paths.Iris) } };
            var wasOn = new List<string>();
            foreach (var k in FolderNames) foreach (var f in state.Applied[k]) { var o = want.OwnerOf(f); if (o != null && !wasOn.Contains(o.Id)) wasOn.Add(o.Id); }
            var nowOn = GetOn(m, state);
            XLog("apply: before: " + string.Join(", ", Extras_.Sorted(wasOn)) + (wasOn.Count == 0 ? "(nothing on)" : ""));
            XLog("apply: after:  " + FormatSwitches(m, state));
            Moving current = null;   // the extra being moved, for the plain-English summary
            try
            {
                Directory.CreateDirectory(paths.Extras);
                foreach (var folder in FolderNames)
                {
                    var dir = paths[folder];
                    Directory.CreateDirectory(dir);
                    // what was put there before (or what the list knows about and is lying there) and is no longer wanted: back
                    var was = new List<string>();
                    foreach (var f in state.Applied[folder].Concat(want.Known[folder].Where(n => File.Exists(Path.Combine(dir, n)))))
                        if (!string.IsNullOrEmpty(f) && !was.Contains(f)) was.Add(f);
                    foreach (var f in was)
                    {
                        if (Extras_.Has(want.In[folder], f) || Regex.IsMatch(f, @"[\\/]")) continue;
                        var at = Path.Combine(dir, f);
                        if (!File.Exists(at)) continue;
                        current = new Moving { X = want.OwnerOf(f), On = false };
                        var back = Path.Combine(paths.Extras, f);
                        move(at, back);
                        journal.Add(new[] { at, back });
                        XLog(string.Format("apply: moved {0} -> {1}", at, back));
                    }
                    foreach (var f in want.In[folder])
                    {
                        current = new Moving { X = want.OwnerOf(f), On = true };
                        var at = Path.Combine(dir, f);
                        var from = Path.Combine(paths.Extras, f);
                        if (File.Exists(at) && !File.Exists(from)) continue;   // already in place
                        if (!File.Exists(from)) throw new IOException(string.Format("{0} is not downloaded yet", f));
                        move(from, at);
                        journal.Add(new[] { from, at });
                        XLog(string.Format("apply: moved {0} -> {1}", from, at));
                    }
                }
                current = null;
                var r = SetResourcePackList(paths.Options, want.ResourcePacks, want.Known["resourcepacks"]);
                var rpLine = File.Exists(paths.Options) ? Regex.Match(File.ReadAllText(paths.Options), @"(?m)^resourcePacks:.*?(?=\r?$)").Value : "";
                XLog("apply: options.txt " + (r.Status == "changed" ? "written: " + rpLine : "unchanged (" + r.Text + ")"));
                if (state.On("iris"))
                {
                    SetIrisShader(paths.Iris, want.ShaderFile);
                    XLog(string.Format("apply: iris.properties written: enableShaders={0}{1}", want.ShaderFile.Length > 0 ? "true" : "false", want.ShaderFile.Length > 0 ? ", shaderPack=" + want.ShaderFile : ""));
                }
                // the check: what should be there is there and whole; what should not be is not
                foreach (var folder in FolderNames)
                {
                    foreach (var f in want.In[folder])
                    {
                        current = new Moving { X = want.OwnerOf(f), On = true };
                        var at = Path.Combine(paths[folder], f);
                        if (!File.Exists(at)) throw new IOException(string.Format("{0} did not arrive in {1}", f, folder));
                        if (want.Sha.TryGetValue(f, out var sha) && !string.IsNullOrEmpty(sha) && !ShaIs(at, sha)) throw new IOException(string.Format("{0} is damaged", f));
                    }
                    foreach (var f in want.Known[folder])
                        if (!Extras_.Has(want.In[folder], f) && File.Exists(Path.Combine(paths[folder], f)))
                        {
                            current = new Moving { X = want.OwnerOf(f), On = false };
                            throw new IOException(string.Format("{0} is still in {1}", f, folder));
                        }
                }
                state.Applied = new ExtrasApplied { Mods = new List<string>(want.Mods), ResourcePacks = new List<string>(want.ResourcePacks), ShaderPacks = new List<string>(want.ShaderPacks) };
                state.InstalledAt = NowIso();
                state.LastApply = new ExtrasLastApply { At = state.InstalledAt, Ok = true, Error = "", Summary = "" };
                XLog(string.Format("apply: result OK, {0} file(s) moved; on: {1}", journal.Count, nowOn.Count > 0 ? string.Join(", ", nowOn) : "nothing"));
                return new ApplyResult { Ok = true, Moved = journal.Count, Error = null, Summary = "" };
            }
            catch (Exception e)
            {
                var why = e.Message;
                var plain = PlainReason(why);
                var summary = current != null && current.X != null
                    ? string.Format("Couldn't switch {0} {1}: {2}. Nothing was changed.", current.On ? "on" : "off", NameOf(current.X), plain)
                    : string.Format("Couldn't apply your extras: {0}. Nothing was changed.", plain);
                XLog("apply: FAILED: " + why, true);
                XLog("rollback: putting everything back because: " + plain, true);
                for (int i = journal.Count - 1; i >= 0; i--)
                {
                    var mv = journal[i];
                    try { if (File.Exists(mv[1])) { MoveFile(mv[1], mv[0]); XLog(string.Format("rollback: moved {0} -> {1}", mv[1], mv[0])); } }
                    catch (Exception e2) { XLog("rollback: could not put back " + mv[1] + ": " + e2.Message, true); }
                }
                foreach (var k in new[] { "options", "iris" })
                {
                    var p = k == "options" ? paths.Options : paths.Iris;
                    try
                    {
                        var now = Extras_.ReadText(p);
                        if (!string.Equals(now, before[k], StringComparison.Ordinal))
                        {
                            if (before[k] == null) File.Delete(p); else File.WriteAllText(p, before[k], Utf8);
                            XLog(string.Format("rollback: {0} put back as it was", Path.GetFileName(p)));
                        }
                    }
                    catch (Exception e3) { XLog("rollback: could not put back " + p + ": " + e3.Message, true); }
                }
                XLog(string.Format("rollback: done, {0} move(s) undone; the previous set is in place", journal.Count));
                state.LastApply = new ExtrasLastApply { At = NowIso(), Ok = false, Error = plain, Summary = summary };
                return new ApplyResult { Ok = false, Moved = 0, Error = why, Summary = summary };
            }
        }

        /// <summary>Invoke-QueuedInstall: installs what was queued with Later (the game is closed now): the queue becomes the
        /// choice, then Apply. A failed install keeps the previous choice and drops the queue. null when nothing is queued.</summary>
        public static ApplyResult QueuedInstall(ExtrasPaths paths, ExtrasManifest m, ExtrasState state, Action<string, string> move = null)
        {
            if (state.Queued == null) return null;
            var q = state.Queued;
            XLog(string.Format("queued install: queued at {0}, the game is closed, installing now", q.At));
            var prevChoices = state.Choices; var prevShader = state.Shader;
            state.Choices = q.Choices; state.Shader = q.Shader;
            var r = Apply(paths, m, state, move);
            if (r.Ok) { state.Queued = null; XLog("queued install: installed at " + state.InstalledAt); }
            else { state.Choices = prevChoices; state.Shader = prevShader; state.Queued = null; XLog("queued install: failed, the previous set stays; choose again in the Extras tab", true); }
            return r;
        }

        /// <summary>Set-ExtrasQueue: Apply again while changes are queued: the new choice replaces the queue (planner H3).
        /// true when there was a queue already.</summary>
        public static bool SetQueue(ExtrasState state, IDictionary<string, bool> choices, string shader)
        {
            var replaced = state.Queued != null;
            state.Queued = new ExtrasChoice(choices, shader, NowIso());
            return replaced;
        }

        /// <summary>
        /// Sync-ExtrasFiles: the engine, on every Play once extras are allowed: every extra's files in extras\ (or already
        /// in place), checked and logged; what was queued is installed; extras that are on and changed version are swapped;
        /// old files removed. fetch(url, outFile) downloads (the self test's $fetch); a wrong checksum throws.
        /// </summary>
        public static SyncResult SyncFiles(ExtrasPaths paths, ExtrasManifest m, ExtrasState state, Action<string, string> fetch)
        {
            Directory.CreateDirectory(paths.Extras);
            Directory.CreateDirectory(paths.Pictures);
            Directory.CreateDirectory(paths.Staging);
            int got = 0;
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var x in m.Extras)
            {
                if (!string.IsNullOrEmpty(x.Picture)) { try { File.WriteAllBytes(Path.Combine(paths.Pictures, x.Id + ".png"), Convert.FromBase64String(x.Picture)); } catch { } }
                foreach (var f in x.Files)
                {
                    var name = f.Filename;
                    if (Regex.IsMatch(name, @"[\\/]|^\.\.?$")) continue;
                    names.Add(name);
                    var folder = FolderFor(f.Kind);
                    var placed = Path.Combine(paths[folder], name);
                    if (Extras_.Has(state.Applied[folder], name) && File.Exists(placed) && ShaIs(placed, f.Sha512)) continue;
                    var at = Path.Combine(paths.Extras, name);
                    if (File.Exists(at) && ShaIs(at, f.Sha512)) continue;
                    var part = Path.Combine(paths.Staging, name + ".part");
                    DeepslateWorks.Log.RemoveTemp(part);
                    fetch(f.Url, part);
                    var gotSha = File.Exists(part) ? Sha512(part) : "(nothing)";
                    long size = File.Exists(part) ? new FileInfo(part).Length : 0;
                    var ok = Extras_.Same(gotSha, f.Sha512);
                    var exp = f.Sha512 ?? "";
                    XLog(string.Format("download: {0} ({1}), {2} bytes, sha512 expected {3}... got {4}... {5}", name, NameOf(x), size,
                        exp.Substring(0, Math.Min(16, exp.Length)), gotSha.Substring(0, Math.Min(16, gotSha.Length)), ok ? "OK" : "FAILED"), !ok);
                    if (!ok) { DeepslateWorks.Log.RemoveTemp(part); throw new IOException(string.Format("{0} downloaded wrong", name)); }
                    MoveFile(part, at);
                    got++;
                }
            }
            ApplyResult applied = null;
            if (state.Queued != null) applied = QueuedInstall(paths, m, state);
            else
            {
                // an extra that is on, whose file is a new version now: install again (the old file goes back to extras\, then away)
                var placedChanged = false;
                foreach (var folder in FolderNames) foreach (var f in state.Applied[folder]) if (!names.Contains(f)) placedChanged = true;
                var want = GetWanted(m, state);
                foreach (var folder in FolderNames) foreach (var f in want.In[folder]) if (!Extras_.Has(state.Applied[folder], f)) placedChanged = true;
                if (placedChanged) { XLog("update: a new version of an extra that is on: installing it"); applied = Apply(paths, m, state); }
            }
            int removed = 0;
            foreach (var file in new DirectoryInfo(paths.Extras).GetFiles())
            {
                if (!names.Contains(file.Name) && !file.Name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                {
                    try { File.Delete(file.FullName); removed++; XLog("removed an old file: " + file.Name); } catch { }
                }
            }
            return new SyncResult { Downloaded = got, Removed = removed, Applied = applied };
        }

        /// <summary>Get-AppliedExtraJars: the jars of the extras that are on; the engine's mod sync leaves them in mods\.</summary>
        public static List<string> AppliedJars(ExtrasState state) => state.Applied.Mods.Where(x => !string.IsNullOrEmpty(x)).ToList();

        // ---- checks (planner C): files, settings, dependencies, and the game's own log -----------------------------

        /// <summary>Test-Extras: the Files, Settings and Dependencies checks (the Extras tab, Check extras, -VerifyExtras).</summary>
        public static List<ExtrasCheck> Verify(ExtrasPaths paths, ExtrasManifest m, ExtrasState state)
        {
            var checks = new List<ExtrasCheck>();
            var want = GetWanted(m, state);
            var on = GetOn(m, state);
            foreach (var x in m.Extras)
            {
                var isOn = Extras_.Has(on, x.Id);
                foreach (var f in x.Files)
                {
                    var folder = FolderFor(f.Kind);
                    var at = Path.Combine(paths[folder], f.Filename);
                    if (isOn)
                    {
                        if (!File.Exists(at)) checks.Add(new ExtrasCheck("Files", x.Id, false, string.Format("{0}: {1} is missing from {2}", NameOf(x), f.Filename, folder)));
                        else if (!ShaIs(at, f.Sha512)) checks.Add(new ExtrasCheck("Files", x.Id, false, string.Format("{0}: {1} in {2} is not the right file (checksum)", NameOf(x), f.Filename, folder)));
                        else checks.Add(new ExtrasCheck("Files", x.Id, true, string.Format("{0}: {1} in {2}", NameOf(x), f.Filename, folder)));
                    }
                    else if (File.Exists(at)) checks.Add(new ExtrasCheck("Files", x.Id, false, string.Format("{0} is off but {1} is still in {2}", NameOf(x), f.Filename, folder)));
                }
            }
            // settings: options.txt lists the enabled resource packs, in the list's order, and no others of ours
            var text = Extras_.ReadText(paths.Options) ?? "";
            var mt = Regex.Match(text, @"(?m)^resourcePacks:(.*?)(?=\r?$)");
            var list = new List<string>();
            if (mt.Success) { try { list = ParseList(mt.Groups[1].Value); } catch { } }
            var ours = list.Select(x => Regex.Replace(x, "^file/", "", RegexOptions.IgnoreCase)).Where(x => Extras_.Has(want.Known["resourcepacks"], x)).ToList();
            var expected = want.ResourcePacks;
            if (Extras_.Same(string.Join("|", ours), string.Join("|", expected)))
                checks.Add(new ExtrasCheck("Settings", "", true, expected.Count > 0 ? "options.txt switches on " + string.Join(", ", expected) : "options.txt has none of the extras' resource packs"));
            else checks.Add(new ExtrasCheck("Settings", "", false, string.Format("options.txt lists [{0}], should be [{1}]", string.Join(", ", ours), string.Join(", ", expected))));
            if (state.On("iris"))
            {
                var it = Extras_.ReadText(paths.Iris) ?? "";
                var en = Regex.Match(it, @"(?m)^enableShaders\s*[=:]\s*(\S+)").Groups[1].Value;
                var pk = Regex.Match(it, @"(?m)^shaderPack\s*[=:]\s*(.+?)\s*$").Groups[1].Value;
                bool good; string say;
                if (want.ShaderFile.Length > 0) { good = Extras_.Same(en, "true") && Extras_.Same(pk, want.ShaderFile); say = "Iris: shaders on, " + want.ShaderFile; }
                else { good = Extras_.Same(en, "false"); say = "Iris: shaders off"; }
                checks.Add(new ExtrasCheck("Settings", "iris", good, good ? say : string.Format("{0} expected; iris.properties says enableShaders={1}, shaderPack={2}", say, en, pk)));
            }
            // dependencies
            var fa = m.Find("fresh-animations");
            if (fa != null)
            {
                var faOn = Extras_.Has(on, "fresh-animations");
                var jars = fa.Files.Where(f => Extras_.Same(f.Kind, "mod")).Select(f => File.Exists(Path.Combine(paths.Mods, f.Filename))).ToList();
                bool all = jars.Count(b => b) == jars.Count, none = jars.Count(b => b) == 0;
                var good = faOn ? all : none;
                checks.Add(new ExtrasCheck("Dependencies", "fresh-animations", good, faOn
                    ? (good ? "EMF and ETF are there for Fresh Animations" : "Fresh Animations is on but EMF or ETF is missing")
                    : (good ? "EMF and ETF are out with Fresh Animations" : "Fresh Animations is off but EMF or ETF is still there")));
            }
            var iris = m.Find("iris");
            if (iris != null)
            {
                var irisThere = iris.Files.Any(f => File.Exists(Path.Combine(paths.Mods, f.Filename)));
                var needs = state.On("iris") && !Extras_.Same(state.Shader, "none");
                var good = needs ? irisThere : true;
                checks.Add(new ExtrasCheck("Dependencies", "iris", good, needs ? (good ? "Iris is there for the shaders" : "Shaders are chosen but Iris is missing") : "Shaders: none chosen"));
            }
            return checks;
        }

        /// <summary>Read-GameSession: the game's last session from logs\latest.log: when it started, the mod files NeoForge
        /// found, the resource packs the game switched on, and whether mod loading failed. null when there is no log.</summary>
        public static GameSession ReadGameSession(string file)
        {
            if (!File.Exists(file)) return null;
            string[] lines;
            try
            {
                using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sr = new StreamReader(fs))
                    lines = Regex.Split(sr.ReadToEnd(), "\r?\n");
            }
            catch { return null; }
            var s = new GameSession();
            var first = lines.FirstOrDefault(l => !string.IsNullOrEmpty(l)) ?? "";
            var mt = Regex.Match(first, @"^\[(\d{2}[A-Za-z]{3}\d{4} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\]");
            if (mt.Success)
            {
                try { s.StartedAt = DateTime.ParseExact(Regex.Replace(mt.Groups[1].Value, @"\.\d+$", ""), "ddMMMyyyy HH:mm:ss", CultureInfo.InvariantCulture).ToUniversalTime(); } catch { }
            }
            if (s.StartedAt == null) { try { s.StartedAt = File.GetCreationTimeUtc(file); } catch { } }
            var failRe = new Regex("Mod loading has failed|ModLoadingException|LoadingFailedException|Failed to load mod|requires .* but .* is (missing|not installed)|Mod .* (requires|is incompatible)", RegexOptions.IgnoreCase);
            foreach (var l in lines)
            {
                var f = Regex.Match(l, "Found mod file \"([^\"]+)\"");
                if (f.Success) { s.Found.Add(f.Groups[1].Value); continue; }
                var rl = Regex.Match(l, "Reloading ResourceManager: (.*)$", RegexOptions.IgnoreCase);
                if (rl.Success) { s.Packs = Regex.Split(rl.Groups[1].Value, @",\s*").ToList(); s.Loaded = true; continue; }
                var cn = Regex.Match(l, @"Connecting to ([^,\s]+), ?(\d+)");
                if (cn.Success) { s.Connects.Add(cn.Groups[1].Value + ":" + cn.Groups[2].Value); continue; }
                if (Regex.IsMatch(l, @"missing on the client side|neoforge\.network\.negotiation\.failure"))
                {
                    s.Refused = true;
                    var rm = Regex.Match(l, "Channel of mod '([^']{1,80})'"); if (rm.Success) s.RefusedMod = rm.Groups[1].Value;
                    var rc = Regex.Match(l, @"\(([a-z0-9_.-]{1,64}):[a-z0-9_./-]{1,64}\)"); if (rc.Success) s.RefusedChannel = rc.Groups[1].Value;
                    continue;
                }
                if (failRe.IsMatch(l)) { s.Failed = true; s.Errors.Add(l.Trim()); }
            }
            return s;
        }

        static DateTime? ParseIso(string t)
        {
            if (string.IsNullOrEmpty(t)) return null;
            try { return DateTime.Parse(t, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal); } catch { return null; }
        }

        /// <summary>Test-ExtrasInGame: per extra: "active" (the game loaded it in a session after the install), "waiting" (no
        /// game session since the install), "problem" with a reason, "off" or "off-loaded" (switched off, but the last
        /// session still had it).</summary>
        public static Dictionary<string, InGameState> InGame(ExtrasPaths paths, ExtrasManifest m, ExtrasState state, GameSession session)
        {
            var o = new Dictionary<string, InGameState>(StringComparer.OrdinalIgnoreCase);
            var on = GetOn(m, state);
            var since = ParseIso(state.InstalledAt);
            var fresh = session != null && session.StartedAt != null && (since == null || session.StartedAt.Value >= since.Value.AddSeconds(-2));
            var irisSettings = Extras_.ReadText(paths.Iris) ?? "";
            foreach (var x in m.Extras)
            {
                var id = x.Id;
                var isOn = Extras_.Has(on, id);
                var files = x.Files;
                var jarFound = files.Count(f => Extras_.Same(f.Kind, "mod") && session != null && session.Found.Contains(f.Filename));
                var jars = files.Count(f => Extras_.Same(f.Kind, "mod"));
                if (!isOn) { o[id] = new InGameState(fresh && jars > 0 && jarFound > 0 ? "off-loaded" : "off"); continue; }
                if (!fresh) { o[id] = new InGameState("waiting"); continue; }
                var needles = x.ModIds.Concat(files.Select(f => f.Filename)).Where(n => !string.IsNullOrEmpty(n)).ToList();
                var mention = session.Errors.Where(l => needles.Any(n => Regex.IsMatch(l, Regex.Escape(n), RegexOptions.IgnoreCase))).ToList();
                if (mention.Count > 0)
                {
                    var why = "the game could not load it: " + Regex.Replace(mention[0], @"^\[[^\]]*\]\s*(\[[^\]]*\]\s*)*:?\s*", "", RegexOptions.IgnoreCase);
                    if (why.Length > 160) why = why.Substring(0, 157) + "...";
                    o[id] = new InGameState("problem", why); continue;
                }
                if (jars > 0 && jarFound < jars) { o[id] = new InGameState("problem", "the game did not load it (not in its mod list)"); continue; }
                var rp = files.Where(f => Extras_.Same(f.Kind, "resourcepack")).ToList();
                if (rp.Count > 0 && session.Loaded && rp.Any(f => !Extras_.Has(session.Packs, "file/" + f.Filename))) { o[id] = new InGameState("problem", "the game did not switch on its resource pack"); continue; }
                if (rp.Count > 0 && !session.Loaded) { o[id] = new InGameState("waiting"); continue; }
                var sh = files.Where(f => Extras_.Same(f.Kind, "shader")).ToList();
                if (sh.Count > 0 && !Regex.IsMatch(irisSettings, @"(?m)^shaderPack\s*[=:]\s*" + Regex.Escape(sh[0].Filename) + @"\s*$", RegexOptions.IgnoreCase)) { o[id] = new InGameState("problem", "Iris is set to another shader pack (changed in the game?)"); continue; }
                if (session.Failed && jars > 0 && !session.Loaded) { o[id] = new InGameState("problem", "mod loading failed in the game (see the Log tab)"); continue; }
                o[id] = new InGameState("active");
            }
            return o;
        }

        /// <summary>Get-ExtrasInstalled: what is installed, from the files in place (not from what was chosen): the ids of
        /// the extras whose every file is in.</summary>
        public static List<string> Installed(ExtrasManifest m, ExtrasState state)
            => m.Extras.Where(x => x.Files.Count > 0 && x.Files.All(f => Extras_.Has(state.Applied[FolderFor(f.Kind)], f.Filename))).Select(x => x.Id).ToList();

        static InGameState Get(Dictionary<string, InGameState> d, string id) => d != null && id != null && d.TryGetValue(id, out var g) ? g : null;

        /// <summary>Get-ExtraStatus (planner G): one status per extra, in words and a tone. verify: Verify's checks; inGame:
        /// InGame's answer.</summary>
        public static ExtraStatus Status(ExtraItem x, ExtrasManifest m, ExtrasState state, IEnumerable<ExtrasCheck> verify, Dictionary<string, InGameState> inGame, bool gameRunning)
        {
            var id = x.Id;
            var installed = Installed(m, state);
            var chosenOn = Extras_.Has(GetOn(m, state.Chosen()), id);
            var isOn = Extras_.Has(installed, id);
            if (state.Queued != null && chosenOn != isOn)
            {
                if (chosenOn) return new ExtraStatus("Waiting for the game to close", "amber");
                return new ExtraStatus("Off, removed when the game closes", "amber");
            }
            var g = Get(inGame, id);
            if (!isOn)
            {
                if (g != null && g.State == "off-loaded") return new ExtraStatus(gameRunning ? "Off, removed when the game closes" : "Off, takes effect next time you play", "grey");
                return new ExtraStatus("Off", "grey");
            }
            if (state.LastApply != null && !state.LastApply.Ok && Regex.IsMatch(state.LastApply.Summary ?? "", Regex.Escape(NameOf(x)), RegexOptions.IgnoreCase))
                return new ExtraStatus("Problem: " + state.LastApply.Error, "red");
            var bad = (verify ?? new ExtrasCheck[0]).Where(c => Extras_.Same(c.Id, id) && c.Ok == false).ToList();
            if (bad.Count > 0) return new ExtraStatus("Problem: " + bad[0].Text, "red");
            if (g != null && g.State == "problem") return new ExtraStatus("Problem: " + g.Reason, "red");
            if (g != null && g.State == "active") return new ExtraStatus("Active in game", "green");
            return new ExtraStatus("Ready, starts next time you play", "blue");
        }

        /// <summary>Get-ExtrasHeadline (planner G): the line at the top of the tab; Action "play" | "restart" | null.
        /// statuses: Status per extra (not the shader packs).</summary>
        public static ExtrasHeadline Headline(ExtrasManifest m, ExtrasState state, IDictionary<string, ExtraStatus> statuses, bool gameRunning)
        {
            var onIds = GetOn(m, state.Chosen());
            if (gameRunning && state.Queued != null) return new ExtrasHeadline("The game is running. Your changes install when it closes.", "restart");
            if (onIds.Count == 0 && state.Queued == null)
                return new ExtrasHeadline(gameRunning ? "The game is running. No extras are switched on." : "No extras are switched on. Switch some on and press Apply.", null);
            var shown = statuses.Keys.Where(k => Extras_.Has(onIds, k)).ToList();
            var notActive = shown.Where(k => statuses[k].Text != "Active in game").ToList();
            if (notActive.Count == 0 && shown.Count > 0) return new ExtrasHeadline("Everything you've switched on is active in game.", null);
            if (shown.Any(k => statuses[k].Tone == "red")) return new ExtrasHeadline("Something is wrong with an extra: see the red line below.", null);
            if (gameRunning) return new ExtrasHeadline("The game is running. Your extras show as active once it has loaded them.", null);
            return new ExtrasHeadline("The game isn't running. Your extras will be used next time you press Play.", "play");
        }

        /// <summary>Get-ExtrasReport (planner D): the extras block of every report; null when this PC has no extras.</summary>
        public static JObj ReportBlock(ExtrasPaths paths, ExtrasManifest m, ExtrasState state)
        {
            if (m == null || !state.Downloaded) return null;
            var verify = Verify(paths, m, state);
            var inGame = InGame(paths, m, state, ReadGameSession(paths.LatestLog));
            var on = GetOn(m, state);
            string St(string id) { var g = Get(inGame, id); return g?.State; }
            var states = on.Select(St).ToList();
            var ig = on.Count == 0 ? "none" : states.Any(s => s == "problem") ? "problems" : states.Any(s => s == "waiting") ? "waiting" : "active";
            var failed = verify.Where(c => c.Ok == false).ToList();
            return J.O(
                "on", new List<object>(on),
                "shader", state.On("iris") ? state.Shader : "none",
                "queued", state.Queued != null,
                "lastApply", state.LastApply == null ? null : J.O("at", state.LastApply.At, "ok", state.LastApply.Ok, "error", string.IsNullOrEmpty(state.LastApply.Error) ? null : state.LastApply.Error),
                "verify", J.O("ok", failed.Count == 0, "failed", failed.Take(20).Select(c => (object)c.Text).ToList()),
                "inGame", J.O("state", ig,
                              "active", on.Where(id => St(id) == "active").Select(id => (object)id).ToList(),
                              "problems", on.Where(id => St(id) == "problem").Select(id => (object)string.Format("{0}: {1}", id, Get(inGame, id).Reason)).Take(20).ToList()));
        }

        // ---- planner H: what Apply does ------------------------------------------------------------------------

        /// <summary>Get-ApplyRoute: "nothing"; with the game running "ask_restart" (Yes / Later / Allow all), or "restart" when
        /// Allow all was given before; with the game closed "install" (then AfterInstall).</summary>
        public static string ApplyRoute(bool gameRunning, bool changed, bool autoRestart = false)
        {
            if (!changed) return "nothing";
            if (gameRunning) return autoRestart ? "restart" : "ask_restart";
            return "install";
        }
        /// <summary>Get-AfterInstall: "start" when Start the game after Apply was allowed before, else "ask_start".</summary>
        public static string AfterInstall(bool autoStart = false) => autoStart ? "start" : "ask_start";
        /// <summary>Get-AfterRestartInstall: after a Yes the game is always started again; what to say (a failed install
        /// means the old set is back, planner H2).</summary>
        public static AfterRestart AfterRestartInstall(ApplyResult result)
            => new AfterRestart { Relaunch = true, Say = result.Ok ? "Installed and checked." : result.Summary + " The game starts with your previous extras." };
        /// <summary>Test-ExtrasChanged: has anything been switched compared with what is installed?</summary>
        public static bool Changed(ExtrasManifest m, ExtrasState state)
        {
            var w = GetWanted(m, state);
            foreach (var k in FolderNames)
                if (!Extras_.Same(string.Join("|", Extras_.Sorted(w.In[k])), string.Join("|", Extras_.Sorted(state.Applied[k])))) return true;
            return false;
        }
    }
}

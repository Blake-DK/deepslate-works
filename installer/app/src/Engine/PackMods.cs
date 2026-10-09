using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    // ---- the pack's mods, before every launch and in the game that started (2.1.0, ported to 3.0) ----------------------
    // kanefinch, 2026-10-01: "Channel of mod 'Timeless & Classics Guns: Zero' failed to connect: This channel is missing
    // on the client side, but required on the server (tacz:acknowledge) [+1 more]". The game started without TaCZ. The
    // Minecraft Launcher is only ever opened by the engine, after mods\ has been checked file by file against the mod list
    // (TestPackMods), anything missing or wrong fetched again and checked again (OpenLauncherChecked). After a launch the
    // window reads the game's log (TestGameMods) and says so when the game still started without one. Docs: docs/07.

    /// <summary>One mod of the pack that is not right: missing | wrong | unreadable (mods\), not loaded | refused (game).</summary>
    public sealed class MissingMod
    {
        public string Slug = "", Name = "", Filename = "", Why = "";
    }

    /// <summary>{ok, where: folder | game, checked, missing[], elsewhere}: the report's `mods` block (migration 0020).</summary>
    public sealed class ModsCheck
    {
        public bool Ok;
        public string Where = "folder";
        public int Checked;
        public List<MissingMod> Missing = new List<MissingMod>();
        public bool Elsewhere;

        public JObj ToJson() => J.O("ok", Ok, "where", Where, "checked", Checked,
            "missing", Missing.Take(200).Select(m => (object)J.O("slug", m.Slug, "name", m.Name, "filename", m.Filename)).ToList(), "elsewhere", Elsewhere);
    }

    public static partial class Engine
    {
        public const string PackListName = "pack.json";   // the client set of the last mod list, for the game check
        public static string PackListPath => Env.TestTarget ? TestPackListPath : LivePackListPath;
        public static string LivePackListPath => Path.Combine(Env.AppHome, PackListName);
        /// <summary>docs/45: the test pack's own list, so a test run never changes what the live game check compares.</summary>
        public static string TestPackListPath => Path.Combine(Env.AppHome, "pack-test.json");

        /// <summary>The mods PCs get: everything but server-only.</summary>
        public static List<object> PackFiles(object manifest) => J.Arr(manifest, "files").Where(f => f != null && J.Str(f, "side") != "server").ToList();

        public static string ModLabel(object f) { var n = J.Str(f, "name"); return string.IsNullOrEmpty(n) ? (J.Str(f, "slug") ?? "") : n; }

        public static void SavePackList(string path, object manifest)
        {
            var files = PackFiles(manifest).Select(f => (object)J.O("slug", J.Str(f, "slug") ?? "", "name", ModLabel(f), "filename", J.Str(f, "filename") ?? "", "sha512", J.Str(f, "sha512") ?? "")).ToList();
            // 3.3.0: the pack's hash and its settings files too, so the Update button can say what changed without the mod list
            var configs = J.Arr(manifest, "configs").Select(c => (object)J.O("path", J.Str(c, "path") ?? "", "sha256", J.Str(c, "sha256") ?? "")).ToList();
            // 3.5.0: what the Settings tab needs from the mod list between runs: the tier's render distance, the memory
            // limits and the server's view distance (docs/30 §4)
            var settings = J.O("tier", J.Str(manifest, "tier"), "renderDistance", J.Long(manifest, "render_distance"), "serverViewDistance", J.Long(manifest, "server_view_distance"),
                               "ram", J.O("min_gb", J.Num(manifest, "ram.min_gb"), "max_gb", J.Num(manifest, "ram.max_gb"), "user_max_gb", J.Num(manifest, "ram.user_max_gb")));
            Json.WriteFile(path, J.O("version", J.Str(manifest, "version") ?? "", "hash", J.Str(manifest, "hash") ?? "", "server", J.Str(manifest, "server_address") ?? "", "savedAt", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), "files", files, "configs", configs, "settings", settings));
        }

        public static object ReadPackList(string path)
        {
            try { return File.Exists(path) ? Json.ReadFile(path) : null; } catch { return null; }
        }

        /// <summary>mods\ against the mod list: every file there, whole (SHA-512).</summary>
        public static ModsCheck TestPackMods(string modsDir, IEnumerable<object> files)
        {
            var c = new ModsCheck { Where = "folder" };
            foreach (var f in files)
            {
                var name = J.Str(f, "filename");
                if (string.IsNullOrEmpty(name) || name.IndexOfAny(new[] { '\\', '/' }) >= 0) continue;
                c.Checked++;
                var at = Path.Combine(modsDir, name);
                string why = null;
                if (!File.Exists(at)) why = "missing";
                else { try { if (!string.Equals(Sha512Hex(at), J.Str(f, "sha512") ?? "", StringComparison.OrdinalIgnoreCase)) why = "wrong"; } catch { why = "unreadable"; } }
                if (why != null) c.Missing.Add(new MissingMod { Slug = J.Str(f, "slug") ?? "", Name = ModLabel(f), Filename = name, Why = why });
            }
            c.Ok = c.Missing.Count == 0;
            return c;
        }

        /// <summary>The check before the launcher opens; what is missing or wrong is fetched again (fetch: file entry, dest)
        /// and everything checked once more. The launcher opens only when the result is ok.</summary>
        public static ModsCheck RepairPackMods(string modsDir, IList<object> files, Action<object, string> fetch)
        {
            var c = TestPackMods(modsDir, files);
            if (c.Ok) return c;
            Log.Line(string.Format("before the launch: {0} of {1} mods missing or wrong: {2}", c.Missing.Count, c.Checked, string.Join(", ", c.Missing.Select(m => m.Filename + " (" + m.Why + ")"))));
            foreach (var m in c.Missing)
            {
                var f = files.FirstOrDefault(x => J.Str(x, "filename") == m.Filename);
                try { fetch(f, Path.Combine(modsDir, m.Filename)); Log.Line("fetched again: " + m.Filename); }
                catch (Exception e) { Log.Line(string.Format("could not fetch {0} again: {1}", m.Filename, e.Message)); }
            }
            c = TestPackMods(modsDir, files);
            Log.Line("before the launch, checked again: " + (c.Ok ? string.Format("all {0} mods in place", c.Checked) : string.Format("{0} still missing or wrong", c.Missing.Count)));
            return c;
        }

        /// <summary>Planner's words: "Your game started without Timeless &amp; Classics Guns. Press Play to repair."</summary>
        public static string MissingText(ModsCheck c)
        {
            if (c == null || c.Ok) return "";
            if (c.Elsewhere && c.Missing.Count == 0) return "Your game started from another launcher profile, without the Deepslate Works mods. Press Play to repair.";
            var n = c.Missing.Count;
            var first = n > 0 ? c.Missing[0].Name : "some mods";
            var who = n <= 1 ? first : string.Format("{0} and {1} other mod{2}", first, n - 1, n == 2 ? "" : "s");
            if (c.Where == "folder") return string.Format("{0} {1} not on this PC yet. Press Play to repair.", who, n <= 1 ? "is" : "are");
            return string.Format("Your game started without {0}. Press Play to repair.", who);
        }

        /// <summary>The one way the game is started: mods\ checked first; anything missing or wrong and the launcher stays
        /// shut. Every launch goes through the engine and so through here: the Play tab, the Extras tab's Yes, the restart
        /// after Apply, deepslate://play and the shortcuts. open: Open-Launcher (tests put a stand-in in).</summary>
        public static bool OpenLauncherChecked(Run run, string modsDir, IEnumerable<object> files, Func<bool> open = null)
        {
            var c = TestPackMods(modsDir, files);
            if (run != null) run.ModsCheck = c;
            if (!c.Ok) { Log.Line("NOT opening the launcher: " + MissingText(c)); return false; }
            Log.Line(string.Format("all {0} mods checked in place; opening the launcher", c.Checked));
            var ok = (open ?? OpenLauncher)();
            run?.Emit(J.O("t", "launched", "opened", ok));
            return ok;
        }

        /// <summary>The game that started, from its log: which of the pack's mods it found. elsewhere: that game ran from
        /// another folder (another launcher profile) and went for our server. Null when the log says nothing about mod
        /// files (no claim is made then).</summary>
        public static ModsCheck TestGameMods(GameSession s, IEnumerable<object> files, bool elsewhere = false)
        {
            if (s == null) return null;
            if (s.Found.Count == 0 && !s.Refused && !elsewhere) return null;
            var c = new ModsCheck { Where = "game", Elsewhere = elsewhere };
            foreach (var f in files)
            {
                var name = J.Str(f, "filename");
                if (string.IsNullOrEmpty(name)) continue;
                c.Checked++;
                if (!s.Found.Contains(name) && !FoundUnderOwnLocator(s, name)) c.Missing.Add(new MissingMod { Slug = J.Str(f, "slug") ?? "", Name = ModLabel(f), Filename = name, Why = "not loaded" });
            }
            // the server's own words name the mod even when the log lists no files: put it first
            if (!string.IsNullOrEmpty(s.RefusedMod) || !string.IsNullOrEmpty(s.RefusedChannel))
            {
                var ns = s.RefusedChannel ?? "";
                var hit = c.Missing.FirstOrDefault(m =>
                    (ns.Length > 0 && (m.Slug.StartsWith(ns, StringComparison.OrdinalIgnoreCase) || m.Filename.StartsWith(ns, StringComparison.OrdinalIgnoreCase))) ||
                    (!string.IsNullOrEmpty(s.RefusedMod) && (s.RefusedMod.IndexOf(Regex.Replace(m.Name, @"\s*\(.*$", ""), StringComparison.OrdinalIgnoreCase) >= 0 || m.Name.IndexOf(s.RefusedMod, StringComparison.OrdinalIgnoreCase) >= 0)));
                if (hit != null) { c.Missing.Remove(hit); c.Missing.Insert(0, hit); }
                else if (c.Missing.Count == 0) c.Missing.Add(new MissingMod { Slug = ns, Name = !string.IsNullOrEmpty(s.RefusedMod) ? s.RefusedMod : ns, Why = "refused" });
            }
            c.Ok = !elsewhere && c.Missing.Count == 0 && !s.Refused;
            return c;
        }

        /// <summary>3.6.1 (item 4a): a pack file a mod's own locator loaded under another name: the pack's name without
        /// ".jar" inside a file that locator reported (Sodium: "net.caffeinemc." + the name + "-mod.jar").</summary>
        public static bool FoundUnderOwnLocator(GameSession s, string filename)
        {
            var stem = Regex.Replace(filename ?? "", @"\.jar$", "", RegexOptions.IgnoreCase);
            return stem.Length >= 6 && s.FoundByOwnLocator.Any(x => x.IndexOf(stem, StringComparison.OrdinalIgnoreCase) >= 0);
        }

        public sealed class FoundSession { public GameSession Session; public bool Elsewhere; }

        /// <summary>Which game session to look at after a launch at since (UTC): ours (the Deepslate Works folder), or one in
        /// .minecraft that went for our server (serverHost), i.e. the launcher started another profile. Null until one
        /// has loaded far enough to say (resources loaded, mod loading failed, or it connected / was refused).</summary>
        public static FoundSession FindGameSession(string gameDir, string minecraftDir, DateTime sinceUtc, string serverHost)
        {
            foreach (var (dir, elsewhere) in new[] { (gameDir, false), (minecraftDir, true) })
            {
                if (string.IsNullOrEmpty(dir)) continue;
                var log = Path.Combine(dir, "logs", "latest.log");
                if (!File.Exists(log)) continue;
                try { if (File.GetLastWriteTimeUtc(log) < sinceUtc) continue; } catch { continue; }
                var s = Extras.ReadGameSession(log);
                if (s == null || s.StartedAt == null || s.StartedAt.Value < sinceUtc.AddSeconds(-5)) continue;
                // the files found at DEBUG level (libraries among them) are in debug.log only: 3.6.1 (item 4a) always adds
                // them, not only when latest.log has none
                var dbg = Extras.ReadGameSession(Path.Combine(dir, "logs", "debug.log"));
                if (dbg != null) { foreach (var f in dbg.Found) if (!s.Found.Contains(f)) s.Found.Add(f); s.FoundByOwnLocator.AddRange(dbg.FoundByOwnLocator); }
                if (elsewhere)
                {
                    if (string.IsNullOrEmpty(serverHost) || !s.Connects.Any(x => x.IndexOf(serverHost, StringComparison.OrdinalIgnoreCase) >= 0)) continue;
                    return new FoundSession { Session = s, Elsewhere = true };
                }
                if (s.Loaded || s.Failed || s.Refused || s.Connects.Count > 0) return new FoundSession { Session = s, Elsewhere = false };
            }
            return null;
        }

        public static string GameCheckMode(bool test) => test ? "test_game_check" : "game_check";

        /// <summary>The window's report of what the game loaded (mode game_check): for Play first and for Alex. The mod
        /// check goes even when reports are off (the door needs it); no log and no PC details then.</summary>
        public static void SendGameCheck(ModsCheck c, string pack, bool reportsOff, bool test = false)
        {
            if (string.IsNullOrEmpty(Http.Token)) return;
            var line = "game check: " + (c.Ok ? string.Format("all {0} mods loaded", c.Checked) : MissingText(c));
            // 3.6.1 (item 4): the test game's check has its own mode, so the site keeps it out of every live figure
            var rep = J.O("packVersion", string.IsNullOrEmpty(pack) ? "unknown" : pack, "installerVersion", Env.Version, "mode", GameCheckMode(test), "outcome", c.Ok ? "ok" : "failed",
                          "durationSec", 0, "log", LogBundle.GameCheckLog(line, c.Ok, reportsOff), "system", null, "minimal", reportsOff, "mods", c.ToJson());
            try { Http.PostJson(Env.ReportUrl, rep, 20); Log.Line("game check sent to the site"); }
            catch (Exception e) { Log.Line("game check not sent: " + e.Message); }
        }
    }
}

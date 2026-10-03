using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.4.2 (Alex, 2026-10-03: "a save log button on the log page … or it should just every time you press play or
    /// update"): this PC's logs, made safe to hand over. The app's log, the game's latest.log and its newest crash report,
    /// with the username, paths, tokens and addresses taken out (Report.Redact) and every chat line dropped from the game
    /// log (chat can hold private messages). Three ways out: Save log (a zip in Downloads), Send to Alex (a report of mode
    /// "log_sent"), and by itself, for players who allow install reports: a run that never reported is sent at the next
    /// run (mode "unfinished"), and a game that failed to load sends its log with the game check.
    /// </summary>
    public static class LogBundle
    {
        public const string OpenMarkerName = "run-open.json";
        public const string UnreportedName = "run-unreported.json";
        /// <summary>The app log's lines kept in a bundle (the Log tab shows 400).</summary>
        public const int AppLines = 3000;
        /// <summary>The game log's lines kept: its end, where a failure is.</summary>
        public const int GameLines = 4000;

        static string GameDir => Env.DataDir;

        /// <summary>The last n lines of a file another process may be writing (the app, the game).</summary>
        public static List<string> ReadTail(string path, int n)
        {
            var lines = new List<string>();
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return lines;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var sr = new StreamReader(fs, Encoding.UTF8))
            {
                string l;
                while ((l = sr.ReadLine()) != null) { lines.Add(l); if (lines.Count > n * 2) lines.RemoveRange(0, lines.Count - n); }
            }
            if (lines.Count > n) lines.RemoveRange(0, lines.Count - n);
            return lines;
        }

        /// <summary>A chat line in a Minecraft log: "[CHAT] …" (the client) or a player's message as the server echoes it.</summary>
        public static bool IsChat(string line) => line != null && (line.IndexOf("[CHAT]", StringComparison.Ordinal) >= 0 || Regex.IsMatch(line, @"\]: <[A-Za-z0-9_]{1,16}> "));

        /// <summary>A game log made safe: chat lines dropped, then the same redaction as a report.</summary>
        public static string CleanGameLog(IEnumerable<string> lines)
        {
            int dropped = 0;
            var kept = new List<string>();
            foreach (var l in lines) { if (IsChat(l)) dropped++; else kept.Add(l); }
            var text = string.Join("\n", kept);
            if (dropped > 0) text += string.Format("\n[{0} chat line{1} left out]", dropped, dropped == 1 ? "" : "s");
            return Report.Redact(text, true);
        }

        public static string GameLogPath(string gameDir = null) => Path.Combine(gameDir ?? GameDir, "logs", "latest.log");

        /// <summary>The newest crash report in the game folder, or null.</summary>
        public static string NewestCrash(string gameDir = null)
        {
            try
            {
                var dir = new DirectoryInfo(Path.Combine(gameDir ?? GameDir, "crash-reports"));
                return dir.Exists ? dir.GetFiles("crash-*.txt").OrderByDescending(f => f.LastWriteTimeUtc).Select(f => f.FullName).FirstOrDefault() : null;
            }
            catch { return null; }
        }

        /// <summary>The three parts, made safe: (name in the zip, text).</summary>
        public static List<KeyValuePair<string, string>> Parts(string gameDir = null)
        {
            var parts = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("deepslate-works.log", Report.Redact(string.Join("\n", ReadTail(Env.LogFile, AppLines)), true)),
            };
            var game = GameLogPath(gameDir);
            if (File.Exists(game)) parts.Add(new KeyValuePair<string, string>("game-latest.log", CleanGameLog(ReadTail(game, GameLines))));
            var crash = NewestCrash(gameDir);
            if (crash != null) parts.Add(new KeyValuePair<string, string>("game-" + Path.GetFileName(crash), Report.Redact(string.Join("\n", ReadTail(crash, GameLines)), true)));
            return parts;
        }

        /// <summary>The parts as one text, each under its own heading (what Send to Alex uploads).</summary>
        public static string Text(List<KeyValuePair<string, string>> parts)
            => string.Join("\n\n", parts.Select(p => "===== " + p.Key + " =====\n" + p.Value));

        /// <summary>Downloads, or Documents when there is no Downloads folder.</summary>
        public static string SaveDir()
        {
            var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var downloads = string.IsNullOrEmpty(profile) ? null : Path.Combine(profile, "Downloads");
            return downloads != null && Directory.Exists(downloads) ? downloads : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        }

        public static string ZipName(DateTime at) => "Deepslate Works logs " + at.ToString("yyyy-MM-dd HH-mm", CultureInfo.InvariantCulture) + ".zip";

        /// <summary>Save log: a zip of the parts in dir. Returns its path.</summary>
        public static string Save(string dir, DateTime at, string gameDir = null)
        {
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, ZipName(at));
            if (File.Exists(path)) File.Delete(path);
            using (var z = ZipFile.Open(path, ZipArchiveMode.Create))
                foreach (var p in Parts(gameDir))
                {
                    var e = z.CreateEntry(p.Key, CompressionLevel.Optimal);
                    using (var w = new StreamWriter(e.Open(), new UTF8Encoding(false))) w.Write(p.Value.Replace("\n", "\r\n"));
                }
            Log.Line("log saved: " + Report.Redact(path));
            return path;
        }

        /// <summary>Send to Alex: the parts as a report of mode log_sent. Pressing the button is the consent, so it goes
        /// even when install reports are off. Returns null when it went, else why not.</summary>
        public static string Send(string pack, string gameDir = null)
        {
            if (string.IsNullOrEmpty(Http.Token)) { try { if (File.Exists(Env.TokenFile)) Http.Token = J.Str(Json.Parse(File.ReadAllText(Env.TokenFile)), "token"); } catch { } }
            if (string.IsNullOrEmpty(Http.Token)) return "This PC isn't signed in yet, so there is nowhere to send it. Use Save log and send Alex the zip instead.";
            var rep = J.O("packVersion", string.IsNullOrEmpty(pack) ? "unknown" : pack, "installerVersion", Env.Version, "mode", "log_sent", "outcome", "ok",
                          "durationSec", 0, "log", Report.Shorten(Text(Parts(gameDir)), 512 * 1024), "system", null);
            try { Http.PostJson(Env.ReportUrl, rep, 30); Log.Line("log sent to the site"); return null; }
            catch (Exception e) { Log.Line("log not sent: " + e.Message); return "It didn't go: " + e.Message; }
        }

        // ---- a run that never reported ----------------------------------------------------------------------------------

        static string OpenMarker => Path.Combine(Env.AppHome, OpenMarkerName);
        static string Unreported => Path.Combine(Env.AppHome, UnreportedName);

        /// <summary>A run begins: a marker from a run that never got to report is kept for the next report; then this one's.</summary>
        public static void Opened(Run run)
        {
            try
            {
                Directory.CreateDirectory(Env.AppHome);
                if (File.Exists(OpenMarker)) { if (File.Exists(Unreported)) File.Delete(Unreported); File.Move(OpenMarker, Unreported); }
                Json.WriteFile(OpenMarker, J.O("startedAt", run.Started.ToString("s", CultureInfo.InvariantCulture), "mode", run.ReportMode, "pack", run.PackSeen));
            }
            catch (Exception e) { Log.Line("run marker not written: " + e.Message); }
        }

        /// <summary>This run reported (or was told not to): its marker goes.</summary>
        public static void Closed()
        {
            try { if (File.Exists(OpenMarker)) File.Delete(OpenMarker); } catch { }
        }

        /// <summary>The app log's lines from one run: from its start to the next "started:" line (the next run).</summary>
        public static List<string> LinesOfRun(IEnumerable<string> log, DateTime startedAt)
        {
            var stamp = new Regex(@"^\[(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\]");
            var keep = new List<string>();
            bool inside = false;
            foreach (var l in log)
            {
                var m = stamp.Match(l);
                if (m.Success && DateTime.TryParseExact(m.Groups[1].Value, "s", CultureInfo.InvariantCulture, DateTimeStyles.None, out var at))
                {
                    if (!inside && at >= startedAt.AddSeconds(-1)) inside = true;
                    else if (inside && at > startedAt.AddSeconds(1) && l.IndexOf("] started: ", StringComparison.Ordinal) > 0) break;
                }
                if (inside) keep.Add(l);
            }
            return keep;
        }

        /// <summary>Before a run reports: the run before it that never did is sent first (mode unfinished), its log only
        /// when reports are allowed. Then the marker is gone either way.</summary>
        public static void SendUnreported(Run run)
        {
            if (!File.Exists(Unreported)) return;
            try
            {
                var m = Json.Parse(File.ReadAllText(Unreported));
                File.Delete(Unreported);
                if (run.DryRun || string.IsNullOrEmpty(run.Token)) return;
                DateTime.TryParseExact(J.Str(m, "startedAt"), "s", CultureInfo.InvariantCulture, DateTimeStyles.None, out var started);
                var lines = started == default(DateTime) ? new List<string>() : LinesOfRun(ReadTail(Env.LogFile, AppLines * 3), started);
                var log = run.ReportsOff ? "" : Report.Shorten(Report.Redact(string.Join("\n", lines), true), 512 * 1024);
                var rep = J.O("packVersion", J.Str(m, "pack") ?? run.PackSeen ?? "unknown", "installerVersion", Env.Version, "mode", "unfinished", "outcome", "failed",
                              "failedStep", "The run never finished: the window was closed, or Windows stopped it, before it could report",
                              "durationSec", 0, "log", log, "system", null, "minimal", run.ReportsOff);
                Http.PostJson(Env.ReportUrl, rep, 20);
                Log.Line("the run of " + J.Str(m, "startedAt") + " never reported: sent now");
            }
            catch (Exception e) { Log.Line("the unfinished run was not sent: " + e.Message); }
        }

        /// <summary>The game check's log when the game failed to load: the check's line, then the game log made safe.</summary>
        public static string GameCheckLog(string line, bool ok, bool reportsOff, string gameDir = null)
        {
            if (reportsOff) return "";
            if (ok) return line;
            var game = GameLogPath(gameDir);
            if (!File.Exists(game)) return line;
            return Report.Shorten(line + "\n\n===== game-latest.log =====\n" + CleanGameLog(ReadTail(game, GameLines)), 512 * 1024);
        }
    }
}

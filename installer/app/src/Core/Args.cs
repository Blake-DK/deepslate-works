using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>What the command line said (2.0.x's param block, the same names; -X, --x and /x all work).</summary>
    public class Args
    {
        public string Link = "";          // the deepslate:// link, when Windows starts this from the Play button on the site
        public bool Uninstall, Yes, VerifyExtras, Console, AllowAll, DryRun, NoLaunch;
        public bool Update;               // 3.3.0: the app updated itself during an Update and carries on with it
        public string Screenshots = "", Root = "", From = "", MigratedFrom = "";   // MigratedFrom: -HandOver (3.1.0), or 2.1.3's -MigratedFrom
        public int WaitFor;
        public string[] PretendRunning = new string[0];
        public List<string> Unknown = new List<string>();

        public static bool IsPlayLink(string l) => Regex.IsMatch(l ?? "", "^deepslate://play/?$");

        public static Args Parse(string[] argv)
        {
            var a = new Args();
            for (int i = 0; i < argv.Length; i++)
            {
                var raw = argv[i] ?? "";
                if (raw.StartsWith("deepslate:", StringComparison.OrdinalIgnoreCase) || (!raw.StartsWith("-") && !raw.StartsWith("/") && a.Link == "" && raw.Contains("://"))) { a.Link = raw; continue; }
                var k = raw.TrimStart('-', '/').ToLowerInvariant();
                string Next() => i + 1 < argv.Length ? argv[++i] : "";
                switch (k)
                {
                    case "uninstall": a.Uninstall = true; break;
                    case "yes": case "quiet": a.Yes = true; break;
                    case "verifyextras": a.VerifyExtras = true; break;
                    case "console": a.Console = true; break;
                    case "allowall": a.AllowAll = true; break;
                    case "dryrun": a.DryRun = true; break;
                    case "nolaunch": a.NoLaunch = true; break;
                    case "update": a.Update = true; break;
                    case "screenshots": a.Screenshots = Next(); break;
                    case "root": a.Root = Next(); break;
                    case "from": a.From = Next(); break;
                    case "migratedfrom": case "handover": a.MigratedFrom = Next(); break;
                    case "waitfor": int.TryParse(Next(), out a.WaitFor); break;
                    case "pretendrunning": a.PretendRunning = Next().Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries); break;
                    default: a.Unknown.Add(raw); break;
                }
            }
            // ANY web page can put a deepslate:// link in front of someone: exactly one link is accepted, and when this was
            // started by a link nothing else on the command line counts (2.0.x, docs/07 "Play from the site").
            if (a.Link != "")
            {
                var link = a.Link;
                a = new Args { Link = link };
            }
            return a;
        }

        /// <summary>3.3.0: what an Update's restart after a self-update passes on: the switches, never a link (a link run
        /// would reset them), and -Update so the new copy goes straight on with it.</summary>
        public static string[] ForUpdate(string[] restartArgs)
        {
            var r = (restartArgs ?? new string[0]).Where(x => !IsPlayLink(x) && !string.Equals(x, "-Update", StringComparison.OrdinalIgnoreCase)).ToList();
            r.Add("-Update");
            return r.ToArray();
        }

        /// <summary>What a restart after a self-update passes on: only the link for a link run; else the switches that matter.</summary>
        public string[] ForRestart()
        {
            if (Link != "") return new[] { Link };
            var r = new List<string>();
            if (Console) r.Add("-Console");
            if (Update) r.Add("-Update");
            if (NoLaunch) r.Add("-NoLaunch");
            return r.ToArray();
        }
    }

}

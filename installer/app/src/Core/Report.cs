using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Management;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace DeepslateWorks
{
    /// <summary>
    /// The install report (docs/07 "Install reports"): at the end of every run the log of that run and a description of
    /// the PC go to the site. Before anything is sent the name in C:\Users\&lt;name&gt;\ becomes ~, the Windows user name and
    /// the PC's name are blanked wherever they appear, tokens, e-mail and network addresses are removed. The site does
    /// the same again before it stores it.
    /// </summary>
    public static class Report
    {
        /// <summary>The Extras tab's state for the report; set by the extras code (null when there is none).</summary>
        public static Func<object> ExtrasBlock = () => null;
        /// <summary>A notice the site answered with (an older installer): shown by the window.</summary>
        public static Action<string> ShowNotice = t => { };

        static List<string> personal;
        static IEnumerable<string> Personal
        {
            get
            {
                if (personal != null) return personal;
                personal = new[] { Environment.GetEnvironmentVariable("USERNAME"), Environment.UserName, Environment.GetEnvironmentVariable("COMPUTERNAME"), Environment.MachineName }
                    .Where(x => !string.IsNullOrEmpty(x) && x.Length >= 3).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                return personal;
            }
        }
        /// <summary>Tests: the words that identify the person or the PC.</summary>
        public static void SetPersonal(IEnumerable<string> words) { personal = words.ToList(); }

        public static string Redact(string t, bool addresses = false, string token = null)
        {
            if (string.IsNullOrEmpty(t)) return "";
            t = Regex.Replace(t, @"(?i)\b([A-Z]):(\\{1,4}|/)(Users|Documents and Settings)(\\{1,4}|/)[^\\/:*?""<>|\r\n]+", "$1:$2$3$4~");
            t = Regex.Replace(t, @"(^|[\s""'=(])/(home|Users)/[^/\s""']+", "$1/$2/~");
            foreach (var n in Personal) t = Regex.Replace(t, "(?i)(?<![A-Za-z0-9])" + Regex.Escape(n) + "(?![A-Za-z0-9])", "~");
            token = token ?? Http.Token;
            if (!string.IsNullOrEmpty(token)) t = t.Replace(token, "~");
            t = Regex.Replace(t, @"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}", "$1 ~");
            t = Regex.Replace(t, @"(?i)((?:launcherToken|pollToken|token|password)""?\s*[:=]\s*""?)(?!(?:Bearer|Basic)\s)[^""\s,;}]{4,}", "$1~");
            t = Regex.Replace(t, @"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "~@~");
            if (addresses)
            {
                t = Regex.Replace(t, @"(?i)(?<![\w:])(?:(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?)(?![\w:])", "~ip~");
                t = Regex.Replace(t, @"(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.]|\.\d)", "~ip~");
            }
            return t;
        }

        public static string Shorten(string t, int maxBytes)
        {
            if (Encoding.UTF8.GetByteCount(t) <= maxBytes) return t;
            const string note = "\n\n[... the middle of the log was cut to fit ...]\n\n";
            int half = (maxBytes - 80) / 2 / 2;   // characters; two bytes each at the very worst for what a log holds
            return t.Substring(0, half) + note + t.Substring(t.Length - half);
        }

        public static object RedactTree(object v)
        {
            if (v == null) return null;
            if (v is string s) return Redact(s);
            if (v is JObj jo) { var o = new JObj(); foreach (var k in jo.OrderedKeys) o[k] = RedactTree(jo[k]); return o; }
            if (v is IDictionary<string, object> d) { var o = new JObj(); foreach (var kv in d) o[kv.Key] = RedactTree(kv.Value); return o; }
            if (v is IList l) { var r = new List<object>(); foreach (var x in l) r.Add(RedactTree(x)); return r; }
            return v;
        }

        static string Wmi(ManagementBaseObject o, string p) { try { return Convert.ToString(o[p])?.Trim(); } catch { return null; } }

        public static JObj SystemInfo(Run run)
        {
            var s = J.O("os", null, "cpu", null, "ramGb", null, "gpus", new List<object>(), "disk", null,
                        "launcher", run?.Facts["launcher"], "java", run?.Facts["java"], "neoforge", run?.Facts["neoforge"], "powershell", Runtime());
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT Caption, Version, BuildNumber, OSArchitecture FROM Win32_OperatingSystem"))
                    foreach (ManagementBaseObject os in q.Get())
                    {
                        string display = null;
                        try { display = Convert.ToString(Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "DisplayVersion", null)); } catch { }
                        s["os"] = J.O("caption", Wmi(os, "Caption"), "version", Wmi(os, "Version"), "build", Wmi(os, "BuildNumber"), "display", display, "arch", Wmi(os, "OSArchitecture"));
                        break;
                    }
            }
            catch { }
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT Name, NumberOfCores, NumberOfLogicalProcessors FROM Win32_Processor"))
                    foreach (ManagementBaseObject c in q.Get())
                    {
                        s["cpu"] = J.O("name", Wmi(c, "Name"), "cores", Convert.ToInt32(c["NumberOfCores"]), "threads", Convert.ToInt32(c["NumberOfLogicalProcessors"]));
                        break;
                    }
            }
            catch { }
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem"))
                    foreach (ManagementBaseObject c in q.Get()) { s["ramGb"] = Math.Round(Convert.ToDouble(c["TotalPhysicalMemory"]) / (1024.0 * 1024 * 1024), 1); break; }
            }
            catch { }
            try
            {
                var list = new List<object>();
                using (var q = new ManagementObjectSearcher("SELECT Name, DriverVersion, AdapterRAM FROM Win32_VideoController"))
                    foreach (ManagementBaseObject g in q.Get())
                    {
                        long? vram = null;
                        try { if (g["AdapterRAM"] != null) vram = (long)(Convert.ToDouble(g["AdapterRAM"]) / (1024 * 1024)); } catch { }   // Windows reports at most 4 GB here
                        if (list.Count < 8) list.Add(J.O("name", Wmi(g, "Name"), "driver", Wmi(g, "DriverVersion"), "vramMb", vram));
                    }
                s["gpus"] = list;
            }
            catch { }
            try
            {
                var drive = System.IO.Path.GetPathRoot(Env.Root).TrimEnd('\\');
                using (var q = new ManagementObjectSearcher("SELECT FreeSpace, Size FROM Win32_LogicalDisk WHERE DeviceID='" + drive.Replace("'", "") + "'"))
                    foreach (ManagementBaseObject d in q.Get())
                    {
                        s["disk"] = J.O("drive", drive, "freeGb", Math.Round(Convert.ToDouble(d["FreeSpace"]) / (1024.0 * 1024 * 1024), 1), "totalGb", Math.Round(Convert.ToDouble(d["Size"]) / (1024.0 * 1024 * 1024), 1));
                        break;
                    }
            }
            catch { }
            return s;
        }

        /// <summary>".NET Framework 4.8.1": what runs the app, in the report's (old) powershell field.</summary>
        public static string Runtime()
        {
            try
            {
                var rel = Convert.ToInt32(Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full", "Release", 0));
                var v = rel >= 533320 ? "4.8.1" : rel >= 528040 ? "4.8" : rel > 0 ? "4.7 or older" : Environment.Version.ToString();
                return ".NET Framework " + v;
            }
            catch { return ".NET " + Environment.Version; }
        }

        public static JObj New(Run run, string outcome)
        {
            string failed = outcome != "ok" && !string.IsNullOrEmpty(run.StepName) ? run.StepName : null;
            string problem = string.IsNullOrEmpty(run.UpdateProblem) ? null : Redact(run.UpdateProblem, true);
            object extras = null;
            try { extras = ExtrasBlock(); } catch (Exception e) { Log.Line("extras: not in the report: " + e.Message); }
            return J.O(
                "packVersion", run.PackSeen,
                "installerVersion", Env.Version,
                "updatedFrom", run.UpdatedFrom,
                "updateProblem", problem,
                "setupProblems", run.SetupChecked ? (object)run.SetupProblems.Cast<object>().ToList() : null,
                "extras", extras,
                "mode", run.Mode,
                "outcome", outcome,
                "failedStep", failed,
                "durationSec", (int)(DateTime.Now - run.Started).TotalSeconds,
                "log", Shorten(Redact(string.Join("\n", Log.RunLines), true), 512 * 1024),
                "system", run.Mode == "uninstall" ? null : RedactTree(SystemInfo(run)));   // no PC details when leaving
        }

        /// <summary>Once per run. Reports declined in the app: only "pressed Play, pack version" goes (2.0.0).</summary>
        public static void Send(Run run, string outcome)
        {
            if (run.Reported) return;
            run.Reported = true;
            if (run.DryRun) return;
            if (string.IsNullOrEmpty(run.Token)) { Log.Line("not signed in, so no install report was sent"); return; }
            try
            {
                var rep = New(run, outcome);
                if (run.ReportsOff) rep = J.O("packVersion", rep["packVersion"], "installerVersion", rep["installerVersion"], "mode", rep["mode"], "outcome", rep["outcome"],
                                              "durationSec", rep["durationSec"], "log", "", "system", null, "minimal", true, "extras", rep["extras"]);
                var answer = Http.PostJson(Env.ReportUrl, rep, 20);
                Log.Line("install report sent");
                var notice = J.Str(answer, "notice");
                if (!string.IsNullOrEmpty(notice))
                {
                    notice = Regex.Replace(notice, @"[\x00-\x1F\x7F]", " ").Trim();
                    if (notice.Length > 300) notice = notice.Substring(0, 300);
                    if (notice.Length > 0) { Log.Line("the site says: " + notice); run.Emit(J.O("t", "note", "text", notice)); ShowNotice(notice); }
                }
            }
            catch (Exception e) { Log.Line("install report not sent: " + e.Message); }
        }
    }
}

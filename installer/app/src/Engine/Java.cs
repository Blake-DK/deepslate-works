using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    public static partial class Engine
    {
        /// <summary>Which Java the profile is pointed at (Select-Java's answer). Path null: none, Java 21 is downloaded.</summary>
        public sealed class JavaChoice
        {
            public string Path, Source, Say, PassedOver;
        }

        /// <summary>
        /// Runs "java -version" and gives back what it wrote, stderr then stdout; null when it did not end within 15 s.
        /// Throws when it cannot be started. Tests swap it for stand-ins (on Linux there is no java.exe to run).
        /// </summary>
        public static Func<string, string> AskJava = RealAskJava;

        static string RealAskJava(string exe)
        {
            var psi = new ProcessStartInfo(exe, "-version")
            {
                UseShellExecute = false,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
            };
            using (var p = Process.Start(psi))
            {
                var err = p.StandardError.ReadToEndAsync();
                var outp = p.StandardOutput.ReadToEndAsync();
                if (!p.WaitForExit(15000)) { try { p.Kill(); } catch { } return null; }
                return err.Result + "\n" + outp.Result;
            }
        }

        // Java says its version on stderr. It is asked through a process of its own and both streams are read as text
        // (1.4.1: in Windows PowerShell 5.1 a native command's stderr sent through 2>&1 became an error, and that ended
        // the install whatever the Java was; docs/07 "A Java on the PC ended the install").
        /// <summary>The line with the version in it, or null: no answer, no such file, or nothing that reads as a
        /// version. Never throws.</summary>
        public static string GetJavaVersionText(string exe)
        {
            if (string.IsNullOrEmpty(exe)) return null;
            try
            {
                var text = AskJava(exe);
                if (text == null) return null;
                // "Picked up JAVA_TOOL_OPTIONS: ..." may come first: the line is found, not assumed to be the first
                foreach (var line in Regex.Split(text, "\r?\n"))
                    if (Regex.IsMatch(line, "version \"[^\"]+\"", RegexOptions.IgnoreCase)) return line.Trim();
                return null;
            }
            catch { return null; }
        }

        /// <summary>21 from 'java version "21.0.12" 2026-07-21 LTS', 8 from 'java version "1.8.0_503"', 0 from anything else.</summary>
        public static int GetJavaMajor(string line)
        {
            var m = Regex.Match(line ?? "", "version \"(\\d+)(?:\\.(\\d+))?", RegexOptions.IgnoreCase);
            if (!m.Success) return 0;
            int first;
            if (!int.TryParse(m.Groups[1].Value, out first)) return 0;
            if (first == 1 && m.Groups[2].Success && m.Groups[2].Value.Length > 0) { int.TryParse(m.Groups[2].Value, out var second); return second; }
            return first;
        }

        /// <summary>"java on PATH": the first java.exe in the folders PATH names (Get-Command java), or "".</summary>
        public static string FindJavaOnPath()
        {
            var path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (var raw in path.Split(';'))
            {
                var d = raw.Trim().Trim('"');
                if (d.Length == 0) continue;
                try
                {
                    var f = System.IO.Path.Combine(Environment.ExpandEnvironmentVariables(d), "java.exe");
                    if (File.Exists(f)) return f;
                }
                catch { }
            }
            return "";
        }

        static bool Exists(string p) { try { return !string.IsNullOrEmpty(p) && (File.Exists(p) || Directory.Exists(p)); } catch { return false; } }

        static string FirstJavaIn(string dir)
        {
            try { return Directory.EnumerateFiles(dir, "java.exe", SearchOption.AllDirectories).FirstOrDefault(); }
            catch { return null; }
        }

        // Which Java the profile is pointed at: the launcher's own, one on PATH that is 21 or newer, or the one
        // downloaded on an earlier run. With none of them Path is null and Java 21 is downloaded. A Java on PATH
        // that is older, or that does not answer, is passed over and left alone: it never stops the install, and the
        // profile never points at it.
        public static JavaChoice SelectJava(string bundled, string onPath, string runtimeDir)
        {
            if (Exists(bundled)) return new JavaChoice { Path = bundled, Source = "the launcher's own", Say = "Using the launcher's own Java" };
            string passedOver = null;
            if (!string.IsNullOrEmpty(onPath))
            {
                var line = GetJavaVersionText(onPath);
                var major = GetJavaMajor(line);
                if (major >= 21) return new JavaChoice { Path = onPath, Source = "on PATH", Say = string.Format("Using Java {0} from PATH", major) };
                passedOver = !string.IsNullOrEmpty(line) ? line : "a java that did not say its version";
            }
            string found = null;
            if (!string.IsNullOrEmpty(runtimeDir) && Directory.Exists(runtimeDir)) found = FirstJavaIn(runtimeDir);
            if (found != null) return new JavaChoice { Path = found, Source = "downloaded on an earlier run", Say = "Using the Java we downloaded last time", PassedOver = passedOver };
            return new JavaChoice { PassedOver = passedOver };
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;

namespace DeepslateWorks
{
    /// <summary>
    /// The log: %TEMP%\deepslate-works.log, "[yyyy-MM-ddTHH:mm:ss] text" per line, as 2.0.x wrote it (the Log tab and the
    /// install report read it). This run's lines are kept too: they are the report's log.
    /// </summary>
    public static class Log
    {
        static readonly object Gate = new object();
        static readonly List<string> Run = new List<string>();
        public static event Action<string> Written;   // the window's Log tab

        public static void Line(string msg)
        {
            var line = string.Format("[{0:yyyy-MM-ddTHH:mm:ss}] {1}", DateTime.Now, msg);
            lock (Gate)
            {
                Run.Add(line);
                try { File.AppendAllText(Env.LogFile, line + Environment.NewLine); } catch { }
            }
            try { Written?.Invoke(line); } catch { }
        }

        public static string[] RunLines { get { lock (Gate) return Run.ToArray(); } }
        public static void ClearRun() { lock (Gate) Run.Clear(); }

        /// <summary>A leftover temporary file is never a reason to stop (Remove-Temp).</summary>
        public static void RemoveTemp(string path)
        {
            try { if (!string.IsNullOrEmpty(path) && File.Exists(path)) File.Delete(path); }
            catch (Exception e) { Line("could not remove " + path + ": " + e.Message); }
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace DeepslateWorks.Tests
{
    /// <summary>A scratch folder per test (Scratch) and the Home module's swappable parts put back afterwards.</summary>
    public abstract class HomeTestBase : IDisposable
    {
        protected readonly Scratch S = new Scratch();
        readonly IHomeIo io = Home.Io;
        readonly Func<ProcessStartInfo, Process> start = Home.StartProcess;
        readonly Func<string, string> version = Home.ProductVersionOf;
        readonly Action<string, object> writeProfiles = Uninstaller.WriteProfiles;
        readonly string[] pretend = Uninstaller.PretendRunning;
        /// <summary>What would have been started.</summary>
        protected readonly List<ProcessStartInfo> Started = new List<ProcessStartInfo>();

        protected HomeTestBase()
        {
            Home.StartProcess = psi => { Started.Add(psi); return null; };
        }

        public void Dispose()
        {
            Home.Io = io; Home.StartProcess = start; Home.ProductVersionOf = version;
            Uninstaller.WriteProfiles = writeProfiles; Uninstaller.PretendRunning = pretend;
            S.Dispose();
        }

        protected static string Write(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text);
            return path;
        }

        protected static string Names(string dir) =>
            string.Join(",", Directory.GetFileSystemEntries(dir).Select(Path.GetFileName).OrderBy(n => n, StringComparer.OrdinalIgnoreCase));

        protected static bool Logged(string text) => Log.RunLines.Any(l => l.Contains(text));
    }
}

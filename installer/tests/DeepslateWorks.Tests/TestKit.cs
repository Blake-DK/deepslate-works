using System;
using System.IO;
using Xunit;

namespace DeepslateWorks.Tests
{
    /// <summary>A test that needs Windows itself (registry, shortcuts, wscript, WPF): skipped anywhere else.</summary>
    public sealed class WindowsFactAttribute : FactAttribute
    {
        public WindowsFactAttribute() { if (Environment.OSVersion.Platform != PlatformID.Win32NT) Skip = "needs Windows"; }
    }

    /// <summary>A scratch folder per test, deleted after; Env pointed into it (Root, AppHome, Temp) so nothing on the PC
    /// running the tests is touched, as -SelfTest did with -Root.</summary>
    public sealed class Scratch : IDisposable
    {
        public string Dir { get; }
        public Scratch()
        {
            Dir = Path.Combine(Path.GetTempPath(), "dw-test-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(Dir);
            Env.Root = Path.Combine(Dir, "Roaming"); Directory.CreateDirectory(Env.Root);
            Env.CustomRoot = true;
            Env.AppHome = Path.Combine(Dir, "LocalAppData", "DeepslateWorks");
            Env.Temp = Path.Combine(Dir, "Temp"); Directory.CreateDirectory(Env.Temp);
            Env.PortalUrl = "https://deepslate.example";
            Http.Fake = null; Http.FakeDownload = null; Http.Token = null;
            Log.ClearRun();
        }
        public string P(params string[] parts) => Path.Combine(Dir, Path.Combine(parts));
        public void Dispose()
        {
            Http.Fake = null; Http.FakeDownload = null; Http.Token = null;
            try { Directory.Delete(Dir, true); } catch { }
        }
    }

    // Env is static: tests that move it must not run side by side.
    [CollectionDefinition("env", DisableParallelization = true)] public class EnvCollection { }
}

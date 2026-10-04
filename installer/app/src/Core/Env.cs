using System;
using System.IO;
using System.Reflection;

namespace DeepslateWorks
{
    /// <summary>The address of the site, set at build time (the csproj's PortalUrl, from installer.yml).</summary>
    [AttributeUsage(AttributeTargets.Assembly)]
    public sealed class BuildInfoAttribute : Attribute
    {
        public string PortalUrl { get; }
        public BuildInfoAttribute(string portalUrl) { PortalUrl = portalUrl; }
    }

    /// <summary>
    /// Names, versions and places, the C# side of the PowerShell script's config block (docs/07). Paths that tests move
    /// (Root, AppHome, Temp) are settable; everything else follows from them.
    /// </summary>
    public static class Env
    {
        public const string PackName = "Deepslate Works";
        public const string ExeName = "DeepslateWorks.exe";
        public const string LockName = @"Global\DeepslateWorks";              // the install steps: one run per PC user at a time (same name as 2.0.x)
        public const string AppMutexName = @"Local\DeepslateWorks.App";      // one window per PC user (same name as 2.0.x)
        public const string AppShowEvent = @"Local\DeepslateWorks.App.Show"; // a second start: to the front (3.1.0: from the desktop or the Start Menu, nothing more)
        public const string AppPlayEvent = @"Local\DeepslateWorks.App.Play"; // 3.1.0: a second start from the website's Play button: to the front, and Play
        public const string AppUpEvent = @"Local\DeepslateWorks.App.Up";     // set once the window is on screen
        public const string AppUserModelId = "DeepslateWorks.App";           // its own taskbar button, as 2.0.3
        public const int ExitAlreadyRunning = 3;
        public const string ProfileId = "deepslate-works";                   // the mod list's profile.id; it has always been this
        public const string UninstallKeyName = "DeepslateWorks";
        public const string ConsentFileName = "consent.json";
        public const string ExtrasStateName = "extras.json";
        public const string ExtrasManifestName = "extras-manifest.json";

        static string _portal;
        /// <summary>https://deepslate.dsw.test unless the build said otherwise; DEEPSLATE_PORTAL_URL only in tests (Root set).</summary>
        public static string PortalUrl
        {
            get
            {
                if (_portal != null) return _portal;
                // 3.5.0: windows-smoke-3.ps1's engine run talks to a stand-in site on this PC, never the real one; only a
                // test run (-Root) reads it, and only an address on 127.0.0.1
                var test = CustomRoot ? Environment.GetEnvironmentVariable("DEEPSLATE_PORTAL_URL") : null;
                if (!string.IsNullOrEmpty(test) && System.Text.RegularExpressions.Regex.IsMatch(test, @"^http://127\.0\.0\.1:\d{2,5}/?$")) return test.TrimEnd('/');
                var a = typeof(Env).Assembly.GetCustomAttribute<BuildInfoAttribute>();
                return a != null && !string.IsNullOrEmpty(a.PortalUrl) ? a.PortalUrl.TrimEnd('/') : "https://deepslate.dsw.test";
            }
            set { _portal = value == null ? null : value.TrimEnd('/'); }
        }
        public static string ManifestUrl => PortalUrl + "/api/modpack/manifest";
        public static string WakeUrl => PortalUrl + "/api/play/wake";
        public static string ExtrasUrl => PortalUrl + "/api/modpack/extras";
        public static string ReportUrl => PortalUrl + "/api/installer/report";
        public static string ExeDownloadUrl => PortalUrl + "/downloads/" + ExeName;   // never an address from the manifest
        public static string SiteHost { get { try { return new Uri(PortalUrl).Host; } catch { return PortalUrl; } } }

        /// <summary>"3.0.0", from installer/VERSION via the csproj.</summary>
        public static string Version
        {
            get
            {
                var v = typeof(Env).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";
                int plus = v.IndexOf('+');
                return plus > 0 ? v.Substring(0, plus) : v;
            }
        }

        public static bool OnWindows => Environment.OSVersion.Platform == PlatformID.Win32NT;

        /// <summary>%APPDATA%; a test run moves it (-Root), and then nothing outside it is touched.</summary>
        public static string Root { get; set; } = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        /// <summary>A test run (-Root given): nothing is copied, registered or linked outside Root.</summary>
        public static bool CustomRoot { get; set; }
        static string _appHome;
        /// <summary>%LOCALAPPDATA%\DeepslateWorks: the exe, consent.json, extras.json, logs\.</summary>
        public static string AppHome
        {
            get
            {
                if (_appHome != null) return _appHome;
                if (CustomRoot) return Path.Combine(Root, "LocalAppData", "DeepslateWorks");
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepslateWorks");
            }
            set { _appHome = value; }
        }
        /// <summary>The game folder (the mod list's profile.dir; it has always been this).</summary>
        public static string DataDir => Path.Combine(Root, ".minecraft-deepslate-works");
        public static string Minecraft => Path.Combine(Root, ".minecraft");
        public static string Profiles => Path.Combine(Minecraft, "launcher_profiles.json");
        public static string TokenFile => Path.Combine(DataDir, "launcher.json");
        public static string InstalledFile => Path.Combine(DataDir, "installed.json");
        public static string Temp { get; set; } = Path.GetTempPath();
        /// <summary>%TEMP%\deepslate-works.log, the same file 2.0.x wrote, so the Log tab shows both.</summary>
        public static string LogFile => Path.Combine(Temp, "deepslate-works.log");
        public static string ConsentPath => Path.Combine(AppHome, ConsentFileName);
        public static string ExtrasStatePath => Path.Combine(AppHome, ExtrasStateName);
        public static string ExtrasManifestPath => Path.Combine(AppHome, ExtrasManifestName);
        public static string HomeExe => Path.Combine(AppHome, ExeName);

        /// <summary>The running exe's full path.</summary>
        public static string MePath => Assembly.GetEntryAssembly()?.Location ?? typeof(Env).Assembly.Location;
    }
}

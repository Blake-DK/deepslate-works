using System;
using System.IO;
using System.Management;
using System.Threading;
using Microsoft.Win32;

namespace DeepslateWorks
{
    /// <summary>
    /// How Repair reads and writes the four things it looks after (Get-WindowsHomeIo / Get-FileHomeIo): the registry and
    /// the shortcuts on a PC (WindowsHomeIo), files in one folder in the tests (FileHomeIo). The copier and the sleep
    /// are here too, so a test can refuse the copy and count the waiting.
    /// </summary>
    public interface IHomeIo
    {
        /// <summary>%TEMP%: the Play link and the shortcuts never point into it.</summary>
        string Temp { get; }
        void Copy(string from, string to);
        void Sleep(int seconds);
        /// <summary>The command deepslate:// runs now; "" when there is none.</summary>
        string Handler();
        bool SetHandler(string exe);
        bool ShortcutsThere(string exe);
        Home.ShortcutsMade MakeShortcuts(string exe);
        /// <summary>Windows' ransomware protection (controlled folder access) is on.</summary>
        bool ControlledFolderAccess();
        bool Listed(string exe);
        void List(string exe);
    }

    /// <summary>The real ones: this Windows user's registry and shortcuts. RegRoot is "Software" (HKCU\Software); the
    /// tests use a key of their own, and folders of their own for the shortcuts.</summary>
    public class WindowsHomeIo : IHomeIo
    {
        public string GameDir;
        public string RegRoot;
        public string Desktop, Programs;
        public string Temp { get; set; }

        public WindowsHomeIo(string gameDir, string regRoot = "Software", string desktop = null, string programs = null)
        {
            GameDir = gameDir;
            RegRoot = regRoot;
            Desktop = desktop ?? Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            Programs = programs ?? Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            Temp = Env.Temp;
        }

        public void Copy(string from, string to) => Home.CopyFile(from, to);
        public void Sleep(int seconds) => Thread.Sleep(seconds * 1000);
        public string Handler() => Home.ReadHandler(RegRoot);
        public bool SetHandler(string exe) => Home.RegisterPlayLink(exe, RegRoot);
        public bool ShortcutsThere(string exe) => Home.TestShortcuts(exe, Desktop, Programs);
        public Home.ShortcutsMade MakeShortcuts(string exe) => Home.SetShortcuts(exe, Desktop, Programs);
        public bool ControlledFolderAccess() => Home.TestControlledFolderAccess();
        public bool Listed(string exe) => Home.TestListed(exe, GameDir, RegRoot);
        public void List(string exe) => Home.RegisterUninstall(exe, GameDir, RegRoot);
    }

    /// <summary>The tests': the same four things as files in one folder (handler.txt, Desktop.lnk, Programs.lnk,
    /// Uninstall.lnk with the shortcut's "target" arguments, apps.txt). Each part can be swapped, as the self test did.</summary>
    public class FileHomeIo : IHomeIo
    {
        public string At;
        public string Temp { get; set; }
        public Action<string, string> Copier;                 // null: the real copy
        public Func<string, bool> SetHandlerFn;               // null: writes handler.txt
        public Func<string, Home.ShortcutsMade> MakeShortcutsFn;
        public bool Cfa;
        public int Slept;                                     // seconds it would have waited

        public FileHomeIo(string at)
        {
            At = at;
            Directory.CreateDirectory(at);
            Temp = Path.Combine(at, "temp");
        }

        string F(string name) => Path.Combine(At, name);
        static string ReadOr(string f) => File.Exists(f) ? File.ReadAllText(f) : "";

        public void Copy(string from, string to) { if (Copier != null) Copier(from, to); else Home.CopyFile(from, to); }
        public void Sleep(int seconds) { Slept += seconds; }
        public string Handler() => ReadOr(F("handler.txt"));
        public bool SetHandler(string exe)
        {
            if (SetHandlerFn != null) return SetHandlerFn(exe);
            File.WriteAllText(F("handler.txt"), Home.HandlerCommand(exe));
            return true;
        }
        Home.Shortcut[] Specs(string exe) => new[] { Home.ShortcutSpec(exe, "desktop"), Home.ShortcutSpec(exe, "startmenu"), Home.UninstallShortcutSpec(exe) };
        static readonly string[] Names = { "Desktop.lnk", "Programs.lnk", "Uninstall.lnk" };
        public bool ShortcutsThere(string exe)
        {
            var s = Specs(exe);
            for (int i = 0; i < Names.Length; i++) if (!File.Exists(F(Names[i])) || ReadOr(F(Names[i])) != s[i].Line) return false;
            return true;
        }
        public Home.ShortcutsMade MakeShortcuts(string exe)
        {
            if (MakeShortcutsFn != null) return MakeShortcutsFn(exe);
            var s = Specs(exe);
            for (int i = 0; i < Names.Length; i++) File.WriteAllText(F(Names[i]), s[i].Line);
            return new Home.ShortcutsMade { Made = 3 };
        }
        public bool ControlledFolderAccess() => Cfa;
        string AppsLine(string exe) => J.Str(Home.UninstallEntry(exe, "", 0), "UninstallString") + "|" + Env.Version;
        public bool Listed(string exe) => File.Exists(F("apps.txt")) && ReadOr(F("apps.txt")) == AppsLine(exe);
        public void List(string exe) => File.WriteAllText(F("apps.txt"), AppsLine(exe));
    }

    public static partial class Home
    {
        // ---- the registry (HKCU only, no admin rights) -----------------------------------------------------------
        public static string HandlerKey(string regRoot = "Software") => regRoot + @"\Classes\deepslate";
        public static string AppsKey(string regRoot = "Software") => regRoot + @"\Microsoft\Windows\CurrentVersion\Uninstall\" + Env.UninstallKeyName;

        public static string ReadHandler(string regRoot = "Software")
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(HandlerKey(regRoot) + @"\shell\open\command"))
                    return k == null ? "" : Convert.ToString(k.GetValue("", "")) ?? "";
            }
            catch { return ""; }
        }

        /// <summary>deepslate:// for this Windows user: "URL:Deepslate Works", URL Protocol, the exe's icon, and the
        /// command. true when the command reads back as written.</summary>
        public static bool RegisterPlayLink(string exe, string regRoot = "Software")
        {
            var b = HandlerKey(regRoot);
            using (var k = Registry.CurrentUser.CreateSubKey(b))
            {
                k.SetValue("", "URL:" + Env.PackName);
                k.SetValue("URL Protocol", "");
            }
            using (var k = Registry.CurrentUser.CreateSubKey(b + @"\DefaultIcon")) k.SetValue("", IconLocation(exe));
            using (var k = Registry.CurrentUser.CreateSubKey(b + @"\shell\open\command")) k.SetValue("", HandlerCommand(exe));
            return ReadHandler(regRoot) == HandlerCommand(exe);
        }

        /// <summary>Listed in Settings -> Apps by this version: its Uninstall runs this exe, and the version is this one.</summary>
        public static bool TestListed(string exe, string gameDir, string regRoot = "Software")
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(AppsKey(regRoot)))
                {
                    if (k == null) return false;
                    var want = UninstallEntry(exe, gameDir, 0);
                    return Convert.ToString(k.GetValue("UninstallString", "")) == J.Str(want, "UninstallString")
                        && Convert.ToString(k.GetValue("DisplayVersion", "")) == Env.Version;
                }
            }
            catch { return false; }
        }

        public static void RegisterUninstall(string exe, string gameDir, string regRoot = "Software")
        {
            var e = UninstallEntry(exe, gameDir, FolderSizeKb(gameDir));
            using (var k = Registry.CurrentUser.CreateSubKey(AppsKey(regRoot)))
                foreach (var name in e.OrderedKeys)
                {
                    var v = e[name];
                    if (v is int i) k.SetValue(name, i, RegistryValueKind.DWord);
                    else k.SetValue(name, Convert.ToString(v) ?? "", RegistryValueKind.String);
                }
        }

        /// <summary>Controlled folder access (Defender's EnableControlledFolderAccess = 1). Read inside a try: false
        /// when it cannot be read.</summary>
        public static bool TestControlledFolderAccess()
        {
            try
            {
                using (var q = new ManagementObjectSearcher(@"root\Microsoft\Windows\Defender", "SELECT EnableControlledFolderAccess FROM MSFT_MpPreference"))
                    foreach (ManagementBaseObject o in q.Get()) return Convert.ToInt32(o["EnableControlledFolderAccess"]) == 1;
            }
            catch { }
            try
            {
                var v = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows Defender\Windows Defender Exploit Guard\Controlled Folder Access", "EnableControlledFolderAccess", 0);
                return Convert.ToInt32(v) == 1;
            }
            catch { return false; }
        }
    }
}

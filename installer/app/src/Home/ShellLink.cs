using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace DeepslateWorks
{
    /// <summary>
    /// The shortcuts, through the shell's own IShellLinkW (2.x used WScript.Shell, which cannot set the
    /// AppUserModelID). Each shortcut carries System.AppUserModel.ID = Env.AppUserModelId, the id the window sets for
    /// itself, so a pinned shortcut and the open window are one taskbar button.
    /// </summary>
    public static partial class Home
    {
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        class CShellLink { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
            void GetIDList(out IntPtr ppidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
            void GetHotkey(out short pwHotkey);
            void SetHotkey(short wHotkey);
            void GetShowCmd(out int piShowCmd);
            void SetShowCmd(int iShowCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
            void Resolve(IntPtr hwnd, uint fFlags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        interface IPropertyStore
        {
            [PreserveSig] int GetCount(out uint cProps);
            [PreserveSig] int GetAt(uint iProp, out PropertyKey pkey);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant pv);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant pv);
            [PreserveSig] int Commit();
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct PropertyKey { public Guid fmtid; public uint pid; }

        // PROPVARIANT: 16 bytes on x86, 24 on x64. Only VT_LPWSTR is used here.
        [StructLayout(LayoutKind.Sequential)]
        struct PropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }
        const ushort VT_LPWSTR = 31;

        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pvar);

        // PKEY_AppUserModel_ID
        static PropertyKey AumidKey => new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };

        /// <summary>Writes (or overwrites) a .lnk.</summary>
        public static void WriteShortcut(string file, Shortcut s)
        {
            var link = (IShellLinkW)new CShellLink();
            try
            {
                link.SetPath(s.Target);
                link.SetArguments(s.Arguments ?? "");
                link.SetWorkingDirectory(s.WorkingDirectory ?? "");
                link.SetDescription(s.Description ?? "");
                if (!string.IsNullOrEmpty(s.IconPath)) link.SetIconLocation(s.IconPath, s.IconIndex);
                if (!string.IsNullOrEmpty(s.AppUserModelId))
                {
                    var store = (IPropertyStore)link;
                    var key = AumidKey;
                    var pv = new PropVariant { vt = VT_LPWSTR, p = Marshal.StringToCoTaskMemUni(s.AppUserModelId) };
                    try
                    {
                        Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref pv));
                        Marshal.ThrowExceptionForHR(store.Commit());
                    }
                    finally { PropVariantClear(ref pv); }
                }
                ((IPersistFile)link).Save(file, true);
            }
            finally { Marshal.FinalReleaseComObject(link); }
        }

        /// <summary>Reads a .lnk back: target, arguments, working folder, description, icon, AppUserModelID.</summary>
        public static Shortcut ReadShortcut(string file)
        {
            var link = (IShellLinkW)new CShellLink();
            try
            {
                ((IPersistFile)link).Load(file, 0);   // STGM_READ
                var s = new Shortcut();
                var sb = new StringBuilder(32768);
                link.GetPath(sb, sb.Capacity, IntPtr.Zero, 0); s.Target = sb.ToString();
                sb.Clear(); link.GetArguments(sb, sb.Capacity); s.Arguments = sb.ToString();
                sb.Clear(); link.GetWorkingDirectory(sb, sb.Capacity); s.WorkingDirectory = sb.ToString();
                sb.Clear(); link.GetDescription(sb, 1024); s.Description = sb.ToString();
                sb.Clear(); link.GetIconLocation(sb, sb.Capacity, out var idx); s.IconPath = sb.ToString(); s.IconIndex = idx;
                try
                {
                    var store = (IPropertyStore)link;
                    var key = AumidKey;
                    if (store.GetValue(ref key, out var pv) == 0)
                    {
                        try { if (pv.vt == VT_LPWSTR && pv.p != IntPtr.Zero) s.AppUserModelId = Marshal.PtrToStringUni(pv.p); }
                        finally { PropVariantClear(ref pv); }
                    }
                }
                catch { }
                return s;
            }
            finally { Marshal.FinalReleaseComObject(link); }
        }

        /// <summary>"Deepslate Works" on the desktop and in the Start Menu, "Uninstall Deepslate Works" next to it (1.5.2).
        /// Which one failed, and why (1.5.6).</summary>
        public static ShortcutsMade SetShortcuts(string exe, string desktop, string programs)
        {
            var r = new ShortcutsMade();
            foreach (var (where, from, folder) in new[] { ("desktop", "desktop", desktop), ("menu", "startmenu", programs) })
            {
                if (string.IsNullOrEmpty(folder)) continue;
                try { WriteShortcut(Path.Combine(folder, ShortcutName), ShortcutSpec(exe, from)); r.Made++; }
                catch (Exception e) { r.Failed.Add(new System.Collections.Generic.KeyValuePair<string, string>(where, e.Message)); Log.Line("could not make the shortcut in " + folder + ": " + e.Message); }
            }
            if (!string.IsNullOrEmpty(programs))
            {
                try { WriteShortcut(Path.Combine(programs, UninstallShortcutName), UninstallShortcutSpec(exe)); r.Made++; }
                catch (Exception e) { r.Failed.Add(new System.Collections.Generic.KeyValuePair<string, string>("uninstall", e.Message)); Log.Line("could not make the uninstall shortcut: " + e.Message); }
            }
            return r;
        }

        /// <summary>The three shortcuts are there AND start what this version would make them start (2.0.3), so 2.x's
        /// wscript / powershell ones are made again.</summary>
        public static bool TestShortcuts(string exe, string desktop, string programs)
        {
            var want = new[]
            {
                (Path.Combine(desktop ?? "", ShortcutName), ShortcutSpec(exe, "desktop")),
                (Path.Combine(programs ?? "", ShortcutName), ShortcutSpec(exe, "startmenu")),
                (Path.Combine(programs ?? "", UninstallShortcutName), UninstallShortcutSpec(exe)),
            };
            foreach (var (file, spec) in want)
            {
                try
                {
                    if (!File.Exists(file)) return false;
                    var l = ReadShortcut(file);
                    if (!string.Equals(l.Target, spec.Target, StringComparison.OrdinalIgnoreCase) || !string.Equals(l.Arguments, spec.Arguments, StringComparison.OrdinalIgnoreCase)) return false;
                }
                catch { return false; }
            }
            return true;
        }
    }
}

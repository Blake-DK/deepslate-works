using System;
using System.Runtime.InteropServices;
using System.Text;

namespace DeepslateWorks
{
    /// <summary>Win32 the app needs: the foreground, the taskbar button, message boxes, a console for the switches.</summary>
    public static class Native
    {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int MessageBoxW(IntPtr h, string text, string caption, uint type);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string id);
        [DllImport("kernel32.dll")] public static extern bool AttachConsole(int pid);
        [DllImport("kernel32.dll")] public static extern bool AllocConsole();
        [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();

        /// <summary>Lets whatever this process starts or signals next take the foreground (ASFW_ANY). Never fails.</summary>
        public static void GrantForeground() { try { AllowSetForegroundWindow(-1); } catch { } }

        /// <summary>"ok" | "yes" | "no". Topmost and to the front: nothing else of the app may be on screen.</summary>
        public static string Box(string text, bool yesNo = false, bool warn = false)
        {
            uint flags = 0x00010000 | 0x00040000;   // MB_SETFOREGROUND | MB_TOPMOST
            if (yesNo) flags |= 0x4;
            flags |= warn ? 0x30u : (yesNo ? 0x20u : 0x40u);
            int r;
            try { r = MessageBoxW(IntPtr.Zero, text, Env.PackName, flags); } catch { r = 1; }
            return r == 6 ? "yes" : r == 7 ? "no" : "ok";
        }

        /// <summary>The console of the terminal this was started from, for -VerifyExtras and the tests' output. A WinExe has
        /// none of its own; started from Explorer there is nothing to attach to, and output goes nowhere (as it should).</summary>
        public static bool UseParentConsole()
        {
            try { return AttachConsole(-1); } catch { return false; }
        }

        /// <summary>Brings a window to the front even when another program holds the foreground (Show-Front in 2.0.3).</summary>
        public static bool ForceForeground(IntPtr h)
        {
            try
            {
                if (GetForegroundWindow() == h) return true;
                uint theirs = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero), mine = GetCurrentThreadId();
                bool joined = theirs != 0 && theirs != mine && AttachThreadInput(mine, theirs, true);
                try { BringWindowToTop(h); SetForegroundWindow(h); }
                finally { if (joined) AttachThreadInput(mine, theirs, false); }
                return GetForegroundWindow() == h;
            }
            catch { return false; }
        }
    }
}

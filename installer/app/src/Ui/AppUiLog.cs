using System;
using System.Diagnostics;
using System.Threading;
using System.Windows;
using System.Windows.Controls;

namespace DeepslateWorks
{
    /// <summary>3.4.2 (Alex, 2026-10-03): Save log and Send to Alex on the Log tab (Home/LogBundle.cs does the work).</summary>
    sealed partial class AppUi
    {
        Button SaveLogButton, SendLogButton;
        TextBlock LogStatus;

        void WireLogButtons()
        {
            var w = Window;
            T F<T>(string n) where T : class => w.FindName(n) as T ?? throw new InvalidOperationException("the window has no " + n);
            SaveLogButton = F<Button>("SaveLogButton"); SendLogButton = F<Button>("SendLogButton"); LogStatus = F<TextBlock>("LogStatus");
            SaveLogButton.Click += (s, e) => SaveLog(LogBundle.SaveDir(), true);
            SendLogButton.Click += (s, e) => SendLog();
        }

        /// <summary>The zip into dir; Explorer opens on it (not in tests).</summary>
        internal string SaveLog(string dir, bool show)
        {
            try
            {
                var path = LogBundle.Save(dir, DateTime.Now);
                LogStatus.Text = "Saved to " + path + ". Send it to Alex however you like, or press Send to Alex.";
                if (show) { try { Process.Start("explorer.exe", "/select,\"" + path + "\""); } catch { } }
                return path;
            }
            catch (Exception e)
            {
                Log.Line("log not saved: " + e.Message);
                LogStatus.Text = "Couldn't save it: " + e.Message;
                return null;
            }
        }

        void SendLog()
        {
            SendLogButton.IsEnabled = false;
            LogStatus.Text = "Sending…";
            var pack = VerCurrent;
            new Thread(() =>
            {
                var why = LogBundle.Send(pack);
                try
                {
                    Window.Dispatcher.BeginInvoke(new Action(() =>
                    {
                        SendLogButton.IsEnabled = true;
                        LogStatus.Text = why ?? "Sent. Alex can read it on the site (People → Installs).";
                    }));
                }
                catch { }
            }) { IsBackground = true, Name = "send log" }.Start();
        }

        // ---- for the window tests ---------------------------------------------------------------------------------------
        internal string LogStatusText => LogStatus.Text;
    }
}

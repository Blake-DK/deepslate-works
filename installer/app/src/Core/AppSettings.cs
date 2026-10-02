using System;

namespace DeepslateWorks
{
    /// <summary>
    /// The app's own settings on this PC (3.1.0, planner 2026-10-02): settings.json in %LOCALAPPDATA%\DeepslateWorks.
    /// One so far: what pressing Play on the website does once the game is ready (the cog on the Play tab).
    /// </summary>
    public static class AppSettings
    {
        public const string FileName = "settings.json";
        public static string Path => System.IO.Path.Combine(Env.AppHome, FileName);

        /// <summary>start after 5 seconds (the default) | wait for me to press Play | start straight away.</summary>
        public const string Countdown = "countdown", Wait = "wait", Now = "now";
        public static readonly string[] WebsitePlayChoices = { Countdown, Wait, Now };
        public const int CountdownSeconds = 5;

        public static string WebsitePlay(string path = null)
        {
            var v = J.Str(Json.ReadFile(path ?? Path), "websitePlay");
            return Array.IndexOf(WebsitePlayChoices, v) >= 0 ? v : Countdown;
        }

        public static void SetWebsitePlay(string value, string path = null)
        {
            if (Array.IndexOf(WebsitePlayChoices, value) < 0) throw new ArgumentException("not a choice: " + value);
            var p = path ?? Path;
            var j = Json.ReadFile(p) as JObj ?? new JObj();
            j["version"] = 1;
            j["websitePlay"] = value;
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(p));
            Json.WriteFile(p, j);
        }
    }
}

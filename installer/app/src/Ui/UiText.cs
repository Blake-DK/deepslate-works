using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>One line in the Play tab's list: the words, the colour and the weight.</summary>
    public sealed class PlayLine
    {
        public string Text, Color, Weight;
        public PlayLine(string text, string color, string weight = "Normal") { Text = text; Color = color; Weight = weight; }
    }

    /// <summary>The window's words and the small decisions behind them (2.0.x Show-App and friends, without the drawing),
    /// so they can be tested without WPF. Every text is the one 2.0.x showed.</summary>
    public static class UiText
    {
        // ---- the Play tab ------------------------------------------------------------------------------------------
        public const string FirstTitle = "Before we start";
        public const string OneQuestion = "One question";
        public const string FewQuestions = "A few questions";
        public const string FirstStatus = "Deepslate Works asks once for each thing it does on this PC. Your answers are remembered; Review permissions changes them. Allow all says yes to every card on this page, with everything they say still shown.";
        public const string LaterStatus = "Deepslate Works is about to do something it hasn't asked about yet.";
        public const string NeededBadge = "Needed to play";
        public const string OptionalBadge = "Optional";
        public const string NeededWarning = "Deepslate Works can't set up the game without this. You can play only once it's allowed.";
        public const string StoppedTitle = "Stopped";
        public const string StoppedStatus = "You said Not now to '{0}', which is needed to play. Nothing more was done. To carry on, open Review permissions and choose Allow.";
        public const string ReviewTitle = "Permissions";
        public const string ReviewStatus = "What Deepslate Works may do on this PC. Changes count from the next Play. Reset all forgets every answer, so everything is asked again.";
        public const string RunningTitle = "Getting the game ready";
        public const string RunningStatus = "Checking for updates, then the Minecraft Launcher opens on Deepslate Works.";
        public const string RunningExtrasStatus = "Fetching the visual extras.";
        public const string AlreadyTitle = "Already running";
        public const string AlreadyStatus = "Deepslate Works is busy in another window. Let it finish, then press Play.";
        public const string FailedTitle = "That didn't work";
        public const string FailedStatus = "Something went wrong. The Log tab has the details; Alex has them too if reports are on.";
        public const string ReadyTitle = "Ready";
        public const string ReadyStatus = "The Minecraft Launcher is opening on Deepslate Works: press Play there. This window can stay open, or be closed.";
        public const string Play = "Play", Continue = "Continue", SaveAndPlay = "Save and play", Working = "Working...";
        public const string Allow = "Allow", NotNow = "Not now";
        /// <summary>The Extras tab's download question's buttons (2.0.1: Allow all on every question).</summary>
        public const string DownloadButton = "Download", AllowAll = "Allow all";
        public const string CloseWhileBusy = "Deepslate Works is still busy. Close anyway? It carries on next time you press Play.";

        // ---- Play with a countdown (3.1.0, planner B) --------------------------------------------------------------
        public const string IdleTitle = "Deepslate Works";
        public const string IdleStatus = "Press Play to check for updates and start the game.";
        public const string ReadyToPlayTitle = "Ready to play";
        public const string ReadyToPlayStatus = "Everything is up to date and every mod is checked. Press Play to start the game.";
        public const string CountdownButton = "Starting the game in {0}\u2026";
        public const string CountdownHint = "Click anywhere to stop";
        public const string CountdownStatus = "Everything is up to date and every mod is checked.";
        public const string CountdownStopped = "Stopped. Press Play when you're ready.";
        public const string NewExtrasStatus = "New visual extras have been added: have a look on the Extras tab. Press Play when you're ready.";
        public const string QueuedExtrasStatus = "Your extras changes are waiting to install. Press Play when you're ready.";
        public const string WaitingForPlayStep = "Waiting for you to press Play";
        public const string SettingsLink = "\u2699 Play settings";
        public const string SettingsQuestion = "When I press Play on the website";
        public static readonly KeyValuePair<string, string>[] WebsitePlayLabels =
        {
            new KeyValuePair<string, string>(AppSettings.Countdown, "Start after 5 seconds"),
            new KeyValuePair<string, string>(AppSettings.Wait, "Wait for me to press Play"),
            new KeyValuePair<string, string>(AppSettings.Now, "Start straight away"),
        };
        public const string SettingsNote = "Opening Deepslate Works from the desktop or the Start Menu never starts the game by itself.";

        // ---- the app as the front door, votes before play (3.2.0, planner 2026-10-02) ------------------------------
        public const string OpenedStatus = "Signing in, checking for updates and waking the server. Press Play when it's ready.";
        public const string VoteFirstHint = "There's a vote to answer first: it's on the Vote tab.";
        public const string StartServerQuestion = "Start the server? It is switched off (or crashed), so joining won't wake it. This is the same Start as Admin \u2192 Server on the site.";
        public const string StartSent = "Start sent. The server is starting.";
        public const string VoteButton = "Vote", VoteSaving = "Saving...", NextVote = "Next vote", GoToPlay = "Go to Play";
        public const string VoteThanks = "Thanks, your vote is in. Here's how it stands:";
        public const string BallotNote = "The season's mod vote: tick the mods you want. It has a few questions, so it's on the site; it takes two minutes. Come back here when you've voted.";
        public const string BallotOpen = "Open the vote on the site", BallotDone = "I've voted";
        public const string BallotChecking = "Checking with the site...";

        // ---- the guided setup after the old launcher (3.1.0, planner A3) -------------------------------------------
        public static readonly string[] GuidedSteps = { "Welcome", "Move over", "Permissions", "Extras" };
        public static string StepLabel(int n) => string.Format("Step {0} of {1}: {2}", n, GuidedSteps.Length, GuidedSteps[n - 1]);
        public const string WelcomeTitle = "Welcome to the new Deepslate Works app";
        public static readonly string[] WelcomeLines =
        {
            "One program: no black window, nothing running in PowerShell.",
            "A Play button of its own. From the website the game starts after a 5-second countdown you can stop.",
            "Every mod is checked before the game starts, and the app keeps itself up to date.",
        };
        public const string WelcomeKept = "Your mods, settings, extras and sign-in are kept.";
        public const string Next = "Next", Retry = "Retry";
        public const string MoveTitle = "Moving over from the old launcher";
        public const string MoveStatus = "Each line ticks as it's done. The old launcher is removed only once the new app has checked its own install.";
        public const string MoveFailedStatus = "Something didn't work: the line in red says why. Retry tries the lines that aren't done.";
        public const string MoveCopy = "Deepslate Works in its own folder";
        public const string MoveLink = "The Play button on the website opens the new app";
        public const string MoveShortcuts = "Desktop and Start Menu shortcuts";
        public const string MoveApps = "Its entry in Settings \u2192 Apps";
        public const string MoveCarry = "Your permissions, extras, sign-in and installed pack";
        public const string MoveVerify = "Checking the new app's install";
        public const string MoveCleanup = "Removing the old launcher";
        public const string MoveNoLinks = "You said Not now to the Play button and shortcuts (Review permissions changes that)";
        public const string MoveKeptLink = "The Play button you already had now opens the new app";
        public const string MoveVerified = "The Play button, the shortcuts and Settings \u2192 Apps all start the new app";
        public const string MoveNothingOld = "Nothing of the old launcher was left";
        public const string PermTitle = "Permissions";
        public const string PermNone = "Nothing new to ask. Your answers from the old launcher are kept:";
        public const string PermSome = "The new app asks about something the old one didn't. Everything you answered before stays answered.";
        public const string ExtrasStepHeadline = "Step 4 of 4: the visual extras, if you'd like any. Then press Continue.";
        public const string DoneTitle = "All set";
        public const string DoneStatus = "You're moved over to the new app. Press Play when you're ready: the game starts only when you do.";

        /// <summary>A Move over line's mark and colour by its status.</summary>
        public static PlayLine MoveLine(MoveItem it)
        {
            switch (it.Status)
            {
                case "ok": return new PlayLine("\u2713  " + it.Label + (it.Detail != "" ? ": " + it.Detail : ""), "#2E7D5B");
                case "skipped": return new PlayLine("\u2013  " + it.Label + ": " + it.Detail, "#666");
                case "failed": return new PlayLine("\u2717  " + it.Label + ": " + it.Detail, "#B3261E", "SemiBold");
                case "doing": return new PlayLine("\u2026  " + it.Label, "#1A5FB4");
                default: return new PlayLine("    " + it.Label, "#888");
            }
        }

        /// <summary>One kept answer, for the Permissions step: "Allowed" or "Not now", with the card's title.</summary>
        public static string KeptAnswer(ConsentStep s, ConsentAnswer a) => string.Format("{0}  {1}: {2}", a.Answer == "allow" ? "\u2713" : "\u2013", s.Title, a.Answer == "allow" ? "allowed" : "not now");

        /// <summary>The badge colours by tone (planner G): background, text.</summary>
        public static readonly Dictionary<string, string[]> Tones = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            { "grey", new[] { "#EEF0F2", "#555555" } }, { "blue", new[] { "#E3F0FF", "#1A5FB4" } }, { "amber", new[] { "#FFF4E0", "#8A5A00" } },
            { "green", new[] { "#E8F3EE", "#2E7D5B" } }, { "red", new[] { "#FDECEA", "#B3261E" } },
        };
        public static string[] Tone(string tone) => tone != null && Tones.TryGetValue(tone, out var t) ? t : Tones["grey"];

        /// <summary>The FPS cost badge's colours: Low green, Medium amber, High red.</summary>
        public static string[] FpsTone(string fps)
        {
            switch ((fps ?? "").ToLowerInvariant())
            {
                case "low": return Tones["green"];
                case "medium": return Tones["amber"];
                case "high": return Tones["red"];
                default: return Tones["grey"];
            }
        }

        /// <summary>The Extras headline box's colour (Overview.HeadlineTone): green, red, amber, else the plain blue-grey.</summary>
        public static string HeadlineBackground(string tone)
            => tone == "green" ? "#E8F3EE" : tone == "red" ? "#FDECEA" : tone == "amber" ? "#FFF4E0" : "#EEF4F8";

        /// <summary>The Play tab's title when questions are shown (Show-FirstRun).</summary>
        public static string QuestionsTitle(bool first, int count) => first ? FirstTitle : count == 1 ? OneQuestion : FewQuestions;

        /// <summary>A card's text: the bigger wording for a bigger step, the extras' size put in ("10" when unknown).</summary>
        public static string CardText(ConsentStep step, int level, string sizeMb)
        {
            var text = step.Text ?? "";
            if (level > 1 && !string.IsNullOrEmpty(step.Bigger)) text = step.Bigger;
            if (text.Contains("{0}")) text = text.Replace("{0}", string.IsNullOrEmpty(sizeMb) ? "10" : sizeMb);
            return text;
        }

        /// <summary>The level an answer covers once saved: an Allow covers the step's biggest level (or the one asked
        /// about), a Not now level 1 (Save-Answers).</summary>
        public static int SavedLevel(string answer, int askLevel, int top) => answer == "allow" ? Math.Max(askLevel, top) : 1;

        /// <summary>What a status line from the install steps shows on the Play tab (Read-StatusLines): step, tick, note and
        /// fail are lines; the others (ask, declined, used, changed, extras, done) are not shown.</summary>
        public static PlayLine LineFor(JObj o)
        {
            var text = J.Str(o, "text") ?? "";
            switch (J.Str(o, "t"))
            {
                case "step": return new PlayLine(text, "#555");
                case "tick": return new PlayLine("✓  " + text, "#2E7D5B");
                case "note": return new PlayLine("   " + text, "#666");
                case "fail": return new PlayLine(text, "#B3261E", "SemiBold");
                default: return null;
            }
        }

        /// <summary>The exit code 2.0.x's engine would have ended with, for the log line "the install steps ended".</summary>
        public static int ExitCodeFor(Exception e)
        {
            if (e == null) return 0;
            if (e is NeedAnswer) return 20;
            if (e is StepDeclined) return 21;
            if (e is AlreadyRunning) return Env.ExitAlreadyRunning;
            return 1;
        }

        /// <summary>The title and text when a run ended with an exception that is not a question (On-RunEnded).</summary>
        public static KeyValuePair<string, string> EndedText(Exception e, string lastFail)
        {
            if (e is AlreadyRunning) return new KeyValuePair<string, string>(AlreadyTitle, AlreadyStatus);
            var text = !string.IsNullOrEmpty(lastFail) ? lastFail : e is RunFailed && !string.IsNullOrEmpty(e.Message) ? e.Message : FailedStatus;
            return new KeyValuePair<string, string>(FailedTitle, text);
        }

        // ---- the Log tab ---------------------------------------------------------------------------------------------
        static readonly Regex ErrorWords = new Regex("ERROR|FAIL|refused|could not", RegexOptions.IgnoreCase);
        /// <summary>A log line shown red (Update-LogBox; -match is case-insensitive).</summary>
        public static bool IsErrorLine(string line) => ErrorWords.IsMatch(line ?? "");
        /// <summary>The line Show details jumps to (the last one that says ERROR).</summary>
        public static bool IsDetailsLine(string line) => (line ?? "").IndexOf("ERROR", StringComparison.OrdinalIgnoreCase) >= 0;
        /// <summary>The Log tab shows this many of the log's last lines.</summary>
        public const int LogLines = 600;
    }
}

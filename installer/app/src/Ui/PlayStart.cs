using System;
using System.Collections.Generic;

namespace DeepslateWorks
{
    /// <summary>
    /// Play with a countdown (3.1.0, planner 2026-10-02, B). The app never starts the game the moment it opens. Opened by
    /// the website's Play button (deepslate://play) and everything ready, it counts down on the Play button ("Starting the
    /// game in 5…", "Click anywhere to stop") and starts at 0; opened from the desktop or the Start Menu it only shows Play.
    /// What the person chose with the cog ("When I press Play on the website") decides between counting down, waiting and
    /// starting straight away. Pure, so it is tested; the window draws it.
    /// </summary>
    public static class PlayStart
    {
        /// <summary>What happens once the game is ready: "countdown", "now" (start straight away) or "wait" (the Play
        /// button, and why in `why`).</summary>
        public sealed class Decision
        {
            public string Do;
            public string Why;   // for the log: what kept the countdown away
            public override string ToString() => Do + (string.IsNullOrEmpty(Why) ? "" : " (" + Why + ")");
        }

        /// <summary>
        /// fromWebsite: this window was opened (or brought back) by deepslate://play. pressedPlay: the person pressed Play
        /// or Continue in the window, which is a start in itself. The rest are the planner's "no countdown" cases.
        /// </summary>
        public static Decision Decide(bool fromWebsite, bool pressedPlay, string setting, bool firstRun, bool handOver, bool newPermission, bool newExtras, bool queuedExtras)
        {
            if (pressedPlay) return new Decision { Do = "now" };
            if (!fromWebsite) return new Decision { Do = "wait", Why = "opened from the desktop or the Start Menu" };
            var no = new List<string>();
            if (firstRun) no.Add("first run");
            if (handOver) no.Add("just moved over from the old launcher");
            if (newPermission) no.Add("a new permission needs an answer");
            if (newExtras) no.Add("new extras to look at");
            if (queuedExtras) no.Add("extras changes are waiting to install");
            if (no.Count > 0) return new Decision { Do = "wait", Why = string.Join(", ", no) };
            if (setting == AppSettings.Wait) return new Decision { Do = "wait", Why = "the setting says wait for Play" };
            if (setting == AppSettings.Now) return new Decision { Do = "now", Why = "the setting says start straight away" };
            return new Decision { Do = "countdown" };
        }
    }

    /// <summary>
    /// The countdown on the Play button: started at 5, one Tick a second, Fired at 0. Any click, key, tab switch or
    /// setting change Cancels it for good: the button says Play and stays that way until it is pressed.
    /// </summary>
    public sealed class Countdown
    {
        public int Left { get; private set; }
        public bool Running { get; private set; }
        public bool Fired { get; private set; }
        public string CancelledBy { get; private set; }

        public Countdown(int seconds = AppSettings.CountdownSeconds) { Left = Math.Max(1, seconds); Running = true; }

        /// <summary>One second gone. True when it has just reached 0: start the game.</summary>
        public bool Tick()
        {
            if (!Running) return false;
            Left--;
            if (Left > 0) return false;
            Running = false; Fired = true;
            return true;
        }

        /// <summary>Stopped by the person ("click", "key", "tab", "setting", "closed"). False when it was not running.</summary>
        public bool Cancel(string by)
        {
            if (!Running) return false;
            Running = false; CancelledBy = by;
            return true;
        }

        public string ButtonText => Running ? string.Format(UiText.CountdownButton, Left) : UiText.Play;
    }
}

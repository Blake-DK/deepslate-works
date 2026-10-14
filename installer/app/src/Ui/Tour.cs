using System;
using System.Collections.Generic;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.6.6 (Alex, 2026-10-14): the first-time guide. A card over the window walks through each tab, showing the real tab
    /// behind it, and ends on the pack's new keys, which the player confirms. Shown once per PC (settings.json's tourSeen);
    /// raising Version shows it again to everyone. Play waits for it like a must-vote poll. Pure: no WPF.
    /// </summary>
    public static class Tour
    {
        public const string Version = "3.6.6";

        /// <summary>One page: the tab shown behind the card (play, extras, settings, log, test), its title and lines.</summary>
        public sealed class Page
        {
            public string Tab, Title, Button;
            public string[] Lines;
            public bool Keys;   // the last page: no Skip, confirmed with its own button
        }

        /// <summary>Due when this PC has not seen this version of the tour.</summary>
        public static bool Due(string seen) => !string.Equals(seen, Version, StringComparison.Ordinal);

        /// <summary>The pages in order; the Test tab's only for a sign-in that has it.</summary>
        public static List<Page> Pages(bool test)
        {
            var p = new List<Page>
            {
                new Page { Tab = "play", Title = UiText.TourWelcomeTitle, Lines = UiText.TourWelcome },
                new Page { Tab = "play", Title = "Play", Lines = UiText.TourPlay },
                new Page { Tab = "play", Title = "Votes", Lines = UiText.TourVotes },
                new Page { Tab = "extras", Title = "Extras", Lines = UiText.TourExtras },
                new Page { Tab = "settings", Title = "Settings", Lines = UiText.TourSettings },
                new Page { Tab = "log", Title = "Log", Lines = UiText.TourLog },
            };
            if (test) p.Add(new Page { Tab = "test", Title = "Test", Lines = UiText.TourTest });
            p.Add(new Page { Tab = "play", Title = UiText.TourKeysTitle, Lines = UiText.TourKeys, Keys = true, Button = UiText.TourKeysButton });
            foreach (var x in p) if (x.Button == null) x.Button = "Next";
            return p;
        }

        /// <summary>The small label over the title: "1 of 8".</summary>
        public static string StepLine(int index, int count) => string.Format("{0} of {1}", index + 1, count);

        /// <summary>Skip goes to the keys page, which has to be seen.</summary>
        public static int SkipTo(List<Page> pages) => pages.FindIndex(x => x.Keys);
    }
}

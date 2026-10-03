using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.3.1 (planner 2026-10-02): Review permissions is a view of its own. Its row is Allow all, Reset all, Save and
    /// nothing else: no Play, no Update, no "Checked at" line, no Play hint (on 3.3.0 they made the row wider than the
    /// window and "Reset all" was cut off behind the links). Save stores the answers and goes back to the Play view as it
    /// was; it never starts the game or a run. A run that was ready and waiting is still ready after it. Leaving the view
    /// (Save, Reset all, another tab) puts the Play view back exactly as it was.
    /// </summary>
    sealed partial class AppUi
    {
        /// <summary>The Play view as it was when Review was opened, put back when it is left.</summary>
        sealed class PlayView
        {
            public string Mode, Title, Status, Changed, Hint;
            public object PlayContent;
            public bool PlayEnabled, ChangedShown, HintShown;
            public double PlayMinWidth;
            public List<UIElement> Body;
        }

        PlayView reviewFrom;
        bool reviewing;
        public const double ReviewSaveMinWidth = 110;

        /// <summary>Review permissions: every step with its current answer; the row is Allow all, Reset all, Save.</summary>
        void OpenReview()
        {
            if (Mode == "running" || Mode == "asking" || Guided > 0 || updating) return;
            // the game may be ready and waiting: it keeps waiting while the answers are looked at
            CancelCountdown("a setting");
            HideCountdown();
            reviewFrom = new PlayView
            {
                Mode = Mode, Title = PlayTitle.Text, Status = PlayStatus.Text, Changed = PlayChanged.Text, ChangedShown = PlayChanged.Visibility == Visibility.Visible,
                Hint = PlayHint.Text, HintShown = PlayHint.Visibility == Visibility.Visible,
                PlayContent = PlayButton.Content, PlayEnabled = PlayButton.IsEnabled, PlayMinWidth = PlayButton.MinWidth,
                Body = PlayBody.Children.Cast<UIElement>().ToList(),
            };
            PlayBody.Children.Clear();   // the elements are kept in reviewFrom and put back as they are
            reviewing = true;
            Answers = new Dictionary<string, string>();
            foreach (var k in Consent.Keys) Answers[k] = Consent[k].Answer;
            ShowFirstRun(Consents.Steps());
            PlayTitle.Text = UiText.ReviewTitle;
            PlayStatus.Text = UiText.ReviewStatus;
            PlayButton.Content = UiText.Save;
            PlayButton.MinWidth = ReviewSaveMinWidth;
            PlayHint.Visibility = Visibility.Collapsed;
            SetPromptButtons(true, true);
            SyncUpdateRow();
            Log.Line("window: Review permissions opened");
        }

        /// <summary>Back to the Play view as it was: after Save, or when the view is left without saving.</summary>
        void CloseReview(string why)
        {
            if (!reviewing) return;
            reviewing = false;
            var v = reviewFrom; reviewFrom = null;
            PlayButton.MinWidth = v?.PlayMinWidth ?? 190;
            SetPromptButtons(false, false);
            Asking = new List<ConsentStep>();
            if (v == null) { ShowIdle(); return; }
            ClearPlayBody();
            foreach (var e in v.Body) PlayBody.Children.Add(e);
            Mode = v.Mode;
            PlayTitle.Text = v.Title; PlayStatus.Text = v.Status;
            PlayChanged.Text = v.Changed; PlayChanged.Visibility = v.ChangedShown ? Visibility.Visible : Visibility.Collapsed;
            PlayHint.Text = v.Hint; PlayHint.Visibility = v.HintShown ? Visibility.Visible : Visibility.Collapsed;
            PlayButton.Content = v.PlayContent; PlayButton.IsEnabled = v.PlayEnabled;
            // a countdown that was running when Review opened was stopped then: the ready game waits for Play
            if (Mode == "ready") { PlayButton.Content = UiText.Play; PlayButton.IsEnabled = true; if (PlayHint.Text == UiText.CountdownHint) PlayHint.Visibility = Visibility.Collapsed; }
            SyncUpdateRow();
            GatePlay();
            Log.Line("window: Review permissions closed (" + why + ")");
        }

        /// <summary>Reset all leaves Review for the first-run questions (as before); the view to come back to is kept for nothing.</summary>
        void LeaveReviewForReset()
        {
            if (!reviewing) return;
            reviewing = false;
            PlayButton.MinWidth = reviewFrom?.PlayMinWidth ?? 190;
            if (reviewFrom != null && reviewFrom.Mode == "ready") { /* the ready run keeps waiting; Continue starts it, as before */ }
            reviewFrom = null;
        }

        /// <summary>The Update button and its line belong to the Play view: not on the question cards (first run, Review)
        /// nor in the guided setup, where the row would be wider than the window.</summary>
        void SyncUpdateRow()
        {
            var show = Mode != "asking" && Guided == 0 && !reviewing;
            var b = show ? Visibility.Visible : Visibility.Collapsed;
            if (UpdateButton.Visibility != b) UpdateButton.Visibility = b;
            var l = show && !string.IsNullOrEmpty(UpdateLine.Text) ? Visibility.Visible : Visibility.Collapsed;
            if (UpdateLine.Visibility != l) UpdateLine.Visibility = l;
        }

        // ---- for the window tests ---------------------------------------------------------------------------------------
        internal void PressReview() => OpenReview();
        internal void PressPlay() => OnPlayButton();
        internal void PressAllowAll() => OnAllowAll();
        internal void PressTab(string which) => Tabs.SelectedItem = which == "extras" ? ExtrasTab : which == "log" ? LogTab : which == "vote" ? VoteTab : PlayTab;
        internal bool InReview => reviewing;
        internal string ModeNow => Mode;
        internal bool RunStarted => worker != null;
        internal bool GoSent => goEvent.WaitOne(0);
        internal bool ResetShown => ResetButton.Visibility == Visibility.Visible;
        internal bool AllowAllShown => AllowAllButton.Visibility == Visibility.Visible;
        internal bool UpdateShown => UpdateButton.Visibility == Visibility.Visible;
        internal bool UpdateLineShown => UpdateLine.Visibility == Visibility.Visible;
        internal bool PlayHintShown => PlayHint.Visibility == Visibility.Visible;
        internal double PlayMinWidthNow => PlayButton.MinWidth;
        internal void SimWaiting() { runWaiting = true; }
    }
}

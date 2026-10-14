using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.6.6 (Alex, 2026-10-14): the first-time guide (Tour.cs) in the window. It starts once the window has settled (no
    /// guided setup, no question card, not reviewing), on a home refresh, so a new player gets it after the first-run
    /// questions and everyone else on the first open after the update. While it is open Play waits, as for a must-vote
    /// poll (VotesBlock); after the last page the votes come, or Play opens and a waiting run carries on.
    /// </summary>
    sealed partial class AppUi
    {
        Grid TourLayer;
        TextBlock TourStep, TourTitle;
        StackPanel TourBody;
        Button TourNext, TourBack, TourSkip;
        List<Tour.Page> tourPages;
        int tourAt = -1;

        public bool TourOpen => tourAt >= 0;

        void WireTour()
        {
            var w = Window;
            T F<T>(string n) where T : class => w.FindName(n) as T ?? throw new InvalidOperationException("the window has no " + n);
            TourLayer = F<Grid>("TourLayer"); TourStep = F<TextBlock>("TourStep"); TourTitle = F<TextBlock>("TourTitle"); TourBody = F<StackPanel>("TourBody");
            TourNext = F<Button>("TourNext"); TourBack = F<Button>("TourBack"); TourSkip = F<Button>("TourSkip");
            TourBack.Content = UiText.TourBack; TourSkip.Content = UiText.TourSkip;
            TourNext.Click += (s, e) => { if (!TourOpen) return; if (tourAt + 1 < tourPages.Count) ShowTourPage(tourAt + 1); else FinishTour(); };
            TourBack.Click += (s, e) => { if (TourOpen && tourAt > 0) ShowTourPage(tourAt - 1); };
            TourSkip.Click += (s, e) => { if (TourOpen) { Log.Line("window: tour skipped at page " + (tourAt + 1)); ShowTourPage(Tour.SkipTo(tourPages)); } };
        }

        /// <summary>On every home refresh: the tour, if this PC has not seen it and nothing else has the window.</summary>
        void MaybeStartTour()
        {
            if (TourOpen || homeSim || Guided > 0 || Mode == "asking" || reviewing) return;
            string seen;
            try { seen = AppSettings.TourSeen(); } catch { return; }
            if (!Tour.Due(seen)) return;
            StartTour();
        }

        public void StartTour()
        {
            tourPages = Tour.Pages(TestTab != null);
            if (Count != null && Count.Running) { CancelCountdown("the first-time guide"); HideCountdown(); }
            Log.Line("window: the first-time guide (" + tourPages.Count + " pages)");
            ShowTourPage(0);
        }

        void ShowTourPage(int i)
        {
            tourAt = i;
            var p = tourPages[i];
            TourStep.Text = Tour.StepLine(i, tourPages.Count).ToUpperInvariant();
            TourTitle.Text = p.Title;
            TourBody.Children.Clear();
            foreach (var line in p.Lines)
            {
                var t = NewText(line, 14, "Normal", "Fg"); t.TextWrapping = TextWrapping.Wrap; t.Margin = new Thickness(0, 0, 0, 6);
                TourBody.Children.Add(t);
            }
            TourNext.Content = p.Button;
            TourBack.Visibility = i > 0 ? Visibility.Visible : Visibility.Collapsed;
            TourSkip.Visibility = p.Keys ? Visibility.Collapsed : Visibility.Visible;
            var tab = TabFor(p.Tab);
            if (tab != null && tab.Visibility == Visibility.Visible) Tabs.SelectedItem = tab;
            TourLayer.Visibility = Visibility.Visible;
            GatePlay();
        }

        TabItem TabFor(string tab)
        {
            switch (tab)
            {
                case "extras": return ExtrasTab;
                case "settings": return SettingsTab;
                case "log": return LogTab;
                case "test": return TestTab;
                default: return PlayTab;
            }
        }

        /// <summary>The last page confirmed: remembered on this PC, then the votes, or Play as usual.</summary>
        void FinishTour()
        {
            try { AppSettings.SetTourSeen(Tour.Version); } catch (Exception e) { Log.Line("window: the guide could not be remembered: " + e.Message); }
            tourAt = -1;
            TourLayer.Visibility = Visibility.Collapsed;
            Tabs.SelectedItem = PlayTab;
            Log.Line("window: the first-time guide done");
            if (PendingVotes.Count > 0) { GatePlay(); ShowVoteTab(); UpdateVoteBadge(); }
            else FinishVotes();
        }

        // ---- for the window tests ----------------------------------------------------------------------------------------
        internal string TourPageTitle => TourOpen ? TourTitle.Text : null;
        internal void TourClickNext() => TourNext.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
        /// <summary>Screenshots: the guide closed without remembering it on this PC.</summary>
        internal void SimTourEnd() { tourAt = -1; TourLayer.Visibility = Visibility.Collapsed; Tabs.SelectedItem = PlayTab; }
        internal void TourClickSkip() => TourSkip.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
    }
}

using System;
using System.Globalization;
using System.Windows.Data;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.4.0 (docs/21 §4): the Update button's "✓ Up to date" / "● Update" with the mark in Copper and the words in Fg. The
    /// button's Content stays the plain string (the window tests read it); its ContentTemplate splits it with this.
    /// </summary>
    public sealed class MarkSplit : IValueConverter
    {
        static bool HasMark(string s) => s != null && s.Length >= 2 && (s[0] == '✓' || s[0] == '●') && s[1] == ' ';

        /// <summary>The leading ✓ or ●, or "".</summary>
        public static string Mark(string s) => HasMark(s) ? s.Substring(0, 1) : "";

        /// <summary>Everything after the mark (with its space), or the whole label when it has none.</summary>
        public static string Rest(string s) => HasMark(s) ? s.Substring(1) : s ?? "";

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => (parameter as string) == "mark" ? Mark(value as string) : Rest(value as string ?? value?.ToString());

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
    }
}

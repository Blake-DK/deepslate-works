using System;
using System.Globalization;
using System.Management;

namespace DeepslateWorks
{
    /// <summary>
    /// 3.5.0 (docs/30 §4.1): how much memory the game gets. One place for the rule, so the Settings tab's slider and the
    /// engine's launcher profile cannot disagree. Automatic is the rule the engine always had: 3 / 4 / 5 / 6 GB for a PC
    /// under 8 / 8 / 12 / 16 GB and up, kept within the mod list's ram.min_gb and ram.max_gb. A choice made in Settings
    /// may go from ram.min_gb to the smaller of ram.user_max_gb and the PC's memory less 4 GB.
    /// </summary>
    public static class Memory
    {
        /// <summary>ram.user_max_gb when the mod list does not give one.</summary>
        public const int DefaultUserMaxGb = 8;
        /// <summary>ram.min_gb when the mod list does not give one (the schema's own lowest).</summary>
        public const int DefaultMinGb = 2;
        /// <summary>What the PC is taken to have when WMI cannot say.</summary>
        public const int UnknownTotalGb = 8;

        public sealed class Bounds
        {
            public int TotalGb;    // the PC's memory, whole GB
            public int Low, High;  // the slider's range
            public int Auto;       // what Deepslate Works would pick
            /// <summary>The top of the range is not above the bottom (a PC under 8 GB): no choice to make.</summary>
            public bool Fixed => High <= Low;
        }

        /// <summary>The engine's own rule, unchanged since 1.x.</summary>
        public static int Automatic(double totalGb, double? minGb, double? maxGb)
        {
            double x = 3;
            if (totalGb >= 16) x = 6; else if (totalGb >= 12) x = 5; else if (totalGb >= 8) x = 4;
            // the mod list's bounds; one it does not give is no bound
            if (maxGb.HasValue) x = Math.Min(maxGb.Value, x);
            if (minGb.HasValue) x = Math.Max(minGb.Value, x);
            return (int)Math.Round(x);
        }

        public static Bounds Range(double totalGb, double? minGb, double? maxGb, double? userMaxGb)
        {
            var total = (int)Math.Round(totalGb);
            var low = (int)Math.Round(minGb ?? DefaultMinGb);
            var high = (int)Math.Min(Math.Round(userMaxGb ?? DefaultUserMaxGb), total - 4);
            return new Bounds { TotalGb = total, Low = low, High = Math.Max(low, high), Auto = Automatic(totalGb, minGb, maxGb) };
        }

        /// <summary>
        /// What the launcher profile gets: the automatic value when nothing was chosen; a choice kept within the range,
        /// never below its bottom. clamped says the choice had to be moved (the memory was taken out of the PC, or the
        /// mod list's limit came down); settings.json keeps the choice as it is.
        /// </summary>
        public static int Xmx(int? chosenGb, Bounds b, out bool clamped)
        {
            clamped = false;
            if (!chosenGb.HasValue) return b.Auto;
            var x = Math.Max(b.Low, Math.Min(b.High, chosenGb.Value));
            clamped = x != chosenGb.Value;
            return x;
        }

        /// <summary>The engine's Bounds from the mod list it was given (ram.min_gb, ram.max_gb, ram.user_max_gb).</summary>
        public static Bounds FromManifest(object manifest, double totalGb)
            => Range(totalGb, J.Num(manifest, "ram.min_gb"), J.Num(manifest, "ram.max_gb"), J.Num(manifest, "ram.user_max_gb"));

        /// <summary>The PC's memory in whole GB, the read the engine always made (WMI); 8 when it fails.</summary>
        public static int TotalGb()
        {
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem"))
                    foreach (ManagementBaseObject c in q.Get()) return (int)Math.Round(Convert.ToDouble(c["TotalPhysicalMemory"], CultureInfo.InvariantCulture) / (1024.0 * 1024 * 1024));
            }
            catch { }
            return UnknownTotalGb;
        }

        /// <summary>docs/30 §4.1: one warning at a time, the first that applies; null for none.</summary>
        public static string Warning(int chosenGb, int totalGb)
        {
            if (chosenGb * 2 > totalGb) return UiText.RamWarnHalf;
            if (chosenGb > 8) return UiText.RamWarnStutter;
            return null;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>What an Update would bring, in plain words (3.3.0): a newer app, mods, settings files, extras.</summary>
    public sealed class Waiting
    {
        public string AppVersion;              // a newer app on the site, or null
        public int ModsChanged;                // added, changed or removed files of the pack
        public bool PackNew;                   // the pack's hash differs from what this PC has
        public bool Config;                    // the pack's settings files changed
        public bool Extras;                    // the extras on the site changed, or changes chosen here wait to install
        public bool NotInstalled;              // nothing on this PC yet
        public bool NotSignedIn;
        public string Problem;                 // the check itself could not be done
        public DateTime CheckedAt;
        public bool Any => AppVersion != null || ModsChanged > 0 || PackNew || Config || Extras || NotInstalled || NotSignedIn;
    }

    /// <summary>
    /// 3.3.0, the Update button: is there anything newer than this PC has? Asked when the app opens and every 10 minutes
    /// while it is open (GET /api/app/updates: the pack's files and settings, the current app, the extras' files; no
    /// download is logged for it). Compared with what the last run left on this PC: pack-list.json, installed.json, the
    /// extras list. Pure, so it is tested.
    /// </summary>
    public static class UpdateCheck
    {
        public const string UpdatesPath = "/api/app/updates";
        public const int EveryMinutes = 10;

        public static Waiting Compare(object site, object packList, object installed, ExtrasManifest localExtras, bool extrasQueued, string appVersion, DateTime now)
        {
            var w = new Waiting { CheckedAt = now };
            var offered = J.Str(site, "app.version");
            if (Ver.IsNewer(offered, appVersion)) w.AppVersion = offered;
            if (installed == null || packList == null) { w.NotInstalled = true; return w; }

            var siteFiles = J.Arr(site, "pack.files").ToDictionary(f => J.Str(f, "filename") ?? "", f => (J.Str(f, "sha512") ?? "").ToLowerInvariant(), StringComparer.OrdinalIgnoreCase);
            var ours = J.Arr(packList, "files").ToDictionary(f => J.Str(f, "filename") ?? "", f => (J.Str(f, "sha512") ?? "").ToLowerInvariant(), StringComparer.OrdinalIgnoreCase);
            w.ModsChanged = siteFiles.Count(kv => !ours.TryGetValue(kv.Key, out var sha) || sha != kv.Value) + ours.Keys.Count(k => !siteFiles.ContainsKey(k));
            var siteHash = J.Str(site, "pack.hash") ?? "";
            w.PackNew = siteHash.Length > 0 && !string.Equals(siteHash, J.Str(installed, "hash") ?? "", StringComparison.OrdinalIgnoreCase);

            string Sig(object list) => string.Join("|", J.Arr(list, "configs").Select(c => (J.Str(c, "path") ?? "") + "=" + (J.Str(c, "sha256") ?? "").ToLowerInvariant()).OrderBy(x => x, StringComparer.Ordinal));
            w.Config = Sig(J.Get(site, "pack")) != Sig(packList);

            var siteExtras = new HashSet<string>(J.Strs(site, "extras").Select(x => x.ToLowerInvariant()));
            var ourExtras = new HashSet<string>((localExtras?.Extras ?? new List<ExtraItem>()).SelectMany(x => x.Files).Select(f => (f.Sha512 ?? "").ToLowerInvariant()));
            w.Extras = extrasQueued || (localExtras != null && !siteExtras.SetEquals(ourExtras));
            return w;
        }

        /// <summary>The line under the buttons: what is waiting, or "Checked at 15:42. Nothing to update."</summary>
        public static string Line(Waiting w)
        {
            if (w == null) return "";
            if (w.NotSignedIn) return "Not signed in yet: Update signs you in and fetches the pack.";
            if (w.Problem != null) return "Couldn't check for updates: " + w.Problem;
            var parts = new List<string>();
            if (w.NotInstalled) parts.Add("Not installed on this PC yet");
            else if (w.ModsChanged > 0) parts.Add(string.Format("New pack: {0} mod{1} changed", w.ModsChanged, w.ModsChanged == 1 ? "" : "s"));
            else if (w.PackNew || w.Config) parts.Add("New pack settings");
            if (w.AppVersion != null) parts.Add("New version of this app");
            if (w.Extras && !w.NotInstalled) parts.Add("Your extras changed");
            if (parts.Count == 0) return string.Format("Checked at {0}. Nothing to update.", w.CheckedAt.ToString("HH:mm", CultureInfo.InvariantCulture));
            return string.Join(". ", parts) + ".";
        }

        /// <summary>The button: "Up to date" with a tick, "Update" with a dot, or "Updating…" while it runs.</summary>
        public static string Button(Waiting w, bool running) => running ? "Updating…" : w == null || !w.Any && w.Problem == null ? "✓ Up to date" : w.Problem != null ? "Update" : "● Update";

        // ---- the call, and what this PC has ------------------------------------------------------------------------
        public static Waiting Run(DateTime now)
        {
            if (string.IsNullOrEmpty(Http.Token))
            {
                try { if (File.Exists(Env.TokenFile)) Http.Token = J.Str(Json.Parse(File.ReadAllText(Env.TokenFile)), "token"); } catch { }
            }
            if (string.IsNullOrEmpty(Http.Token)) return new Waiting { NotSignedIn = true, CheckedAt = now };
            object site;
            try { site = Http.GetJson(Env.PortalUrl + UpdatesPath, 20); }
            catch (Exception e)
            {
                if ((e as HttpError)?.Status == 401) return new Waiting { NotSignedIn = true, CheckedAt = now };
                return new Waiting { Problem = SiteHome.Why(e), CheckedAt = now };
            }
            object installed = null;
            try { if (File.Exists(Env.LiveInstalledFile)) installed = Json.Parse(File.ReadAllText(Env.LiveInstalledFile)); } catch { }   // docs/45: the live pack's, always
            ExtrasManifest x = null; bool queued = false;
            try { x = ExtrasManifest.Read(Env.ExtrasManifestPath); } catch { }
            try { queued = ExtrasState.Read(Env.ExtrasStatePath)?.Queued != null; } catch { }
            return Compare(site, Engine.ReadPackList(Engine.LivePackListPath), installed, x, queued, Env.Version, now);
        }
    }
}

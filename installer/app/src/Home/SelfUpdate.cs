using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;

namespace DeepslateWorks
{
    /// <summary>
    /// The app updates itself (docs/07 "Updates", 3.0). The mod list names the version of DeepslateWorks.exe the site hands
    /// out, its SHA-256 and size (installer.exe). An older copy fetches it from this site's /downloads (never from an
    /// address in the mod list) to DeepslateWorks.exe.new, checks the size, the checksum, that it is a Windows program and
    /// the version written inside it, renames itself to .old (Windows lets a running exe be renamed, not deleted), moves
    /// the new one into its place and starts it; the new one deletes .old on its next start. On any problem nothing is
    /// replaced and the run carries on with the version it has; the report's updateProblem says why.
    /// </summary>
    public static class SelfUpdate
    {
        public class Offer { public string Version; public string Sha256; public long Size; }
        public class Outcome { public string Status; public string Version; public string Problem; }   // current | updated | failed

        /// <summary>What the site says about the exe: manifest.installer.exe {version, sha256, size}, or null (a mod list
        /// from before 3.0 names only the script).</summary>
        public static Offer Offered(object manifest)
        {
            try
            {
                var e = J.Obj(manifest, "installer.exe");
                if (e == null) return null;
                var v = J.Str(e, "version");
                if (string.IsNullOrEmpty(v)) return null;
                return new Offer { Version = v, Sha256 = J.Str(e, "sha256") ?? "", Size = J.Long(e, "size") ?? 0 };
            }
            catch { return null; }
        }

        public static void CleanOld() => CleanOldAt(Env.MePath);

        public static void CleanOldAt(string exe)
        {
            if (string.IsNullOrEmpty(exe)) return;
            var old = exe + ".old";
            if (!File.Exists(old)) return;
            try { File.SetAttributes(old, FileAttributes.Normal); File.Delete(old); Log.Line("removed " + Path.GetFileName(old) + ", left by the last update"); }
            catch (Exception e) { Log.Line("could not remove " + old + " (the next start tries again): " + e.Message); }
        }

        public static string Check(Run run, object manifest, string[] restartArgs) => CheckAt(run, manifest, restartArgs, Env.MePath);

        /// <summary>Check for the exe at a given path (tests).</summary>
        public static string CheckAt(Run run, object manifest, string[] restartArgs, string exe)
        {
            // Set when an older copy fetched this one and started it: also what stops a second update in the same run.
            if (!string.IsNullOrEmpty(run.UpdatedFrom)) { Log.Line("update step: not again in this run (started by " + run.UpdatedFrom + ")"); return "current"; }
            if (run.DryRun || (run.PretendRunning?.Length ?? 0) > 0 || string.IsNullOrEmpty(exe)) return "current";
            var offer = Offered(manifest);
            if (offer == null || !Ver.IsNewer(offer.Version, Env.Version)) return "current";

            run.Step(string.Format("Updating Deepslate Works {0} {1} {2}", Env.Version, '→', offer.Version));
            var u = Apply(offer, exe);
            if (u.Status == "updated")
            {
                Log.Line(string.Format("OK {0} is in place; starting it", u.Version));
                try
                {
                    var psi = new ProcessStartInfo(exe, Home.QuoteArgs(RestartArgs(restartArgs, Process.GetCurrentProcess().Id)))
                    {
                        UseShellExecute = false,
                        WorkingDirectory = Path.GetDirectoryName(exe) ?? "",
                    };
                    psi.EnvironmentVariables["DEEPSLATE_UPDATED_FROM"] = Env.Version;
                    Native.GrantForeground();
                    Home.StartProcess(psi);
                    run.Reported = true;   // the report is the new copy's to send
                    return "updated";
                }
                catch (Exception e)
                {
                    // never a PC with a new exe nobody started and the old one gone: put the old one back
                    PutBack(exe);
                    u = new Outcome { Status = "failed", Version = offer.Version, Problem = "it could not be started: " + e.Message };
                }
            }
            run.UpdateProblem = u.Problem;
            Log.Line("UPDATE NOT APPLIED: " + u.Problem);
            run.Emit(J.O("t", "note", "text", string.Format("Deepslate Works could not update itself ({0}).", u.Problem)));
            return "failed";
        }

        /// <summary>3.5.2 (Alex, 2026-10-06): the server lets in only the newest app, so a run whose update failed stops
        /// here instead of carrying on with a version that could not join. Play tries the update again.</summary>
        public static string NotUpdatedText(string offered) => string.Format(
            "Deepslate Works {0} is needed to play, and this PC could not update to it, so nothing was started. Press Play to try again. If it keeps happening, download Deepslate Works again from the site.",
            offered);

        /// <summary>What the new exe is started with: what this one passes on, then -WaitFor this process and -From update
        /// (a -From or -WaitFor this one was started with is not passed twice).</summary>
        public static string[] RestartArgs(string[] restartArgs, int pid)
        {
            var a = new List<string>();
            var given = restartArgs ?? new string[0];
            for (int i = 0; i < given.Length; i++)
            {
                if (string.Equals(given[i], "-From", StringComparison.OrdinalIgnoreCase) || string.Equals(given[i], "-WaitFor", StringComparison.OrdinalIgnoreCase)) { i++; continue; }
                a.Add(given[i]);
            }
            a.Add("-WaitFor"); a.Add(pid.ToString());
            a.Add("-From"); a.Add("update");
            return a.ToArray();
        }

        /// <summary>Fetches, checks and puts the offered exe in place of exe (Update-Script). Starts nothing.</summary>
        public static Outcome Apply(Offer offer, string exe)
        {
            if (offer == null || !Ver.IsNewer(offer.Version, Env.Version)) return new Outcome { Status = "current", Version = Env.Version };
            var nv = offer.Version;
            Outcome Fail(string why) => new Outcome { Status = "failed", Version = nv, Problem = why };
            if (!Regex.IsMatch(offer.Sha256 ?? "", "^[0-9a-fA-F]{64}$")) return Fail("the site gave no checksum for it");
            var tmp = exe + ".new";
            var old = exe + ".old";
            Log.RemoveTemp(tmp);
            try { Http.Download(Env.ExeDownloadUrl, tmp, 300); }
            catch (Exception e) { Log.RemoveTemp(tmp); return Fail("it could not be downloaded: " + e.Message); }
            try
            {
                if (!File.Exists(tmp)) return Fail("the download is empty");
                long len = new FileInfo(tmp).Length;
                if (offer.Size > 0 && len != offer.Size) { Log.RemoveTemp(tmp); return Fail(string.Format("the download is {0} bytes, the site said {1}", len, offer.Size)); }
                var got = Home.Sha256(tmp);
                var want = offer.Sha256.ToLowerInvariant();
                if (got != want) { Log.RemoveTemp(tmp); return Fail(string.Format("the checksum of the download ({0}...) is not the one the site gave ({1}...)", got.Substring(0, 12), want.Substring(0, 12))); }
                if (!IsWindowsProgram(tmp)) { Log.RemoveTemp(tmp); return Fail("the download is not a Windows program"); }
                var pv = Home.ProductVersionOf(tmp) ?? "";
                if (!VersionMatches(pv, nv)) { Log.RemoveTemp(tmp); return Fail(string.Format("the program in the download is not version {0}", nv)); }
                if (File.Exists(old)) { File.SetAttributes(old, FileAttributes.Normal); File.Delete(old); }
                File.Move(exe, old);
                try { File.Move(tmp, exe); }
                catch { File.Move(old, exe); throw; }
            }
            catch (Exception e) { Log.RemoveTemp(tmp); return Fail("it could not be written: " + e.Message); }
            return new Outcome { Status = "updated", Version = nv };
        }

        /// <summary>The new exe could not be started: it goes, and the one that ran is back where it was.</summary>
        static void PutBack(string exe)
        {
            var old = exe + ".old";
            try
            {
                if (!File.Exists(old)) return;
                if (File.Exists(exe)) File.Delete(exe);
                File.Move(old, exe);
                Log.Line("the new version was taken out again; " + Path.GetFileName(exe) + " is the one that ran");
            }
            catch (Exception e) { Log.Line("could not put " + exe + " back: " + e.Message); }
        }

        /// <summary>"MZ": the start of every Windows program.</summary>
        public static bool IsWindowsProgram(string file)
        {
            try
            {
                using (var s = File.OpenRead(file))
                    return s.ReadByte() == 0x4D && s.ReadByte() == 0x5A;
            }
            catch { return false; }
        }

        /// <summary>The ProductVersion inside is the offered version ("3.0.1", "3.0.1-beta", "3.0.1.0"), never "3.0.10"
        /// for "3.0.1".</summary>
        public static bool VersionMatches(string productVersion, string offered)
        {
            if (string.IsNullOrEmpty(productVersion) || string.IsNullOrEmpty(offered)) return false;
            return productVersion == offered || productVersion.StartsWith(offered + "-", StringComparison.Ordinal)
                || productVersion.StartsWith(offered + "+", StringComparison.Ordinal) || productVersion.StartsWith(offered + ".", StringComparison.Ordinal);
        }
    }
}

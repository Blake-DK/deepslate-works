using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>
    /// handover.json in %LOCALAPPDATA%\DeepslateWorks (3.1.0, planner 2026-10-02): the move from the old launcher (2.x,
    /// DeepslateWorks.ps1) to this app. The old launcher 2.2.0 writes it when the app is downloaded and checked
    /// (state "downloaded"); the guided setup moves it on ("moving", "moved") and ends it ("done"). Until it says done,
    /// the next Play from either launcher carries on with the move (2.2.0's Get-PendingHandOver reads the same file).
    /// </summary>
    public sealed class HandOverState
    {
        public const string FileName = "handover.json";
        public const string Downloaded = "downloaded", Moving = "moving", Moved = "moved", Done = "done";

        public string From = "", App = "", Sha256 = "", State = Downloaded, At = "";

        public static string PathIn(string dir) => Path.Combine(dir, FileName);

        public static HandOverState Read(string dir)
        {
            var j = Json.ReadFile(PathIn(dir));
            if (!(j is JObj)) return null;
            return new HandOverState
            {
                From = J.Str(j, "from") ?? "", App = J.Str(j, "app") ?? "", Sha256 = J.Str(j, "sha256") ?? "",
                State = J.Str(j, "state") ?? Downloaded, At = J.Str(j, "at") ?? "",
            };
        }

        public void Save(string dir)
        {
            At = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
            Json.WriteFile(PathIn(dir), J.O("version", 1, "from", From, "app", App, "sha256", Sha256, "state", State, "at", At));
        }

        /// <summary>A move that has not finished: the guided setup opens (again) on the next start.</summary>
        public static bool Pending(string dir)
        {
            var s = Read(dir);
            return s != null && s.State != Done;
        }

        /// <summary>The step the guided setup starts at: 1 (Welcome) until the move is done, 3 (Permissions) after it.</summary>
        public int FirstStep => State == Moved ? 3 : 1;
    }

    /// <summary>One line of the guided setup's "Move over" step: what it is, and how it went.</summary>
    public sealed class MoveItem
    {
        public string Id, Label;
        public string Status = "waiting";   // waiting | doing | ok | skipped | failed
        public string Detail = "";
        public bool Ok => Status == "ok" || Status == "skipped";
    }

    /// <summary>
    /// Step 2 of the guided setup, "Move over": the app takes over from the old launcher, one thing at a time, each with its
    /// own line: its own folder, the website's Play button, the shortcuts, the Settings -> Apps entry, what is carried
    /// over (the same files the old launcher used: permissions, extras, sign-in, the installed pack), a check of all of
    /// that, and only then the old launcher's files removed. A line that fails says why; Retry runs the ones not done.
    /// </summary>
    public static class HandOver
    {
        public sealed class Context
        {
            public string Me, Dir;
            public IHomeIo Io;
            public bool Links;          // "Shortcuts and Play button" allowed (an answer the old launcher saved)
            public string Exe;          // the installed copy, once "copy" is done
            public Dictionary<string, ConsentAnswer> Consent;
        }

        public static List<MoveItem> NewItems() => new List<MoveItem>
        {
            new MoveItem { Id = "copy", Label = UiText.MoveCopy },
            new MoveItem { Id = "link", Label = UiText.MoveLink },
            new MoveItem { Id = "shortcuts", Label = UiText.MoveShortcuts },
            new MoveItem { Id = "apps", Label = UiText.MoveApps },
            new MoveItem { Id = "carry", Label = UiText.MoveCarry },
            new MoveItem { Id = "verify", Label = UiText.MoveVerify },
            new MoveItem { Id = "cleanup", Label = UiText.MoveCleanup },
        };

        /// <summary>Runs every line that is not done yet, in order, telling `changed` as each one starts and ends. True
        /// when all of them are done (ok or skipped). handover.json goes to "moving", and to "moved" when all are done.</summary>
        public static bool MoveOver(List<MoveItem> items, Context c, Action<MoveItem> changed = null)
        {
            var st = HandOverState.Read(c.Dir) ?? new HandOverState();
            if (st.State != HandOverState.Moved) { st.State = HandOverState.Moving; TrySave(st, c.Dir); }
            foreach (var it in items)
            {
                if (it.Ok) continue;
                it.Status = "doing"; it.Detail = ""; changed?.Invoke(it);
                try { Do(it, items, c); }
                catch (Exception e) { it.Status = "failed"; it.Detail = e.Message; }
                Log.Line(string.Format("move over: {0}: {1}{2}", it.Id, it.Status, it.Detail != "" ? " (" + it.Detail + ")" : ""));
                changed?.Invoke(it);
            }
            var all = items.All(i => i.Ok);
            if (all) { st.State = HandOverState.Moved; TrySave(st, c.Dir); }
            return all;
        }

        static void TrySave(HandOverState st, string dir)
        {
            try { st.Save(dir); } catch (Exception e) { Log.Line("could not write " + HandOverState.FileName + ": " + e.Message); }
        }

        static void Do(MoveItem it, List<MoveItem> items, Context c)
        {
            var exe = c.Exe ?? Path.Combine(c.Dir, Env.ExeName);
            switch (it.Id)
            {
                case "copy":
                {
                    var r = Home.CopyHome(c.Me, c.Dir, c.Io);
                    if (!r.Ok) { Fail(it, r.Message); return; }
                    c.Exe = r.Exe;
                    Done(it, c.Dir);
                    return;
                }
                case "link":
                {
                    var want = Home.HandlerCommand(exe);
                    if (!c.Links)
                    {
                        // Not now to the Play button, yet the old launcher had one: it is kept, pointing at this app, so it
                        // never names a file that the clean-up below removes
                        if (!PointsAtOldLauncher(c.Io.Handler(), c.Dir)) { Skip(it, UiText.MoveNoLinks); return; }
                        c.Io.SetHandler(exe);
                        if (string.Equals(c.Io.Handler(), want, StringComparison.OrdinalIgnoreCase)) Done(it, UiText.MoveKeptLink); else Fail(it, "Windows did not keep the setting for deepslate:// links");
                        return;
                    }
                    if (!string.Equals(c.Io.Handler(), want, StringComparison.OrdinalIgnoreCase)) c.Io.SetHandler(exe);
                    if (string.Equals(c.Io.Handler(), want, StringComparison.OrdinalIgnoreCase)) Done(it); else Fail(it, "Windows did not keep the setting for deepslate:// links");
                    return;
                }
                case "shortcuts":
                {
                    if (!c.Links) { Skip(it, UiText.MoveNoLinks); return; }
                    if (c.Io.ShortcutsThere(exe)) { Done(it); return; }
                    var made = c.Io.MakeShortcuts(exe);
                    if (made.Failed.Count == 0) { Done(it); return; }
                    if (made.Failed.All(f => f.Key == "desktop") && c.Io.ControlledFolderAccess()) { Skip(it, "Windows' ransomware protection blocked the desktop shortcut. The Start Menu entry and the Play button work."); return; }
                    Fail(it, made.Failed[0].Value);
                    return;
                }
                case "apps":
                {
                    if (!c.Io.Listed(exe)) c.Io.List(exe);
                    if (c.Io.Listed(exe)) Done(it); else Fail(it, "Windows did not keep the entry");
                    return;
                }
                case "carry":
                {
                    var found = CarriedOver(c.Consent);
                    if (found.Problem != null) { Fail(it, found.Problem); return; }
                    Done(it, found.Say);
                    return;
                }
                case "verify":
                {
                    var bad = Verify(c, exe);
                    if (bad.Count > 0) { Fail(it, string.Join("; ", bad)); return; }
                    Done(it, UiText.MoveVerified);
                    return;
                }
                case "cleanup":
                {
                    // never before this app's own install checked out (planner A4)
                    var verify = items.FirstOrDefault(i => i.Id == "verify");
                    if (verify == null || verify.Status != "ok") { Fail(it, "Waiting for the check above"); return; }
                    var removed = Home.RemoveOldLayout(c.Dir);
                    var left = OldLauncherFiles(c.Dir);
                    if (left.Count > 0) { Fail(it, string.Format("{0} could not be removed. Close any other Deepslate Works window, then Retry.", string.Join(", ", left))); return; }
                    Done(it, removed.Count > 0 ? string.Join(", ", removed) : UiText.MoveNothingOld);
                    return;
                }
            }
        }

        static void Done(MoveItem it, string detail = "") { it.Status = "ok"; it.Detail = detail ?? ""; }
        static void Skip(MoveItem it, string why) { it.Status = "skipped"; it.Detail = why; }
        static void Fail(MoveItem it, string why) { it.Status = "failed"; it.Detail = why ?? "it did not work"; }

        /// <summary>What the old launcher left that the app goes on using where it is: answered permissions, extras,
        /// the sign-in, the installed pack. Say: one line. Problem: a file that is there but cannot be read.</summary>
        public sealed class Carried { public string Say; public string Problem; public int Answers; public bool Extras, SignedIn; public string Pack; }

        public static Carried CarriedOver(Dictionary<string, ConsentAnswer> consent = null)
        {
            var r = new Carried();
            var bits = new List<string>();
            if (File.Exists(Env.ConsentPath) && !(Json.ReadFile(Env.ConsentPath) is JObj)) { r.Problem = Env.ConsentFileName + " is there but cannot be read"; return r; }
            r.Answers = (consent ?? Consents.Read(Env.ConsentPath)).Count;
            bits.Add(r.Answers == 1 ? "1 permission answer" : r.Answers + " permission answers");
            if (File.Exists(Env.ExtrasStatePath))
            {
                if (!(Json.ReadFile(Env.ExtrasStatePath) is JObj)) { r.Problem = Env.ExtrasStateName + " is there but cannot be read"; return r; }
                r.Extras = true; bits.Add("your extras");
            }
            if (File.Exists(Env.TokenFile))
            {
                var t = J.Str(Json.ReadFile(Env.TokenFile), "token");
                if (string.IsNullOrEmpty(t)) { r.Problem = "the sign-in file is there but has no sign-in in it"; return r; }
                r.SignedIn = true; bits.Add("your sign-in");
            }
            if (File.Exists(Env.InstalledFile))
            {
                r.Pack = J.Str(Json.ReadFile(Env.InstalledFile), "version");
                if (string.IsNullOrEmpty(r.Pack)) { r.Problem = "installed.json is there but says no pack"; return r; }
                bits.Add("pack " + r.Pack);
            }
            r.Say = "Kept: " + string.Join(", ", bits);
            return r;
        }

        /// <summary>This app's own install, read back: the copy where the Play button and the shortcuts point, those two,
        /// and the Settings -> Apps entry. What is wrong, in words; empty when everything checks out.</summary>
        public static List<string> Verify(Context c, string exe)
        {
            var bad = new List<string>();
            if (!File.Exists(exe)) { bad.Add("the app is not in " + c.Dir); return bad; }
            if (!Home.SamePath(c.Me, exe))
            {
                string a = null, b = null;
                try { a = Home.Sha256(c.Me); b = Home.Sha256(exe); } catch (Exception e) { bad.Add("the copy could not be read: " + e.Message); }
                if (a != null && b != null && a != b && !Ver.IsNewer(Home.ProductVersionOf(exe), Env.Version)) bad.Add("the copy in " + c.Dir + " is not this app");
            }
            if (PointsAtOldLauncher(c.Io.Handler(), c.Dir)) bad.Add("the website's Play button still starts the old launcher");
            if (c.Links)
            {
                if (!string.Equals(c.Io.Handler(), Home.HandlerCommand(exe), StringComparison.OrdinalIgnoreCase)) bad.Add("the website's Play button does not start it");
                if (!c.Io.ShortcutsThere(exe) && !c.Io.ControlledFolderAccess()) bad.Add("the shortcuts do not start it");
            }
            if (!c.Io.Listed(exe)) bad.Add("Settings -> Apps does not list it");
            return bad;
        }

        /// <summary>deepslate:// still runs the old launcher (its .vbs shim or .ps1, or 1.x's) from the home folder.</summary>
        public static bool PointsAtOldLauncher(string handler, string dir)
        {
            if (string.IsNullOrEmpty(handler)) return false;
            return new[] { "DeepslateWorks.vbs", "DeepslateWorks.ps1", "install.ps1", "play.ps1" }.Any(n => handler.IndexOf(Path.Combine(dir, n), StringComparison.OrdinalIgnoreCase) >= 0);
        }

        /// <summary>The old launcher's own files still in the home folder (DeepslateWorks.ps1, .bak, .vbs, .ico, 1.x's).</summary>
        public static List<string> OldLauncherFiles(string dir)
        {
            var names = new[] { "DeepslateWorks.ps1", "DeepslateWorks.ps1.bak", "DeepslateWorks.vbs", "DeepslateWorks.ico", "install.ps1", "Setup.bat", "play.ps1" };
            return names.Where(n => File.Exists(Path.Combine(dir, n))).ToList();
        }

        /// <summary>The end of the guided setup: handover.json says done, so neither launcher starts the move again.</summary>
        public static void Finish(string dir)
        {
            var st = HandOverState.Read(dir) ?? new HandOverState();
            st.State = HandOverState.Done;
            TrySave(st, dir);
            Log.Line("move over: done");
        }
    }
}

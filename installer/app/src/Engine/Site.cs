using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;

namespace DeepslateWorks
{
    /// <summary>
    /// The install steps' side of the site: the lock, the sign-in, the mod list, the wake on Play, and the messages for
    /// a site that said no.
    /// </summary>
    public static partial class Engine
    {
        // ---- seams the tests swap (the self test's $sleep and stand-ins) ----------------------------------------
        /// <summary>Waits this many seconds (Start-Sleep). Tests: counted, not waited.</summary>
        public static Action<int> Sleep = s => Thread.Sleep(TimeSpan.FromSeconds(s));
        /// <summary>Opens an address in the browser (Start-Process $url). Tests: noted, not opened.</summary>
        public static Action<string> OpenUrl = url => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });

        /// <summary>
        /// Something 2.0.x said only on the console (Write-Host): shown in the window as a note, and, as before, not a
        /// line of the log (the log stays line for line what 2.0.x wrote).
        /// </summary>
        static void Show(Run run, string text) => run.Emit(J.O("t", "note", "text", text));

        // ---- one copy at a time (docs/07 "The lock") -------------------------------------------------------------
        // 2026-09-29: m1owl pressed Play while Setup.bat was still downloading; both wrote the same file in mods/ and the
        // second run failed. A named mutex is held for the whole run; a second copy says so and leaves without touching
        // anything. A copy that was killed leaves the mutex "abandoned", which the next run simply takes over.
        // A mutex belongs to the thread that took it: Execute takes it and lets it go on the same thread.
        public static Mutex EnterLock(string name)
        {
            var m = new Mutex(false, name);
            bool got;
            try { got = m.WaitOne(0); }
            catch (AbandonedMutexException) { got = true; Log.Line("the last run did not end properly; carrying on"); }
            if (!got) { m.Dispose(); return null; }
            return m;
        }
        public static void ExitLock(ref Mutex m)
        {
            if (m == null) return;
            try { m.ReleaseMutex(); } catch { }
            try { m.Dispose(); } catch { }
            m = null;
        }

        /// <summary>launcher.json's token (Read-Token); a dry run takes DEEPSLATE_LAUNCHER_TOKEN (tests).</summary>
        public static string ReadToken(Run run)
        {
            string t = null;
            if (File.Exists(Env.TokenFile)) { try { t = J.Str(Json.Parse(File.ReadAllText(Env.TokenFile)), "token"); } catch { } }
            var env = Environment.GetEnvironmentVariable("DEEPSLATE_LAUNCHER_TOKEN");
            if (run.DryRun && !string.IsNullOrEmpty(env)) t = env;
            return string.IsNullOrEmpty(t) ? null : t;
        }

        /// <summary>What kind of run this is, for the report: nothing installed yet, the pack changed, or everything was current.</summary>
        public static string GetRunMode(object prev, string packHash)
        {
            if (prev == null) return "first_install";
            if (!string.IsNullOrEmpty(packHash) && !string.Equals(J.Str(prev, "hash") ?? "", packHash, StringComparison.OrdinalIgnoreCase)) return "update";
            return "play";
        }

        // ---- the site said no ------------------------------------------------------------------------------------
        /// <summary>What the site answered when it said no: the response body, or the message itself when it is the JSON
        /// (the tests' stand-ins throw that) (Read-ErrorBody).</summary>
        public static string ReadErrorBody(Exception e)
        {
            string body = (e as HttpError)?.Body ?? "";
            if (body.Length == 0) { var m = e?.Message ?? ""; if (m.TrimStart().StartsWith("{")) body = m; }
            return body;
        }

        public static string GateMessage(Exception e, string wakeRefused)
        {
            var body = ReadErrorBody(e);
            if (Regex.IsMatch(body, "not_live", RegexOptions.IgnoreCase)) return "The server hasn't launched yet. Watch Discord for the date.";
            if (Regex.IsMatch(body, "server_offline", RegexOptions.IgnoreCase))
            {
                if (!string.IsNullOrEmpty(wakeRefused) && Wake.RefusedText.TryGetValue(wakeRefused, out var t)) return t;
                return "The server isn't up right now (it is starting, stopping or out of reach), so updates are paused. Try again in a minute.";
            }
            return "The site said no (" + body.Substring(0, Math.Min(120, body.Length)) + ")";
        }

        // ---- wake on Play (docs/13 §12 B) ---------------------------------------------------------------------------
        // Play on a sleeping server starts it through the site before the updates are fetched, so it boots while the game
        // loads. The site decides (only from Asleep, one start however often Play is pressed); nothing here can start a
        // server that is switched off or crashed. A wake that cannot be asked for is never a reason to stop.
        public sealed class Wake
        {
            public static readonly Dictionary<string, string> Text = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "waking", "Waking the server, ready in about 30 s" },
                { "ready", "Server ready" },
                { "failed", "The server didn't wake up. Try again in a minute or tell Alex" },
            };
            public static readonly Dictionary<string, string> RefusedText = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "off", "The server is switched off. Ask Alex in Discord." },
                { "crashed", "The server has crashed. Ask Alex in Discord." },
                { "unreachable", "The site can't reach the server right now. Try again in a minute." },
            };
            /// <summary>Why the site would not wake it (off, crashed, unreachable): what a later "server_offline" says.</summary>
            public string Refused;
            public bool Waking;

            /// <summary>The real call: (method) -> the site's answer. 3.2.0: said to come from the app, so the event log reads
            /// "&lt;name&gt; woke the server (app)" (planner 2026-10-02).</summary>
            public static object Call(string method) => method == "POST" ? Http.PostJson(Env.WakeUrl, J.O("via", "app"), 15) : Http.Call(method, Env.WakeUrl, 15);

            /// <summary>"waking", "no" (not asked or refused), or what the site said (Request-Wake).</summary>
            public string Request(Run run, Func<string, object> call)
            {
                object r;
                try { r = call("POST"); }
                catch (Exception e)
                {
                    var body = ReadErrorBody(e);
                    string code = "";
                    try { code = J.Str(Json.Parse(body), "error.code") ?? ""; } catch { }
                    if (code.Length > 0 && RefusedText.ContainsKey(code)) Refused = code;
                    Log.Line(string.Format("wake: not started ({0})", code.Length > 0 ? code : e.Message));
                    return "no";
                }
                var result = J.Str(r, "result") ?? "";
                if (Eq(result, "started") || Eq(result, "already") || Eq(J.Str(r, "wake.phase") ?? "", "waking"))
                {
                    Show(run, Text["waking"]);
                    Log.Line("wake: the server is waking");
                    return "waking";
                }
                Log.Line("wake: " + result);
                return result;
            }

            /// <summary>After the launcher opens: asks every 5 s until the server is up or the wake has failed, and says
            /// which (Watch-Wake).</summary>
            public string Watch(Run run, Func<string, object> call, Action<int> sleep, int limitSec = 200)
            {
                var t0 = DateTime.Now;
                while ((DateTime.Now - t0).TotalSeconds < limitSec)
                {
                    string phase = "";
                    try { phase = J.Str(call("GET"), "wake.phase") ?? ""; } catch { }
                    if (Eq(phase, "ready")) { Show(run, Text["ready"]); Log.Line("wake: server ready"); return "ready"; }
                    if (Eq(phase, "failed")) { Show(run, Text["failed"]); Log.Line("wake: failed"); return "failed"; }
                    if (Eq(phase, "idle")) return "idle";
                    sleep(5);
                }
                Log.Line("wake: stopped watching");
                return "gave up";
            }
        }

        static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);   // PowerShell's -eq

        // ---- the mod list ----------------------------------------------------------------------------------------
        /// <summary>The mod list; unauthorized = the sign-in expired (401). A 403 is the site's gate (Fail with its
        /// reason); anything else is "Couldn't reach" (Get-Manifest).</summary>
        public static object GetManifest(Run run, Wake wake, out bool unauthorized)
        {
            unauthorized = false;
            try { return Http.GetJson(Env.ManifestUrl, 60); }
            catch (Exception e)
            {
                int code = (e as HttpError)?.Status ?? 0;
                if (code == 401) { unauthorized = true; return null; }
                if (code == 403) throw run.Fail(GateMessage(e, wake?.Refused));
                throw run.Fail(string.Format("Couldn't reach {0}. Check your internet, or ask Alex if the site is down.", Env.PortalUrl));
            }
        }

        // ---- c. sign in ------------------------------------------------------------------------------------------
        /// <summary>
        /// The device sign-in: a code from the site, the browser opened on it, the site asked until the person said
        /// "Yes, that's me" there; the token saved in launcher.json {token, savedAt}. Returns the token; ticks
        /// "Signed in as ...". Every way it can end without a token is a Fail.
        /// </summary>
        public static string SignIn(Run run)
        {
            run.Step("Signing in");
            if (run.DryRun) { run.Note("(dry run) would open the browser to sign in"); throw run.Fail("(dry run) not signed in; the mod list needs a sign-in"); }
            object start;
            try { start = Http.PostJson(Env.PortalUrl + "/api/launcher/start", J.O("hostname", Environment.GetEnvironmentVariable("COMPUTERNAME")), 30); }
            catch { throw run.Fail(string.Format("Couldn't reach {0}. Check your internet, or ask Alex if the site is down.", Env.PortalUrl)); }
            var url = J.Str(start, "url");
            Show(run, string.Format("Your code is  {0}  - a browser window is opening. Sign in with Discord and press 'Yes, that's me'.", J.Str(start, "code")));
            Show(run, string.Format("If nothing opens, go to {0}", url));
            try { OpenUrl(url); } catch (Exception e) { Log.Line("could not open the browser: " + e.Message); }
            var deadline = DateTime.Now.AddSeconds(J.Int(start, "expiresInSec"));
            string token = null;
            object poll = null;
            while (DateTime.Now < deadline)
            {
                Sleep(J.Int(start, "pollEverySec"));
                try { poll = Http.GetJson(string.Format("{0}/api/launcher/poll?token={1}", Env.PortalUrl, J.Str(start, "pollToken")), 30); } catch { continue; }
                var status = J.Str(poll, "status") ?? "";
                var lt = J.Str(poll, "launcherToken");
                if (Eq(status, "approved") && !string.IsNullOrEmpty(lt)) { token = lt; break; }
                if (Eq(status, "denied")) throw run.Fail("Sign-in was denied in the browser.");
                if (Eq(status, "expired")) throw run.Fail("The sign-in code expired. Press Play again.");
            }
            if (token == null) throw run.Fail("Timed out waiting for the browser sign-in. Press Play again.");
            Json.WriteFile(Env.TokenFile, J.O("token", token, "savedAt", DateTime.Now.ToString("s")));
            run.Token = token;
            run.Tick(string.Format("Signed in as {0}", J.Str(poll, "displayName")));
            return token;
        }
    }
}

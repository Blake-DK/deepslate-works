using System;
using System.Collections.Generic;
using System.Linq;

namespace DeepslateWorks
{
    public class ConsentStep
    {
        public string Id, Title, Text, Bigger;
        public bool Required;
        public int Top = 1;
        public bool FirstRun = true;   // false: asked where it happens (the Extras tab), listed in Review permissions
    }

    public class ConsentAnswer
    {
        public string Answer;   // allow | decline
        public int Level = 1;   // what was allowed, or done
        public string At;
    }

    /// <summary>
    /// The permission per step (2.0.0, 2.0.1): consent.json in %LOCALAPPDATA%\DeepslateWorks, the same file and shape
    /// 2.0.x wrote ({version:1, steps:{id:{answer, level, at}}}), so answers carry over to 3.0.
    /// </summary>
    public static class Consents
    {
        public static List<ConsentStep> Steps()
        {
            var site = Env.SiteHost;
            return new List<ConsentStep>
            {
                new ConsentStep { Id = "signin", Title = "Sign in with Discord", Text = string.Format("Links this PC to your account on {0} so the server knows it's you.", site), Required = true },
                new ConsentStep { Id = "launcher", Title = "Check the Minecraft Launcher is closed", Text = "The launcher overwrites settings if it's open.", Required = true },
                new ConsentStep { Id = "java", Title = "Java 21", Text = "Minecraft 1.21 needs Java 21. Uses the launcher's own copy if you have it, otherwise downloads one into the Deepslate folder only.", Required = true, Top = 2,
                    Bigger = "This PC needs its own Java 21 now: about 45 MB, downloaded into the Deepslate folder only. Nothing else on the PC changes." },
                new ConsentStep { Id = "neoforge", Title = "NeoForge", Text = "The mod loader. Installed into its own profile; your normal Minecraft isn't touched.", Required = true },
                new ConsentStep { Id = "mods", Title = "Mods and settings", Text = "Downloads the mods the server uses, from Modrinth. Updates after this happen by themselves.", Required = true },
                new ConsentStep { Id = "profile", Title = "Launcher profile and server list", Text = "Adds a 'Deepslate Works' profile and the server address.", Required = true },
                new ConsentStep { Id = "shortcuts", Title = "Shortcuts and Play button", Text = "Adds a desktop icon and lets the website's Play button open this app.", Required = false },
                new ConsentStep { Id = "reports", Title = "Send install reports", Text = "Sends a log of what happened to the site so Alex can fix problems. Your username and file paths are removed. If you say Not now, only 'pressed Play' and the pack version are sent: the server needs that to let you in.", Required = false },
                new ConsentStep { Id = "extras", Title = "Optional visual extras", Text = "Download the optional visual extras? About {0} MB, nothing is switched on. You choose them in the Extras tab.", Required = false },
                new ConsentStep { Id = "restart", Title = "Restart the game to apply extras", Text = "When you press Apply while Minecraft is running: close it (like its own X button), install your extras and start it again, without asking first.", Required = false, FirstRun = false },
                new ConsentStep { Id = "launch", Title = "Start the game after Apply", Text = "When you press Apply with Minecraft closed: open the Minecraft Launcher on Deepslate Works afterwards, without asking first.", Required = false, FirstRun = false },
            };
        }
        public static ConsentStep Step(string id) => Steps().FirstOrDefault(s => s.Id == id);

        public static Dictionary<string, ConsentAnswer> Read(string path)
        {
            var c = new Dictionary<string, ConsentAnswer>();
            var j = Json.ReadFile(path);
            var steps = J.Obj(j, "steps");
            if (steps == null) return c;
            foreach (var k in steps.OrderedKeys)
            {
                var a = J.Str(steps[k], "answer");
                if (a != "allow" && a != "decline") continue;
                c[k] = new ConsentAnswer { Answer = a, Level = J.Int(steps[k], "level", 1), At = J.Str(steps[k], "at") ?? "" };
            }
            return c;
        }
        public static void Save(string path, Dictionary<string, ConsentAnswer> c)
        {
            var steps = new JObj();
            foreach (var k in c.Keys.OrderBy(x => x, StringComparer.Ordinal)) steps[k] = J.O("answer", c[k].Answer, "level", c[k].Level, "at", c[k].At);
            Json.WriteFile(path, J.O("version", 1, "steps", steps));
        }
        public static void SetAnswer(Dictionary<string, ConsentAnswer> c, string id, string answer, int level)
            => c[id] = new ConsentAnswer { Answer = answer, Level = level, At = DateTime.UtcNow.ToString("s") };
        /// <summary>"allow", "decline", or "ask": asked when the step is new, or about to do more than the answer covers.</summary>
        public static string Decision(Dictionary<string, ConsentAnswer> c, string id, int level = 1)
        {
            if (!c.TryGetValue(id, out var a)) return "ask";
            if (a.Answer == "decline") return "decline";
            if (a.Level < level) return "ask";
            return "allow";
        }
        /// <summary>The steps with no answer yet: all of them on the first run, a new step after an update.</summary>
        public static List<ConsentStep> Unanswered(Dictionary<string, ConsentAnswer> c) => Steps().Where(s => s.FirstRun && !c.ContainsKey(s.Id)).ToList();
        /// <summary>Allow all (2.0.1): every step shown in that question is answered Allow.</summary>
        public static void ApproveAll(Dictionary<string, string> answers, IEnumerable<ConsentStep> steps) { foreach (var s in steps) answers[s.Id] = "allow"; }
        /// <summary>Reset all (Review permissions): every answer forgotten, so everything is asked again.</summary>
        public static void ResetAll(string path) { if (System.IO.File.Exists(path)) System.IO.File.Delete(path); }
        /// <summary>After a run: what was really done becomes the level the answer covers.</summary>
        public static void SetUsed(Dictionary<string, ConsentAnswer> c, string id, int level) { if (c.TryGetValue(id, out var a) && a.Answer == "allow") a.Level = level; }
    }
}

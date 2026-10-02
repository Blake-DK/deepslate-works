using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace DeepslateWorks
{
    /// <summary>The server in the site's words (shared/server-state.ts on the site; the app never words it itself).</summary>
    public sealed class ServerInfo
    {
        public string State = "unreachable", Line = "Can't reach the server", Label = "", Tone = "bad", Hint = "";
        public string WakePhase = "idle", WakeLine;
        public int? WakeLeftS;
        /// <summary>Admins only: switched off or crashed, so a wake will not start it; Start does (the site's audited start).</summary>
        public bool CanStart;
        public bool Waking => WakePhase == "waking" || State == "waking";
        public bool Asleep => State == "asleep";
    }

    public sealed class PollOptionInfo { public string Id, Text, ImageUrl, Link, ModName, ModDescription, ModSlug; }
    public sealed class PollCount { public string Id, Text; public int Votes, Percent; }
    public sealed class PollInfo
    {
        public string Id, Question, Closes;
        public bool Multiple, MustVote, Open = true;
        public List<PollOptionInfo> Options = new List<PollOptionInfo>();
        public List<string> Mine;                       // null: not voted
        public List<PollCount> Counts = new List<PollCount>();   // after voting
        public int Voters;
    }
    public sealed class BallotInfo { public string Id, Title, Url; }
    public sealed class NewsInfo { public string Body, At, Author; }
    /// <summary>One thing to answer before Play, in the order the site gives (oldest first): a poll, or the mod ballot.</summary>
    public sealed class VoteItem { public PollInfo Poll; public BallotInfo Ballot; public string Id => Poll?.Id ?? Ballot?.Id; }

    /// <summary>What the Play tab shows (planner 2026-10-02): GET /api/app/home, every 10 s while the window is open.</summary>
    public sealed class HomeInfo
    {
        public bool SignedIn, Admin;
        public string Site, Name;
        public ServerInfo Server = new ServerInfo();
        public List<string> Online = new List<string>();
        public NewsInfo News;
        public List<VoteItem> Votes = new List<VoteItem>();
        public string VoteFirstButton = SiteHome.VoteFirstButton;
    }

    /// <summary>
    /// The app as the front door (planner 2026-10-02): the server's state, who's online and the pinned news item on the
    /// Play tab; the votes to answer before Play; an admin's Start; the wake. Every call goes to the site only, with this
    /// PC's sign-in. Parse and the decisions are pure, so they are tested without a window or a network.
    /// </summary>
    public static class SiteHome
    {
        public const string VoteFirstButton = "Vote first, it takes ten seconds";
        public const string HomePath = "/api/app/home", StartPath = "/api/app/start";
        public static string HomeUrl => Env.PortalUrl + HomePath;
        public static string VoteUrl(string pollId) => Env.PortalUrl + "/api/polls/" + Uri.EscapeDataString(pollId ?? "") + "/vote";

        public static HomeInfo Parse(object j)
        {
            var h = new HomeInfo
            {
                SignedIn = J.Bool(j, "signedIn"), Admin = J.Bool(j, "admin"), Site = J.Str(j, "site") ?? Env.PortalUrl, Name = J.Str(j, "name"),
                Server = ParseServer(J.Obj(j, "server")),
                Online = J.Strs(j, "online"),
            };
            var n = J.Obj(j, "news");
            if (n != null && !string.IsNullOrWhiteSpace(J.Str(n, "body"))) h.News = new NewsInfo { Body = J.Str(n, "body"), At = J.Str(n, "at"), Author = J.Str(n, "author") };
            var v = J.Obj(j, "votes");
            if (v != null)
            {
                h.VoteFirstButton = J.Str(v, "button") ?? VoteFirstButton;
                var polls = J.Arr(v, "polls").Select(ParsePoll).Where(p => p != null).ToDictionary(p => p.Id);
                var b = J.Obj(v, "ballot");
                var ballot = b == null ? null : new BallotInfo { Id = J.Str(b, "id"), Title = J.Str(b, "title"), Url = J.Str(b, "url") };
                foreach (var o in J.Arr(v, "order"))
                {
                    var id = J.Str(o, "id");
                    if (J.Str(o, "kind") == "ballot" && ballot != null && ballot.Id == id) h.Votes.Add(new VoteItem { Ballot = ballot });
                    else if (id != null && polls.TryGetValue(id, out var p)) h.Votes.Add(new VoteItem { Poll = p });
                }
            }
            return h;
        }

        public static ServerInfo ParseServer(object s)
        {
            if (s == null) return new ServerInfo();
            var w = J.Obj(s, "wake");
            var left = J.Long(w, "leftS");
            return new ServerInfo
            {
                State = J.Str(s, "state") ?? "unreachable", Line = J.Str(s, "line") ?? "", Label = J.Str(s, "label") ?? "", Tone = J.Str(s, "tone") ?? "neutral", Hint = J.Str(s, "hint") ?? "",
                WakePhase = J.Str(w, "phase") ?? "idle", WakeLine = J.Str(w, "line"), WakeLeftS = left.HasValue ? (int?)left.Value : null,
                CanStart = J.Bool(s, "canStart"),
            };
        }

        public static PollInfo ParsePoll(object p)
        {
            var id = J.Str(p, "id");
            if (string.IsNullOrEmpty(id)) return null;
            var r = new PollInfo
            {
                Id = id, Question = J.Str(p, "question") ?? "", Closes = J.Str(p, "closes"), Multiple = J.Bool(p, "multiple"), MustVote = J.Bool(p, "mustVote"), Open = J.Bool(p, "open", true),
                Mine = J.Get(p, "mine") is List<object> ? J.Strs(p, "mine") : null,
            };
            foreach (var o in J.Arr(p, "options"))
            {
                var m = J.Obj(o, "mod");
                r.Options.Add(new PollOptionInfo { Id = J.Str(o, "id"), Text = J.Str(o, "text") ?? J.Str(m, "name") ?? "", ImageUrl = J.Str(o, "imageUrl"), Link = J.Str(o, "link"), ModName = J.Str(m, "name"), ModDescription = J.Str(m, "description"), ModSlug = J.Str(m, "slug") });
            }
            var res = J.Obj(p, "results");
            if (res != null)
            {
                r.Voters = J.Int(res, "voters");
                foreach (var c in J.Arr(res, "counts")) r.Counts.Add(new PollCount { Id = J.Str(c, "id"), Text = J.Str(c, "text"), Votes = J.Int(c, "votes"), Percent = J.Int(c, "percent") });
            }
            return r;
        }

        // ---- the small decisions the window draws ----------------------------------------------------------------

        /// <summary>The line on the Play tab: the site's line, or while a wake runs, how long it is likely to take.</summary>
        public static string ServerLine(ServerInfo s)
        {
            if (s == null) return "";
            if (s.Waking) return s.WakeLeftS.HasValue && s.WakeLeftS.Value > 0 && s.WakeLeftS.Value < 30 ? string.Format("Waking the server, about {0} s", s.WakeLeftS.Value) : "Waking the server, about 30 s";
            return s.Line;
        }

        /// <summary>The colour of the dot: the site's tones (good, info, warn, neutral, bad).</summary>
        public static string ToneColour(string tone) => tone == "good" ? "#2E7D5B" : tone == "info" ? "#1A5FB4" : tone == "warn" ? "#C0661F" : tone == "bad" ? "#B3261E" : "#888888";

        public static string OnlineLine(HomeInfo h)
        {
            if (h == null || !h.SignedIn) return "";
            if (h.Online.Count == 0) return "Nobody online right now.";
            var names = h.Online.Take(8).ToList();
            return "Online now: " + string.Join(", ", names) + (h.Online.Count > names.Count ? string.Format(" and {0} more", h.Online.Count - names.Count) : "");
        }

        /// <summary>A must-vote poll left unanswered keeps Play shut (the door would hold them anyway); nothing else does.</summary>
        public static bool BlocksPlay(HomeInfo h) => h != null && h.SignedIn && h.Votes.Count > 0;

        /// <summary>Picking: one for single choice, several for multiple; "I don't mind" only on its own (shared/polls.ts).</summary>
        public const string DontMind = "dont-mind";
        public static List<string> Pick(List<string> picked, string id, bool multiple, bool on)
        {
            var p = new List<string>(picked ?? new List<string>());
            if (!multiple || id == DontMind) return on ? new List<string> { id } : p.Where(x => x != id).ToList();
            p.Remove(DontMind);
            if (on) { if (!p.Contains(id)) p.Add(id); } else p.Remove(id);
            return p;
        }

        public static string PickNote(PollInfo p) => (p.Multiple ? "Pick as many as you like." : "Pick one.") + (string.IsNullOrEmpty(p.Closes) ? "" : " Open until " + p.Closes + ".") + " You can change your vote on the site until it closes.";
        public static string StepLine(int index, int count) => count > 1 ? string.Format("Vote {0} of {1}", index + 1, count) : "Before you play";

        // ---- the calls ----------------------------------------------------------------------------------------------

        /// <summary>The sign-in this PC has (launcher.json): the run sets Http.Token; before the first run it is read here.</summary>
        static void EnsureToken()
        {
            if (!string.IsNullOrEmpty(Http.Token)) return;
            try { if (File.Exists(Env.TokenFile)) Http.Token = J.Str(Json.Parse(File.ReadAllText(Env.TokenFile)), "token"); } catch { }
        }

        public static HomeInfo Fetch()
        {
            EnsureToken();
            return Parse(Http.GetJson(HomeUrl, 8));
        }

        /// <summary>The vote; the poll comes back with the results. A refusal throws HttpError (its body says why).</summary>
        public static PollInfo Vote(string pollId, IEnumerable<string> choices)
        {
            EnsureToken();
            return ParsePoll(J.Obj(Http.PostJson(VoteUrl(pollId), J.O("choices", choices.Cast<object>().ToList()), 20), "poll"));
        }

        public static void Start()
        {
            EnsureToken();
            Http.PostJson(Env.PortalUrl + StartPath, J.O(), 30);
        }

        /// <summary>The site's "wake" for a sleeping server, said to come from the app ("&lt;name&gt; woke the server (app)").
        /// The site decides: only from Asleep, only for a member the door would let in, one start however often.</summary>
        public static void Wake()
        {
            EnsureToken();
            Http.PostJson(Env.WakeUrl, J.O("via", "app"), 15);
        }

        /// <summary>What a refusal said, for the screen: the site's message, or the error.</summary>
        public static string Why(Exception e)
        {
            var body = Engine.ReadErrorBody(e);
            try { var m = J.Str(Json.Parse(body), "error.message"); if (!string.IsNullOrEmpty(m)) return m; } catch { }
            return e is HttpError h && h.Status == 0 ? "Couldn't reach " + Env.SiteHost + "." : e.Message;
        }
    }
}

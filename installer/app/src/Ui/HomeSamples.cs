namespace DeepslateWorks
{
    /// <summary>What GET /api/app/home answers, for the screenshots and the tests (planner 2026-10-02).</summary>
    public static class HomeSamples
    {
        public const string Waking = @"{ ""signedIn"": true, ""site"": ""https://deepslate.dsw.test"", ""name"": ""KaneFinch"", ""admin"": false,
  ""server"": { ""state"": ""waking"", ""line"": ""Waking up… about 24 s"", ""label"": ""Waking up"", ""tone"": ""warn"", ""hint"": ""Somebody pressed Play; it is waking up."", ""wake"": { ""phase"": ""waking"", ""leftS"": 30, ""line"": ""Waking the server, ready in about 30 s"" }, ""canStart"": false },
  ""online"": [],
  ""news"": { ""body"": ""Season 1 starts Saturday at 19:00. The map is pre-generated out to 1,500 blocks, so the first hour should be smooth."", ""at"": ""2 Oct, 09:12"", ""author"": ""Bramble09"", ""image"": null },
  ""votes"": { ""polls"": [], ""ballot"": null, ""order"": [], ""button"": ""Vote first, it takes ten seconds"" } }";

        public const string OffAdmin = @"{ ""signedIn"": true, ""site"": ""https://deepslate.dsw.test"", ""name"": ""Bramble09"", ""admin"": true,
  ""server"": { ""state"": ""off"", ""line"": ""Switched off"", ""label"": ""Switched off"", ""tone"": ""neutral"", ""hint"": ""The server is switched off, so joining won't wake it. Start it here."", ""wake"": { ""phase"": ""idle"", ""leftS"": null, ""line"": null }, ""canStart"": true },
  ""online"": [], ""news"": null,
  ""votes"": { ""polls"": [], ""ballot"": null, ""order"": [], ""button"": ""Vote first, it takes ten seconds"" } }";

        // 3.4.0: the banner's pill and the Play tab with the server up and nobody waiting to vote; and asleep
        public const string Up = @"{ ""signedIn"": true, ""site"": ""https://deepslate.dsw.test"", ""name"": ""KaneFinch"", ""admin"": false,
  ""server"": { ""state"": ""online"", ""line"": ""Online, 2 playing"", ""label"": ""Online"", ""tone"": ""good"", ""hint"": ""The server is up."", ""wake"": { ""phase"": ""idle"", ""leftS"": null, ""line"": null }, ""canStart"": false },
  ""online"": [""Bramble09"", ""samoyedx""],
  ""players"": [ { ""name"": ""Bramble09"", ""uuid"": ""069a79f4-44e9-4726-a5be-fca90e38aaf5"" }, { ""name"": ""samoyedx"", ""uuid"": null } ],
  ""news"": { ""body"": ""Have your say: how seasons will work\n\nSeasons start soon: a ladder of bosses, a new trial every week, a zone to explore and one big fight at the end, everybody together.\n\nThree quick votes, in this channel and on the site under Votes:\n1. How long should a season be?\n2. When should the big fight be?\n3. Which boss goes first?"", ""at"": ""4 Oct, 17:35"", ""author"": ""m1_owl"", ""image"": null, ""url"": ""https://deepslate.dsw.test/votes"" },
  ""votes"": { ""polls"": [], ""ballot"": null, ""order"": [], ""button"": ""Vote first, it takes ten seconds"" } }";

        public const string Asleep = @"{ ""signedIn"": true, ""site"": ""https://deepslate.dsw.test"", ""name"": ""KaneFinch"", ""admin"": false,
  ""server"": { ""state"": ""asleep"", ""line"": ""Asleep, join to wake it"", ""label"": ""Asleep"", ""tone"": ""info"", ""hint"": ""Nobody is on, so it is asleep. Press Play or join and it wakes up in about 30 seconds."", ""wake"": { ""phase"": ""idle"", ""leftS"": null, ""line"": null }, ""canStart"": false },
  ""online"": [], ""news"": null,
  ""votes"": { ""polls"": [], ""ballot"": null, ""order"": [], ""button"": ""Vote first, it takes ten seconds"" } }";

        public const string Poll1 =@"{ ""id"": ""p1"", ""question"": ""What's the next boss?"", ""multiple"": false, ""mustVote"": true, ""open"": true, ""closes"": ""4 Oct, 19:00"", ""mine"": null, ""results"": null,
  ""options"": [
    { ""id"": ""o1"", ""text"": ""The Warden"", ""imageUrl"": null, ""link"": ""https://minecraft.wiki/w/Warden"", ""mod"": null },
    { ""id"": ""o2"", ""text"": ""A Lava Golem"", ""imageUrl"": null, ""link"": null, ""mod"": null },
    { ""id"": ""o3"", ""text"": ""Create: a contraption race"", ""imageUrl"": null, ""link"": null, ""mod"": { ""slug"": ""create"", ""name"": ""Create"", ""description"": ""Gears, belts and contraptions."", ""wiki"": ""https://create.fandom.com"" } },
    { ""id"": ""dont-mind"", ""text"": ""I don't mind"", ""imageUrl"": null, ""link"": null, ""mod"": null } ] }";

        public const string TwoVotes = @"{ ""signedIn"": true, ""site"": ""https://deepslate.dsw.test"", ""name"": ""KaneFinch"", ""admin"": false,
  ""server"": { ""state"": ""online"", ""line"": ""Online, 2 playing"", ""label"": ""Online"", ""tone"": ""good"", ""hint"": ""The server is up."", ""wake"": { ""phase"": ""idle"", ""leftS"": null, ""line"": null }, ""canStart"": false },
  ""online"": [""Bramble09"", ""m1_owl""], ""news"": null,
  ""votes"": { ""polls"": [ " + Poll1 + @",
      { ""id"": ""p2"", ""question"": ""Which mods should we add next?"", ""multiple"": true, ""mustVote"": true, ""open"": true, ""closes"": null, ""mine"": null, ""results"": null,
        ""options"": [ { ""id"": ""o1"", ""text"": ""Farmer's Delight"", ""mod"": null }, { ""id"": ""o2"", ""text"": ""Waystones"", ""mod"": null }, { ""id"": ""dont-mind"", ""text"": ""I don't mind"", ""mod"": null } ] } ],
    ""ballot"": null, ""order"": [ { ""kind"": ""poll"", ""id"": ""p1"" }, { ""kind"": ""poll"", ""id"": ""p2"" } ], ""button"": ""Vote first, it takes ten seconds"" } }";

        public const string Voted = @"{ ""id"": ""p1"", ""question"": ""What's the next boss?"", ""multiple"": false, ""mustVote"": true, ""open"": true, ""mine"": [""o2""],
  ""options"": [ { ""id"": ""o1"", ""text"": ""The Warden"" }, { ""id"": ""o2"", ""text"": ""A Lava Golem"" }, { ""id"": ""o3"", ""text"": ""Create: a contraption race"" }, { ""id"": ""dont-mind"", ""text"": ""I don't mind"" } ],
  ""results"": { ""voters"": 5, ""winners"": [""A Lava Golem""], ""counts"": [
    { ""id"": ""o1"", ""text"": ""The Warden"", ""votes"": 1, ""percent"": 20 }, { ""id"": ""o2"", ""text"": ""A Lava Golem"", ""votes"": 3, ""percent"": 60 },
    { ""id"": ""o3"", ""text"": ""Create: a contraption race"", ""votes"": 0, ""percent"": 0 }, { ""id"": ""dont-mind"", ""text"": ""I don't mind"", ""votes"": 1, ""percent"": 20 } ] } }";
    }
}

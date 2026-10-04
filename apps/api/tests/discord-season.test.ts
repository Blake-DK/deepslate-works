import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Announcer, type FeedState, type FeedStore, type PostRow } from "../src/discord/announcer.js";
import { seasonPost, seasonReply, type FeedEvent, type Switches } from "../src/discord/lines.js";
import { Webhook } from "../src/discord/webhook.js";
import { readSeasonFile } from "../src/seasons/files.js";
import { findByTitle } from "../src/shared/season.js";

// docs/21 §6, docs/22 §13 (W1.5): season moments in the forum season-updates. A boss, a trial and the season are one
// post each; what happens to them is a reply in that post. The season is the sample file as it is in the repo.

const DIR = fileURLToPath(new URL("../../../modpack/seasons", import.meta.url));
const FEED = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const UPDATES = "https://discord.com/api/webhooks/323456789012345678/ybcdefghijklmnopqrstuvwxyz0123456789ABCD";
const ANNA = "11111111-1111-4111-8111-111111111111";
const SW = { deaths: true, joins: true, challenges: true, advancements: true, votes: true, mentionUnvoted: true, season: true, news: true, live: true, serverUpDown: true, pack: true, problems: true, firstJoin: true, paused: false } as Switches;
const PORTAL = "https://deepslate.dsw.test";

type Call = { method: string; url: string; body: Record<string, unknown> };

async function setup(opts: { updates?: boolean; sw?: Partial<Switches>; answer?: (c: Call) => Response | null } = {}) {
  const file = await readSeasonFile(DIR, "sample");
  if (!file) throw new Error("sample.json does not read");
  const calls: Call[] = [];
  let ids = 1000;
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { method: init.method ?? "GET", url: String(url), body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {} };
    calls.push(c);
    const id = String(++ids);
    // a post started with thread_name answers with the new thread's id as channel_id; a reply with the thread it is in
    const thread = /thread_id=(\d+)/.exec(c.url)?.[1] ?? (c.body.thread_name ? `9${id}` : "42");
    return opts.answer?.(c) ?? new Response(JSON.stringify({ id, channel_id: thread }), { status: 200 });
  }) as typeof fetch;
  const clock = Date.parse("2026-11-24T20:00:00Z");
  const hook = (url: string) => new Webhook(url, { fetch: f, sleep: async () => {}, now: () => clock, minGapMs: 0 });
  const feed = hook(FEED);
  const updates = opts.updates === false ? null : hook(UPDATES);
  const events: FeedEvent[] = [];
  const posts = new Map<string, PostRow>();
  let state: FeedState | null = { cursor: "0", hash: `${feed.hash}:${updates ? `:${updates.hash}` : ""}`, refused: {}, log: [] };
  const store: FeedStore = {
    newestEventId: async () => events.reduce((m, e) => (e.id > m ? e.id : m), 0n),
    eventsAfter: async (id, limit) => events.filter((e) => e.id > id).slice(0, limit),
    loadState: async () => (state ? structuredClone(state) : null),
    saveState: async (s) => { state = structuredClone(s); },
    member: async () => ({ userId: "u-anna" }),
    online: async () => 1,
    vote: async () => null,
    remindable: async () => [],
    unvoted: async () => ({ discordIds: [], others: 0 }),
    news: async () => null,
    picture: async () => null,
    packChange: async () => null,
    post: async (key) => posts.get(key) ?? null,
    savePost: async (row) => { posts.set(row.key, row); },
    addError: async () => {},
    switches: async () => ({ ...SW, ...opts.sw }) as Switches,
    brand: async () => ({ name: "Deepslate Works", avatar: null }),
    season: async (id) => (id === file.id ? file : null),
    seasonTitle: async (title) => Boolean(findByTitle(file, title)),
  };
  const a = new Announcer({ store, feed, admin: null, updates, portal: PORTAL, log: () => {}, now: () => new Date(clock) });
  let next = 100n;
  const add = (kind: string, message: string, meta: Record<string, unknown>, actor: string | null = null) => void events.push({ id: ++next, at: new Date(clock), kind, actor, message, meta });
  const season = (message: string, meta: Record<string, unknown>) => add("SEASON", message, { season: "sample", ...meta });
  const sent = () => calls.filter((c) => c.method === "POST");
  return { a, file, posts, add, season, sent, calls };
}

describe("season moments in Discord (docs/21 §6, docs/22 §13)", () => {
  it("a boss woken and killed is one post with two replies", async () => {
    const t = await setup();
    t.season("The Rehearsal Golem has awoken", { what: "wake", id: "rehearsal_golem", title: "The Rehearsal Golem", by: "Anna" });
    t.season("The Rehearsal Golem has fallen for the first time, to Anna and Ben", { what: "boss", id: "rehearsal_golem", title: "The Rehearsal Golem", names: ["Anna", "Ben"], first: true });
    t.season("Cyra defeated The Rehearsal Golem", { what: "boss", id: "rehearsal_golem", title: "The Rehearsal Golem", names: ["Cyra"], first: false });
    await t.a.round();
    const s = t.sent();
    expect(s.map((c) => c.body.thread_name ?? null)).toEqual(["The Rehearsal Golem · Sample Season · Dress Rehearsal", null, null, null]);
    expect(s.every((c) => c.url.startsWith("https://discord.com/api/webhooks/323456789012345678/"))).toBe(true); // the forum, never #game-chat
    const thread = t.posts.get("boss:sample:rehearsal_golem")?.threadId;
    expect(thread).toBeTruthy();
    for (const c of s.slice(1)) expect(c.url).toContain(`thread_id=${thread}`);
    expect(s[0]!.body.content).toBe("**The Rehearsal Golem** · tier 2 · 15 points, twice for the first on the server\nAny village, or summoned. Hit it once to see the wake line, then finish it.");
    expect(s.slice(1).map((c) => c.body.content)).toEqual([
      "**The Rehearsal Golem has awoken.** Anna is in the fight.",
      "**The Rehearsal Golem has fallen**, first on the server, to Anna and Ben. 30 points each.",
      "Cyra beat The Rehearsal Golem.",
    ]);
    expect(s.every((c) => JSON.stringify(c.body.allowed_mentions) === JSON.stringify({ parse: [] }))).toBe(true);
  });

  it("a trial that opens is its post; who is first through is a reply in it", async () => {
    const t = await setup();
    t.season("A new trial is open: Rehearsal: The Bed. Sleep in a bed.", { what: "trial_open", id: "rehearsal_bed", title: "Rehearsal: The Bed" });
    await t.a.round();
    expect(t.sent().map((c) => [c.body.thread_name, c.body.content])).toEqual([["Trial: Rehearsal: The Bed · Sample Season · Dress Rehearsal", "**Trial: Rehearsal: The Bed** · 5 points\nSleep in a bed."]]);
    t.season("Anna is the first to finish the trial Rehearsal: The Bed", { what: "trial", id: "rehearsal_bed", title: "Rehearsal: The Bed", names: ["Anna"], first: true });
    await t.a.round();
    expect(t.sent()).toHaveLength(2);
    expect(t.sent()[1]!.body.content).toBe("**Anna** is first through **Rehearsal: The Bed**. 10 points.");
  });

  it("the season's own post holds the start, the goal, the leader, the reminders and the end", async () => {
    const t = await setup();
    t.season("Sample Season · Dress Rehearsal has begun", { what: "started" });
    t.season("The season's goal is at 50%", { what: "goal", percent: 50, count: 2, target: 3 });
    t.season("Anna leads the season with 20 points", { what: "leader", name: "Anna", points: 20 });
    t.season("A week to go in Sample Season · Dress Rehearsal", { what: "week_to_go" });
    t.season("Sample Season · Dress Rehearsal is over. Anna wins with 20 points.", { what: "ended", winners: ["Anna"], points: 20 });
    await t.a.round();
    const s = t.sent();
    expect(s.filter((c) => c.body.thread_name)).toHaveLength(1);
    expect(s[0]!.body.thread_name).toBe("Sample Season · Dress Rehearsal");
    expect(s.slice(1).map((c) => c.body.content)).toEqual([
      "**Sample Season · Dress Rehearsal has begun.** A trial every week: https://deepslate.dsw.test/season",
      "Server goal: 2 of 3 boss kills. Half way.",
      "**Anna** takes the lead with 20 points",
      "A week to go in Sample Season · Dress Rehearsal",
      "**Sample Season · Dress Rehearsal is over. Anna wins with 20 points.**\nThe result is kept in the hall of fame: https://deepslate.dsw.test/season?tab=hall",
    ]);
  });

  it("a season's titles are not also posted as plain advancements; other advancements still are", async () => {
    const t = await setup();
    t.add("ADVANCEMENT", "Anna has completed the challenge [The Rehearsal Golem]", { name: "Anna", how: "challenge", title: "The Rehearsal Golem" }, ANNA);
    t.add("ADVANCEMENT", "Anna has made the advancement [Woke The Rehearsal Golem]", { name: "Anna", how: "advancement", title: "Woke The Rehearsal Golem" }, ANNA);
    t.add("ADVANCEMENT", "Anna has made the advancement [Stone Age]", { name: "Anna", how: "advancement", title: "Stone Age" }, ANNA);
    await t.a.round();
    expect(t.sent().map((c) => c.body.content)).toEqual(["made the advancement **Stone Age**"]);
  });

  it("without the forum's webhook, or with the switch off, nothing is posted anywhere", async () => {
    for (const opts of [{ updates: false }, { sw: { season: false } }]) {
      const t = await setup(opts);
      t.season("The Rehearsal Golem has awoken", { what: "wake", id: "rehearsal_golem", title: "The Rehearsal Golem", by: "Anna" });
      await t.a.round();
      expect(t.sent()).toHaveLength(0);
    }
  });

  it("a post deleted by hand is made again once, and the reply goes into the new one", async () => {
    let gone = true;
    const t = await setup({
      answer: (c) => {
        if (gone && c.url.includes("thread_id=111")) {
          gone = false;
          return new Response(JSON.stringify({ code: 10003, message: "Unknown Channel" }), { status: 404 });
        }
        return null;
      },
    });
    t.posts.set("boss:sample:rehearsal_ravager", { key: "boss:sample:rehearsal_ravager", channel: "updates", messageId: "1", postedAt: new Date(), editedAt: null, via: "webhook", threadId: "111" });
    t.season("Anna defeated The Rehearsal Ravager", { what: "boss", id: "rehearsal_ravager", title: "The Rehearsal Ravager", names: ["Anna"], first: false });
    await t.a.round();
    const s = t.sent();
    expect(s).toHaveLength(3); // the reply that failed, the new post, the reply in it
    expect(s[1]!.body.thread_name).toBe("The Rehearsal Ravager · Sample Season · Dress Rehearsal");
    const thread = t.posts.get("boss:sample:rehearsal_ravager")?.threadId;
    expect(thread).not.toBe("111");
    expect(s[2]!.url).toContain(`thread_id=${thread}`);
    await t.a.round();
    expect(t.sent()).toHaveLength(3); // and not again
  });

  it("a moment about a boss the file no longer has is dropped, and names from the game cannot mention or format", async () => {
    const t = await setup();
    expect(seasonPost({ meta: { what: "boss", id: "gone" } }, t.file, PORTAL)).toBeNull();
    expect(seasonReply({ message: "x", meta: { what: "leader", name: "@everyone_", points: 5 } }, t.file, PORTAL)).not.toContain("**@everyone_**");
    t.season("x", { what: "boss", id: "gone", names: ["Anna"] });
    await t.a.round();
    expect(t.sent()).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { Announcer, type FeedState, type FeedStore, type PostRow } from "../src/discord/announcer.js";
import type { Switches } from "../src/discord/lines.js";
import { Webhook } from "../src/discord/webhook.js";
import { CHANGE_CUT, CHANGES, changeText, type Change } from "../src/changelog.js";

// The change log (Alex, 2026-10-04): one forum post "Change log" in season-updates; every deploy's entry is a reply in it.

const FEED = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const UPDATES = "https://discord.com/api/webhooks/323456789012345678/ybcdefghijklmnopqrstuvwxyz0123456789ABCD";
const SW = { deaths: true, joins: true, challenges: true, advancements: true, votes: true, mentionUnvoted: true, season: true, news: true, live: true, serverUpDown: true, pack: true, problems: true, firstJoin: true, paused: false } as Switches;

type Call = { method: string; url: string; body: Record<string, unknown> };
const ONE: Change = { id: "a", date: "2026-10-04", lines: ["First thing.", "Second thing."] };
const TWO: Change = { id: "b", date: "2026-11-01", lines: ["Later thing."] };

function setup(changes: Change[], opts: { updates?: boolean; answer?: (c: Call) => Response | null } = {}) {
  const calls: Call[] = [];
  let ids = 1000;
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { method: init.method ?? "GET", url: String(url), body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {} };
    calls.push(c);
    const id = String(++ids);
    const thread = /thread_id=(\d+)/.exec(c.url)?.[1] ?? (c.body.thread_name ? `9${id}` : "42");
    return opts.answer?.(c) ?? new Response(JSON.stringify({ id, channel_id: thread }), { status: 200 });
  }) as typeof fetch;
  let clock = Date.parse("2026-10-04T20:00:00Z");
  const hook = (url: string) => new Webhook(url, { fetch: f, sleep: async () => {}, now: () => clock, minGapMs: 0 });
  const feed = hook(FEED);
  const updates = opts.updates === false ? null : hook(UPDATES);
  const posts = new Map<string, PostRow>();
  let state: FeedState | null = null;
  const store: FeedStore = {
    newestEventId: async () => 0n,
    eventsAfter: async () => [],
    loadState: async () => (state ? structuredClone(state) : null),
    saveState: async (s) => { state = structuredClone(s); },
    member: async () => null,
    online: async () => 0,
    vote: async () => null,
    remindable: async () => [],
    unvoted: async () => ({ discordIds: [], others: 0 }),
    news: async () => null,
    picture: async () => null,
    packChange: async () => null,
    post: async (key) => posts.get(key) ?? null,
    savePost: async (row) => { posts.set(row.key, row); },
    addError: async () => {},
    switches: async () => SW,
    brand: async () => ({ name: "Deepslate Works", avatar: null }),
  };
  const logs: string[] = [];
  const make = (list: Change[]) => new Announcer({ store, feed, admin: null, updates, changes: list, portal: "https://deepslate.dsw.test", log: (_o, m) => void logs.push(m), now: () => new Date(clock) });
  const sent = () => calls.filter((c) => c.method === "POST");
  return { a: make(changes), make, posts, store, sent, logs, later: (ms: number) => void (clock += ms) };
}

describe("the change log in Discord", () => {
  it("makes one post called Change log and puts the entry in it as a reply", async () => {
    const t = setup([ONE]);
    await t.a.round();
    const s = t.sent();
    expect(s.map((c) => c.body.thread_name ?? null)).toEqual(["Change log", null]);
    expect(s.every((c) => c.url.includes("/323456789012345678/"))).toBe(true);
    const thread = t.posts.get("changelog")?.threadId;
    expect(thread).toBeTruthy();
    expect(s[1]!.url).toContain(`thread_id=${thread}`);
    expect(s[1]!.body.content).toBe("**4 October 2026**\n• First thing.\n• Second thing.");
    expect(t.posts.get("changelog:a")?.threadId).toBe(thread);
  });

  it("says nothing twice: not a minute later, and not after a restart", async () => {
    const t = setup([ONE]);
    await t.a.round();
    t.later(61_000);
    await t.a.round();
    await t.make([ONE]).round();
    expect(t.sent().length).toBe(2);
  });

  it("a later deploy's entry is a new reply in the same post", async () => {
    const t = setup([ONE]);
    await t.a.round();
    const thread = t.posts.get("changelog")?.threadId;
    await t.make([ONE, TWO]).round();
    const s = t.sent();
    expect(s.length).toBe(3);
    expect(s[2]!.body.thread_name).toBeUndefined();
    expect(s[2]!.url).toContain(`thread_id=${thread}`);
    expect(s[2]!.body.content).toBe("**1 November 2026**\n• Later thing.");
  });

  it("posts entries oldest first when several are waiting", async () => {
    const t = setup([ONE, TWO]);
    await t.a.round();
    expect(t.sent().slice(1).map((c) => String(c.body.content).split("\n")[0])).toEqual(["**4 October 2026**", "**1 November 2026**"]);
  });

  it("posts nothing without the forum's webhook, and nothing without entries", async () => {
    const none = setup([ONE], { updates: false });
    await none.a.round();
    expect(none.sent()).toEqual([]);
    const empty = setup([]);
    await empty.a.round();
    expect(empty.sent()).toEqual([]);
  });

  it("tries again a minute later when Discord did not take it", async () => {
    let down = true;
    const t = setup([ONE], { answer: () => (down ? new Response("{}", { status: 500 }) : null) });
    await t.a.round();
    expect(t.posts.size).toBe(0);
    down = false;
    await t.a.round(); // inside the minute: not looked at
    expect(t.posts.size).toBe(0);
    t.later(61_000);
    await t.a.round();
    expect([...t.posts.keys()].sort()).toEqual(["changelog", "changelog:a"]);
  });

  it("an entry Discord refuses for good is skipped, said once, and does not hold up the one after it", async () => {
    const t = setup([ONE, TWO], { answer: (c) => (String(c.body.content).includes("First thing.") ? new Response(JSON.stringify({ code: 50035, message: "Invalid Form Body" }), { status: 400 }) : null) });
    await t.a.round();
    expect(t.sent().map((c) => String(c.body.content).split("\n")[0])).toEqual(["What's new on the site and the server. Every update adds a reply here, newest at the bottom.", "**4 October 2026**", "**1 November 2026**"]);
    expect(t.posts.get("changelog:a")?.messageId).toBe("");
    expect(t.posts.get("changelog:b")?.messageId).toBeTruthy();
    expect(t.logs).toEqual(["discord change log: Discord refused this entry; it is skipped"]);
    t.later(61_000);
    await t.a.round();
    expect(t.sent()).toHaveLength(3); // not tried for ever
  });

  it("the database failing after Discord took a reply does not post it a second time", async () => {
    const t = setup([ONE]);
    const save = t.store.savePost;
    let down = true;
    t.store.savePost = async (row) => {
      if (down) throw new Error("database away");
      await save(row);
    };
    await t.a.round();
    expect(t.sent()).toHaveLength(2); // the post and the entry, though neither row could be written
    expect(t.posts.size).toBe(0);
    down = false;
    t.later(61_000);
    await t.a.round();
    expect(t.sent()).toHaveLength(2);
    expect([...t.posts.keys()].sort()).toEqual(["changelog", "changelog:a"]); // written once the database is back
    await t.make([ONE, TWO]).round(); // and after a restart only the new entry is posted
    expect(t.sent()).toHaveLength(3);
  });

  it("an entry too long for one Discord message is cut at a line break and says so", () => {
    const long: Change = { id: "long", date: "2026-10-05", lines: Array.from({ length: 40 }, (_, i) => `Line ${i + 1} ${"x".repeat(80)}`) };
    const text = changeText(long);
    expect(text.length).toBeLessThanOrEqual(2000);
    const lines = text.split("\n");
    expect(lines[0]).toBe("**5 October 2026**");
    expect(lines.at(-1)).toBe(CHANGE_CUT);
    expect(lines.slice(1, -1).every((l, i) => l === `• ${long.lines[i]}`)).toBe(true); // whole lines only
    expect(lines.length).toBeGreaterThan(10);
  });
});

describe("the entries in the repo", () => {
  it("have ids of their own, a real date, and fit a Discord message", () => {
    expect(new Set(CHANGES.map((c) => c.id)).size).toBe(CHANGES.length);
    for (const c of CHANGES) {
      expect(c.id).toMatch(/^[a-z0-9-]{3,60}$/);
      expect(c.date).toMatch(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
      expect(c.lines.length).toBeGreaterThan(0);
      // whole, in one message: Discord takes 2000 characters, and a longer entry would be posted cut short
      expect(changeText(c).length).toBeLessThanOrEqual(2000);
      expect(changeText(c)).not.toContain(CHANGE_CUT);
    }
  });
});

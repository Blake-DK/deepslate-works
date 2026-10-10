import { describe, expect, it } from "vitest";
import { Announcer, chatStaysInGame, type FeedState, type FeedStore, type PostRow } from "../src/discord/announcer.js";
import { Webhook } from "../src/discord/webhook.js";
import { escapeText, type FeedEvent, type PollView, type Switches } from "../src/discord/lines.js";
import { modsChanged } from "../src/players/pack.js";
import { REAL } from "./fixtures/discord-events.js";

const FEED = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const ADMIN = "https://discord.com/api/webhooks/223456789012345678/zbcdefghijklmnopqrstuvwxyz0123456789ABCD";
const LINKED = new Set([REAL.join.actor!, REAL.death.actor!]);
const SW: Switches = { deaths: true, joins: true, challenges: true, advancements: false, votes: true, mentionUnvoted: true, season: true, news: true, live: true, serverUpDown: true, pack: true, problems: true, firstJoin: true, paused: false };

type Call = { method: string; url: string; body: Record<string, unknown> };

/** A fake Discord: every request is recorded; `answer` decides the response (200 with a new message id by default). */
function discord(answer: (c: Call, n: number) => Response | null = () => null) {
  const calls: Call[] = [];
  let ids = 1000;
  const f = (async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : init.body instanceof FormData ? (JSON.parse(String(init.body.get("payload_json"))) as Record<string, unknown>) : {};
    const c = { method: init.method ?? "GET", url: String(url), body };
    calls.push(c);
    return answer(c, calls.length) ?? new Response(JSON.stringify({ id: String(++ids), name: "Deepslate Works", channel_id: "42" }), { status: 200 });
  }) as typeof fetch;
  return { calls, f };
}

type Account = { outsideAuth: boolean; discordId: string | null; guildMember: boolean };

function setup(opts: { events?: FeedEvent[]; feed?: string | null; admin?: string | null; answer?: Parameters<typeof discord>[0]; sw?: Partial<Switches>; state?: FeedState | null; now?: string; votes?: Record<string, PollView>; unvoted?: { discordIds: string[]; others: number }; chatRelay?: boolean; accounts?: Record<string, Account> } = {}) {
  const events: FeedEvent[] = [...(opts.events ?? [])];
  const posts = new Map<string, PostRow>();
  const errors: string[] = [];
  let state: FeedState | null = opts.state === undefined ? { cursor: "0", hash: "", refused: {}, log: [] } : opts.state;
  let clock = Date.parse(opts.now ?? "2026-10-01T18:00:00Z");
  let sw = { ...SW, ...opts.sw };
  const d = discord(opts.answer);
  const hook = (url: string | null | undefined) => (url ? new Webhook(url, { fetch: d.f, sleep: async () => {}, now: () => clock, minGapMs: 0 }) : null);
  const feedHook = hook(opts.feed === undefined ? FEED : opts.feed);
  const adminHook = hook(opts.admin === undefined ? null : opts.admin);
  // the stored hash must match, or the Announcer starts at the newest event (first run)
  if (state && state.hash === "") state.hash = `${feedHook?.hash ?? ""}:${adminHook?.hash ?? ""}`;
  const store: FeedStore = {
    newestEventId: async () => events.reduce((m, e) => (e.id > m ? e.id : m), 0n),
    eventsAfter: async (id, limit) => events.filter((e) => e.id > id).sort((a, b) => Number(a.id - b.id)).slice(0, limit),
    loadState: async () => (state ? structuredClone(state) : null),
    saveState: async (s) => { state = structuredClone(s); },
    // docs/50: with `accounts`, the members are those, and whose chat stays in the game is worked out as store.ts does
    member: async (uuid) => (opts.accounts ? (opts.accounts[uuid] ? { userId: `u-${uuid.slice(0, 4)}`, inGameOnly: chatStaysInGame(opts.accounts[uuid]!) } : null) : LINKED.has(uuid) ? { userId: `u-${uuid.slice(0, 4)}` } : null),
    online: async () => 3,
    vote: async (kind, id) => opts.votes?.[`${kind}:${id}`] ?? null,
    remindable: async () => Object.values(opts.votes ?? {}).filter((v) => v.status === "OPEN" && v.closesAt),
    unvoted: async () => opts.unvoted ?? { discordIds: [], others: 0 },
    news: async (id) => (id === "n1" ? { body: "Map cache cleared.", image: null } : null),
    picture: async () => null,
    packChange: async () => ({ version: "0.1.0+bbbb", previous: "0.1.0+aaaa", changed: 3, at: new Date(clock) }),
    post: async (key) => posts.get(key) ?? null,
    savePost: async (row) => { posts.set(row.key, row); },
    addError: async (message) => { errors.push(message); },
    switches: async () => sw,
    brand: async () => ({ name: "Deepslate Works", avatar: null }),
  };
  const a = new Announcer({ store, feed: feedHook, admin: adminHook, chatRelay: opts.chatRelay, portal: "https://deepslate.dsw.test", log: () => {}, now: () => new Date(clock) });
  let next = 10_000n;
  const add = (e: Partial<FeedEvent> & Pick<FeedEvent, "kind">, base: FeedEvent | null = null) => {
    const row: FeedEvent = { ...(base ?? { actor: null, message: "", meta: {} }), ...e, id: ++next, at: new Date(clock) } as FeedEvent;
    events.push(row);
    return row;
  };
  return {
    a, d, posts, errors, add,
    get state() { return state; },
    tick: (ms: number) => { clock += ms; },
    setSw: (s: Partial<Switches>) => { sw = { ...sw, ...s }; },
    sent: () => d.calls.filter((c) => c.method === "POST"),
    edits: () => d.calls.filter((c) => c.method === "PATCH"),
  };
}

describe("Discord feed (docs/21 §3, §11)", () => {
  it("with no webhook set nothing starts and health says off", () => {
    const t = setup({ feed: null });
    expect(t.a.configured).toBe(false);
    expect(t.a.feedState()).toBe("off");
  });

  it("first run starts at the newest event: switching the feed on never posts history", async () => {
    const t = setup({ state: null, events: [{ ...REAL.death, at: new Date("2026-10-01T17:59:00Z") }] });
    await t.a.round();
    expect(t.sent()).toHaveLength(0);
    expect(t.state?.cursor).toBe(REAL.death.id.toString());
  });

  it("a linked player's death is one line, as the player; an unlinked player in the entrance room is never named", async () => {
    const t = setup();
    t.add({ kind: "DEATH" }, REAL.death);
    t.add({ kind: "DEATH", actor: "00000000-0000-0000-0000-000000000000", message: "Stranger fell from a high place", meta: { name: "Stranger" } });
    t.add({ kind: "JOIN", actor: "00000000-0000-0000-0000-000000000000", message: "Stranger joined", meta: { name: "Stranger" } });
    t.add({ kind: "LINK" }, REAL.held);
    await t.a.round();
    expect(t.sent().map((c) => [c.body.username, c.body.content])).toEqual([["KaneFinch", "was slain by Vindicator"]]);
    expect(t.sent()[0]!.url).toContain("?wait=true");
    expect(t.sent()[0]!.body.allowed_mentions).toEqual({ parse: [] });
  });

  it("five deaths of one player in two minutes are two lines and one edited line", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      t.add({ kind: "DEATH" }, REAL.death);
      t.tick(25_000);
    }
    await t.a.round();
    expect(t.sent()).toHaveLength(2);
    expect(t.edits()).toHaveLength(3);
    expect(t.edits().at(-1)!.body.content).toBe("was slain by Vindicator · and 3 more times since");
    expect(t.edits().at(-1)!.url).toMatch(/\/messages\/1002$/);
  });

  it("joins and leaves: a leave is posted after two minutes; back within two minutes posts neither", async () => {
    const t = setup();
    t.add({ kind: "JOIN" }, REAL.join);
    await t.a.round();
    expect(t.sent().map((c) => c.body.content)).toEqual(["joined · 3 online"]);
    t.tick(30 * 60_000);
    t.add({ kind: "LEAVE" }, REAL.leave);
    await t.a.round();
    expect(t.sent()).toHaveLength(1); // waiting to see whether they come back
    t.tick(60_000);
    t.add({ kind: "JOIN", meta: { name: "bramble09", rejoin: true } }, REAL.join);
    t.tick(2 * 60_000);
    await t.a.round();
    expect(t.sent()).toHaveLength(1);
    t.tick(30 * 60_000);
    t.add({ kind: "LEAVE" }, REAL.leave);
    await t.a.round();
    t.tick(2 * 60_000 + 1);
    await t.a.round();
    expect(t.sent().map((c) => c.body.content)).toEqual(["joined · 3 online", "left · 3 online"]);
  });

  it("a leave within two minutes of the join is not posted", async () => {
    const t = setup();
    t.add({ kind: "JOIN" }, REAL.join);
    t.tick(60_000);
    t.add({ kind: "LEAVE", meta: { name: "bramble09", minutes: 1 } }, REAL.leave);
    await t.a.round();
    t.tick(5 * 60_000);
    await t.a.round();
    expect(t.sent().map((c) => c.body.content)).toEqual(["joined · 3 online"]);
  });

  it("api away for 20 minutes: the deaths of that time are dropped, a poll opened in it is posted", async () => {
    const poll: PollView = { kind: "poll", id: "p1", title: "Next boss", options: ["A", "B"], closesAt: null, mustVote: false, voters: 0, members: 6, status: "OPEN" };
    const t = setup({ votes: { "poll:p1": poll } });
    t.add({ kind: "DEATH" }, REAL.death);
    t.add({ kind: "ADMIN_ACTION", meta: { action: "poll.open", params: { pollId: "p1", question: "Next boss" }, result: "OK" } });
    t.tick(20 * 60_000);
    await t.a.round();
    expect(t.sent()).toHaveLength(1);
    expect((t.sent()[0]!.body.embeds as Array<{ title: string }>)[0]!.title).toBe("Next boss");
    expect(t.posts.get("poll:p1")?.messageId).toBe("1001");
  });

  it("a poll: one message, votes change only its count (once a minute), closing makes it the result and posts the result line", async () => {
    const poll: PollView = { kind: "poll", id: "p1", title: "Next boss", options: ["The Harbinger", "Ignis"], closesAt: null, mustVote: false, voters: 0, members: 6, status: "OPEN" };
    const votes = { "poll:p1": poll };
    const t = setup({ votes });
    t.add({ kind: "ADMIN_ACTION", meta: { action: "poll.open", params: { pollId: "p1" }, result: "OK" } });
    await t.a.round();
    for (let i = 1; i <= 3; i++) {
      votes["poll:p1"] = { ...poll, voters: i };
      t.add({ kind: "PLAYER_ACTION", meta: { action: "poll.vote", params: { pollId: "p1", question: "Next boss", choices: ["Ignis"] }, result: "OK" } });
    }
    await t.a.round();
    expect(t.edits()).toHaveLength(0); // not within a minute of posting
    t.tick(61_000);
    await t.a.round();
    expect(t.edits()).toHaveLength(1);
    const counted = (t.edits()[0]!.body.embeds as Array<{ footer: { text: string }; description: string }>)[0]!;
    expect(counted.footer.text).toBe("3 of 6 have voted");
    expect(counted.description).not.toMatch(/Ignis · /);
    votes["poll:p1"] = { ...poll, voters: 3, status: "CLOSED", result: [{ text: "The Harbinger", votes: 1 }, { text: "Ignis", votes: 2 }, { text: "I don't mind", votes: 0 }], winners: ["Ignis"] };
    t.add({ kind: "ADMIN_ACTION", meta: { action: "poll.close", params: { pollId: "p1", question: "Next boss" }, result: "OK" } });
    await t.a.round();
    expect(t.edits()).toHaveLength(2);
    expect((t.edits()[1]!.body.embeds as Array<{ description: string }>)[0]!.description).toContain("**Ignis · 2**");
    expect(t.sent().at(-1)!.body.content).toBe("**The vote is closed: Next boss** · Ignis won with 2 of 3");
    expect(t.sent()).toHaveLength(2);
  });

  it("the reminder mentions exactly the members who have not voted, once", async () => {
    const poll: PollView = { kind: "poll", id: "p1", title: "Next boss", options: ["A", "B"], closesAt: new Date("2026-10-02T17:00:00Z"), mustVote: false, voters: 4, members: 6, status: "OPEN" };
    const t = setup({ votes: { "poll:p1": poll }, unvoted: { discordIds: ["111111111111111111"], others: 1 } });
    await t.a.round();
    t.tick(61_000);
    await t.a.round();
    expect(t.sent()).toHaveLength(1);
    expect(t.sent()[0]!.body.allowed_mentions).toEqual({ parse: [], users: ["111111111111111111"] });
    expect(t.sent()[0]!.body.content).toContain("<@111111111111111111> and 1 more");
  });

  it("Discord answers 429: the message arrives after the wait, once", async () => {
    let limited = false;
    const t = setup({ answer: (c) => (c.method === "POST" && !limited ? ((limited = true), new Response(JSON.stringify({ retry_after: 0.5 }), { status: 429 })) : null) });
    t.add({ kind: "DEATH" }, REAL.death);
    await t.a.round();
    expect(t.d.calls).toHaveLength(2);
    expect(t.state?.log.filter((l) => l.ok)).toHaveLength(1);
  });

  it("a network outage leaves the cursor where it is and tries again at the next round", async () => {
    let down = true;
    const t = setup({ answer: () => (down ? (() => { throw new TypeError("fetch failed"); })() : null) });
    const e = t.add({ kind: "DEATH" }, REAL.death);
    await t.a.round();
    expect(t.state?.cursor).toBe("0");
    down = false;
    await t.a.round();
    expect(t.sent().filter((c) => c.body.content === "was slain by Vindicator")).toHaveLength(4); // 3 failed tries, then the one taken
    expect(t.state?.cursor).toBe(e.id.toString());
  });

  it("a refused webhook switches the feed off: one ERROR event, health says refused", async () => {
    const t = setup({ answer: () => new Response("{\"message\": \"Unknown Webhook\"}", { status: 404 }) });
    t.add({ kind: "DEATH" }, REAL.death);
    t.add({ kind: "DEATH" }, REAL.death);
    t.add({ kind: "JOIN" }, REAL.join);
    await t.a.round();
    await t.a.round();
    expect(t.d.calls).toHaveLength(1);
    expect(t.errors).toEqual(["Discord feed: the webhook was refused"]);
    expect(t.a.feedState()).toBe("refused");
  });

  it("a crash: the admin channel is told, the feed hears that the server fell over", async () => {
    const t = setup({ admin: ADMIN });
    t.add({ kind: "CRASH" }, REAL.crash);
    await t.a.round();
    expect(t.sent().map((c) => [c.url.includes("223456789012345678") ? "admin" : "feed", c.body.content])).toEqual([
      ["admin", "The server crashed at 19:00. Open Admin → Server: https://deepslate.dsw.test/admin/server"],
      ["feed", "The server fell over. Alex has been told."],
    ]);
  });

  it("sign-in failing and working again: each told once in the admin channel, a second outage the same day too", async () => {
    const t = setup({ admin: ADMIN });
    const failing = "Health: Discord sign-in is failing: 3 failed in the last 30 minutes and none worked. The site's log has the reason under [auth][error]";
    const working = "Health, well again: Discord sign-in works again (3 failed while it was broken)";
    const meta = { health: "signin", method: "discord" };
    t.add({ kind: "ERROR", message: failing, meta });
    t.add({ kind: "WARN", message: working, meta });
    t.add({ kind: "WARN", message: "Clock drift noticed", meta: {} });
    await t.a.round();
    t.tick(60 * 60_000);
    t.add({ kind: "ERROR", message: failing, meta });
    await t.a.round();
    expect(t.sent().map((c) => [c.url.includes("223456789012345678") ? "admin" : "feed", c.body.content])).toEqual([
      ["admin", `Problem: ${escapeText(failing)}`],
      ["admin", escapeText(working)],
      ["admin", `Problem: ${escapeText(failing)}`],
    ]);
  });

  it("the dump, backup and pack checks' well again: each told once in the admin channel", async () => {
    const t = setup({ admin: ADMIN });
    const lines = {
      dump: "Health, well again: there is a fresh database dump",
      backup: "Health, well again: there is a fresh world backup",
      pack: "Health, well again: the site and the server are on the same pack",
    };
    for (const [health, message] of Object.entries(lines)) t.add({ kind: "WARN", message, meta: { health } });
    await t.a.round();
    await t.a.round();
    expect(t.sent().map((c) => [c.url.includes("223456789012345678") ? "admin" : "feed", c.body.content])).toEqual(
      Object.values(lines).map((m) => ["admin", escapeText(m)]),
    );
  });

  it("server up and down: a planned restart and the server back; sleeping and waking are not posted", async () => {
    const t = setup();
    t.add({ kind: "SERVER_STOP" }, REAL.asleep);
    t.add({ kind: "SERVER_START" }, REAL.start);
    await t.a.round();
    expect(t.sent()).toHaveLength(0);
    t.add({ kind: "ADMIN_ACTION" }, REAL.restart);
    t.tick(30_000);
    t.add({ kind: "SERVER_START" }, REAL.start);
    await t.a.round();
    expect(t.sent().map((c) => c.body.content)).toEqual(["The server is restarting. Back in about a minute.", "The server is back."]);
  });

  it("a sync that changed the pack: restarting for an update, and the count of mods", async () => {
    const t = setup();
    t.add({ kind: "SYNC" }, REAL.sync);
    await t.a.round();
    expect(t.sent().map((c) => c.body.content)).toEqual(["The server is restarting for an update. Back in about a minute.", "New pack: 3 mods changed. The app updates it when you press Play."]);
    expect(modsChanged({ a: "1", b: "1", c: "1" }, { a: "1", b: "2", d: "1" })).toBe(3);
  });

  it("first join ever, once per member; news; We're live only when it goes from off to on", async () => {
    const t = setup();
    t.add({ kind: "LINK" }, REAL.bind);
    t.add({ kind: "LINK" }, REAL.bind);
    t.add({ kind: "ADMIN_ACTION", meta: { action: "announcement.create", params: { announcementId: "n1" }, result: "OK" } });
    t.add({ kind: "ADMIN_ACTION" }, REAL.news); // an old row without the item's id: nothing
    t.add({ kind: "ADMIN_ACTION" }, REAL.siteSettings);
    t.add({ kind: "ADMIN_ACTION", meta: { action: "site.settings", params: { live: true, was: false }, result: "OK" } });
    t.add({ kind: "ADMIN_ACTION", meta: { action: "site.settings", params: { live: true, was: true }, result: "OK" } });
    await t.a.round();
    expect(t.sent().map((c) => c.body.content ?? (c.body.embeds as Array<{ description: string }>)[0]!.description)).toEqual([
      "**KaneFinch** is in. Welcome!",
      "Map cache cleared.",
      "**Deepslate Works is open.** Press Play at deepslate.dsw.test",
    ]);
  });

  it("every switch off means its line is not posted; Pause posts nothing and replays nothing", async () => {
    const t = setup({ sw: { deaths: false, joins: false } });
    t.add({ kind: "DEATH" }, REAL.death);
    t.add({ kind: "JOIN" }, REAL.join);
    await t.a.round();
    expect(t.sent()).toHaveLength(0);
    t.setSw({ deaths: true, joins: true, paused: true });
    t.add({ kind: "DEATH" }, REAL.death);
    await t.a.round();
    t.setSw({ paused: false });
    await t.a.round();
    expect(t.sent()).toHaveLength(0);
    t.tick(10 * 60_000); // past the run of deaths
    t.add({ kind: "DEATH" }, REAL.death);
    await t.a.round();
    expect(t.sent()).toHaveLength(1);
  });

  it("challenges are posted, other advancements only with All advancements", async () => {
    const t = setup();
    t.add({ kind: "ADVANCEMENT" }, REAL.advancement);
    t.add({ kind: "ADVANCEMENT", meta: { name: "KaneFinch", how: "challenge", title: "Monster Hunter" } }, REAL.advancement);
    await t.a.round();
    expect(t.sent().map((c) => c.body.content)).toEqual(["completed the challenge **Monster Hunter**"]);
  });

  it("a test message goes even while paused", async () => {
    const t = setup({ sw: { paused: true } });
    expect(await t.a.test("feed")).toEqual({ ok: true });
    expect(t.sent()[0]!.body.content).toBe("This is a test from Deepslate Works. If you can read it, the feed works.");
    expect((await t.a.test("admin")).ok).toBe(false);
  });

  it("an address that is not a Discord webhook is refused without asking anybody", async () => {
    const t = setup({ feed: "https://example.com/hook" });
    t.add({ kind: "DEATH" }, REAL.death);
    await t.a.round();
    expect(t.d.calls).toHaveLength(0);
    expect(t.a.feedState()).toBe("refused");
    expect(t.errors).toEqual(["Discord feed: the webhook was refused"]);
  });
});

describe("invited players' chat stays in the game (docs/50)", () => {
  const BRAMBLE = REAL.join.actor!; // an ordinary member
  const KANE = REAL.death.actor!; // invited, no Discord account on the portal
  const AWAY = "5b9e1c2a-3d4f-4a6b-8c7d-9e0f1a2b3c4d"; // invited, has a Discord account, not in the server
  const BACK = "7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f"; // invited, in the server now
  const accounts: Record<string, Account> = {
    [BRAMBLE]: { outsideAuth: false, discordId: "100000000000000001", guildMember: true },
    [KANE]: { outsideAuth: true, discordId: null, guildMember: true }, // guildMember defaults to true: discordId decides
    [AWAY]: { outsideAuth: true, discordId: "100000000000000003", guildMember: false },
    [BACK]: { outsideAuth: true, discordId: "100000000000000004", guildMember: true },
  };
  const NAMES: Record<string, string> = { [BRAMBLE]: "Bramble09", [KANE]: "KaneFinch", [AWAY]: "samoyedx", [BACK]: "m1_owl" };
  const relay = () => setup({ chatRelay: true, sw: { chatToDiscord: true, chatChannel: "700" }, accounts });
  const chat = (actor: string, text: string) => ({ kind: "CHAT" as const, actor, message: `<${NAMES[actor]}> ${text}`, meta: { name: NAMES[actor] } });
  const said = (t: ReturnType<typeof setup>) => t.sent().map((c) => [c.body.username, c.body.content]);

  it("1. an ordinary member's line is posted", async () => {
    const t = relay();
    t.add(chat(BRAMBLE, "anyone on?"));
    await t.a.round();
    expect(said(t)).toEqual([["Bramble09", "anyone on?"]]);
  });

  it("2. invited, no Discord account: not posted, the position moves on, never tried again", async () => {
    const t = relay();
    const e = t.add(chat(KANE, "hello"));
    await t.a.round();
    expect(t.d.calls).toHaveLength(0);
    expect(t.state?.cursor).toBe(e.id.toString());
    t.tick(5_000);
    await t.a.round();
    expect(t.d.calls).toHaveLength(0);
  });

  it("3. invited, a Discord account that is not in the server: not posted", async () => {
    const t = relay();
    const e = t.add(chat(AWAY, "hi all"));
    await t.a.round();
    expect(t.d.calls).toHaveLength(0);
    expect(t.state?.cursor).toBe(e.id.toString());
  });

  it("4. invited, in the server now: posted like everybody else, with no admin step", async () => {
    const t = relay();
    t.add(chat(BACK, "joined the Discord"));
    await t.a.round();
    expect(said(t)).toEqual([["m1_owl", "joined the Discord"]]);
  });

  it("5. a death of the invited player without Discord is still posted", async () => {
    const t = relay();
    t.add({ kind: "DEATH" }, REAL.death);
    await t.a.round();
    expect(said(t)).toEqual([["KaneFinch", "was slain by Vindicator"]]);
  });

  it("6. a burst from the invited player, then a line from Bramble09: only Bramble09's is posted", async () => {
    const t = relay();
    t.add(chat(KANE, "one"));
    t.add(chat(KANE, "two"));
    t.add(chat(KANE, "three"));
    t.tick(1_500);
    const last = t.add(chat(BRAMBLE, "evening"));
    await t.a.round();
    expect(said(t)).toEqual([["Bramble09", "evening"]]);
    expect(t.state?.cursor).toBe(last.id.toString());
  });

  it("the rule as docs/50 §1 writes it", () => {
    expect(Object.fromEntries(Object.entries(accounts).map(([u, a]) => [NAMES[u], chatStaysInGame(a)]))).toEqual({ Bramble09: false, KaneFinch: true, samoyedx: true, m1_owl: false });
    expect(chatStaysInGame({ outsideAuth: false, discordId: null, guildMember: true })).toBe(false); // not invited: unchanged
  });
});

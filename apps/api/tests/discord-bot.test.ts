import Fastify from "fastify";
import { viaDiscord, viaDiscordHook } from "../src/audit.js";
import { describe, expect, it } from "vitest";
import { actions } from "../src/actions/registry.js";
import { ChatLimit, discordChatName, discordChatText, fromPerson, gameText } from "../src/discord/chat.js";
import { Gateway, INTENTS } from "../src/discord/gateway.js";
import { runCommand, type CommandDeps, type Member } from "../src/discord/commands.js";
import { readPress, voteComponents, votedText } from "../src/discord/votes.js";
import { castVote, type VoteStore } from "../src/shared/polls.js";
import { Announcer, type FeedState, type FeedStore, type PostRow, type VotePoster } from "../src/discord/announcer.js";
import { Webhook } from "../src/discord/webhook.js";
import type { FeedEvent, PollView, Switches } from "../src/discord/lines.js";
import { REAL } from "./fixtures/discord-events.js";

const ctx = { limbo: { dimension: null, x: 0, y: 65, z: 0 }, spawn: null, portalUrl: "https://deepslate.dsw.test" } as never;

describe("chat from Discord into the game (docs/22 §5)", () => {
  const build = (text: string, name = "Pabulum") => {
    const input = actions["chat.fromDiscord"].input.safeParse({ name: discordChatName(name), text: discordChatText(text), member: null });
    expect(input.success).toBe(true);
    return actions["chat.fromDiscord"].build(ctx, input.data!);
  };

  it("the injection test: quotes, backslashes, \"}], and a line break with /op are one tellraw and nothing else", () => {
    const evil = 'he said "hi" \\ back\\slash "}],{"text":"x","clickEvent":{"action":"run_command","value":"/op Pabulum"}}\n/op Pabulum\r\n/stop';
    const lines = build(evil);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.startsWith("tellraw @a[tag=verified] ")).toBe(true);
    expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
    const json = JSON.parse(line.slice("tellraw @a[tag=verified] ".length)) as Array<string | Record<string, unknown>>;
    expect(json).toHaveLength(4);
    for (const part of json.slice(1)) expect(Object.keys(part as object).sort()).toEqual(["color", "text"]);
    expect((json[3] as { text: string }).text).toBe(`: ${discordChatText(evil)}`);
    expect((json[3] as { text: string }).text).toContain("/op Pabulum /stop"); // shown as text, never run
  });

  it("selectors, § colours, control characters and separators come through as plain text or not at all", () => {
    const [line] = build("@a[name=x] §4red\u0000‮\u2028next");
    const json = JSON.parse(line!.slice("tellraw @a[tag=verified] ".length)) as Array<{ text: string; selector?: string }>;
    expect(json[3]!.text).toBe(": @a[name=x] 4red next");
    expect(JSON.stringify(json)).not.toContain("selector");
    expect(line).not.toContain("§");
  });

  it("one line, at most 256 characters with …", () => {
    expect(discordChatText("a\nb\r\nc")).toBe("a b c");
    const long = discordChatText("x".repeat(400));
    expect(long).toHaveLength(257);
    expect(long.endsWith("…")).toBe(true);
    expect(actions["chat.fromDiscord"].input.safeParse({ name: "a", text: "line\nbreak", member: null }).success).toBe(false);
    expect(actions["chat.fromDiscord"].input.safeParse({ name: "a§b", text: "x", member: null }).success).toBe(false);
  });

  it("the event log keeps who and how long, never the text", () => {
    expect(actions["chat.fromDiscord"].audit!({ name: "Pabulum", text: "secret plans", member: "u1" })).toEqual({ name: "Pabulum", member: "u1", length: 12 });
  });

  it("mentions become names, emoji :name:, pictures and files words; bots and webhooks never come back", () => {
    const m = {
      id: "1", channel_id: "c", content: "hi <@111> and <@!222> in <#333> <:pog:444> <@&555>", author: { id: "9", username: "pab" },
      mentions: [{ id: "111", username: "rowan", member: { nick: "samoyedx" } }, { id: "222", username: "owly", global_name: "m1owl" }],
      attachments: [{ content_type: "image/png" }, { content_type: "application/zip" }],
    };
    expect(gameText(m, (id) => (id === "333" ? "general" : null))).toBe("hi @samoyedx and @m1owl in #general :pog: @role [picture] [file]");
    expect(fromPerson(m)).toBe(true);
    expect(fromPerson({ ...m, author: { id: "9", username: "b", bot: true } })).toBe(false);
    expect(fromPerson({ ...m, webhook_id: "77" })).toBe(false);
  });

  it("1 line a second per person, 5 a second in all", () => {
    let t = 0;
    const l = new ChatLimit(() => t);
    expect(l.take("a")).toBe(true);
    expect(l.take("a")).toBe(false);
    for (const p of ["b", "c", "d", "e"]) expect(l.take(p)).toBe(true);
    expect(l.take("f")).toBe(false); // sixth in the second
    t = 1000;
    expect(l.take("a")).toBe(true);
  });
});

// ---- the gateway against a stand-in Discord ---------------------------------------------------------------------------

function fakeDiscord() {
  const sockets: Array<{ url: string; sent: Array<{ op: number; d: unknown }>; closed: number | null; s: Record<string, unknown> }> = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const socket = (url: string) => {
    const rec = { url, sent: [] as Array<{ op: number; d: unknown }>, closed: null as number | null, s: {} as Record<string, unknown> };
    const s = {
      send: (data: string) => rec.sent.push(JSON.parse(data)),
      close: (code?: number) => { rec.closed = code ?? 1000; },
      onopen: null, onmessage: null as null | ((ev: { data: unknown }) => void), onclose: null as null | ((ev: { code: number }) => void), onerror: null,
    };
    rec.s = s as never;
    sockets.push(rec);
    return s;
  };
  const setTimer = (fn: () => void, ms: number) => {
    const t = { fn, ms, live: true };
    timers.push(t);
    return { cancel: () => { t.live = false; } };
  };
  const say = (i: number, p: unknown) => (sockets[i]!.s as { onmessage: (ev: { data: unknown }) => void }).onmessage({ data: JSON.stringify(p) });
  const close = (i: number, code: number) => (sockets[i]!.s as { onclose: (ev: { code: number }) => void }).onclose({ code });
  const runTimers = () => {
    const due = timers.filter((t) => t.live);
    for (const t of due) t.live = false;
    for (const t of due) t.fn();
  };
  return { sockets, timers, socket, setTimer, say, close, runTimers };
}

describe("the gateway (docs/22 §3, §11)", () => {
  const ready = { op: 0, s: 1, t: "READY", d: { session_id: "sess", resume_gateway_url: "wss://resume.example", user: { id: "42", username: "Deepslate Works", discriminator: "1234" }, application: { id: "99" } } };

  function start() {
    const f = fakeDiscord();
    const events: string[] = [];
    const g = new Gateway({ token: "tok", onDispatch: (t) => events.push(t), log: () => {}, socket: f.socket, setTimer: f.setTimer, random: () => 0 });
    g.start();
    f.say(0, { op: 10, d: { heartbeat_interval: 40_000 } });
    return { f, g, events };
  }

  it("identifies with the four intents, and is on after READY", () => {
    const { f, g } = start();
    const id = f.sockets[0]!.sent.find((p) => p.op === 2)!.d as { intents: number; token: string };
    expect(id.intents).toBe(INTENTS.GUILDS | INTENTS.GUILD_MEMBERS | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT);
    f.say(0, ready);
    expect(g.state).toBe("on");
    expect(g.user?.tag).toBe("Deepslate Works#1234");
  });

  it("Discord closing the connection: it resumes at the resume address with the last sequence, nothing replayed twice", () => {
    const { f, g, events } = start();
    f.say(0, ready);
    f.say(0, { op: 0, s: 2, t: "MESSAGE_CREATE", d: {} });
    f.close(0, 1006);
    expect(g.state).toBe("reconnecting");
    f.runTimers();
    expect(f.sockets[1]!.url).toBe("wss://resume.example/?v=10&encoding=json");
    f.say(1, { op: 10, d: { heartbeat_interval: 40_000 } });
    expect(f.sockets[1]!.sent.find((p) => p.op === 6)!.d).toEqual({ token: "tok", session_id: "sess", seq: 2 });
    f.say(1, { op: 0, s: 3, t: "RESUMED", d: {} });
    expect(g.state).toBe("on");
    expect(events.filter((e) => e === "MESSAGE_CREATE")).toHaveLength(1);
  });

  it("no answer to a heartbeat: the connection is dropped and resumed (an hour without network)", () => {
    const { f, g } = start();
    f.say(0, ready);
    f.runTimers(); // first beat sent
    expect(f.sockets[0]!.sent.some((p) => p.op === 1)).toBe(true);
    f.runTimers(); // no ack came: drop
    expect(f.sockets[0]!.closed).toBe(4000);
    expect(g.state).toBe("reconnecting");
    f.runTimers();
    expect(f.sockets).toHaveLength(2);
  });

  it("back-off grows while Discord is unreachable, up to a minute", () => {
    const { f } = start();
    f.say(0, ready);
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      f.close(f.sockets.length - 1, 1006);
      waits.push(f.timers.filter((t) => t.live).at(-1)!.ms);
      f.runTimers();
    }
    expect(waits[0]).toBe(0); // the first resume at once
    expect(Math.max(...waits)).toBe(60_000);
  });

  it("a bad token is refused and not retried; missing privileged intents run without them", () => {
    const a = start();
    a.f.close(0, 4004);
    expect(a.g.state).toBe("refused");
    expect(a.g.refusedReason).toBe("token");
    expect(a.f.timers.filter((t) => t.live && t.ms !== 40_000)).toHaveLength(0);
    const b = start();
    b.f.close(0, 4014);
    expect(b.g.missingIntents).toBe(true);
    b.f.runTimers();
    b.f.say(1, { op: 10, d: { heartbeat_interval: 40_000 } });
    const id = b.f.sockets[1]!.sent.find((p) => p.op === 2)!.d as { intents: number };
    expect(id.intents & INTENTS.MESSAGE_CONTENT).toBe(0);
    expect(id.intents & INTENTS.GUILD_MEMBERS).toBe(0);
  });

  it("the status line is sent after (re)connecting", () => {
    const { f, g } = start();
    g.setPresence({ text: "3 online", status: "online" });
    f.say(0, ready);
    const p = f.sockets[0]!.sent.filter((x) => x.op === 3).at(-1)!.d as { activities: Array<{ state: string }> };
    expect(p.activities[0]!.state).toBe("3 online");
  });
});

// ---- slash commands ------------------------------------------------------------------------------------------------

describe("slash commands (docs/22 §6)", () => {
  const members: Record<string, Member> = { "100": { id: "u-admin", role: "ADMIN", mcUsername: "Bramble09" }, "200": { id: "u-player", role: "PLAYER", mcUsername: "samoyedx" } };
  const calls: Array<{ m: Member; url: string; body: unknown }> = [];
  const d: CommandDeps = {
    host: "deepslate.dsw.test", portal: "https://deepslate.dsw.test",
    member: async (id) => members[id] ?? null,
    server: () => ({ state: "online", players: ["Bramble09", "samoyedx", "m1_owl"], tps: 19.96, sleepInMin: null }),
    pack: async () => "0.1.0+72931447",
    openVotes: async () => [{ title: "Next boss", link: "https://discord.com/channels/1/2", answered: false }],
    me: async () => ({ mcName: "samoyedx", lastPlayed: null, hoursThisMonth: 3.25, app: "3.3.0", currentApp: "3.3.1", pack: "0.1.0+72931447", currentPack: "0.1.0+72931447" }),
    route: async (m, _method, url, body) => { calls.push({ m, url, body }); return { status: url === "/server/wake" ? 202 : 200, body: { cancelled: true } }; },
    setPaused: async () => {},
  };

  it("/online and /status say what the site says, to the channel", async () => {
    expect(await runCommand(d, "online", undefined, "999")).toEqual({ content: "3 online: Bramble09, samoyedx, m1\\_owl", ephemeral: false });
    const s = await runCommand(d, "status", undefined, "999");
    expect(s.ephemeral).toBe(false);
    expect(s.content).toContain("**Online, 3 playing**");
    expect(s.content).toContain("TPS 20.0");
    expect(s.content).toContain("Pack 0.1.0+72931447");
  });

  it("/restart from a member who is not an admin on the portal is refused, whatever their Discord role", async () => {
    calls.length = 0;
    expect(await runCommand(d, "restart", [{ name: "minutes", type: 4, value: 5 }], "200")).toEqual({ content: "Only the portal's admins can do that.", ephemeral: true });
    expect(await runCommand(d, "restart", [{ name: "minutes", type: 4, value: 5 }], "555")).toEqual({ content: "Sign in at deepslate.dsw.test once, then try again.", ephemeral: true });
    expect(calls).toHaveLength(0);
  });

  it("/restart from an admin runs the site's own route as that admin", async () => {
    calls.length = 0;
    const r = await runCommand(d, "restart", [{ name: "minutes", type: 4, value: 5 }], "100");
    expect(r).toEqual({ content: "The server restarts in 5 minutes. Players see a countdown in the game.", ephemeral: false });
    expect(calls).toEqual([{ m: members["100"], url: "/server/restart-in", body: { minutes: 5 } }]);
  });

  it("/wake goes through the same wake as Play, marked discord; /me and /season", async () => {
    calls.length = 0;
    expect((await runCommand(d, "wake", undefined, "200")).content).toBe("Waking the server, about 30 s.");
    expect(calls[0]).toMatchObject({ url: "/server/wake", body: { via: "discord" } });
    expect((await runCommand(d, "me", undefined, "200")).content).toContain("App: 3.3.0 (current is 3.3.1)");
    expect((await runCommand(d, "season", undefined, "200")).content).toBe("No season is running yet.");
  });
});

// ---- votes ---------------------------------------------------------------------------------------------------------

describe("vote buttons (docs/22 §4)", () => {
  const options = [{ id: "o1", text: "The Harbinger" }, { id: "o2", text: "Ignis" }];

  it("single choice: a button each, I don't mind last and grey; multiple: one menu", () => {
    const rows = voteComponents({ id: "p1", options, multiple: false });
    const buttons = rows.flatMap((r) => (r as { components: Array<{ label: string; style: number; custom_id: string }> }).components);
    expect(buttons.map((b) => [b.label, b.style, b.custom_id])).toEqual([["The Harbinger", 1, "vote:p1:o1"], ["Ignis", 1, "vote:p1:o2"], ["I don't mind", 2, "vote:p1:dont-mind"]]);
    const menu = voteComponents({ id: "p1", options, multiple: true })[0] as { components: Array<{ type: number; custom_id: string; max_values: number }> };
    expect(menu.components[0]).toMatchObject({ type: 3, custom_id: "votes:p1", max_values: 3 });
    expect(voteComponents({ id: "p1", options, multiple: false }, true)).toEqual([]);
    expect(readPress("vote:p1:o2")).toEqual({ pollId: "p1", choices: ["o2"] });
    expect(readPress("votes:p1", ["o1", "o2"])).toEqual({ pollId: "p1", choices: ["o1", "o2"] });
    expect(readPress("vote:p1:o2:x")).toBeNull();
  });

  it("the one vote rule: stored, changed, refused when closed, two options from the menu in one go", async () => {
    const answers = new Map<string, string[]>();
    let status: "OPEN" | "CLOSED" = "OPEN";
    const logged: unknown[] = [];
    const store: VoteStore = {
      poll: { findUnique: async () => ({ id: "p1", question: "Next boss", options, multiple: true, mustVote: true, status, openedAt: new Date(), closesAt: null }) },
      pollAnswer: {
        findUnique: async ({ where }) => (answers.has(where.pollId_userId.userId) ? { choices: answers.get(where.pollId_userId.userId)! } : null),
        upsert: async ({ create }) => { answers.set(create.userId, create.choices); },
      },
    };
    const vote = (raw: unknown) => castVote(store, async (a) => { logged.push(a); }, "u1", "p1", raw, "discord");
    expect(await vote(["o1", "o2"])).toMatchObject({ ok: true, texts: ["The Harbinger", "Ignis"], changed: false });
    expect(await vote(["o2"])).toMatchObject({ ok: true, changed: true });
    expect(logged).toHaveLength(2);
    expect((logged[0] as { params: { via: string } }).params.via).toBe("discord");
    expect(await vote(["dont-mind", "o1"])).toMatchObject({ ok: false, code: "bad_choice" });
    status = "CLOSED";
    expect(await vote(["o1"])).toEqual({ ok: false, status: 409, code: "closed", message: "This vote has closed." });
  });

  it("the answer only to them: what they voted for and the results so far", () => {
    expect(votedText(["The Harbinger"], [{ text: "The Harbinger", votes: 2, percent: 67 }, { text: "Ignis", votes: 1, percent: 33 }], 3, false)).toBe("You voted for **The Harbinger**. You can change it until it closes.\n\nSo far, 3 votes:\nThe Harbinger · 2 (67%)\nIgnis · 1 (33%)");
  });
});

// ---- "via Discord" through the site's own routes ----------------------------------------------------------------------

describe("via Discord (docs/22 §6)", () => {
  it("a route called in-process from a command sees the Discord mark, through awaits; the same route from the site does not", async () => {
    const app = Fastify();
    app.addHook("onRequest", viaDiscordHook);
    app.post("/x", async () => {
      await new Promise((r) => setTimeout(r, 5));
      await Promise.resolve();
      return { via: viaDiscord.getStore() === true };
    });
    expect((await app.inject({ method: "POST", url: "/x", headers: { "x-via": "discord" }, payload: { a: 1 } })).json()).toEqual({ via: true });
    expect((await app.inject({ method: "POST", url: "/x", payload: { a: 1 } })).json()).toEqual({ via: false });
    expect(viaDiscord.getStore()).toBeUndefined();
  });
});

// ---- the two channels (docs/22 §13) ----------------------------------------------------------------------------------

const SW: Switches = { deaths: true, joins: true, challenges: true, advancements: false, votes: true, mentionUnvoted: true, season: true, news: true, live: true, serverUpDown: true, pack: true, problems: true, firstJoin: true, paused: false, chatChannel: "700", updatesForum: "800", voteButtons: true, chatToDiscord: true, chatToGame: false, commands: true };
const FEED = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const UPDATES = "https://discord.com/api/webhooks/323456789012345678/ubcdefghijklmnopqrstuvwxyz0123456789ABCD";

function routed(opts: { bot?: boolean; deleted?: boolean; chatRelay?: boolean } = {}) {
  const clock = Date.parse("2026-10-02T19:00:00Z");
  const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
  let ids = 5000;
  let deleted = opts.deleted ?? false;
  const f = (async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ method: init.method ?? "GET", url: String(url), body });
    if (deleted && init.method === "POST" && String(url).includes("thread_id=9001")) {
      deleted = false;
      return new Response(JSON.stringify({ message: "Unknown Channel", code: 10003 }), { status: 404 });
    }
    const id = String(++ids);
    const thread = String(url).match(/thread_id=(\d+)/)?.[1] ?? (body.thread_name ? (id === "5001" ? "9001" : `9${id}`) : "700");
    return new Response(JSON.stringify({ id, channel_id: thread }), { status: 200 });
  }) as typeof fetch;
  const hook = (u: string) => new Webhook(u, { fetch: f, sleep: async () => {}, now: () => clock, minGapMs: 0 });
  const posts = new Map<string, PostRow>();
  const events: FeedEvent[] = [];
  let state: FeedState | null = null;
  const poll: PollView = { kind: "poll", id: "p1", title: "Next boss", options: ["A", "B"], closesAt: null, mustVote: false, voters: 0, members: 6, status: "OPEN" };
  const votes: Record<string, PollView> = { "poll:p1": poll };
  const botCalls: Array<{ what: string; args: unknown[] }> = [];
  const bot: VotePoster = {
    inGuild: true,
    createPost: async (...args) => { botCalls.push({ what: "post", args }); return { ok: true, threadId: "8800", messageId: "8800" }; },
    edit: async (...args) => { botCalls.push({ what: "edit", args }); return { ok: true, retry: false }; },
    tagFor: (_f, name) => (name === "Vote" ? ["t-vote"] : []),
    components: (p, closed) => (closed ? [] : [{ type: 1, components: [{ type: 2, style: 1, label: "A", custom_id: `vote:${p.id}:o1` }] }]),
    pollShape: async (id) => ({ id, options: [{ id: "o1", text: "A" }], multiple: false }),
  };
  const store: FeedStore = {
    newestEventId: async () => 0n,
    eventsAfter: async (id) => events.filter((e) => e.id > id),
    loadState: async () => state,
    saveState: async (s) => { state = s; },
    member: async (uuid) => (uuid === REAL.death.actor || uuid === REAL.join.actor ? { userId: "u" } : null),
    online: async () => 2,
    vote: async (kind, id) => votes[`${kind}:${id}`] ?? null,
    remindable: async () => [],
    unvoted: async () => ({ discordIds: [], others: 0 }),
    news: async () => ({ body: "**Map cache cleared.**\nThe map shows the new world now.", image: null }),
    picture: async () => null,
    packChange: async () => null,
    post: async (k) => posts.get(k) ?? null,
    savePost: async (r) => { posts.set(r.key, r); },
    addError: async () => {},
    switches: async () => SW,
    brand: async () => ({ name: "Deepslate Works", accent: "#b8652c", avatar: null }),
  };
  const feedHook = hook(FEED);
  const updatesHook = hook(UPDATES);
  state = { cursor: "0", hash: `${feedHook.hash}::${updatesHook.hash}`, refused: {}, log: [] };
  const a = new Announcer({ store, feed: feedHook, admin: null, updates: updatesHook, bot: opts.bot ? bot : null, chatRelay: opts.chatRelay ?? true, portal: "https://deepslate.dsw.test", log: () => {}, now: () => new Date(clock) });
  let next = 100n;
  const add = (e: Partial<FeedEvent>, base?: FeedEvent) => events.push({ ...(base ?? { kind: "ADMIN_ACTION", actor: null, message: "", meta: {} }), ...e, id: ++next, at: new Date(clock) } as FeedEvent);
  const where = (c: { url: string }) => (c.url.includes("323456789012345678") ? "updates" : "feed");
  return { a, add, calls, posts, votes, poll, botCalls, where };
}

describe("where things go (docs/22 §13)", () => {
  it("without the bot: a vote is a forum post by the webhook (thread_name), its result a reply in the same post", async () => {
    const t = routed();
    t.add({ meta: { action: "poll.open", params: { pollId: "p1" }, result: "OK" } });
    await t.a.round();
    expect(t.calls).toHaveLength(1);
    expect(t.where(t.calls[0]!)).toBe("updates");
    expect(t.calls[0]!.body.thread_name).toBe("Next boss");
    expect(t.posts.get("poll:p1")).toMatchObject({ channel: "updates", via: "webhook", threadId: "9001", messageId: "5001" });
    t.votes["poll:p1"] = { ...t.poll, status: "CLOSED", voters: 2, result: [{ text: "A", votes: 2 }, { text: "B", votes: 0 }, { text: "I don't mind", votes: 0 }], winners: ["A"] };
    t.add({ meta: { action: "poll.close", params: { pollId: "p1" }, result: "OK" } });
    await t.a.round();
    expect(t.calls[1]).toMatchObject({ method: "PATCH" });
    expect(t.calls[1]!.url).toContain("/messages/5001?thread_id=9001");
    expect(t.calls[2]!.url).toContain("thread_id=9001");
    expect(t.calls[2]!.body.content).toBe("**The vote is closed: Next boss** · A won with 2 of 2");
  });

  it("with the bot: the bot posts it with buttons and the Vote tag; closing removes the buttons; the result line is a reply", async () => {
    const t = routed({ bot: true });
    t.add({ meta: { action: "poll.open", params: { pollId: "p1" }, result: "OK" } });
    await t.a.round();
    expect(t.botCalls[0]!.what).toBe("post");
    const [forum, title, message, tag] = t.botCalls[0]!.args as [string, string, { components: unknown[] }, string];
    expect([forum, title, tag]).toEqual(["800", "Next boss", "Vote"]);
    expect(message.components).toHaveLength(1);
    expect(t.posts.get("poll:p1")).toMatchObject({ via: "bot", threadId: "8800" });
    t.votes["poll:p1"] = { ...t.poll, status: "CLOSED", voters: 1, result: [{ text: "A", votes: 1 }, { text: "B", votes: 0 }, { text: "I don't mind", votes: 0 }], winners: ["A"] };
    t.add({ meta: { action: "poll.close", params: { pollId: "p1" }, result: "OK" } });
    await t.a.round();
    const edit = t.botCalls.find((c) => c.what === "edit")!;
    expect(edit.args[0]).toBe("8800");
    expect((edit.args[2] as { components: unknown[] }).components).toEqual([]);
    expect(t.calls.at(-1)!.url).toContain("thread_id=8800");
  });

  it("a post deleted by hand is made again once and the reply goes in the new one", async () => {
    const t = routed({ deleted: true });
    t.add({ meta: { action: "poll.open", params: { pollId: "p1" }, result: "OK" } });
    await t.a.round();
    t.votes["poll:p1"] = { ...t.poll, status: "CLOSED", voters: 0, result: [], winners: [] };
    t.add({ meta: { action: "poll.close", params: { pollId: "p1" }, result: "OK" } });
    await t.a.round();
    const replies = t.calls.filter((c) => c.method === "POST");
    // the post, the reply refused (unknown channel), the post made again, the reply in it
    expect(replies.map((c) => (c.body.thread_name ? "post" : (c.url.match(/thread_id=(\d+)/)?.[1] ?? "?")))).toEqual(["post", "9001", "post", t.posts.get("poll:p1")!.threadId]);
  });

  it("Test season-updates makes a post, replies in it and edits the reply: the three forum calls §13 builds on", async () => {
    const t = routed();
    expect(await t.a.test("updates")).toEqual({ ok: true });
    expect(t.calls.map((c) => [c.method, t.where(c), c.body.thread_name ?? null, c.url.match(/thread_id=(\d+)/)?.[1] ?? null])).toEqual([
      ["POST", "updates", "Test from Deepslate Works", null],
      ["POST", "updates", null, "9001"],
      ["PATCH", "updates", null, "9001"],
    ]);
    expect(t.calls[2]!.url).toContain("/messages/5002?");
  });

  it("news is a post titled by its first line; a death goes to #game-chat and not the forum", async () => {
    const t = routed();
    t.add({ meta: { action: "announcement.create", params: { announcementId: "n1" }, result: "OK" } });
    t.add({ kind: "DEATH" }, REAL.death);
    await t.a.round();
    expect(t.calls.map((c) => [t.where(c), c.body.thread_name ?? null])).toEqual([["updates", "Map cache cleared."], ["feed", null]]);
  });

  it("game chat: a linked player's lines inside a second are one message in #game-chat; nothing without the bot", async () => {
    const chat = (text: string) => ({ kind: "CHAT", actor: REAL.join.actor, message: `<bramble09> ${text}`, meta: { name: "bramble09" } });
    const t = routed();
    t.add(chat("anyone on?"));
    t.add(chat("@everyone come"));
    t.add({ kind: "CHAT", actor: "00000000-0000-0000-0000-000000000000", message: "<Stranger> hi", meta: { name: "Stranger" } });
    await t.a.round();
    expect(t.calls).toHaveLength(1);
    expect(t.where(t.calls[0]!)).toBe("feed");
    expect(t.calls[0]!.body).toMatchObject({ username: "bramble09", content: "anyone on?\n@​everyone come", allowed_mentions: { parse: [] } });
    const off = routed({ chatRelay: false });
    off.add(chat("hello"));
    await off.a.round();
    expect(off.calls).toHaveLength(0);
  });
});

describe("the bot joins the server (docs/22 §7)", () => {
  it("slash commands refused before the bot is in the server are registered when it joins", async () => {
    const { Bot } = await import("../src/discord/bot.js");
    const registered: string[] = [];
    let inServer = false;
    let dispatch: (t: string, d: unknown) => void = () => {};
    const rest = { registerCommands: async (app: string, guild: string) => { registered.push(`${app}/${guild}:${inServer ? "ok" : "403"}`); return inServer ? { ok: true, data: [] } : { ok: false, status: 403, code: 50001, error: "Missing Access" }; } };
    const gateway = (g: { onDispatch: (t: string, d: unknown) => void }) => { dispatch = g.onDispatch; return { state: "on", user: null, applicationId: "99", start() {}, stop() {}, setPresence() {} } as never; };
    const bot = new Bot({ token: "t", guild: "1", clientId: "99", rest: rest as never, log: () => {}, switches: async () => ({}) as never, commands: {} as never, vote: async () => ({ ok: true, text: "" }), toGame: async () => "nobody", memberName: async () => null, memberChanged: async () => {}, presence: () => "", gateway });
    dispatch("READY", {});
    await new Promise((r) => setTimeout(r, 0));
    inServer = true;
    dispatch("GUILD_CREATE", { id: "1", channels: [{ id: "700", name: "game-chat", type: 0 }, { id: "800", name: "season-updates", type: 15 }] });
    await new Promise((r) => setTimeout(r, 0));
    dispatch("GUILD_CREATE", { id: "1", channels: [] }); // a reconnect: not registered twice
    await new Promise((r) => setTimeout(r, 0));
    expect(registered).toEqual(["99/1:403", "99/1:ok"]);
    expect(bot.inGuild).toBe(true);
  });
});

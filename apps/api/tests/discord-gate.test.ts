import { describe, expect, it } from "vitest";
import { Announcer, type FeedState, type FeedStore, type PostRow } from "../src/discord/announcer.js";
import { discordOutlets, talksToDiscord } from "../src/discord/gate.js";
import type { FeedEvent, Switches } from "../src/discord/lines.js";
import { Webhook } from "../src/discord/webhook.js";
import { botConfig } from "../src/discord/wire.js";
import type { Env } from "../src/env.js";
import { EVENT_KINDS } from "../src/shared/events.js";

// docs/42a (2026-10-08): only the instance marked DISCORD_TALKS=1 talks to the players' Discord. The test server's api
// is not marked; on 2026-10-08 it was handed the live webhooks and its joins reached the players' feed.

const PLAYERS = {
  DISCORD_WEBHOOK_FEED: "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD",
  DISCORD_WEBHOOK_ADMIN: "https://discord.com/api/webhooks/223456789012345678/zbcdefghijklmnopqrstuvwxyz0123456789ABCD",
  DISCORD_WEBHOOK_UPDATES: "https://discord.com/api/webhooks/323456789012345678/ybcdefghijklmnopqrstuvwxyz0123456789ABCD",
  DISCORD_BOT_TOKEN: "bot-token-for-tests",
  DISCORD_GUILD_ID: "123456789012345678",
  DISCORD_CLIENT_ID: "223456789012345678",
};
const PRIVATE = "https://discord.com/api/webhooks/423456789012345678/xbcdefghijklmnopqrstuvwxyz0123456789ABCD";
const SW: Switches = { deaths: true, joins: true, challenges: true, advancements: true, votes: true, mentionUnvoted: true, season: true, news: true, live: true, serverUpDown: true, pack: true, problems: true, chat: true } as Switches;

/** A feed made the way server.ts makes it, from the env, with every request to Discord counted. */
function feedFor(env: Partial<Env>, events: FeedEvent[]) {
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? "GET"} ${String(url)}`);
    return new Response(JSON.stringify({ id: String(1000 + calls.length), name: "Deepslate Works", channel_id: "42" }), { status: 200 });
  }) as typeof fetch;
  const hook = (url: string | undefined) => (url ? new Webhook(url, { fetch: f, sleep: async () => {}, minGapMs: 0 }) : null);
  const o = discordOutlets(env as Env);
  const feed = hook(o.feed), admin = hook(o.admin), updates = hook(o.updates);
  // the stored hash must match the feed's, or the feed starts at the newest event (a first run never posts history)
  let state: FeedState | null = { cursor: "0", hash: `${feed?.hash ?? ""}:${admin?.hash ?? ""}${updates ? `:${updates.hash}` : ""}`, refused: {}, log: [] };
  const posts = new Map<string, PostRow>();
  const store: FeedStore = {
    newestEventId: async () => events.reduce((m, e) => (e.id > m ? e.id : m), 0n),
    eventsAfter: async (id, limit) => events.filter((e) => e.id > id).slice(0, limit),
    loadState: async () => (state ? structuredClone(state) : null),
    saveState: async (s) => { state = structuredClone(s); },
    member: async () => ({ userId: "u-1" }),
    online: async () => 1,
    vote: async () => null,
    remindable: async () => [],
    unvoted: async () => ({ discordIds: [], others: 0 }),
    news: async () => ({ body: "News.", image: null }),
    picture: async () => null,
    packChange: async () => ({ version: "0.1.0+bbbb", previous: "0.1.0+aaaa", changed: 3, at: new Date() }),
    post: async (key) => posts.get(key) ?? null,
    savePost: async (row) => { posts.set(row.key, row); },
    addError: async () => {},
    switches: async () => SW,
    brand: async () => ({ name: "Deepslate Works", avatar: null }),
  };
  const a = new Announcer({ store, feed, admin, updates, bot: null, portal: "https://deepslate.dsw.test", log: () => {} });
  return { a, calls, configured: a.configured };
}

/** One event of every kind the recorder knows, with the fields the feed reads. */
function everyKind(): FeedEvent[] {
  let id = 100n;
  const at = new Date();
  return EVENT_KINDS.map((kind) => ({
    id: ++id, at, kind, actor: "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10",
    message: kind === "DEATH" ? "Bramble09 was slain by Zombie" : kind === "CHAT" ? "hello" : `${kind.toLowerCase()} line`,
    meta: { name: "Bramble09", title: "Stone Age", action: "news.post", params: { id: "n1" }, text: "hello" },
  })) as unknown as FeedEvent[];
}

describe("an instance not marked to talk to Discord (docs/42a)", () => {
  it("is off unless DISCORD_TALKS is exactly 1", () => {
    for (const v of [undefined, "", "0", "true", "yes", " 1"]) expect(talksToDiscord({ DISCORD_TALKS: v })).toBe(false);
    expect(talksToDiscord({ DISCORD_TALKS: "1" })).toBe(true);
  });
  it("gets no bot and none of the players' webhooks, even when they are set", () => {
    expect(botConfig({ ...PLAYERS } as unknown as Env)).toBeNull();
    expect(discordOutlets({ ...PLAYERS } as unknown as Env)).toEqual({ talks: false, feed: undefined, admin: undefined, updates: undefined });
  });
  it("sends nothing to Discord for any event kind", async () => {
    const t = feedFor({ ...PLAYERS }, everyKind());
    expect(t.configured).toBe(false);
    for (let i = 0; i < 5; i++) await t.a.round();
    expect(t.calls).toEqual([]);
  });
  it("may post to a private channel only through the private webhooks", () => {
    expect(discordOutlets({ ...PLAYERS, DISCORD_PRIVATE_WEBHOOK_FEED: PRIVATE } as unknown as Env)).toEqual({ talks: false, feed: PRIVATE, admin: undefined, updates: undefined });
  });
});

describe("the instance marked DISCORD_TALKS=1 (live)", () => {
  it("has its bot and its webhooks as before, and its feed posts", async () => {
    const env = { ...PLAYERS, DISCORD_TALKS: "1" } as unknown as Env;
    expect(botConfig(env)).toMatchObject({ token: PLAYERS.DISCORD_BOT_TOKEN, guild: PLAYERS.DISCORD_GUILD_ID });
    expect(discordOutlets(env)).toEqual({ talks: true, feed: PLAYERS.DISCORD_WEBHOOK_FEED, admin: PLAYERS.DISCORD_WEBHOOK_ADMIN, updates: PLAYERS.DISCORD_WEBHOOK_UPDATES });
    const t = feedFor(env, everyKind());
    expect(t.configured).toBe(true);
    for (let i = 0; i < 5; i++) await t.a.round();
    expect(t.calls.some((c) => c.startsWith("POST https://discord.com/api/v10/webhooks/"))).toBe(true);
  });
  it("ignores the private webhooks", () => {
    expect(discordOutlets({ DISCORD_TALKS: "1", DISCORD_PRIVATE_WEBHOOK_FEED: PRIVATE } as unknown as Env).feed).toBeUndefined();
  });
});

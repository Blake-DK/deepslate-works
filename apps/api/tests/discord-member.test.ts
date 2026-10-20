import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { guildMemberByBot } from "../src/discord/member.js";
import { discordMemberRoutes, MEMBER_LIMIT } from "../src/routes/discord-member.js";

// docs/04: sign-in through Authentik asks api whether a Discord account is in the group's Discord server, by the bot.
// true, false, or null when there is no bot or Discord gave no clear answer (null is never "left the server").

const ENV = { DISCORD_BOT_TOKEN: "bot-token", DISCORD_GUILD_ID: "200000000000000001" };
const ID = "100000000000000001";

type Seen = { url: string; auth: string | null };
function discord(status: number, body: unknown = {}) {
  const seen: Seen[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return Response.json(body, { status });
  }) as typeof fetch;
  return { f, seen };
}

describe("guildMemberByBot", () => {
  it("asks Discord for the member with the bot's token", async () => {
    const d = discord(200, { user: { id: ID } });
    expect(await guildMemberByBot(ENV, ID, d.f)).toBe(true);
    expect(d.seen).toEqual([{ url: `https://discord.com/api/v10/guilds/${ENV.DISCORD_GUILD_ID}/members/${ID}`, auth: "Bot bot-token" }]);
  });

  it("false only for Discord's 'Unknown Member' and 'Unknown User'", async () => {
    expect(await guildMemberByBot(ENV, ID, discord(404, { code: 10007, message: "Unknown Member" }).f)).toBe(false);
    expect(await guildMemberByBot(ENV, ID, discord(404, { code: 10013, message: "Unknown User" }).f)).toBe(false);
  });

  it("null when Discord gave no clear answer: Unknown Guild, a 404 without a code, rate limits, outages, no network", async () => {
    expect(await guildMemberByBot(ENV, ID, discord(404, { code: 10004, message: "Unknown Guild" }).f)).toBeNull();
    expect(await guildMemberByBot(ENV, ID, discord(404, "not json").f)).toBeNull();
    expect(await guildMemberByBot(ENV, ID, discord(429).f)).toBeNull();
    expect(await guildMemberByBot(ENV, ID, discord(500).f)).toBeNull();
    expect(await guildMemberByBot(ENV, ID, discord(403).f)).toBeNull();
    expect(await guildMemberByBot(ENV, ID, (async () => { throw new Error("offline"); }) as typeof fetch)).toBeNull();
  });

  it("null without a bot or a server (api-test), and asks nothing", async () => {
    for (const env of [{}, { DISCORD_BOT_TOKEN: "bot-token" }, { DISCORD_GUILD_ID: "200000000000000001" }]) {
      const d = discord(200);
      expect(await guildMemberByBot(env, ID, d.f)).toBeNull();
      expect(d.seen).toEqual([]);
    }
  });

  it("asks nothing for an id that is not a Discord ID", async () => {
    const d = discord(200);
    expect(await guildMemberByBot(ENV, "../../users/@me", d.f)).toBeNull();
    expect(d.seen).toEqual([]);
  });
});

async function app(status = 200, body: unknown = {}) {
  const d = discord(status, body);
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  discordMemberRoutes(f, ENV, d.f);
  await f.ready();
  const get = (id: string, auth = "Bearer secret") => f.inject({ method: "GET", url: `/discord/member/${id}`, headers: { authorization: auth } });
  return { get, seen: d.seen };
}

describe("GET /discord/member/:id", () => {
  it("answers with the service token, no member needed", async () => {
    const { get } = await app(200);
    const r = await get(ID);
    expect([r.statusCode, r.json()]).toEqual([200, { member: true }]);
  });

  it("refuses without the service token, and asks Discord nothing", async () => {
    const { get, seen } = await app(200);
    expect((await get(ID, "Bearer wrong")).statusCode).toBe(401);
    expect(seen).toEqual([]);
  });

  it("refuses an id that is not a Discord ID", async () => {
    const { get, seen } = await app(200);
    const r = await get("abc");
    expect([r.statusCode, r.json().error.code]).toEqual([400, "validation"]);
    expect(seen).toEqual([]);
  });

  it("passes false and null on as they are", async () => {
    expect((await (await app(404, { code: 10007 })).get(ID)).json()).toEqual({ member: false });
    expect((await (await app(503)).get(ID)).json()).toEqual({ member: null });
  });

  it("answers 30 a minute, then refuses in the site's error shape", async () => {
    expect(MEMBER_LIMIT).toEqual({ max: 30, timeWindow: 60_000 });
    const { get } = await app(200);
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await get(ID)).statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(30);
    const refused = await get(ID);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe("rate_limited");
  });
});

import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Env } from "../env.js";
import { DISCORD_ID_RE, guildMemberByBot } from "../discord/member.js";

// docs/04: the site's sign-in through Authentik asks here whether a Discord account is in the group's Discord server
// (discord/member.ts). Service token only; there is no member yet at a sign-in, so no caller is needed. The bot only
// reads, so this works on every api (docs/42a): without a bot token (api-test) the answer is null.
//
// Each call asks Discord, so it is rate-limited in its own scope (routes/verify.ts has why): 30 a minute in all, far
// above the sign-ins of a group of friends.

export const MEMBER_LIMIT = { max: 30, timeWindow: 60_000 };

export function discordMemberRoutes(app: FastifyInstance, env: Pick<Env, "DISCORD_BOT_TOKEN" | "DISCORD_GUILD_ID">, f: typeof fetch = fetch) {
  app.register(async (scope) => {
    await scope.register(rateLimit, { global: false, hook: "preHandler", keyGenerator: (req) => req.ip });
    // the site reads { error: { code, message } }
    scope.setErrorHandler((err: { statusCode?: number }, _req, reply) => {
      if (err.statusCode === 429) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many Discord server checks. Wait a minute." } });
      return reply.send(err);
    });
    scope.get("/discord/member/:id", { config: { rateLimit: MEMBER_LIMIT } }, async (req, reply) => {
      const id = String((req.params as { id?: unknown }).id ?? "");
      if (!DISCORD_ID_RE.test(id)) return reply.code(400).send({ error: { code: "validation", message: "A Discord ID: digits only." } });
      return { member: await guildMemberByBot(env, id, f) };
    });
  });
}

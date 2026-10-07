import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import type { Announcer } from "../discord/announcer.js";
import type { Bot } from "../discord/bot.js";
import type { Env } from "../env.js";
import { botConfig } from "../discord/wire.js";

// View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History, Add Reactions (docs/22 §7),
// plus Create Public Threads (a forum post is a thread) and Manage Messages (to pin the season's post, docs/22 §13).
const PERMISSIONS = (1n << 10n) | (1n << 11n) | (1n << 38n) | (1n << 14n) | (1n << 16n) | (1n << 6n) | (1n << 35n) | (1n << 13n);

/** "Add the bot to the server": the OAuth link for this app, with the scopes and permissions the bot needs. */
export function inviteLink(clientId: string, guild: string): string {
  const q = new URLSearchParams({ client_id: clientId, scope: "bot applications.commands", permissions: PERMISSIONS.toString(), guild_id: guild, disable_guild_select: "true" });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

// docs/21 §7 and docs/22 §7: Admin → Site settings → Discord. The webhook addresses and the token never leave api; the
// card gets their state, the bot's name, the server's channels to pick from and the last 20 messages sent.
export function discordRoutes(app: FastifyInstance, feed: Announcer, bot: Bot | null, env: Env) {
  app.get("/discord", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const cfg = botConfig(env);
    const b = bot?.overview() ?? null;
    return {
      ...(await feed.overview()),
      bot: b ? { ...b, invite: cfg?.clientId && cfg.guild ? inviteLink(cfg.clientId, cfg.guild) : null } : { state: env.DISCORD_BOT_TOKEN ? "no_guild" : "unset" },
    };
  });
  app.post("/discord/test", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const body = z.object({ channel: z.enum(["feed", "admin", "updates"]) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "channel: feed|admin|updates" } });
    return feed.test(body.data.channel);
  });
}

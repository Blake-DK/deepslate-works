import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import type { Announcer } from "../discord/announcer.js";

// docs/21 §7: Admin → Site settings → Discord. The webhook addresses never leave api; the card gets their state, the
// webhook's name (and the channel's, with a bot token) and the last 20 messages sent.
export function discordRoutes(app: FastifyInstance, feed: Announcer) {
  app.get("/discord", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return feed.overview();
  });
  app.post("/discord/test", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ channel: z.enum(["feed", "admin"]) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "channel: feed|admin" } });
    return feed.test(body.data.channel);
  });
}

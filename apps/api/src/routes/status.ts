import type { FastifyInstance } from "fastify";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { toLive, type StatusPoller } from "../status/poller.js";

export function statusRoutes(app: FastifyInstance, amp: Amp, poller?: StatusPoller, tail?: ConsoleTail) {
  // Served from the poller's last answer (at most 10 s old); AMP is only asked directly when that is stale.
  app.get("/status", async (_req, reply) => {
    const cached = poller?.fresh();
    if (cached) return cached;
    try {
      return toLive(await amp.getStatus(), tail ?? null, new Date());
    } catch (e) {
      return reply.code(502).send({ error: { code: "amp_error", message: String(e instanceof Error ? e.message : e) } });
    }
  });
}

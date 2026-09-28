import type { FastifyInstance } from "fastify";
import type { Amp } from "../amp/client.js";

export function statusRoutes(app: FastifyInstance, amp: Amp) {
  app.get("/status", async (_req, reply) => {
    try {
      const s = await amp.getStatus();
      return { state: s.state, players: s.players, cpu: s.cpu, memMb: s.memMb, uptime: s.uptime };
    } catch (e) {
      return reply.code(502).send({ error: { code: "amp_error", message: String(e instanceof Error ? e.message : e) } });
    }
  });
}

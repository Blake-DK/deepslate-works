import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { THRESHOLD, type GroundItems } from "../status/ground.js";

const planBody = z.object({ auto: z.boolean(), threshold: z.number().int().min(THRESHOLD.min).max(THRESHOLD.max) });

// Admin → Server → Settings: entity counts, "Clear ground items now" and the automatic schedule (status/ground.ts).
export function groundRoutes(app: FastifyInstance, ground: GroundItems) {
  app.get("/server/ground", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return ground.read();
  });

  app.post("/server/ground/clear", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const r = ground.begin(req.caller.userId);
    if (!r.ok) {
      const message = r.code === "busy" ? "A clear is already counting down." : "The server isn't running.";
      return reply.code(409).send({ error: { code: r.code, message } });
    }
    return r;
  });

  app.post("/server/ground/plan", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = planBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: { code: "validation", message: `auto: true or false; threshold: ${THRESHOLD.min} to ${THRESHOLD.max}` } });
    return { plan: await ground.setPlan(b.data, req.caller.userId) };
  });
}

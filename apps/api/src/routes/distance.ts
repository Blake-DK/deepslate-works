import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { Distances, Refusal } from "../status/distance.js";

const body = z.object({ view: z.number().int(), sim: z.number().int(), apply: z.enum(["now", "next"]) });

export function distanceRoutes(app: FastifyInstance, distances: Distances) {
  app.get("/server/distance", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return distances.read();
  });

  app.post("/server/distance", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: { code: "validation", message: "view, sim: whole numbers; apply: now or next" } });
    try {
      return await distances.set({ view: b.data.view, sim: b.data.sim }, b.data.apply, req.caller.userId);
    } catch (e) {
      if (e instanceof Refusal) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
      throw e;
    }
  });
}

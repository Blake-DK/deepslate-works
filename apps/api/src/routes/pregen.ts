import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConsoleTail } from "../amp/console.js";
import { requireAdmin } from "../auth.js";
import { chunksIn, Refused, type Pregen } from "../status/pregen.js";

// Admin → Server → Pre-generation. Off unless an admin turns it on; see status/pregen.ts.

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const on = z.object({
  mode: z.enum(["empty", "now"]),
  area: z.object({ x: z.number().int().min(-100_000).max(100_000), z: z.number().int().min(-100_000).max(100_000), radius: z.number().int().min(16).max(10_000) }),
  window: z.object({ from: clock, to: clock }).nullable().default(null),
  capHours: z.number().min(0.25).max(240).nullable().default(null),
});

export function pregenRoutes(app: FastifyInstance, tail: ConsoleTail, pregen: Pregen) {
  const view = () => ({
    ...pregen.watch.state,
    plan: pregen.plan,
    doing: pregen.lastStep,
    total: pregen.plan.area ? chunksIn(pregen.plan.area.radius) : null,
    sleep: pregen.sleep,
    serverState: tail.state,
    serverRunning: tail.state === 20,
    online: tail.online.size,
  });

  app.get("/pregen", async () => {
    // what AMP allows is asked again when the last answer is a minute old
    if (!pregen.sleep.checkedAt || Date.now() - Date.parse(pregen.sleep.checkedAt) > 60_000) await pregen.lookAtSleep();
    return view();
  });

  app.post("/pregen/on", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = on.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300) } });
    try {
      await pregen.turnOn(body.data, req.caller.userId);
    } catch (e) {
      if (e instanceof Refused) return reply.code(409).send({ error: { code: e.code, message: e.message } });
      throw e;
    }
    return view();
  });

  app.post("/pregen/off", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await pregen.turnOff("asked", req.caller.userId);
    return view();
  });

  app.post("/pregen/cancel", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await pregen.cancel(req.caller.userId);
    return view();
  });
}

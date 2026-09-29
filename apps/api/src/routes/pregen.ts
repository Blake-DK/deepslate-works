import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConsoleTail } from "../amp/console.js";
import { requireAdmin } from "../auth.js";
import type { PregenKeeper, PregenWatch } from "../status/pregen.js";

// Admin → Server → Pre-generation. Off unless an admin turns it on; see status/pregen.ts.

const on = z.object({
  mode: z.enum(["hours", "empty"]),
  hours: z.number().min(0.25).max(72).optional(),
  whilePlaying: z.boolean().default(false),
  task: z.object({ x: z.number().int().min(-100_000).max(100_000), z: z.number().int().min(-100_000).max(100_000), radius: z.number().int().min(16).max(10_000) }).nullable().default(null),
});

export function pregenRoutes(app: FastifyInstance, tail: ConsoleTail, watch: PregenWatch, keeper: PregenKeeper) {
  const view = () => ({ ...watch.state, plan: keeper.plan, doing: keeper.lastStep, roundSec: Math.round(keeper.runForMs / 1000), ampWaitsSec: keeper.idleSeenMs === null ? null : Math.round(keeper.idleSeenMs / 1000), serverState: tail.state, serverRunning: tail.state === 20, online: tail.online.size });

  app.get("/pregen", async () => view());

  app.post("/pregen/on", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = on.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300) } });
    await keeper.turnOn(body.data, req.caller.userId);
    return view();
  });

  app.post("/pregen/off", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await keeper.turnOff("asked", req.caller.userId);
    return view();
  });
}

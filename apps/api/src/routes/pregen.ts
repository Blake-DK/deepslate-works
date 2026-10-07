import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConsoleTail } from "../amp/console.js";
import { requireAdmin } from "../auth.js";
import { mapOf } from "../status/map.js";
import { PREGEN_WORLD } from "../actions/registry.js";
import { chunksIn, phase, Refused, type Pregen } from "../status/pregen.js";

// Admin → Server → Pre-generation. Off unless an admin turns it on; see status/pregen.ts.

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const on = z.object({
  mode: z.enum(["empty", "now"]),
  what: z.enum(["generate", "render", "both"]).default("generate"),
  purge: z.boolean().default(false),
  area: z.object({ x: z.number().int().min(-100_000).max(100_000), z: z.number().int().min(-100_000).max(100_000), radius: z.number().int().min(16).max(10_000), world: PREGEN_WORLD.optional() }),
  window: z.object({ from: clock, to: clock }).nullable().default(null),
  capHours: z.number().min(0.25).max(240).nullable().default(null),
});

export function pregenRoutes(app: FastifyInstance, tail: ConsoleTail, pregen: Pregen, players: () => number | null = () => null) {
  const map = () => {
    const s = pregen.map.state;
    const id = mapOf(pregen.plan.area?.world);
    const m = s.maps[id] ?? null;
    // the estimate is for the task in hand, whichever map that is
    return { id, status: m?.status ?? null, percent: m?.percent ?? null, waiting: m?.pending ?? null, remaining: s.current === id ? s.remaining : null, threads: s.threads, at: s.listAt, stopped: pregen.plan.mapStopped === true };
  };
  const view = () => ({
    ...pregen.watch.state,
    plan: pregen.plan,
    doing: pregen.lastStep,
    phase: pregen.plan.mode === "off" ? null : phase(pregen.plan.what, pregen.watch.state.status, false),
    map: map(),
    total: pregen.plan.area ? chunksIn(pregen.plan.area.radius) : null,
    sleep: pregen.sleep,
    serverState: tail.state,
    serverRunning: tail.state === 20,
    online: Math.max(tail.online.size, tail.state === 20 ? (players() ?? 0) : 0),
  });

  app.get("/pregen", async () => {
    // what AMP allows is asked again when the last answer is a minute old
    if (!pregen.sleep.checkedAt || Date.now() - Date.parse(pregen.sleep.checkedAt) > 60_000) await pregen.lookAtSleep();
    return view();
  });

  app.post("/pregen/on", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
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
    if (!(await requireAdmin(req, reply))) return;
    await pregen.turnOff("asked", req.caller.userId);
    return view();
  });

  // BlueMap's config read again (render threads): `bluemap reload`, and a render in hand is asked for again.
  app.post("/pregen/map-reload", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    if (!(await pregen.reloadMap(req.caller.userId))) return reply.code(409).send({ error: { code: "server_offline", message: "The server isn't running, or BlueMap did not take the command." } });
    return view();
  });

  app.post("/pregen/cancel", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    await pregen.cancel(req.caller.userId);
    return view();
  });
}

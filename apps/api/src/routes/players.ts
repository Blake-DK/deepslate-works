import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import type { Limbo } from "../players/limbo.js";
import { requireAdmin } from "../auth.js";
import { runAction } from "../actions/run.js";
import { ADMIN_ACTIONS, actions, type ActionName } from "../actions/registry.js";
import { db } from "../db.js";

export function playerRoutes(app: FastifyInstance, amp: Amp, tail: ConsoleTail, limbo: Limbo) {
  app.get("/players", async () => ({
    state: tail.state,
    online: [...tail.online].map((name) => ({ name, uuid: tail.uuidByName.get(name) ?? null, held: limbo.held.has(name) })),
    held: [...limbo.held.entries()].map(([name, h]) => ({ name, since: new Date(h.since).toISOString() })),
  }));

  // Portal → api after a successful /link: release now if online.
  app.post("/link/release", async (req, reply) => {
    const body = z.object({ uuid: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "uuid" } });
    return limbo.release(body.data.uuid.toLowerCase());
  });

  // Portal (admin remove / member left the guild) → api: kick + unwhitelist if online.
  app.post("/player/revoke", async (req, reply) => {
    const body = z.object({ uuid: z.string().uuid(), reason: z.string().max(120).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "uuid" } });
    return limbo.revoke(body.data.uuid.toLowerCase(), req.caller.userId, body.data.reason);
  });

  app.post("/actions/:name", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const name = (req.params as { name: string }).name as ActionName;
    if (!ADMIN_ACTIONS.includes(name)) return reply.code(404).send({ error: { code: "validation", message: "unknown action" } });
    if (tail.state !== 20) return reply.code(409).send({ error: { code: "server_offline", message: "The server isn't running" } });
    const r = await runAction(amp, limbo.actionCtx, name, req.body ?? {}, req.caller.userId);
    return r.ok ? r : reply.code(400).send({ ...r, error: { code: r.detail === "validation" ? "validation" : "amp_error", message: r.detail ?? "failed" } });
  });

  app.get("/actions", async () => ADMIN_ACTIONS.map((n) => ({ name: n, role: actions[n].role })));

  app.get("/console/tail", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const n = Math.min(300, Math.max(1, Number((req.query as { lines?: string }).lines ?? 200) || 200));
    return { state: tail.state, lines: tail.lines.slice(-n) };
  });

  app.post("/server/:op", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const op = (req.params as { op: string }).op;
    const method = ({ start: "Start", stop: "Stop", restart: "Restart" } as Record<string, string>)[op];
    if (!method) return reply.code(404).send({ error: { code: "validation", message: "start|stop|restart" } });
    try {
      const r = await amp.call<unknown>("Core", method);
      await db.auditLog.create({ data: { userId: req.caller.userId, action: `server.${op}`, params: {}, result: "OK" } });
      return { ok: true, result: r };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await db.auditLog.create({ data: { userId: req.caller.userId, action: `server.${op}`, params: {}, result: "FAILED", detail } });
      return reply.code(502).send({ error: { code: "amp_error", message: detail } });
    }
  });
}

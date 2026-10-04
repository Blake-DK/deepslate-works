import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import type { Limbo } from "../players/limbo.js";
import { requireAdmin } from "../auth.js";
import { runAction } from "../actions/run.js";
import { ADMIN_ACTIONS, OWN_ROUTE, actions, type ActionName } from "../actions/registry.js";
import { audit } from "../audit.js";

export function playerRoutes(app: FastifyInstance, amp: Amp, tail: ConsoleTail, limbo: Limbo, beforeStop: () => Promise<unknown> = async () => undefined) {
  app.get("/players", async () => ({
    state: tail.state,
    online: [...tail.online].map((name) => ({ name, uuid: tail.uuidByName.get(name) ?? null, held: limbo.held.has(name) })),
    held: [...limbo.held.entries()].map(([name, h]) => ({ name, since: new Date(h.since).toISOString() })),
  }));

  // Admin → Control Room, "who is held and why" (docs/32 §7 item 10): the list, and Release for a linked member.
  app.get("/held", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { state: tail.state, held: limbo.heldList() };
  });
  app.post("/held/release", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ name: z.string().regex(/^[A-Za-z0-9_]{3,16}$/) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "name" } });
    const r = await limbo.adminRelease(body.data.name, req.caller.userId);
    if (r.ok) return { ok: true };
    const message = r.code === "not_held" ? "They are not in the entrance room any more." : r.code === "not_linked" ? "They have not linked their Minecraft account yet, so they cannot be let in from here." : "The server did not take the command.";
    return reply.code(r.code === "failed" ? 502 : 409).send({ error: { code: r.code, message } });
  });

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
    if (!ADMIN_ACTIONS.includes(name) || OWN_ROUTE.has(name)) return reply.code(404).send({ error: { code: "validation", message: "unknown action" } });
    if (tail.state !== 20) return reply.code(409).send({ error: { code: "server_offline", message: "The server isn't running" } });
    const r = await runAction(amp, limbo.actionCtx, name, req.body ?? {}, req.caller.userId);
    return r.ok ? r : reply.code(400).send({ ...r, error: { code: r.detail === "validation" ? "validation" : "amp_error", message: r.detail ?? "failed" } });
  });

  app.get("/actions", async () => ADMIN_ACTIONS.map((n) => ({ name: n, role: actions[n].role })));

  app.get("/console/tail", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const n = Math.min(300, Math.max(1, Number((req.query as { lines?: string }).lines ?? 200) || 200));
    return { state: tail.state, lines: tail.lines.slice(-n), entries: tail.entries.slice(-n).map((e) => ({ seq: e.seq, text: e.text })) };
  });

  app.post("/server/:op", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const op = (req.params as { op: string }).op;
    // `kill` is for a server that hangs while it shuts down (2026-09-29: stuck at "Saving worlds" for ten minutes,
    // AMP in "Stopping" and deaf to Stop). What had not been saved is lost. For an admin, and only while the server
    // is in "Stopping": there is no other state in which ending the process is the right thing to do.
    const method = ({ start: "Start", stop: "Stop", restart: "Restart", kill: "Kill" } as Record<string, string>)[op];
    if (!method) return reply.code(404).send({ error: { code: "validation", message: "start|stop|restart|kill" } });
    if (op === "kill" && tail.state !== 45) {
      await audit({ userId: req.caller.userId, action: "server.kill", params: { state: tail.state }, result: "DENIED", detail: "not in Stopping" });
      return reply.code(409).send({ error: { code: "not_stopping", message: "The server is not stuck in \"Stopping\". Ending its process is only for that." } });
    }
    // A running pre-generation is paused, and the save waited for, before the server is stopped.
    if (op === "stop" || op === "restart") await beforeStop().catch((e) => req.log.warn({ err: String(e) }, "could not pause the pre-generation before the stop"));
    try {
      const r = await amp.call<unknown>("Core", method);
      await audit({ userId: req.caller.userId, action: `server.${op}`, params: {}, result: "OK" });
      return { ok: true, result: r };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await audit({ userId: req.caller.userId, action: `server.${op}`, params: {}, result: "FAILED", detail });
      return reply.code(502).send({ error: { code: "amp_error", message: detail } });
    }
  });
}

import type { FastifyInstance } from "fastify";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import type { ActionCtx } from "../actions/registry.js";
import { runAction } from "../actions/run.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../audit.js";
import { RateLimit } from "../console/limit.js";

// Planner ruling 2026-09-30 (docs/13): the Minecraft server console for admins. Whatever an admin types goes to
// the server as it is, through the one action `console.send`, so it is sent by actions/run.ts and written into
// the event log ("Alex ran: …") like every other command. It is the game's console and nothing lower: no shell,
// no AMP settings, no files.
export function consoleRoutes(app: FastifyInstance, amp: Amp, tail: ConsoleTail, ctx: () => ActionCtx, limit = new RateLimit()) {
  app.post("/console/send", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const who = req.caller.userId ?? "service";
    if (!limit.take(who)) {
      const typed = (req.body as { command?: unknown } | null)?.command;
      await audit({ userId: req.caller.userId, action: "console.send", params: { command: typeof typed === "string" ? typed.slice(0, 200) : "" }, result: "DENIED", detail: "more than 5 commands a second" });
      return reply.code(429).send({ error: { code: "rate_limited", message: "More than 5 commands a second. Wait a moment." } });
    }
    if (tail.state !== 20) return reply.code(409).send({ error: { code: "server_offline", message: "The server isn't running" } });
    const r = await runAction(amp, ctx(), "console.send", req.body ?? {}, req.caller.userId);
    if (!r.ok) return reply.code(400).send({ ...r, error: { code: r.detail === "validation" ? "validation" : "amp_error", message: r.detail === "validation" ? "One line, up to 1000 characters." : (r.detail ?? "failed") } });
    return r;
  });
}

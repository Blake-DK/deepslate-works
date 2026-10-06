import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import type { ActionCtx } from "../actions/registry.js";
import { runAction } from "../actions/run.js";
import { requireAdmin } from "../auth.js";

// docs/37 Step 2: Builder mode. WorldEdit on NeoForge asks no permissions mod: it works for ops, or for a player in
// creative when its use-in-creative is on (ours is). So an admin Alex has ticked "Builder tools" for switches
// themselves into creative here, and out again. Only for themselves, only with the tick, only while online. Any admin
// may switch anyone out (unticking does).

export type BuilderUser = { id: string; role: "ADMIN" | "PLAYER"; builderTools: boolean; mcUsername: string | null };

const body = z.object({ on: z.boolean(), userId: z.string().min(1).max(64).optional() });

export function builderRoutes(app: FastifyInstance, d: { amp: Amp; tail: ConsoleTail; ctx: () => ActionCtx; findUser(id: string): Promise<BuilderUser | null> }) {
  const refuse = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

  app.post("/builder/mode", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = body.safeParse(req.body);
    if (!b.success) return refuse(reply, 400, "validation", "On or off.");
    const target = b.data.userId ?? req.caller.userId;
    if (!target) return refuse(reply, 400, "validation", "Whose Builder mode?");
    if (b.data.on && target !== req.caller.userId) return refuse(reply, 403, "forbidden", "Builder mode is switched on by its owner only.");
    const u = await d.findUser(target);
    if (!u) return refuse(reply, 404, "not_found", "No such member.");
    if (b.data.on && (u.role !== "ADMIN" || !u.builderTools)) return refuse(reply, 403, "no_builder_tools", "Builder tools are not ticked for you. An admin ticks them on People.");
    if (!u.mcUsername) return refuse(reply, 409, "no_minecraft", "No Minecraft account is linked.");
    if (d.tail.state !== 20) return refuse(reply, 409, "server_offline", "The server is not running.");
    const name = [...d.tail.online].find((n) => n.toLowerCase() === u.mcUsername!.toLowerCase());
    if (!name) return b.data.on ? refuse(reply, 409, "offline", "Join the server first, then switch Builder mode on.") : { ok: true, online: false };
    const r = await runAction(d.amp, d.ctx(), b.data.on ? "builder.on" : "builder.off", { player: name }, req.caller.userId);
    if (!r.ok) return refuse(reply, 502, "amp_error", r.detail ?? "The server did not take the command.");
    return { ok: true, online: true };
  });
}

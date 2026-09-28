import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { Env } from "../env.js";
import { requireAdmin } from "../auth.js";
import { syncServer } from "../modpack/sync.js";

let syncing = false;

export function modpackRoutes(app: FastifyInstance, env: Env, amp: Amp) {
  app.post("/modpack/sync", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ packVersion: z.string().max(64).optional(), dryRun: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "bad body" } });
    if (syncing) return reply.code(409).send({ error: { code: "busy", message: "a sync is already running" } });
    syncing = true;
    try {
      const res = await syncServer(env, amp, { dryRun: body.data.dryRun });
      req.log.info({ ok: res.ok, restarted: res.restarted, packVersion: body.data.packVersion, by: req.caller.userId }, "modpack sync");
      return res.ok ? res : reply.code(502).send({ ...res, error: { code: "amp_error", message: res.lines.at(-1) ?? "sync failed" } });
    } finally {
      syncing = false;
    }
  });
}

import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { Env } from "../env.js";
import { requireAdmin } from "../auth.js";
import { BUILD_TARGETS, runBuild, type BuildEvent } from "../modpack/build.js";
import { syncServer } from "../modpack/sync.js";
import { recordSynced } from "../players/pack.js";
import { getSection } from "../settings.js";
import { chatSafe } from "../actions/registry.js";
import { OneAtATime } from "../modpack/busy.js";

// Build writes dist/, sync reads it: one of them at a time, and a second caller is told who holds it.
const busy = new OneAtATime();

export function modpackRoutes(app: FastifyInstance, env: Env, amp: Amp, build: typeof runBuild = runBuild, beforeRestart: () => Promise<unknown> = async () => undefined) {
  app.post("/modpack/sync", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ packVersion: z.string().max(64).optional(), dryRun: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "bad body" } });
    const held = busy.take("sync", req.caller.userId);
    if (!held.ok) return reply.code(409).send({ error: { code: "busy", message: held.message } });
    try {
      const res = await syncServer(env, amp, { dryRun: body.data.dryRun, beforeRestart });
      req.log.info({ ok: res.ok, restarted: res.restarted, dryRun: Boolean(body.data.dryRun), packVersion: body.data.packVersion, by: req.caller.userId }, "modpack sync");
      // docs/14 "Play first": from now on this is the pack a member's run of Play has to have installed
      if (res.ok && !body.data.dryRun) await recordSynced().catch((err) => req.log.warn({ err: String(err) }, "could not record the synced pack"));
      return res.ok ? res : reply.code(502).send({ ...res, error: { code: "amp_error", message: res.lines.at(-1) ?? "sync failed" } });
    } finally {
      busy.release();
    }
  });

  // Streams newline-delimited JSON: {"line": "..."} as the CLI prints, then {"done": true, "ok", "code"}.
  app.post("/modpack/build", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ target: z.enum(BUILD_TARGETS).default("all") }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "target: all|config|server|installer|items" } });
    const held = busy.take("build", req.caller.userId);
    if (!held.ok) return reply.code(409).send({ error: { code: "busy", message: held.message } });
    const packName = chatSafe((await getSection("branding")).name, "");
    const events = build(env, body.data.target, packName ? { packName } : {});
    const log = req.log;
    const by = req.caller.userId;
    async function* ndjson(): AsyncGenerator<string> {
      let last: BuildEvent | null = null;
      try {
        for await (const e of events) {
          last = e;
          yield `${JSON.stringify(e)}\n`;
        }
      } finally {
        busy.release();
        log.info({ target: body.data?.target, by, result: last && "done" in last ? last : "aborted" }, "modpack build");
      }
    }
    const stream = Readable.from(ndjson());
    // If the stream is torn down before it is ever read, the generator's `finally` never runs.
    stream.once("close", () => {
      busy.release();
    });
    return reply
      .header("content-type", "application/x-ndjson; charset=utf-8")
      .header("cache-control", "no-store")
      .send(stream);
  });
}

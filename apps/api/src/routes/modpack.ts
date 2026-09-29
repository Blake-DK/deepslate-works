import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { Env } from "../env.js";
import { requireAdmin } from "../auth.js";
import { BUILD_TARGETS, runBuild, type BuildEvent } from "../modpack/build.js";
import { syncServer } from "../modpack/sync.js";
import { getSection } from "../settings.js";
import { chatSafe } from "../actions/registry.js";

// Build writes dist/, sync reads it: one of them at a time.
let busy: "build" | "sync" | null = null;

export function modpackRoutes(app: FastifyInstance, env: Env, amp: Amp, build: typeof runBuild = runBuild) {
  app.post("/modpack/sync", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ packVersion: z.string().max(64).optional(), dryRun: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "bad body" } });
    if (busy) return reply.code(409).send({ error: { code: "busy", message: `a ${busy} is already running` } });
    busy = "sync";
    try {
      const res = await syncServer(env, amp, { dryRun: body.data.dryRun });
      req.log.info({ ok: res.ok, restarted: res.restarted, packVersion: body.data.packVersion, by: req.caller.userId }, "modpack sync");
      return res.ok ? res : reply.code(502).send({ ...res, error: { code: "amp_error", message: res.lines.at(-1) ?? "sync failed" } });
    } finally {
      busy = null;
    }
  });

  // Streams newline-delimited JSON: {"line": "..."} as the CLI prints, then {"done": true, "ok", "code"}.
  app.post("/modpack/build", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ target: z.enum(BUILD_TARGETS).default("all") }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "target: all|config|server|installer" } });
    if (busy) return reply.code(409).send({ error: { code: "busy", message: `a ${busy} is already running` } });
    busy = "build";
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
        busy = null;
        log.info({ target: body.data?.target, by, result: last && "done" in last ? last : "aborted" }, "modpack build");
      }
    }
    const stream = Readable.from(ndjson());
    // If the stream is torn down before it is ever read, the generator's `finally` never runs.
    stream.once("close", () => {
      busy = null;
    });
    return reply
      .header("content-type", "application/x-ndjson; charset=utf-8")
      .header("cache-control", "no-store")
      .send(stream);
  });
}

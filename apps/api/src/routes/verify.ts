import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { verifyServer, type VerifyDeps } from "../modpack/verify.js";

// Alex, 2026-10-14: after Sync, whether the server came back with every mod the pack gives it (modpack/verify.ts).
// `since` (Sync's restartedAt): waits for a start after it; without, checks the server's last start.
//
// Each call reads the server's mod files over the tunnel, so it is rate-limited: 3 a minute for one admin. Sync calls it
// once a run, and that one call waits up to 7 minutes, so the limit never meets real use. Fastify's own limiter rather
// than console/limit.ts's, because it is the one code scanning recognises (js/missing-rate-limiting). It is registered
// in this route's own scope, before the route, as it only applies to routes declared after it.

export const VERIFY_LIMIT = { max: 3, timeWindow: 60_000 };

export function verifyRoutes(app: FastifyInstance, deps: Pick<VerifyDeps, "capture" | "latest" | "sleep">) {
  app.register(async (scope) => {
    await scope.register(rateLimit, { global: false, hook: "preHandler", keyGenerator: (req) => req.caller?.userId ?? req.ip });
    // the site reads { error: { code, message } }
    scope.setErrorHandler((err: { statusCode?: number }, _req, reply) => {
      if (err.statusCode === 429) return reply.code(429).send({ error: { code: "rate_limited", message: "The server's mods were just checked. Wait a minute." } });
      return reply.send(err);
    });
    scope.post("/modpack/verify", { config: { rateLimit: VERIFY_LIMIT } }, async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      const body = z.object({ since: z.string().datetime().optional() }).safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "since: an ISO time" } });
      return verifyServer(deps, body.data.since ? new Date(body.data.since) : undefined);
    });
  });
}

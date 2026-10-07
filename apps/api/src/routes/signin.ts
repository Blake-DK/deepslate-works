import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HealthWatch } from "../status/health-watch.js";
import { SIGNIN_METHODS } from "../status/signin-watch.js";

// web reports each sign-in's outcome (status/signin-watch.ts): the method and whether it worked, nothing else.
const body = z.object({ method: z.enum(SIGNIN_METHODS), ok: z.boolean() }).strict();

export function signInRoutes(app: FastifyInstance, watch: HealthWatch) {
  app.post("/signin/outcome", async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: { code: "validation", message: "A sign-in method and ok." } });
    await watch.signInOutcome(b.data.method, b.data.ok);
    return { ok: true };
  });
}

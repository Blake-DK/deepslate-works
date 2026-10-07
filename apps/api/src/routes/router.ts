import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { requireAdmin } from "../auth.js";
import { RouterError, type RouterDash } from "../router/client.js";

// Admin → Server → Router (Alex, 2026-10-07): the mc-router dashboard's routes, who is on, recent logins, and adding or
// removing a route. Admins only, every request; the two changes are named and audited here. The dashboard itself stays
// on the AMP host, reached over the tunnel by api alone (the relays and the router.* host were taken out).

const LABEL = /^\S(?:[^\p{Cc}]{0,58}\S)?$/u;
export const hostnameSchema = z.string().trim().toLowerCase().max(253)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, "a hostname such as play.example.com");
const addBody = z.object({
  hostname: hostnameSchema,
  port: z.number().int().min(1024).max(65535),
  label: z.string().trim().max(60).regex(LABEL, "letters, numbers and spaces").optional().or(z.literal("").transform(() => undefined)),
});

/** The address players join Deepslate Works by, without a port: its route is never removed from the site. */
export function protectedHost(serverAddress: string | undefined): string | null {
  const host = serverAddress?.trim().toLowerCase().replace(/:\d+$/, "");
  return host ? host : null;
}

function refuse(reply: FastifyReply, e: unknown) {
  if (!(e instanceof RouterError)) throw e;
  if (e.status === 0) return reply.code(503).send({ error: { code: "router_unreachable", message: e.message } });
  if (e.status >= 400 && e.status < 500) return reply.code(400).send({ error: { code: "router_refused", message: e.message } });
  return reply.code(502).send({ error: { code: "router_failed", message: e.message } });
}

export function routerRoutes(app: FastifyInstance, dash: RouterDash, serverAddress?: string) {
  const keep = protectedHost(serverAddress);

  app.get("/router", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    try {
      return { ...(await dash.view()), protectedHost: keep };
    } catch (e) {
      return refuse(reply, e);
    }
  });

  app.post("/router/routes", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const b = addBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: { code: "validation", message: b.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300) } });
    const params = { hostname: b.data.hostname, port: b.data.port, ...(b.data.label ? { label: b.data.label } : {}) };
    try {
      await dash.addRoute(params);
    } catch (e) {
      await audit({ userId: req.caller.userId, action: "router.routeAdd", params, result: "FAILED", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      return refuse(reply, e);
    }
    await audit({ userId: req.caller.userId, action: "router.routeAdd", params, result: "OK" });
    return { ok: true };
  });

  app.delete<{ Params: { hostname: string } }>("/router/routes/:hostname", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const h = hostnameSchema.safeParse(req.params.hostname);
    if (!h.success) return reply.code(400).send({ error: { code: "validation", message: "hostname: a hostname such as play.example.com" } });
    const params = { hostname: h.data };
    if (keep && h.data === keep) {
      await audit({ userId: req.caller.userId, action: "router.routeRemove", params: { ...params, refused: "server_address" }, result: "DENIED" });
      return reply.code(409).send({ error: { code: "server_address", message: "This is the address players join Deepslate Works by; the site never removes it." } });
    }
    try {
      await dash.removeRoute(h.data);
    } catch (e) {
      await audit({ userId: req.caller.userId, action: "router.routeRemove", params, result: "FAILED", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      return refuse(reply, e);
    }
    await audit({ userId: req.caller.userId, action: "router.routeRemove", params, result: "OK" });
    return { ok: true };
  });
}

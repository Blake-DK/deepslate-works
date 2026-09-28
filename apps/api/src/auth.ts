import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const MC_USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export type Role = "ADMIN" | "PLAYER";
export type Caller = { userId: string | null; role: Role | null; mcUsername: string | null };

export function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Headers set by `web` from its verified session. Only trusted because the bearer token matched. */
export function callerFromHeaders(h: Record<string, string | string[] | undefined>): Caller {
  const one = (k: string) => (Array.isArray(h[k]) ? h[k]?.[0] : h[k]) ?? null;
  const role = one("x-user-role");
  const mc = one("x-mc-username");
  return {
    userId: one("x-user-id"),
    role: role === "ADMIN" || role === "PLAYER" ? role : null,
    mcUsername: mc && MC_USERNAME_RE.test(mc) ? mc : null,
  };
}

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller;
  }
}

export function serviceAuth(token: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!tokenMatches(req.headers.authorization, token)) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "service token required" } });
    }
    req.caller = callerFromHeaders(req.headers);
  };
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.caller.role !== "ADMIN") {
    reply.code(403).send({ error: { code: "forbidden", message: "admin only" } });
    return false;
  }
  return true;
}

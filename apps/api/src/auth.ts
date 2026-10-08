import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db.js";

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

/**
 * `own`: paths that take a token of their own instead of the service token, and only that one (docs/42 T9: the test
 * server's /test/summary takes the live site's TEST_SUMMARY_TOKEN). Such a request is nobody: web's caller headers
 * are not read.
 */
export function serviceAuth(token: string, own: Readonly<Record<string, string>> = {}) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0] ?? "";
    const its = Object.hasOwn(own, path) ? own[path] : undefined;
    if (its !== undefined) {
      if (!tokenMatches(req.headers.authorization, its)) return reply.code(401).send({ error: { code: "unauthorized", message: "this path's own token required" } });
      req.caller = { userId: null, role: null, mcUsername: null };
      return;
    }
    if (!tokenMatches(req.headers.authorization, token)) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "service token required" } });
    }
    req.caller = callerFromHeaders(req.headers);
  };
}

/** A member's role as the database has it; null for an id that is no member. Replaced in tests (setRoleLookup). */
export type RoleLookup = (userId: string) => Promise<Role | null>;
const fromDb: RoleLookup = async (id) => (await db.user.findUnique({ where: { id }, select: { role: true } }))?.role ?? null;
let lookupRole: RoleLookup = fromDb;
const ROLE_TTL_MS = 5_000;
const roles = new Map<string, { role: Role | null; at: number }>();

export function setRoleLookup(f: RoleLookup | null) {
  lookupRole = f ?? fromDb;
  roles.clear();
}

async function roleOf(userId: string): Promise<Role | null> {
  const now = Date.now();
  const hit = roles.get(userId);
  if (hit && now - hit.at < ROLE_TTL_MS) return hit.role;
  const role = await lookupRole(userId);
  if (roles.size > 1000) roles.clear();
  roles.set(userId, { role, at: now });
  return role;
}

/**
 * Admin only. The x-user-role header is web's word, so it is not enough on its own: the member named by x-user-id must
 * be an admin in the database too (read at most every 5 s per member). A missing or unknown id is refused. Keep this
 * check here, in api, whatever web already checked.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const id = req.caller.userId;
  if (req.caller.role === "ADMIN" && id && (await roleOf(id)) === "ADMIN") return true;
  reply.code(403).send({ error: { code: "forbidden", message: "admin only" } });
  return false;
}

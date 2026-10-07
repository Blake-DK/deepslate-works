import "server-only";
import { auth } from "@/auth";
import { loadCurrentUser, type CurrentUser } from "@/server/auth/session";

// Caddy forward_auth answers for the hosts behind the portal's login: the map (any member) and the mc-router
// dashboard (admins only). docs/35 R-11: the cookie alone is not enough; the session is checked against the
// database as the pages do, so a removed or blocked member loses access too. Caddy asks for every map tile, so one
// answer per session stands for 30 s; a demoted admin keeps the dashboard for at most that long.
const KEEP_MS = 30_000;
const seen = new Map<string, { role: CurrentUser["role"] | null; until: number }>();

async function roleFor(key: string): Promise<CurrentUser["role"] | null> {
  const now = Date.now();
  const hit = seen.get(key);
  if (hit && hit.until > now) return hit.role;
  const role = (await loadCurrentUser())?.role ?? null;
  if (seen.size > 500) for (const [k, v] of seen) if (v.until <= now) seen.delete(k);
  seen.set(key, { role, until: now + KEEP_MS });
  return role;
}

/** 200 (with X-User) when allowed, 401 without a good session, 403 for a member where an admin is needed. No body. */
export async function verifyAccess(need: "member" | "admin"): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response(null, { status: 401 });
  const { id, sv, via, pa } = session.user;
  const role = await roleFor(`${id}:${sv ?? 0}:${via ?? ""}:${pa ?? ""}`);
  if (!role) return new Response(null, { status: 401 });
  if (need === "admin" && role !== "ADMIN") return new Response(null, { status: 403 });
  return new Response(null, { status: 200, headers: { "X-User": id } });
}

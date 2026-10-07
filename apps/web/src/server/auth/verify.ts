import "server-only";
import { auth } from "@/auth";
import { loadCurrentUser } from "@/server/auth/session";

// Caddy forward_auth answer for the map host. docs/35 R-11: the cookie alone is not enough; the session is checked
// against the database as the pages do, so a removed or blocked member loses the map too. Caddy asks for every tile,
// so one answer per session stands for 30 s.
const KEEP_MS = 30_000;
const seen = new Map<string, { ok: boolean; until: number }>();

async function stillGood(key: string): Promise<boolean> {
  const now = Date.now();
  const hit = seen.get(key);
  if (hit && hit.until > now) return hit.ok;
  const ok = Boolean(await loadCurrentUser());
  if (seen.size > 500) for (const [k, v] of seen) if (v.until <= now) seen.delete(k);
  seen.set(key, { ok, until: now + KEEP_MS });
  return ok;
}

/** 200 (with X-User) with a good session, 401 without. No body. */
export async function verifyMember(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response(null, { status: 401 });
  const { id, sv, via, pa } = session.user;
  if (!(await stillGood(`${id}:${sv ?? 0}:${via ?? ""}:${pa ?? ""}`))) return new Response(null, { status: 401 });
  return new Response(null, { status: 200, headers: { "X-User": id } });
}

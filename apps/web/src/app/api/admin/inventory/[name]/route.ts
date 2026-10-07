import { loadCurrentUser } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";
import { readJson, readJsonError } from "@/server/read-json";

export const dynamic = "force-dynamic";

// docs/13 §13: change an online player's inventory or ender chest. Admins only (api checks again, limits to 5 a second
// and writes the event log). Same-site JSON only, so a form elsewhere cannot use an admin's cookie.
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await loadCurrentUser(); // checks the session is still good (docs/04 "Ending sessions")
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!req.headers.get("content-type")?.startsWith("application/json") || (origin && host && new URL(origin).host !== host)) return Response.json({ error: { code: "forbidden", message: "same-site JSON only" } }, { status: 403 });
  const { name } = await params;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return Response.json({ error: { code: "validation", message: "Minecraft name" } }, { status: 400 });
  const r = await readJson(req);
  if (!r.ok) return readJsonError(r);
  const body = r.body;
  try {
    return Response.json(await apiFetch(`/players/${name}/inventory`, { method: "POST", body, caller: { id: user.id, role: "ADMIN" }, timeoutMs: 15_000 }));
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    return Response.json({ error: { code: "api_error", message: "The site's backend did not answer." } }, { status: 502 });
  }
}

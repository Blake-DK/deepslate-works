import { loadCurrentUser } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";

export const dynamic = "force-dynamic";

// docs/13 §13: the player as they are now (live when online, else the save file), for the editor's refresh.
export async function GET(req: Request) {
  const user = await loadCurrentUser(); // checks the session is still good (docs/04 "Ending sessions")
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const url = new URL(req.url);
  const uuid = url.searchParams.get("uuid") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(uuid) || (name && !/^[A-Za-z0-9_]{3,16}$/.test(name))) return Response.json({ error: { code: "validation", message: "uuid" } }, { status: 400 });
  try {
    return Response.json(await apiFetch(`/players/${uuid}/data?live=1${name ? `&name=${name}` : ""}`, { caller: { id: user.id, role: "ADMIN" }, timeoutMs: 20_000 }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    return Response.json({ error: { code: "api_error", message: "The site's backend did not answer." } }, { status: 502 });
  }
}

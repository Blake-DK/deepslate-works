import { loadCurrentUser } from "@/server/auth/session";
import { apiError, apiRaw } from "@/server/api-client";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Admin only. Passes a file from the game server through (api checks the path, the size and the
// never-shown list, and records the download). docs/16 §3.
export async function GET(req: Request) {
  const user = await loadCurrentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const target = `/files/download?path=${encodeURIComponent(path)}`;
  let res: Response;
  try {
    res = await apiRaw(target, { caller: { id: user.id, role: "ADMIN" }, timeoutMs: 10 * 60_000, signal: req.signal });
  } catch (e) {
    return new Response(`The game server could not be reached: ${e instanceof Error ? e.message : "unknown"}`, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (!res.ok || !res.body) {
    const err = await apiError(target, res);
    return new Response(err.message, { status: err.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
  for (const h of ["content-type", "content-length", "content-disposition"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { headers });
}

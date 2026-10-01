import { loadCurrentUser } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";

export const dynamic = "force-dynamic";

// Admin only (docs/13 §11): one line to the Minecraft console. The api checks the role again, sends it through the
// action `console.send`, writes it into the event log and limits it to 5 a second. JSON only and same origin, so a
// form on another site cannot post here with an admin's cookie.
export async function POST(req: Request) {
  const user = await loadCurrentUser(); // checks the session is still good (docs/04 "Ending sessions")
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!req.headers.get("content-type")?.startsWith("application/json") || (origin && host && new URL(origin).host !== host)) {
    return Response.json({ error: { code: "forbidden", message: "same-site JSON only" } }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { command?: unknown } | null;
  if (typeof body?.command !== "string") return Response.json({ error: { code: "validation", message: "command" } }, { status: 400 });
  try {
    await apiFetch("/console/send", { method: "POST", body: { command: body.command }, caller: { id: user.id, role: "ADMIN" } });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    return Response.json({ error: { code: "api_error", message: "The site's backend did not answer." } }, { status: 502 });
  }
}

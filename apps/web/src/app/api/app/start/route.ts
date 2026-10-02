import { bearer, userFromLauncherToken } from "@/server/launcher";
import { apiFetch, ApiError } from "@/server/api-client";
import { RateLimiter } from "@/server/auth/rate-limit";

export const dynamic = "force-dynamic";

// Planner 2026-10-02: an admin's Start button in Deepslate Works, for a server that is switched off or has crashed (a
// wake never starts those). The same audited start as Admin → Server's Start ("<name> started the server").
const g = globalThis as unknown as { __dwAppStartLimiter?: RateLimiter };
const limiter = (g.__dwAppStartLimiter ??= new RateLimiter(5, 10 * 60_000));

export async function POST(req: Request) {
  const user = await userFromLauncherToken(bearer(req));
  if (!user) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  if (user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "Only an admin can start the server." } }, { status: 403 });
  if (!limiter.allow(user.id)) return Response.json({ error: { code: "rate_limited", message: "Start was pressed a lot. Wait a few minutes." } }, { status: 429 });
  try {
    await apiFetch("/server/start", { method: "POST", body: {}, caller: { id: user.id, role: "ADMIN" }, timeoutMs: 30_000 });
    return Response.json({ result: "started" });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    return Response.json({ error: { code: "api_error", message: "The site's backend did not answer." } }, { status: 502 });
  }
}

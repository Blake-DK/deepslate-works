import { loadCurrentUser } from "@/server/auth/session";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { apiFetch, ApiError } from "@/server/api-client";
import { RateLimiter } from "@/server/auth/rate-limit";

export const dynamic = "force-dynamic";

// docs/13 §12 B: wake on Play. The Play button (a member's session) and DeepslateWorks.ps1 (its launcher token) call
// this the moment Play is pressed; api decides (only from Asleep, only for a member the server is open for, one start
// however often it is pressed) and writes "<name> woke the server (Play)" into the event log.
// GET: how the wake is going, for the "Waking the server…" line.

const g = globalThis as unknown as { __dwWakeLimiter?: RateLimiter };
const limiter = (g.__dwWakeLimiter ??= new RateLimiter(30, 10 * 60_000));

async function who(req: Request) {
  const token = bearer(req);
  if (token) return { user: await userFromLauncherToken(token), viaToken: true };
  return { user: await loadCurrentUser(), viaToken: false };
}

function answer(e: unknown) {
  if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  return Response.json({ error: { code: "api_error", message: "The site's backend did not answer." } }, { status: 502 });
}

export async function POST(req: Request) {
  const { user, viaToken } = await who(req);
  if (!user) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  // with a cookie, only from this site's own pages (a form elsewhere cannot wake the server as somebody)
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!viaToken && origin && host && new URL(origin).host !== host) return Response.json({ error: { code: "forbidden", message: "same-site only" } }, { status: 403 });
  if (!limiter.allow(user.id)) return Response.json({ error: { code: "rate_limited", message: "Too many presses of Play. Wait a few minutes." } }, { status: 429 });
  try {
    return Response.json(await apiFetch("/server/wake", { method: "POST", body: {}, caller: { id: user.id, role: user.role } }));
  } catch (e) {
    return answer(e);
  }
}

export async function GET(req: Request) {
  const { user } = await who(req);
  if (!user) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  try {
    return Response.json(await apiFetch("/server/wake", { caller: { id: user.id, role: user.role } }));
  } catch (e) {
    return answer(e);
  }
}

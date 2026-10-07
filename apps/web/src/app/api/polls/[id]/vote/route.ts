import { loadCurrentUser } from "@/server/auth/session";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { RateLimiter } from "@/server/auth/rate-limit";
import { answerPoll, forClient } from "@/server/polls";
import { readJson, readJsonError } from "@/server/read-json";

export const dynamic = "force-dynamic";

// Planner 2026-10-02: a vote, from the site (a member's session) or from Deepslate Works (its launcher token).
// Changed votes come here too, until the poll closes. The door re-checks every 5 s, so a held member is let in
// within seconds of voting.

const g = globalThis as unknown as { __dwPollLimiter?: RateLimiter };
const limiter = (g.__dwPollLimiter ??= new RateLimiter(30, 10 * 60_000));

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearer(req);
  const user = token ? await userFromLauncherToken(token) : await loadCurrentUser();
  if (!user) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  if (!token) {
    // with a cookie, only from this site's own pages
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return Response.json({ error: { code: "forbidden", message: "same-site only" } }, { status: 403 });
  }
  if (!limiter.allow(user.id)) return Response.json({ error: { code: "rate_limited", message: "Too many votes in a row. Wait a few minutes." } }, { status: 429 });
  const r = await readJson(req);
  if (!r.ok) return readJsonError(r);
  const body = r.body as { choices?: unknown } | null;
  const r = await answerPoll({ id: user.id, role: user.role }, (await params).id, body?.choices);
  if (!r.ok) return Response.json({ error: { code: r.code, message: r.message } }, { status: r.status });
  return Response.json({ poll: forClient(r.poll), changed: r.changed }, { headers: { "cache-control": "no-store" } });
}

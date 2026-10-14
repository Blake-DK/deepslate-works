import { z } from "zod";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { markSeen } from "@/server/announcements";
import { audit } from "@/server/events";
import { RateLimiter } from "@/server/auth/rate-limit";

export const dynamic = "force-dynamic";

// App 3.6.6 (Alex, 2026-10-14): "Seen it" on a must-read news item in Deepslate Works, before Play. Launcher token only.
const g = globalThis as unknown as { __dwNewsSeenLimiter?: RateLimiter };
const limiter = (g.__dwNewsSeenLimiter ??= new RateLimiter(30, 10 * 60_000));

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await userFromLauncherToken(bearer(req));
  if (!user) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  if (!limiter.allow(user.id)) return Response.json({ error: { code: "rate_limited", message: "Too many at once. Wait a few minutes." } }, { status: 429 });
  const id = z.string().min(1).max(40).safeParse((await params).id);
  if (!id.success || !(await markSeen(user.id, id.data))) return Response.json({ error: { code: "not_found", message: "That news item isn't one to confirm any more." } }, { status: 404 });
  await audit({ userId: user.id, action: "announcement.seen", params: { announcementId: id.data }, result: "OK" });
  return Response.json({ result: "seen" });
}

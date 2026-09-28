import { z } from "zod";
import { startLauncherAuth, APPROVAL_WINDOW_MS } from "@/server/launcher";
import { inviteLimiter } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/request";
import { env } from "@/env";

// Public: the installer calls this first. Rate limited per IP.
export async function POST(req: Request) {
  if (!inviteLimiter.allow(await clientIp())) return Response.json({ error: { code: "rate_limited", message: "Too many attempts, wait a minute", retryAfterSec: 60 } }, { status: 429 });
  const body = z.object({ hostname: z.string().max(64).optional() }).safeParse(await req.json().catch(() => ({})));
  const { code, pollToken } = await startLauncherAuth(body.success ? (body.data.hostname ?? null) : null);
  return Response.json({ code, pollToken, url: `${env.AUTH_URL}/launcher/${code}`, expiresInSec: APPROVAL_WINDOW_MS / 1000, pollEverySec: 3 }, { headers: { "cache-control": "no-store" } });
}

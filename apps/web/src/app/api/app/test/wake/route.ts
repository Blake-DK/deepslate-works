import { audit } from "@/server/events";
import { testAppCall } from "@/server/api-client";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { asMissing, testAppConfigured } from "@/server/test-app";

export const dynamic = "force-dynamic";

// docs/45: wake the test server for the app's Test Play. Admins only. Logged here (who, on the live site) and on the
// test server (server.wake, "live admin, through the app's Test section").
export async function POST(req: Request) {
  // the app's launcher token only, never a cookie (routes-origin.test.ts): a page elsewhere cannot make a browser wake it
  const user = await userFromLauncherToken(bearer(req));
  const admin = user && user.role === "ADMIN" ? user : null;
  if (!admin) return asMissing(req);
  if (!testAppConfigured()) return Response.json({ error: { code: "test_off", message: "The test server is switched off." } }, { status: 503 });
  const res = await testAppCall("/test/app/wake", { method: "POST", body: { discordId: admin.discordId ?? null, name: admin.displayName } });
  const body = res ? await res.json().catch(() => ({})) : { error: { code: "test_unreachable", message: "The site can't reach the test server right now." } };
  const status = res ? res.status : 503;
  await audit({ userId: admin.id, action: "test.app.wake", params: { status, result: (body as { result?: string }).result ?? null }, result: res && res.ok ? "OK" : "FAILED" });
  return Response.json(body, { status });
}

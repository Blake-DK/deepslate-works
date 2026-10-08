import { loadCurrentUser } from "@/server/auth/session";
import { testServerSummary } from "@/server/api-client";
import { env } from "@/env";

export const dynamic = "force-dynamic";

// docs/42 §8, the live site: the Control Room's "Test server" card asks here every 20 s while its tab is seen.
// Admins only. 404 while there is no test server to speak of; `{ off: true }` while TEST_STACK is not 1.
export async function GET() {
  const user = await loadCurrentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  if (env.TEST_MODE || !env.TEST_SITE_URL) return Response.json({ error: { code: "not_found", message: "no test server" } }, { status: 404 });
  if (!env.TEST_STACK) return Response.json({ off: true });
  try {
    return Response.json({ off: false, summary: await testServerSummary() });
  } catch (e) {
    return Response.json({ off: false, summary: null, problem: e instanceof Error ? e.message : String(e) });
  }
}

import { testAppCall } from "@/server/api-client";
import { appAdmin, asMissing, testAppConfigured } from "@/server/test-app";
import { testServerText } from "@/lib/server-status";

export const dynamic = "force-dynamic";

// docs/45: the launcher's Test section asks whether to show itself, and what the test server is doing. Admins only:
// anyone else gets what a path that does not exist gives. `available: false` with the reason when the test stack is
// off or cannot be reached; the section then says so and does nothing else.
export async function GET(req: Request) {
  if (!(await appAdmin(req))) return asMissing(req);
  if (!testAppConfigured()) return Response.json({ available: false, reason: "The test server is switched off." }, { headers: { "cache-control": "no-store" } });
  const res = await testAppCall("/test/app/state", { timeoutMs: 5000 });
  if (!res || !res.ok) return Response.json({ available: false, reason: "The site can't reach the test server right now." }, { headers: { "cache-control": "no-store" } });
  const s = (await res.json()) as { state: string; players: string[]; address: string | null; pack: { site: string | null; server: string | null } };
  // 3.6.1: `server`, the test server in the site's words (the app 3.6.1 card); 3.6.0 reads `state` and ignores it
  return Response.json({ available: true, state: s.state, players: s.players.length, address: s.address, pack: s.pack.site, serverPack: s.pack.server, server: testServerText(s.state, s.players.length) }, { headers: { "cache-control": "no-store" } });
}

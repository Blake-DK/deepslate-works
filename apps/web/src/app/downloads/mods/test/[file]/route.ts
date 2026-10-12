import { PRIVATE_JAR } from "modpack/mod-url";
import { testAppCall } from "@/server/api-client";
import { audit } from "@/server/events";
import { appTester, asMissing, testAppConfigured } from "@/server/test-app";

export const dynamic = "force-dynamic";

// docs/58 with docs/45: a private jar of the TEST pack, for the app's Test tab. Admins and testers only (anyone else:
// the missing-page answer, as on /api/app/test/*). Passed through from the test server's api, which hands out only a
// jar its own lock names as private, and only the very file it names; the test server's jar is never kept on live.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const who = await appTester(req);
  if (!who) return asMissing(req);
  if (!PRIVATE_JAR.test(file)) return new Response("Not found", { status: 404 });
  if (!testAppConfigured()) return Response.json({ error: { code: "test_off", message: "The test server is switched off." } }, { status: 503 });
  const res = await testAppCall("/test/app/mod", { query: { file }, timeoutMs: 300_000 });
  if (res && res.status === 404) return new Response("Not found", { status: 404 });
  if (!res || !res.ok || !res.body) return Response.json({ error: { code: "test_unreachable", message: "The test server's mod file can't be fetched right now." } }, { status: 503 });
  await audit({ userId: who.user.id, action: "test.app.mod", params: { file, as: who.as }, result: "OK" });
  const length = res.headers.get("content-length");
  return new Response(res.body, { headers: { "content-type": "application/java-archive", ...(length ? { "content-length": length } : {}), "content-disposition": `attachment; filename="${file}"`, "cache-control": "no-store" } });
}

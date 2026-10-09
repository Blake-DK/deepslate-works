import { notFound } from "next/navigation";
import { testAppCall } from "@/server/api-client";
import { appAdmin, testAppConfigured } from "@/server/test-app";

export const dynamic = "force-dynamic";

// docs/45: the test pack's settings bundle, passed through from the test server's api. Admins only.
export async function GET(req: Request) {
  if (!(await appAdmin(req))) notFound();
  if (!testAppConfigured()) return Response.json({ error: { code: "test_off", message: "The test server is switched off." } }, { status: 503 });
  const res = await testAppCall("/test/app/config.zip", { timeoutMs: 60_000 });
  if (!res || !res.ok || !res.body) return Response.json({ error: { code: "test_unreachable", message: "The test settings bundle can't be fetched right now." } }, { status: 503 });
  return new Response(res.body, { headers: { "content-type": "application/zip", ...(res.headers.get("content-length") ? { "content-length": res.headers.get("content-length")! } : {}), "cache-control": "no-store" } });
}

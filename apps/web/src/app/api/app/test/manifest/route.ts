import type { LockFile, Manifest } from "modpack";
import { env } from "@/env";
import { audit } from "@/server/events";
import { testAppCall } from "@/server/api-client";
import { getBranding, readLogoBase64 } from "@/server/branding";
import { getInstaller } from "@/server/modpack/lock";
import { appTester, asMissing, testAppConfigured, testManifest } from "@/server/test-app";
import { installerFor } from "@/shared/installer-info";

export const dynamic = "force-dynamic";

// docs/45: the test pack for the app's Test Play, in the shape of /api/modpack/manifest. Admins and testers only (docs/57;
// anyone else: the missing-page answer). The pack and the address come from the test server's api; the app's own update offer and the
// logo are the live site's, so the app stays on the live channel.
export async function GET(req: Request) {
  const who = await appTester(req);
  if (!who) return asMissing(req);
  const user = who.user;
  if (!testAppConfigured()) return Response.json({ error: { code: "test_off", message: "The test server is switched off." } }, { status: 503 });
  const [packRes, stateRes] = await Promise.all([testAppCall("/test/app/pack"), testAppCall("/test/app/state", { timeoutMs: 5000 })]);
  if (!packRes || !packRes.ok) return Response.json({ error: { code: "test_unreachable", message: "The site can't reach the test server right now." } }, { status: 503 });
  const pack = (await packRes.json()) as { mods: Manifest; lock: LockFile };
  const state = stateRes && stateRes.ok ? ((await stateRes.json()) as { address: string | null }) : { address: null };
  const [installerInfo, brand] = await Promise.all([getInstaller(), getBranding()]);
  const body = testManifest({
    mods: pack.mods,
    lock: pack.lock,
    address: state.address,
    installer: installerFor(installerInfo, req.headers.get("user-agent")),
    branding: brand.generated ? { hash: brand.generated.hash, name: brand.name, tagline: brand.tagline, pixel: brand.generated.pixel, icon128: await readLogoBase64(128) } : null,
    tier: user.pcTier ?? null,
    configUrl: `${env.AUTH_URL}/api/app/test/config.zip`,
    site: env.AUTH_URL,
  });
  await audit({ userId: user.id, action: "test.app.manifest", params: { version: body.version, files: body.files.filter((f) => f.side !== "server").length, as: who.as }, result: "OK" });
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

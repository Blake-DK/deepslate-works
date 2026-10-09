import "server-only";
import { notFound } from "next/navigation";
import type { LockFile, Manifest } from "modpack";
import { distancesFor, serverViewDistance } from "modpack/schema";
import { env } from "@/env";
import { bearer, userFromLauncherToken } from "@/server/launcher";

// The launcher's Test section, version one (planner and Alex, 2026-10-09; docs/45): admins only.
//
// The app asks the LIVE site, with its own launcher token, under /api/app/test/*. Every route there first finds the user
// behind the token and reads their role from the database (the token's row includes the user as the database has it
// now); anyone else gets exactly what a path that does not exist gives (notFound()). The live site then asks the test
// server's api on the admin's behalf with TEST_APP_TOKEN (api-client.ts testAppCall), which never reaches the app.

/** The test game folder and launcher profile: beside the live ones, named so they cannot be taken for live. */
export const TEST_PROFILE = { id: "deepslate-works-test", name: "Deepslate Works TEST", dir: ".minecraft-deepslate-works-test" } as const;

/** The admin behind the app's launcher token, or null (not signed in, not approved, or not an admin). */
export async function appAdmin(req: Request) {
  const user = await userFromLauncherToken(bearer(req));
  return user && user.role === "ADMIN" ? user : null;
}

/** What the middleware answers an app (no session cookie) on a path that does not exist: the same, word for word. */
export const MISSING_FOR_APP = { error: { code: "unauthorized", message: "Sign in first" } } as const;

/**
 * The answer for anyone who is not an admin: exactly what a path that does not exist gives this request. An app (a
 * launcher token, no session cookie) gets the middleware's 401; a signed-in browser gets Next's 404 (notFound()).
 */
export function asMissing(req: Request): Response {
  if (/(^|;\s*)(__Secure-)?[a-z.]*session-token(\.\d+)?=/.test(req.headers.get("cookie") ?? "")) notFound();
  return Response.json(MISSING_FOR_APP, { status: 401 });
}

/** Whether the live site can reach a test server for the app at all (the test stack on, the token set). */
export const testAppConfigured = () => !env.TEST_MODE && env.TEST_STACK && Boolean(env.TEST_APP_TOKEN) && env.TEST_APP_TOKEN.length >= 32;

export type TestManifestInputs = {
  mods: Manifest;
  lock: LockFile;
  /** The test server's game address (the test api's SERVER_ADDRESS); null: the test pack's own server_address. */
  address: string | null;
  /** The live site's own `installer` entry: the app keeps updating itself from the live channel only. */
  installer: unknown;
  branding: unknown;
  tier: string | null;
  /** Where the app fetches the test settings bundle: the live site's own route, never the test stack. */
  configUrl: string;
};

/**
 * The test pack as the app's Play reads a pack: the same shape as /api/modpack/manifest, built the same way, with four
 * things changed: the test lock, the test address, the test folder and profile (TEST_PROFILE), and the test settings
 * bundle. `test: true` says so, and the app's own update stays on the live channel (`installer` is live's).
 */
export function testManifest(i: TestManifestInputs) {
  const dist = distancesFor(i.mods, i.tier);
  return {
    test: true,
    name: `${i.mods.name} TEST`,
    version: `${i.mods.version}+${i.lock.hash.slice(0, 8)}`,
    hash: i.lock.hash,
    generatedAt: i.lock.generatedAt,
    minecraft: i.lock.minecraft,
    neoforge: i.lock.neoforge,
    server_address: i.address ?? i.mods.server_address,
    profile: { ...i.mods.profile, id: TEST_PROFILE.id, dir: TEST_PROFILE.dir, name: TEST_PROFILE.name },
    ram: i.mods.ram,
    render_distance: dist.render,
    simulation_distance: dist.simulation,
    server_view_distance: serverViewDistance(i.mods.server_properties),
    tier: i.tier ?? null,
    config_url: i.lock.configs.length ? i.configUrl : null,
    files: i.lock.files.map((f) => ({ slug: f.slug, name: f.name, filename: f.filename, url: f.url, sha512: f.sha512, size: f.size, side: f.side })),
    configs: i.lock.configs,
    installer: i.installer,
    branding: i.branding,
  };
}

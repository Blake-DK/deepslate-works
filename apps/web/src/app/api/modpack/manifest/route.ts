import { getManifest, serverAddress } from "@/server/modpack/manifest";
import { distancesFor, serverViewDistance } from "modpack/schema";
import { getInstaller, getLock } from "@/server/modpack/lock";
import { installerFor } from "@/shared/installer-info";
import { loadCurrentUser } from "@/server/auth/session";
import { canDownload, manifestKeyOk } from "@/server/modpack/gate";
import { env } from "@/env";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { logDownload } from "@/server/download-log";
import { viaOf } from "@/lib/download-log";
import { getBranding, readLogoBase64 } from "@/server/branding";

// Gated: a launcher token or a session that may download (admin, or player while live and the server is online),
// or the admin-only MANIFEST_KEY. Not cached beyond the client.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  let who: string | null = null;
  let tier: string | null = null;
  let via = viaOf(false, manifestKeyOk(key));
  if (!manifestKeyOk(key)) {
    // The installer/updater authenticates with its launcher token (approved in the browser after a Discord login).
    const fromToken = await userFromLauncherToken(bearer(req));
    const user = fromToken ?? (await loadCurrentUser());
    who = user?.id ?? null;
    tier = user?.pcTier ?? null;
    via = viaOf(Boolean(fromToken), false);
    const gate = await canDownload(user);
    if (!gate.ok && gate.reason !== "anonymous") await logDownload({ userId: who, what: "modlist", via, file: "mod list", refused: gate.reason === "not_live" ? "not_live" : "server_offline" });
    if (!gate.ok) {
      const code = gate.reason === "anonymous" ? "unauthorized" : gate.reason === "not_live" ? "not_live" : "server_offline";
      const message = gate.reason === "anonymous" ? "Sign in first" : gate.reason === "not_live" ? "Not launched yet" : "Downloads open when the server is online";
      return Response.json({ error: { code, message } }, { status: gate.reason === "anonymous" ? 401 : 403 });
    }
  }
  const [m, lock, installerInfo, brand] = await Promise.all([getManifest(), getLock(), getInstaller(), getBranding()]);
  const installer = installerFor(installerInfo, req.headers.get("user-agent"));
  if (!lock) return Response.json({ error: { code: "no_lock", message: "Pack not built yet" } }, { status: 503 });
  // The member's measured PC tier picks the distances (mods.json render_by_tier); as plain numbers, which every
  // installer reads. Only a first install and a value the installer set itself are changed (docs/07).
  const dist = distancesFor(m, tier);
  const k = key && manifestKeyOk(key) ? `?key=${encodeURIComponent(key)}` : "";
  const body = {
    name: m.name,
    version: `${m.version}+${lock.hash.slice(0, 8)}`,
    hash: lock.hash,
    generatedAt: lock.generatedAt,
    minecraft: lock.minecraft,
    neoforge: lock.neoforge,
    server_address: serverAddress(m),
    profile: m.profile,
    ram: m.ram,
    render_distance: dist.render,
    simulation_distance: dist.simulation,
    // docs/30 §4.2: the server's own view distance as mods.json expects it, so the app's Settings tab can say "the server
    // shows 12 chunks"; null when mods.json does not say
    server_view_distance: serverViewDistance(m.server_properties),
    tier: tier ?? null,
    config_url: lock.configs.length ? `${env.AUTH_URL}/downloads/config.zip${k}` : null,
    files: lock.files.map((f) => ({ slug: f.slug, name: f.name, filename: f.filename, url: f.url, sha512: f.sha512, size: f.size, side: f.side })),
    configs: lock.configs,
    // docs/07 "The installer updates itself": which installer is current, and the checksum of its zip. No address:
    // the installer fetches it from /downloads on the site it was built for, and from nowhere else. The old launcher
    // sees the app as `app` (2.2.0 asks first), never as `exe` (2.1.3 would move without asking): installerFor.
    installer,
    // the chosen logo (planner, 2026-10-01): the app puts it on the launcher profile (128 px PNG) and fetches the
    // .ico from /brand/logo.ico?v=<hash> on its own site; null until a logo is picked
    branding: brand.generated ? { hash: brand.generated.hash, name: brand.name, tagline: brand.tagline, pixel: brand.generated.pixel, icon128: await readLogoBase64(128) } : null,
  };
  await logDownload({ userId: who, what: "modlist", via, file: "mod list", version: body.version, files: body.files.filter((f) => f.side !== "server").length });
  return Response.json(body, { headers: { "cache-control": "private, max-age=60" } });
}

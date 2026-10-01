import { getManifest } from "@/server/modpack/manifest";
import { distancesFor } from "modpack/schema";
import { NO_EXTRAS, packFor, visualChoice } from "modpack/visuals";
import { getInstaller, getLock } from "@/server/modpack/lock";
import { loadCurrentUser } from "@/server/auth/session";
import { canDownload, manifestKeyOk } from "@/server/modpack/gate";
import { env } from "@/env";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { logDownload } from "@/server/download-log";
import { viaOf } from "@/lib/download-log";

// Gated: a launcher token or a session that may download (admin, or player while live and the server is online),
// or the admin-only MANIFEST_KEY. Not cached beyond the client.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  let who: string | null = null;
  let tier: string | null = null;
  let choice = NO_EXTRAS;
  let via = viaOf(false, manifestKeyOk(key));
  if (!manifestKeyOk(key)) {
    // The installer/updater authenticates with its launcher token (approved in the browser after a Discord login).
    const fromToken = await userFromLauncherToken(bearer(req));
    const user = fromToken ?? (await loadCurrentUser());
    who = user?.id ?? null;
    tier = user?.pcTier ?? null;
    choice = visualChoice(user);
    via = viaOf(Boolean(fromToken), false);
    const gate = await canDownload(user);
    if (!gate.ok && gate.reason !== "anonymous") await logDownload({ userId: who, what: "modlist", via, file: "mod list", refused: gate.reason === "not_live" ? "not_live" : "server_offline" });
    if (!gate.ok) {
      const code = gate.reason === "anonymous" ? "unauthorized" : gate.reason === "not_live" ? "not_live" : "server_offline";
      const message = gate.reason === "anonymous" ? "Sign in first" : gate.reason === "not_live" ? "Not launched yet" : "Downloads open when the server is online";
      return Response.json({ error: { code, message } }, { status: gate.reason === "anonymous" ? 401 : 403 });
    }
  }
  const [m, lock, installer] = await Promise.all([getManifest(), getLock(), getInstaller()]);
  if (!lock) return Response.json({ error: { code: "no_lock", message: "Pack not built yet" } }, { status: 503 });
  // The member's measured PC tier picks the distances (mods.json render_by_tier); as plain numbers, which every
  // installer reads. Only a first install and a value the installer set itself are changed (docs/07).
  const dist = distancesFor(m, tier);
  const k = key && manifestKeyOk(key) ? `?key=${encodeURIComponent(key)}` : "";
  // The member's own choice of visual extras (Me page): optional mods only for them, resource and shader packs apart
  // from `files`, so that an installer from before 1.6.0 never puts a .zip among the mods.
  const pack = packFor(lock, choice);
  const info = (f: (typeof lock.files)[number]) => ({ slug: f.slug, filename: f.filename, url: f.url, sha512: f.sha512, size: f.size });
  const body = {
    name: m.name,
    version: `${m.version}+${lock.hash.slice(0, 8)}`,
    hash: lock.hash,
    generatedAt: lock.generatedAt,
    minecraft: lock.minecraft,
    neoforge: lock.neoforge,
    server_address: m.server_address,
    profile: m.profile,
    ram: m.ram,
    render_distance: dist.render,
    simulation_distance: dist.simulation,
    tier: tier ?? null,
    config_url: lock.configs.length ? `${env.AUTH_URL}/downloads/config.zip${k}` : null,
    files: pack.mods.map((f) => ({ ...info(f), side: f.side })),
    visuals: {
      extras: choice.extras,
      shader: choice.shader,
      resourcepacks: pack.resourcepacks.map(info),
      shaderpack: pack.shaderpack ? info(pack.shaderpack) : null,
      known: pack.known,
    },
    configs: lock.configs,
    // docs/07 "The installer updates itself": which installer is current, and the checksum of its zip. No address:
    // the installer fetches it from /downloads on the site it was built for, and from nowhere else.
    installer,
  };
  await logDownload({ userId: who, what: "modlist", via, file: "mod list", version: body.version, files: body.files.filter((f) => f.side !== "server").length });
  return Response.json(body, { headers: { "cache-control": "private, max-age=60" } });
}

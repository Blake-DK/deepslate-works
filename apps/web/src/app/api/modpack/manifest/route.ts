import { getManifest } from "@/server/modpack/manifest";
import { getLock } from "@/server/modpack/lock";
import { loadCurrentUser } from "@/server/auth/session";
import { canDownload, manifestKeyOk } from "@/server/modpack/gate";
import { env } from "@/env";

// Gated: a session that may download (admin, or player while the server is online), or the private key
// the Windows installer carries. Cache 60 s per client.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!manifestKeyOk(key)) {
    const user = await loadCurrentUser();
    const gate = await canDownload(user);
    if (!gate.ok) {
      const code = gate.reason === "anonymous" ? "unauthorized" : gate.reason === "not_live" ? "not_live" : "server_offline";
      const message = gate.reason === "anonymous" ? "Sign in first" : gate.reason === "not_live" ? "Not launched yet" : "Downloads open when the server is online";
      return Response.json({ error: { code, message } }, { status: gate.reason === "anonymous" ? 401 : 403 });
    }
  }
  const [m, lock] = await Promise.all([getManifest(), getLock()]);
  if (!lock) return Response.json({ error: { code: "no_lock", message: "Pack not built yet" } }, { status: 503 });
  const k = key && manifestKeyOk(key) ? `?key=${encodeURIComponent(key)}` : "";
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
    render_distance: 8,
    simulation_distance: 6,
    config_url: lock.configs.length ? `${env.AUTH_URL}/downloads/config.zip${k}` : null,
    files: lock.files.map((f) => ({ slug: f.slug, filename: f.filename, url: f.url, sha512: f.sha512, size: f.size, side: f.side })),
    configs: lock.configs,
  };
  return Response.json(body, { headers: { "cache-control": "private, max-age=60" } });
}

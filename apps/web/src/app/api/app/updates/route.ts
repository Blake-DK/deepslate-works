import { readFile } from "node:fs/promises";
import type { ExtrasLock } from "modpack/extras";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { getInstaller, getLock, P } from "@/server/modpack/lock";
import { installerFor } from "@/lib/installer-info";
import { getSection } from "@/server/site-settings";
import { canSeeServer, getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

// App 3.3.0 (planner 2026-10-02): the Update button's check, when the app opens and every 10 minutes while it is open.
// Only what it compares, never an address to fetch from: the pack's files (filename and SHA-512) and settings files, the
// current app, the extras' files. Not a download, so nothing is logged and the server may be asleep or switched off;
// the Update itself goes through the mod list as Play does.
export async function GET(req: Request) {
  const user = await userFromLauncherToken(bearer(req));
  if (!user) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  // docs/35 R-41: before "We're live" the pack's file list is not for players, here as in the mod list (same answer)
  if (!canSeeServer(user, await getSettings())) return Response.json({ error: { code: "not_live", message: "Not launched yet" } }, { status: 403 });
  const [lock, info, joining, extras] = await Promise.all([
    getLock(),
    getInstaller(),
    getSection("joining"),
    readFile(P.extrasLock, "utf8").then((t) => JSON.parse(t) as ExtrasLock).catch(() => null),
  ]);
  if (!lock) return Response.json({ error: { code: "no_lock", message: "The pack hasn't been built yet" } }, { status: 503 });
  const offer = installerFor(info, req.headers.get("user-agent"), joining.minInstaller);
  return Response.json(
    {
      pack: {
        hash: lock.hash,
        files: lock.files.filter((f) => f.side !== "server").map((f) => ({ filename: f.filename, sha512: f.sha512 })),
        configs: lock.configs,
      },
      app: { version: offer?.exe?.version ?? null },
      extras: extras ? extras.extras.flatMap((x) => x.files.map((f) => f.sha512)) : [],
    },
    { headers: { "cache-control": "no-store" } },
  );
}

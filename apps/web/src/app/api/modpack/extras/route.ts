import { readFile, stat } from "node:fs/promises";
import { extrasForApp, type ExtrasLock } from "modpack/extras";
import { loadCurrentUser } from "@/server/auth/session";
import { canDownload } from "@/server/modpack/gate";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { P } from "@/server/modpack/lock";

// The app's Extras tab (planner, 2026-10-01): personal, client-only extras, apart from the pack. Gated like the mod
// list (the app's launcher token, or a session that may download). The files themselves come from Modrinth.
let cache: { mtimeMs: number; body: ReturnType<typeof extrasForApp> } | null = null;

export async function GET(req: Request) {
  const user = (await userFromLauncherToken(bearer(req))) ?? (await loadCurrentUser());
  const gate = await canDownload(user);
  if (!gate.ok) {
    const code = gate.reason === "anonymous" ? "unauthorized" : gate.reason === "not_live" ? "not_live" : "server_offline";
    return Response.json({ error: { code, message: gate.reason === "anonymous" ? "Sign in first" : "Not available right now" } }, { status: gate.reason === "anonymous" ? 401 : 403 });
  }
  try {
    const { mtimeMs } = await stat(P.extrasLock);
    if (!cache || cache.mtimeMs !== mtimeMs) cache = { mtimeMs, body: extrasForApp(JSON.parse(await readFile(P.extrasLock, "utf8")) as ExtrasLock) };
  } catch {
    return Response.json({ error: { code: "no_extras", message: "No extras locked yet" } }, { status: 503 });
  }
  return Response.json(cache.body, { headers: { "cache-control": "private, max-age=300" } });
}

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { loadCurrentUser } from "@/server/auth/session";
import { canDownload } from "@/server/modpack/gate";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { getLock } from "@/server/modpack/lock";
import { privateJar } from "@/server/modpack/private-jars";
import { logDownload } from "@/server/download-log";
import { viaOf } from "@/lib/download-log";

export const dynamic = "force-dynamic";

// docs/58: a mod's private jar (a patched build, never published anywhere else), for the app and for nobody outside.
// Gated like the mod list: the app's launcher token or a signed-in member; admins always, players while downloads are
// open to them. Only a jar the pack this server ships names as private, and only the very file it names: anything
// else is a 404. No sign-in page for a browser: this is the app's file, so nobody signed in gets a plain 401.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const fromToken = await userFromLauncherToken(bearer(req));
  const user = fromToken ?? (await loadCurrentUser());
  const via = viaOf(Boolean(fromToken), false);
  const gate = await canDownload(user);
  const logged = `mods/${file.slice(0, 160)}`;
  if (!user || gate.reason === "anonymous") return Response.json({ error: { code: "unauthorized", message: bearer(req) ? "launcher token invalid or expired" : "Sign in first" } }, { status: 401 });
  if (!gate.ok) {
    await logDownload({ userId: user.id, what: "file", via, file: logged, refused: gate.reason === "not_live" ? "not_live" : "server_offline" });
    return Response.json({ error: { code: gate.reason === "not_live" ? "not_live" : "server_offline", message: gate.reason === "not_live" ? "Not launched yet" : "Downloads open when the server is online" } }, { status: 403 });
  }
  const jar = await privateJar(await getLock(), file);
  if (!jar.ok) {
    if (jar.why !== "not_in_lock") console.error(`downloads/mods: ${file} is in the lock but ${jar.why === "missing" ? "not in data/private-jars/" : "the file in data/private-jars/ is not the one the lock names"} (docs/58)`);
    return new Response("Not found", { status: 404 });
  }
  await logDownload({ userId: user.id, what: "file", via, file: logged, size: jar.size, version: jar.version });
  return new Response(Readable.toWeb(createReadStream(jar.file)) as ReadableStream, {
    headers: {
      "content-type": "application/java-archive",
      "content-length": String(jar.size),
      "content-disposition": `attachment; filename="${file}"`,
      "last-modified": jar.mtime.toUTCString(),
      "cache-control": "private, no-store",
    },
  });
}

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { redirect } from "next/navigation";
import { distFile } from "@/server/modpack/lock";
import { loadCurrentUser } from "@/server/auth/session";
import { canDownload, manifestKeyOk } from "@/server/modpack/gate";
import { bearer, userFromLauncherToken } from "@/server/launcher";

const TYPES: Record<string, string> = { ".mrpack": "application/x-modrinth-modpack+zip", ".zip": "application/zip" };
const ALLOWED = new Set(["installer.zip", "client.mrpack", "config.zip"]);

// Gated like the manifest: admin, or player while the server is online; config.zip also with the installer's key.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!ALLOWED.has(file)) return new Response("Not found", { status: 404 });
  const key = new URL(req.url).searchParams.get("key");
  if (!(file === "config.zip" && manifestKeyOk(key))) {
    const fromToken = await userFromLauncherToken(bearer(req));
    const user = fromToken ?? (await loadCurrentUser());
    const gate = await canDownload(user);
    if (gate.reason === "anonymous") {
      if (bearer(req)) return Response.json({ error: { code: "unauthorized", message: "launcher token invalid or expired" } }, { status: 401 });
      redirect(`/login?next=${encodeURIComponent(`/downloads/${file}`)}`);
    }
    if (!gate.ok && fromToken) return Response.json({ error: { code: gate.reason === "not_live" ? "not_live" : "server_offline", message: gate.reason === "not_live" ? "Not launched yet" : "Downloads open when the server is online" } }, { status: 403 });
    if (!gate.ok) redirect(gate.reason === "not_live" ? "/install" : "/install?offline=1");
  }
  const f = await distFile(file);
  if (!f) return new Response("Not built yet", { status: 404 });
  const ext = file.slice(file.lastIndexOf("."));
  return new Response(Readable.toWeb(createReadStream(f.file)) as ReadableStream, {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-length": String(f.size),
      "content-disposition": `attachment; filename="${file}"`,
      "last-modified": f.mtime.toUTCString(),
      "cache-control": "private, no-store",
    },
  });
}

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { redirect } from "next/navigation";
import { distFile } from "@/server/modpack/lock";
import { loadCurrentUser } from "@/server/auth/session";
import { canDownload, manifestKeyOk } from "@/server/modpack/gate";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { getInstaller, getLock } from "@/server/modpack/lock";
import { getManifest } from "@/server/modpack/manifest";
import { logDownload } from "@/server/download-log";
import { viaOf } from "@/lib/download-log";

const TYPES: Record<string, string> = { ".zip": "application/zip", ".ps1": "text/plain; charset=utf-8", ".exe": "application/vnd.microsoft.portable-executable" };
// Windows only since 2026-09-29: no client.mrpack. DeepslateWorks.ps1 on its own is what an installed copy fetches to
// update itself (installer 1.5.0, docs/07 "Updates").
// DeepslateWorks.exe (3.0): the app itself, the download button's file, and what a 3.x copy or the 2.x bridge fetches.
const ALLOWED = new Set(["installer.zip", "config.zip", "DeepslateWorks.ps1", "DeepslateWorks.exe"]);

// Gated like the manifest: admin, or player while the server is online; config.zip also with the installer's key.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!ALLOWED.has(file)) return new Response("Not found", { status: 404 });
  const key = new URL(req.url).searchParams.get("key");
  const withKey = file === "config.zip" && manifestKeyOk(key);
  let who: string | null = null;
  let via = viaOf(false, withKey);
  if (!withKey) {
    const fromToken = await userFromLauncherToken(bearer(req));
    const user = fromToken ?? (await loadCurrentUser());
    who = user?.id ?? null;
    via = viaOf(Boolean(fromToken), false);
    const gate = await canDownload(user);
    if (!gate.ok && gate.reason !== "anonymous") await logDownload({ userId: who, what: "file", via, file, refused: gate.reason === "not_live" ? "not_live" : "server_offline" });
    if (gate.reason === "anonymous") {
      if (bearer(req)) return Response.json({ error: { code: "unauthorized", message: "launcher token invalid or expired" } }, { status: 401 });
      redirect(`/login?next=${encodeURIComponent(`/downloads/${file}`)}`);
    }
    if (!gate.ok && fromToken) return Response.json({ error: { code: gate.reason === "not_live" ? "not_live" : "server_offline", message: gate.reason === "not_live" ? "Not launched yet" : "Downloads open when the server is online" } }, { status: 403 });
    if (!gate.ok) redirect(gate.reason === "not_live" ? "/help" : "/help?offline=1");
  }
  const f = await distFile(file);
  if (!f) return new Response("Not built yet", { status: 404 });
  const [installer, lock, manifest] = await Promise.all([getInstaller(), getLock(), getManifest()]).catch(() => [null, null, null] as const);
  await logDownload({ userId: who, what: "file", via, file, size: f.size, version: file === "DeepslateWorks.exe" ? (installer?.exe?.version ?? null) : file === "installer.zip" || file === "DeepslateWorks.ps1" ? (installer?.version ?? null) : lock && manifest ? `${manifest.version}+${lock.hash.slice(0, 8)}` : null });
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

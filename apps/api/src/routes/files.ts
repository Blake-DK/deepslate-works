import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Amp } from "../amp/client.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../audit.js";
import { getSection } from "../settings.js";
import { chunks, FileError, list, preview, stat } from "../files/browse.js";
import { contentType, downloadName } from "../files/paths.js";

// docs/16 §3: GET only. Admin only. Every download is recorded.
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof FileError) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
  return reply.code(502).send({ error: { code: "amp_error", message: e instanceof Error ? e.message : String(e) } });
}

export function fileRoutes(app: FastifyInstance, amp: Amp) {
  app.get("/files/list", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const f = await getSection("files");
      return await list(amp, (req.query as { dir?: string }).dir ?? "", f.denied);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/files/read", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const f = await getSection("files");
      return await preview(amp, (req.query as { path?: string }).path, f.denied, f.maxPreviewKb * 1024);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/files/download", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const asked = (req.query as { path?: string }).path ?? "";
    try {
      const f = await getSection("files");
      const entry = await stat(amp, asked, f.denied);
      const cap = f.maxDownloadMb * 1024 * 1024;
      if (entry.size > cap) throw new FileError("too_large", `"${entry.name}" is ${(entry.size / 1048576).toFixed(1)} MB; the portal hands out files up to ${f.maxDownloadMb} MB. Use AMP or SFTP for this one.`, 413);
      await audit({ userId: req.caller.userId, action: "files.download", params: { path: entry.path, size: entry.size }, result: "OK" });
      return reply
        .header("content-type", contentType(entry.name))
        .header("content-length", String(entry.size))
        .header("content-disposition", `attachment; filename="${downloadName(entry.name)}"`)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        .send(Readable.from(chunks(amp, entry.path, entry.size, cap)));
    } catch (e) {
      const code = e instanceof FileError ? e.code : "amp_error";
      await audit({ userId: req.caller.userId, action: "files.download", params: { path: String(asked).slice(0, 400) }, result: code === "forbidden" ? "DENIED" : "FAILED", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      return fail(reply, e);
    }
  });
}

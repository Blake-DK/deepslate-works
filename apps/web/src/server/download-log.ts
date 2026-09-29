import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { actionOf, SAME_DOWNLOAD_MS, type Refusal, type Via } from "@/lib/download-log";

type Entry = { userId: string | null; what: "file" | "modlist"; via: Via; file: string; size?: number | null; version?: string | null; files?: number | null; refused?: Refusal | null };

/**
 * One line in the event log for a download, or for one that was refused. The same person fetching the same
 * thing again within two minutes is counted on the line that is there. Never stands in the way of the download:
 * a log that cannot be written is a line in the server's own log.
 */
export async function logDownload(e: Entry): Promise<void> {
  try {
    const action = actionOf(e.what, e.via);
    const result = e.refused ? "DENIED" : "OK";
    const before = await db.event.findFirst({
      where: { kind: "DOWNLOAD", actor: e.userId, at: { gte: new Date(Date.now() - SAME_DOWNLOAD_MS) }, AND: [{ meta: { path: ["action"], equals: action } }, { meta: { path: ["params", "file"], equals: e.file } }, { meta: { path: ["result"], equals: result } }] },
      orderBy: { at: "desc" },
      select: { id: true },
    });
    if (before) {
      await db.event.update({ where: { id: before.id }, data: { count: { increment: 1 } } });
      return;
    }
    await audit({ userId: e.userId, action, params: { file: e.file, via: e.via, size: e.size ?? null, version: e.version ?? null, files: e.files ?? null, refused: e.refused ?? null }, result });
  } catch (err) {
    console.error("download log failed", String(err));
  }
}

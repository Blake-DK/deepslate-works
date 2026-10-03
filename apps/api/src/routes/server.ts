import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleEntry, ConsoleEvent, ConsoleTail } from "../amp/console.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../audit.js";
import type { RestartSchedule } from "../status/restart.js";
import { BackupBusy, type BackupWatch } from "../status/backup-watch.js";

// As AMP names them (Core.GetPermissionsSpec on the live instance, 2026-09-29). The plugin is called
// LocalFileBackupPlugin, its permissions live under LocalFileBackup. Delete and Restore sit next to
// these two; the portal never asks for them and has no code that calls them.
export const BACKUP_PERMISSION = "LocalFileBackup.Backup.CreateBackup";
export const BACKUP_LIST_PERMISSION = "LocalFileBackup.Backup.ViewBackupsList";

export type BackupRow = { id: string | null; name: string; at: string | null; sizeBytes: number | null; sticky: boolean; automatic: boolean };

/** AMP's backup list, whatever exactly it calls the fields: only what is recognised is passed on. */
export function readBackups(raw: unknown): BackupRow[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r) => ({
      id: str(r.Id) ?? str(r.ID) ?? str(r.BackupId),
      name: (str(r.Name) ?? str(r.Title) ?? "Backup").slice(0, 120),
      at: str(r.Timestamp) ?? str(r.TakenAt) ?? str(r.Created) ?? str(r.Date),
      sizeBytes: num(r.TotalSizeBytes) ?? num(r.SizeBytes) ?? num(r.Size),
      sticky: r.Sticky === true,
      automatic: r.WasCreatedAutomatically === true || r.CreatedAutomatically === true,
    }))
    .slice(0, 50);
}

export type StreamEvent = ConsoleEntry | { hb: 1; state: number };

/** Backlog after `since`, then every new console line as it arrives, a heartbeat every 15 s, ends after `maxMs`. */
export async function* consoleStream(tail: ConsoleTail, since: number, opts: { maxMs?: number; heartbeatMs?: number } = {}): AsyncGenerator<StreamEvent> {
  const deadline = Date.now() + (opts.maxMs ?? 10 * 60_000);
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  let last = since;
  let wake: (() => void) | null = null;
  const onEvent = (e: ConsoleEvent) => {
    if (e.type === "line") wake?.();
  };
  tail.on(onEvent);
  try {
    for (;;) {
      const fresh = tail.after(last, 200);
      for (const e of fresh) {
        last = e.seq;
        yield e;
      }
      const left = deadline - Date.now();
      if (left <= 0) return;
      let timer: NodeJS.Timeout | undefined;
      const woke = await new Promise<boolean>((resolve) => {
        wake = () => resolve(true);
        timer = setTimeout(() => resolve(false), Math.min(heartbeatMs, left));
      });
      clearTimeout(timer);
      wake = null;
      if (!woke && Date.now() < deadline) yield { hb: 1, state: tail.state };
    }
  } finally {
    tail.off(onEvent);
  }
}

export function serverRoutes(app: FastifyInstance, amp: Amp, tail: ConsoleTail, restarts: RestartSchedule, backups: BackupWatch) {
  app.get("/server/schedule", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { restart: restarts.current };
  });

  app.post("/server/restart-in", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ minutes: z.number().int().min(1).max(120) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "minutes: 1 to 120" } });
    if (tail.state !== 20) return reply.code(409).send({ error: { code: "server_offline", message: "The server isn't running" } });
    return { restart: restarts.schedule(body.data.minutes, req.caller.userId) };
  });

  app.delete("/server/schedule", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { cancelled: await restarts.cancel(req.caller.userId) };
  });

  app.get("/server/backup", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const has = (node: string) => (amp.hasPermission ? amp.hasPermission(node) : amp.call<boolean>("Core", "CurrentSessionHasPermission", { PermissionNode: node }).then((v) => v === true)).catch(() => false);
    const [allowed, canList] = await Promise.all([has(BACKUP_PERMISSION), has(BACKUP_LIST_PERMISSION)]);
    const stops = canList ? await amp.call<unknown>("LocalFileBackupPlugin", "BackupWillStopServer").catch(() => null) : null;
    const list = canList ? await amp.call<unknown>("LocalFileBackupPlugin", "GetBackups").catch(() => null) : null;
    return { allowed, canList, stopsServer: typeof stops === "boolean" ? stops : null, permission: BACKUP_PERMISSION, listPermission: BACKUP_LIST_PERMISSION, backups: readBackups(list), job: backups.job };
  });

  app.post("/server/backup", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const allowed = await (amp.hasPermission ? amp.hasPermission(BACKUP_PERMISSION) : amp.call<boolean>("Core", "CurrentSessionHasPermission", { PermissionNode: BACKUP_PERMISSION })).catch(() => false);
    if (allowed !== true) {
      await audit({ userId: req.caller.userId, action: "server.backup", params: {}, result: "DENIED", detail: "AMP permission missing" });
      return reply.code(403).send({ error: { code: "forbidden", message: `AMP's webapp user may not take backups. Grant it "${BACKUP_PERMISSION}" in AMP, or use AMP's own backup schedule.` } });
    }
    // The answer is the job, not the backup: it counts once AMP lists it (status/backup-watch.ts).
    try {
      const job = await backups.start(req.caller.userId);
      return reply.code(job.phase === "failed" ? 502 : 202).send(job.phase === "failed" ? { error: { code: "amp_error", message: job.reason }, job } : { job });
    } catch (e) {
      if (e instanceof BackupBusy) return reply.code(409).send({ error: { code: "busy", message: e.message }, job: backups.job });
      const detail = e instanceof Error ? e.message : String(e);
      await audit({ userId: req.caller.userId, action: "server.backup", params: {}, result: "FAILED", detail });
      return reply.code(502).send({ error: { code: "amp_error", message: detail } });
    }
  });

  // Newline-delimited JSON, one console entry per line. Admin only; players never reach the console.
  app.get("/console/stream", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const since = Math.max(0, Number((req.query as { since?: string }).since ?? 0) || 0);
    async function* ndjson() {
      for await (const e of consoleStream(tail, since)) yield `${JSON.stringify(e)}\n`;
    }
    return reply.header("content-type", "application/x-ndjson; charset=utf-8").header("cache-control", "no-store").send(Readable.from(ndjson()));
  });
}

import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleEntry, ConsoleEvent, ConsoleTail } from "../amp/console.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../audit.js";
import type { RestartSchedule } from "../status/restart.js";

const BACKUP_PERMISSION = "LocalFileBackupPlugin.Backup.TakeBackup";

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

export function serverRoutes(app: FastifyInstance, amp: Amp, tail: ConsoleTail, restarts: RestartSchedule) {
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
    const allowed = await amp.call<boolean>("Core", "CurrentSessionHasPermission", { PermissionNode: BACKUP_PERMISSION }).catch(() => false);
    const stopsServer = allowed ? await amp.call<boolean>("LocalFileBackupPlugin", "BackupWillStopServer").catch(() => null) : null;
    return { allowed: allowed === true, stopsServer, permission: BACKUP_PERMISSION };
  });

  app.post("/server/backup", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const allowed = await amp.call<boolean>("Core", "CurrentSessionHasPermission", { PermissionNode: BACKUP_PERMISSION }).catch(() => false);
    if (allowed !== true) {
      await audit({ userId: req.caller.userId, action: "server.backup", params: {}, result: "DENIED", detail: "AMP permission missing" });
      return reply.code(403).send({ error: { code: "forbidden", message: `AMP's webapp user may not take backups. Grant it "${BACKUP_PERMISSION}" in AMP, or use AMP's own backup schedule.` } });
    }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    try {
      const r = await amp.call<{ Status?: boolean; Reason?: string }>("LocalFileBackupPlugin", "TakeBackup", {
        Title: `Portal backup ${stamp}`, Description: "Requested from the Deepslate Works portal", Sticky: false, Local: true, S3: false, WasCreatedAutomatically: false, DirtyOnly: false, BackupWhileRunning: null,
      });
      const ok = r?.Status !== false;
      await audit({ userId: req.caller.userId, action: "server.backup", params: {}, result: ok ? "OK" : "FAILED", detail: r?.Reason ?? null });
      return ok ? { ok: true } : reply.code(502).send({ error: { code: "amp_error", message: r?.Reason ?? "AMP refused the backup" } });
    } catch (e) {
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

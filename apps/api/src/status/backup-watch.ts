import type { Amp } from "../amp/client.js";
import { readBackups } from "../routes/server.js";

// A backup counts only once AMP lists it (Alex, 2026-10-03). AMP's TakeBackup says yes at once and does the work
// afterwards; on 2026-10-03 it said yes to three backups bigger than its backup size limit and never kept them,
// without a word. The 36.7 GB one that went through took about 17 minutes to appear in GetBackups. So the job is
// written down (Setting "_backupJob", it outlives a deploy), the list is read every 30 s, and after WAIT_MS without
// the title in it the job has failed, with the reason in words.
export const BACKUP_JOB_KEY = "_backupJob";
export const WAIT_MS = 45 * 60_000;
export const POLL_MS = 30_000;

export type BackupJob = {
  title: string;
  requestedAt: string;
  by: string | null;
  phase: "waiting" | "listed" | "failed";
  checkedAt: string | null;
  doneAt: string | null;
  sizeBytes: number | null;
  reason: string | null;
};

export type BackupJobStore = { load(): Promise<BackupJob | null>; save(job: BackupJob): Promise<void> };
type Audit = (a: { userId: string | null; action: string; params: Record<string, string>; result: string; detail: string | null }) => Promise<unknown>;

export class BackupBusy extends Error {}

const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;
const hhmm = (iso: string) => `${iso.slice(11, 16)} UTC`;

export function notListedReason(job: BackupJob, waitMs: number, biggestKept: number | null): string {
  return `AMP accepted the backup at ${hhmm(job.requestedAt)} but did not list it within ${Math.round(waitMs / 60_000)} minutes, so it was not kept. ` +
    `AMP drops a backup without saying so when it is bigger than its backup size limit (AMP → Configuration → Backups)` +
    (biggestKept ? `; the biggest backup it holds is ${gb(biggestKept)}.` : ".");
}

export class BackupWatch {
  job: BackupJob | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private amp: Amp,
    private store: BackupJobStore,
    private audit: Audit,
    private opts: { waitMs?: number; pollMs?: number; now?: () => Date; log?: (o: object, m: string) => void } = {},
  ) {}

  private get waitMs() { return this.opts.waitMs ?? WAIT_MS; }
  private now() { return this.opts.now ? this.opts.now() : new Date(); }

  /** At api start: pick up a job that was still waiting when the api went down. */
  async init(): Promise<void> {
    this.job = await this.store.load().catch(() => null);
    if (this.job?.phase === "waiting") this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async start(by: string | null): Promise<BackupJob> {
    if (this.job?.phase === "waiting") throw new BackupBusy(`a backup asked for at ${hhmm(this.job.requestedAt)} is still waiting for AMP to list it`);
    const at = this.now().toISOString();
    const title = `Portal backup ${at.slice(0, 19).replace("T", " ")}`;
    const r = await this.amp.call<{ Status?: boolean; Reason?: string } | null>("LocalFileBackupPlugin", "TakeBackup", {
      Title: title, Description: "Requested from the Deepslate Works portal", Sticky: false, Local: true, S3: false, WasCreatedAutomatically: false, DirtyOnly: false, BackupWhileRunning: null,
    });
    const job: BackupJob = { title, requestedAt: at, by, phase: "waiting", checkedAt: null, doneAt: null, sizeBytes: null, reason: null };
    if (r?.Status === false) {
      Object.assign(job, { phase: "failed", doneAt: at, reason: `AMP refused the backup: ${r.Reason || "no reason given"}` });
      await this.finish(job);
      return job;
    }
    this.job = job;
    await this.store.save(job);
    this.schedule();
    return job;
  }

  /** One look at AMP's list; ends the job when the title is in it or the wait is over. */
  async check(): Promise<BackupJob | null> {
    const job = this.job;
    if (!job || job.phase !== "waiting") return job;
    const now = this.now();
    const rows = readBackups(await this.amp.call<unknown>("LocalFileBackupPlugin", "GetBackups").catch(() => null));
    const row = rows.find((b) => b.name === job.title);
    job.checkedAt = now.toISOString();
    if (row) {
      Object.assign(job, { phase: "listed", doneAt: job.checkedAt, sizeBytes: row.sizeBytes });
      await this.finish(job);
    } else if (now.getTime() - Date.parse(job.requestedAt) >= this.waitMs) {
      const biggest = rows.reduce<number | null>((m, b) => (b.sizeBytes && b.sizeBytes > (m ?? 0) ? b.sizeBytes : m), null);
      Object.assign(job, { phase: "failed", doneAt: job.checkedAt, reason: notListedReason(job, this.waitMs, biggest) });
      await this.finish(job);
    } else {
      await this.store.save(job).catch(() => {});
      this.schedule();
    }
    return job;
  }

  private async finish(job: BackupJob) {
    this.job = job;
    this.stop();
    await this.store.save(job).catch(() => {});
    const minutes = Math.round((Date.parse(job.doneAt ?? job.requestedAt) - Date.parse(job.requestedAt)) / 60_000);
    await this.audit({
      userId: job.by, action: "server.backup", params: { title: job.title }, result: job.phase === "listed" ? "OK" : "FAILED",
      detail: job.phase === "listed" ? `listed by AMP after ${minutes} min${job.sizeBytes ? `, ${gb(job.sizeBytes)}` : ""}` : job.reason,
    }).catch(() => {});
    this.opts.log?.({ backup: job }, "backup: " + job.phase);
  }

  private schedule() {
    this.stop();
    this.timer = setTimeout(() => void this.check().catch((e) => this.opts.log?.({ err: String(e) }, "backup: check failed")), this.opts.pollMs ?? POLL_MS);
    this.timer.unref?.();
  }
}

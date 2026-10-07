import "server-only";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DESIGN_NAME } from "@/lib/designer";
import { DESIGNS_DIR } from "@/server/designer";

// docs/40 Part 2: a design carries on by itself. Design and Change it answer at once; the call to the designer, the
// one send-back, the check and the new version run on in this process, and data/builds/designs/<name>.job.json says
// how far it has got. The card reads the job with the page and asks /api/admin/designer/job while it runs.
//
// The work is a promise held at module level (globalThis, so every bundle of this process shares it), not `after`:
// `web` is one long-lived node process, so a promise nobody awaits runs to its end whether or not the page that
// started it is still open. A job written by another process (the site restarted mid-design) can never finish, so a
// job whose `boot` is not this process's, or that is older than 12 minutes, is shown as failed.

export type JobStage = "designing" | "fixing" | "checking";
export type DesignJob = {
  name: string;
  title?: string;
  ask: string;
  fresh: boolean;
  by: string;
  startedAt: string;
  boot: string;
  stage: JobStage;
  failed?: string;
  text?: string;
  finishedAt?: string;
};
export type JobOutcome = { ok: true } | { ok: false; error: string; text?: string };

const g = globalThis as typeof globalThis & { __designerBoot?: string; __designerRuns?: Map<string, Promise<void>> };
/** This process's id: made once when web starts. */
export const BOOT = (g.__designerBoot ??= randomUUID());
const runs = (g.__designerRuns ??= new Map<string, Promise<void>>());
/** Longer than the designer's own 10 minutes, a send-back included in most cases. */
export const JOB_DEAD_MS = 12 * 60_000;

const jobFile = (name: string) => path.join(DESIGNS_DIR, `${name}.job.json`);

async function write(job: DesignJob): Promise<void> {
  await mkdir(DESIGNS_DIR, { recursive: true });
  const file = jobFile(job.name);
  await writeFile(`${file}.part`, `${JSON.stringify(job)}\n`, { mode: 0o644 });
  await rename(`${file}.part`, file);
}

async function readAll(): Promise<DesignJob[]> {
  let names: string[] = [];
  try {
    names = (await readdir(DESIGNS_DIR)).filter((f) => f.endsWith(".job.json"));
  } catch {
    return [];
  }
  const out: DesignJob[] = [];
  for (const f of names) {
    try {
      const j = JSON.parse(await readFile(path.join(DESIGNS_DIR, f), "utf8")) as DesignJob;
      if (j && DESIGN_NAME.test(j.name) && f === `${j.name}.job.json`) out.push(j);
    } catch {
      // half written or damaged: not a job
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Why a job that has not failed can no longer finish, or null while it can. */
export function deadReason(job: DesignJob, boot: string, now = Date.now()): string | null {
  if (job.failed) return null;
  if (job.boot !== boot) return "The site restarted while it was designing. Start it again.";
  if (now - Date.parse(job.startedAt) > JOB_DEAD_MS) return "It took longer than 12 minutes and was given up. Start it again.";
  return null;
}

/** The newest job, a dead one written down as failed. Null when nothing is running and nothing has failed. */
export async function currentJob(now = Date.now()): Promise<DesignJob | null> {
  const job = (await readAll())[0];
  if (!job) return null;
  const dead = deadReason(job, BOOT, now);
  if (!dead) return job;
  const failed = { ...job, failed: dead, finishedAt: new Date(now).toISOString() };
  await write(failed).catch(() => {});
  return failed;
}

/** Removes every job file: a failed one the admin has read ("Clear"), or the old ones before a new start. */
export async function clearJobs(): Promise<void> {
  for (const j of await readAll()) await rm(jobFile(j.name), { force: true });
}

/**
 * Writes the job and starts `work`, which is not awaited: the caller answers at once. `work` reports its stages
 * through `stage`; when it ends the job file is removed (done) or kept with why it failed.
 */
export async function startJob(job: Omit<DesignJob, "boot" | "stage" | "startedAt">, work: (stage: (s: JobStage) => Promise<void>) => Promise<JobOutcome>): Promise<DesignJob> {
  await clearJobs();
  const started: DesignJob = { ...job, startedAt: new Date().toISOString(), boot: BOOT, stage: "designing" };
  await write(started);
  let current = started;
  const stage = async (s: JobStage) => {
    current = { ...current, stage: s };
    await write(current);
  };
  const run = (async () => {
    let outcome: JobOutcome;
    try {
      outcome = await work(stage);
    } catch (e) {
      outcome = { ok: false, error: `Something went wrong on the site: ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      if (outcome.ok) await rm(jobFile(job.name), { force: true });
      else await write({ ...current, failed: outcome.error, ...(outcome.text ? { text: outcome.text.slice(0, 4000) } : {}), finishedAt: new Date().toISOString() });
    } catch (e) {
      console.error("designer job: could not write its end", e);
    }
  })().finally(() => runs.delete(job.name));
  runs.set(job.name, run);
  return started;
}

/** For tests: the work of a job, to wait for. */
export const runningJob = (name: string): Promise<void> | undefined => runs.get(name);

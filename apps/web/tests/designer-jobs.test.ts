import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// docs/40 Part 2: a design carries on by itself. The job is a file beside the designs, with how far it has got; it
// goes when the design is written and stays, with why, when it failed. One this process did not start is dead.

let root = "";
let jobs: typeof import("@/server/design-jobs");
let dir = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "design-jobs-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.resetModules();
  jobs = await import("@/server/design-jobs");
  dir = (await import("@/server/designer")).DESIGNS_DIR;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const files = async () => (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".job.json")).sort();
const job = { name: "boss_temple", title: "Boss Temple", ask: "a temple", fresh: true, by: "u1" };

describe("a design job", () => {
  it("answers at once, says its stage while it works, and goes when the design is done", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const started = await jobs.startJob(job, async (stage) => {
      await gate;
      await stage("checking");
      return { ok: true };
    });
    expect(started).toMatchObject({ ...job, stage: "designing", boot: jobs.BOOT });
    expect(await files()).toEqual(["boss_temple.job.json"]);
    expect(await jobs.currentJob()).toMatchObject({ name: "boss_temple", stage: "designing" });
    release();
    await jobs.runningJob("boss_temple");
    expect(await files()).toEqual([]);
    expect(await jobs.currentJob()).toBeNull();
  });
  it("a failure stays, with why and the designer's words, until it is cleared or another starts", async () => {
    await jobs.startJob(job, async (stage) => {
      await stage("fixing");
      return { ok: false, error: "The designer's build did not pass our checks, twice: step 3 reaches outside the size.", text: "A temple." };
    });
    await jobs.runningJob("boss_temple");
    expect(await jobs.currentJob()).toMatchObject({ stage: "fixing", failed: "The designer's build did not pass our checks, twice: step 3 reaches outside the size.", text: "A temple." });
    await jobs.startJob({ ...job, name: "gate" }, async () => ({ ok: true }));
    await jobs.runningJob("gate");
    expect(await files()).toEqual([]);
    await jobs.startJob(job, async () => {
      throw new Error("disk full");
    });
    await jobs.runningJob("boss_temple");
    expect((await jobs.currentJob())?.failed).toBe("Something went wrong on the site: disk full");
    await jobs.clearJobs();
    expect(await jobs.currentJob()).toBeNull();
  });
  it("one the site did not start in this run, or older than 12 minutes, is dead and shown as failed", async () => {
    const t = Date.parse("2026-10-07T14:00:00Z");
    const base = { ...job, stage: "designing" as const, startedAt: new Date(t).toISOString(), boot: jobs.BOOT };
    expect(jobs.deadReason(base, jobs.BOOT, t + 60_000)).toBeNull();
    expect(jobs.deadReason({ ...base, boot: "another" }, jobs.BOOT, t + 60_000)).toBe("The site restarted while it was designing. Start it again.");
    expect(jobs.deadReason(base, jobs.BOOT, t + 13 * 60_000)).toBe("It took longer than 12 minutes and was given up. Start it again.");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "boss_temple.job.json"), JSON.stringify({ ...base, boot: "another", startedAt: new Date().toISOString() }));
    expect(await jobs.currentJob()).toMatchObject({ failed: "The site restarted while it was designing. Start it again." });
    expect(JSON.parse(await readFile(path.join(dir, "boss_temple.job.json"), "utf8"))).toMatchObject({ failed: "The site restarted while it was designing. Start it again." });
    await jobs.clearJobs();
  });
  it("the process's id is shared by every bundle of it (globalThis)", async () => {
    vi.resetModules();
    const again = await import("@/server/design-jobs");
    expect(again.BOOT).toBe(jobs.BOOT);
  });
});

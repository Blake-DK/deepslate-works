import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { serverRoutes } from "../src/routes/server.js";
import type { RestartSchedule } from "../src/status/restart.js";
import { BackupWatch, type BackupJob } from "../src/status/backup-watch.js";

// A backup counts once AMP lists it (Alex, 2026-10-03): AMP said yes to three backups over its size limit and
// kept none of them; the one that went through showed in GetBackups about 17 minutes later.

function setup(opts: { takeBackup?: { Status?: boolean; Reason?: string } | null; listed?: () => Array<Record<string, unknown>>; saved?: BackupJob | null } = {}) {
  let clock = new Date("2026-10-03T18:39:28Z");
  const calls: string[] = [];
  const audits: Array<{ result: string; detail: string | null }> = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string): Promise<T> {
      calls.push(String(method));
      if (method === "CurrentSessionHasPermission") return true as T;
      if (method === "TakeBackup") return (opts.takeBackup === undefined ? { Status: true } : opts.takeBackup) as T;
      if (method === "GetBackups") return (opts.listed ? opts.listed() : []) as T;
      return null as T;
    }
  })();
  let stored: BackupJob | null = opts.saved ?? null;
  const watch = new BackupWatch(amp, { load: async () => stored, save: async (j) => { stored = structuredClone(j); } },
    async (a) => { audits.push({ result: a.result, detail: a.detail }); }, { now: () => clock, pollMs: 3_600_000 });
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  serverRoutes(f, amp, new ConsoleTail(amp, () => {}), {} as RestartSchedule, watch);
  const as = (role: string) => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1", "content-type": "application/json" });
  const later = (min: number) => { clock = new Date(clock.getTime() + min * 60_000); };
  return { f, watch, calls, audits, as, later, stored: () => stored };
}

describe("backups count once AMP lists them", () => {
  it("answers 202 with a waiting job, not success, and gives each backup its own title", async () => {
    const { f, watch, as, stored } = setup();
    const r = await f.inject({ method: "POST", url: "/server/backup", headers: as("ADMIN"), payload: {} });
    expect(r.statusCode).toBe(202);
    expect(r.json().job).toMatchObject({ phase: "waiting", title: "Portal backup 2026-10-03 18:39:28", by: "u1" });
    expect(stored()?.phase).toBe("waiting");
    watch.stop();
  });

  it("turns listed when the title shows in GetBackups, with its size", async () => {
    let list: Array<Record<string, unknown>> = [];
    const { f, watch, as, later, audits } = setup({ listed: () => list });
    await f.inject({ method: "POST", url: "/server/backup", headers: as("ADMIN"), payload: {} });
    later(1);
    expect((await watch.check())?.phase).toBe("waiting");
    list = [{ Name: "Portal backup 2026-10-03 18:39:28", TotalSizeBytes: 36_682_932_831 }];
    later(16);
    const job = await watch.check();
    expect(job).toMatchObject({ phase: "listed", sizeBytes: 36_682_932_831 });
    expect(audits).toEqual([{ result: "OK", detail: "listed by AMP after 17 min, 36.7 GB" }]);
    const g = await f.inject({ method: "GET", url: "/server/backup", headers: as("ADMIN") });
    expect(g.json().job.phase).toBe("listed");
  });

  it("fails with the reason when AMP never lists it (the size limit)", async () => {
    const { f, watch, as, later, audits } = setup({ listed: () => [{ Name: "Portal backup 2026-09-29 15:29", TotalSizeBytes: 1_378_751_393 }] });
    await f.inject({ method: "POST", url: "/server/backup", headers: as("ADMIN"), payload: {} });
    later(44);
    expect((await watch.check())?.phase).toBe("waiting");
    later(1);
    const job = await watch.check();
    expect(job?.phase).toBe("failed");
    expect(job?.reason).toContain("did not list it within 45 minutes");
    expect(job?.reason).toContain("backup size limit");
    expect(job?.reason).toContain("1.4 GB");
    expect(audits[0].result).toBe("FAILED");
  });

  it("fails at once when AMP refuses, with AMP's reason", async () => {
    const { f, as } = setup({ takeBackup: { Status: false, Reason: "Not enough space" } });
    const r = await f.inject({ method: "POST", url: "/server/backup", headers: as("ADMIN"), payload: {} });
    expect(r.statusCode).toBe(502);
    expect(r.json().job).toMatchObject({ phase: "failed", reason: "AMP refused the backup: Not enough space" });
  });

  it("takes one at a time", async () => {
    const { f, watch, as, calls } = setup();
    await f.inject({ method: "POST", url: "/server/backup", headers: as("ADMIN"), payload: {} });
    const r = await f.inject({ method: "POST", url: "/server/backup", headers: as("ADMIN"), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(calls.filter((c) => c === "TakeBackup")).toHaveLength(1);
    watch.stop();
  });

  it("keeps waiting across an api restart", async () => {
    const saved: BackupJob = { title: "Portal backup 2026-10-03 18:39:28", requestedAt: "2026-10-03T18:39:28.000Z", by: "u1", phase: "waiting", checkedAt: null, doneAt: null, sizeBytes: null, reason: null };
    const { watch } = setup({ saved, listed: () => [{ Name: saved.title, TotalSizeBytes: 5e9 }] });
    await watch.init();
    expect(watch.job?.phase).toBe("waiting");
    expect((await watch.check())?.phase).toBe("listed");
  });

  it("is for admins", async () => {
    const { f, as, calls } = setup();
    const r = await f.inject({ method: "POST", url: "/server/backup", headers: as("PLAYER"), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(calls).not.toContain("TakeBackup");
  });
});

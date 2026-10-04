import { describe, expect, it } from "vitest";
import { alerts, allWell, BACKUP_MIN_BYTES, datedBackups, evaluate, HealthWatch, type Checks, type Inputs } from "../src/status/health-watch.js";

// docs/32 §7 item 3: the things that fail quietly, looked at every ten minutes, told once when they go wrong.
// Each case below happened on 2026-10-03 or 2026-10-04 and nobody was told at the time.

const now = new Date("2026-10-05T09:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
const GB = 1024 ** 3;
const well: Inputs = {
  dump: { name: "deepslate-2026-10-05.sql.gz", at: h(9), bytes: 661_568 },
  copied: { name: "deepslate-2026-10-05.sql.gz", at: h(8.9) },
  backups: [{ name: "Scheduled Backup", at: h(8), bytes: 19 * GB }, { name: "Scheduled Backup", at: h(32), bytes: 19 * GB }],
  pack: { site: "0.1.0+0d33a462", server: "0.1.0+0d33a462" },
  wake: { failed: false, by: null, at: null },
};
const names = (c: Checks) => Object.entries(c).filter(([, v]) => v.ok === false).map(([k]) => k);

describe("the health watch: what counts as wrong", () => {
  it("a normal morning is well", () => {
    const c = evaluate(well, now);
    expect(names(c)).toEqual([]);
    expect(allWell(c)).toBe(true);
    expect(c.dump.text).toBe("deepslate-2026-10-05.sql.gz, 9 h old");
  });

  it("B-01: the site hands out a pack the server does not run", () => {
    const c = evaluate({ ...well, pack: { site: "0.1.0+d7521da9", server: "0.1.0+0d33a462" } }, now);
    expect(names(c)).toEqual(["pack"]);
    expect(c.pack.text).toMatch(/hands out pack 0\.1\.0\+d7521da9 but the server runs 0\.1\.0\+0d33a462/);
    expect(allWell(c)).toBe(false);
  });

  it("B-20: no dump for more than 26 hours, no dump at all, or an empty one", () => {
    expect(names(evaluate({ ...well, dump: { name: "deepslate-2026-10-03.sql.gz", at: h(40), bytes: 600_000 }, copied: { name: "deepslate-2026-10-03.sql.gz", at: h(39) } }, now))).toEqual(["dump"]);
    expect(evaluate({ ...well, dump: null }, now).dump).toEqual({ ok: false, text: "There is no database dump at all" });
    expect(evaluate({ ...well, dump: { name: "deepslate-2026-10-05.sql.gz", at: h(9), bytes: 20 } }, now).dump.ok).toBe(false);
    expect(evaluate({ ...well, dump: { name: "d", at: h(25), bytes: 600_000 }, copied: { name: "d", at: h(24) } }, now).dump.ok).toBe(true);
  });

  it("B-07: a dump that has not left the VPS an hour after it was made", () => {
    expect(names(evaluate({ ...well, copied: null }, now))).toEqual(["dumpCopy"]);
    expect(names(evaluate({ ...well, copied: { name: "deepslate-2026-10-04.sql.gz", at: h(30) } }, now))).toEqual(["dumpCopy"]);
    // a dump made twenty minutes ago is not late yet (api copies within ten)
    expect(evaluate({ ...well, dump: { name: "new.sql.gz", at: h(1 / 3), bytes: 600_000 }, copied: null }, now).dumpCopy.ok).toBe(true);
  });

  it("docs/28: no world backup for 30 hours, a 22-byte zip, and a backup a third too small", () => {
    expect(evaluate({ ...well, backups: [{ name: "Scheduled Backup", at: h(33), bytes: 19 * GB }] }, now).backup.text).toBe('No world backup for 33 hours (the newest is "Scheduled Backup")');
    expect(evaluate({ ...well, backups: [{ name: "Portal backup", at: h(2), bytes: 22 }, { name: "x", at: h(26), bytes: 19 * GB }] }, now).backup.ok).toBe(false);
    expect(evaluate({ ...well, backups: [{ name: "Scheduled Backup", at: h(2), bytes: 12 * GB }, { name: "x", at: h(26), bytes: 19 * GB }] }, now).backup.text).toMatch(/much smaller than the one before it \(19\.0 GB\)/);
    expect(evaluate({ ...well, backups: [{ name: "a", at: h(2), bytes: 18 * GB }, { name: "b", at: h(26), bytes: 19 * GB }] }, now).backup.ok).toBe(true);
    expect(evaluate({ ...well, backups: [] }, now).backup.ok).toBe(false);
    expect(BACKUP_MIN_BYTES).toBe(GB);
  });

  it("B-66: a wake that failed names who pressed Play", () => {
    const c = evaluate({ ...well, wake: { failed: true, by: "m1owl", at: h(0) } }, now);
    expect(names(c)).toEqual(["wake"]);
    expect(c.wake.text).toMatch(/did not wake when m1owl pressed Play/);
  });

  it("what cannot be looked at is unknown, never an alarm", () => {
    const c = evaluate({ ...well, dump: undefined, backups: undefined, pack: { site: null, server: "0.1.0+0d33a462" } }, now);
    expect([c.dump.ok, c.dumpCopy.ok, c.backup.ok, c.pack.ok]).toEqual([null, null, null, null]);
    expect(allWell(c)).toBe(true);
    expect(alerts(evaluate(well, now), c)).toEqual([]);
  });

  it("AMP's list: unreadable times are left out; a list with rows and no readable time is unknown, not empty", () => {
    expect(datedBackups([{ Name: "a", Timestamp: "2026-10-05T01:00:00Z", TotalSizeBytes: 5 }, { Name: "b", Timestamp: "2026-10-04T01:00:00Z" }])?.map((b) => b.name)).toEqual(["a", "b"]);
    expect(datedBackups([{ Name: "a", Timestamp: "/Date(nonsense)/" }])).toBeUndefined();
    expect(datedBackups([])).toEqual([]);
  });
});

describe("the health watch: told once", () => {
  const bad = evaluate({ ...well, pack: { site: "0.1.0+d7521da9", server: "0.1.0+0d33a462" } }, now);
  const good = evaluate(well, now);

  it("well → wrong is an ERROR, wrong → wrong is silence, wrong → well is a WARN", () => {
    expect(alerts(good, bad)).toEqual([{ check: "pack", level: "ERROR", message: expect.stringMatching(/^Health: The site hands out pack/) }]);
    expect(alerts(bad, bad)).toEqual([]);
    expect(alerts(bad, good)).toEqual([{ check: "pack", level: "WARN", message: "Health, well again: the site and the server are on the same pack" }]);
  });

  it("what is wrong when api starts is news; a wake has no 'well again'", () => {
    expect(alerts(null, bad).map((a) => a.check)).toEqual(["pack"]);
    expect(alerts(null, good)).toEqual([]);
    const failed = evaluate({ ...well, wake: { failed: true, by: "m1owl", at: now } }, now);
    expect(alerts(good, failed).map((a) => a.level)).toEqual(["ERROR"]);
    expect(alerts(failed, good)).toEqual([]);
  });

  it("a round writes one event per change, with the check's name in meta for the feed", async () => {
    const events: Array<{ kind: string; message: string; meta: Record<string, unknown> }> = [];
    let wake = { phase: "idle", by: null as string | null, endedAt: null as string | null };
    const watch = new HealthWatch({
      amp: { call: async () => [{ Name: "Scheduled Backup", Timestamp: h(8).toISOString(), TotalSizeBytes: 19 * GB }] } as never,
      dumpsDir: "/nowhere-for-this-test", repoDir: "/nowhere-for-this-test",
      copied: () => null, serverPack: async () => "0.1.0+0d33a462", wake: () => wake,
      addEvent: async (e) => void events.push(e), log: () => undefined, now: () => now,
    });
    await watch.round(); // nothing readable but the backup list, which is well: no event
    expect(events).toEqual([]);
    expect(watch.checks?.backup.ok).toBe(true);
    wake = { phase: "failed", by: "m1owl", endedAt: now.toISOString() };
    await watch.wakeFailed();
    await watch.round();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "ERROR", meta: { health: "wake" } });
    expect(events[0]!.message).toMatch(/^Health: The server did not wake when m1owl pressed Play/);
  });
});

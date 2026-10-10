import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availability, MockAmp, type Amp, type AmpStatus } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { shouldSnapshot, StatusPoller, toLive, type Snapshot, type SnapshotStore } from "../src/status/poller.js";
import { warningMinutes } from "../src/status/restart.js";
import { consoleStream, type StreamEvent } from "../src/routes/server.js";
import { actions } from "../src/actions/registry.js";

const noLog = () => {};
const status = (over: Partial<AmpStatus> = {}): AmpStatus => ({ state: "Running", stateCode: 20, players: [], maxPlayers: 20, cpu: 5, memMb: 3000, memMaxMb: 6144, tps: 20, uptime: "0:01:00:00", ...over });

describe("availability", () => {
  it("maps AMP states to what the portal shows", () => {
    expect(availability(20)).toBe("online");
    expect(availability(10)).toBe("starting");
    expect(availability(30)).toBe("starting"); // Restarting
    expect(availability(40)).toBe("offline"); // Stopping
    expect(availability(45)).toBe("sleeping"); // PreparingForSleep
    expect(availability(50)).toBe("sleeping"); // Sleeping
    expect(availability(0)).toBe("offline");
    expect(availability(100)).toBe("offline");
    expect(availability(null)).toBe("offline");
  });
});

describe("toLive", () => {
  it("merges AMP's list with the console's and attaches known uuids", () => {
    const tail = { online: new Set(["m1_owl"]), uuidByName: new Map([["Bramble09", "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10"]]) };
    const live = toLive(status({ players: ["Bramble09"] }), tail, new Date("2026-09-29T10:00:00Z"));
    expect(live.players.sort()).toEqual(["Bramble09", "m1_owl"]);
    expect(live.online.find((p) => p.name === "Bramble09")?.uuid).toBe("c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10");
    expect(live.online.find((p) => p.name === "m1_owl")?.uuid).toBeNull();
    expect(live.availability).toBe("online");
  });
  it("shows nobody online when the server is not running, whatever the console remembered", () => {
    const live = toLive(status({ state: "Sleeping", stateCode: 50, tps: null }), { online: new Set(["ghost"]), uuidByName: new Map() }, new Date());
    expect(live.players).toEqual([]);
    expect(live.availability).toBe("sleeping");
  });
});

describe("shouldSnapshot", () => {
  const t0 = new Date("2026-09-29T10:00:00Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);
  const prev = { at: t0, state: "Running", players: ["a"] };
  it("always records a change", () => {
    expect(shouldSnapshot(null, { state: "Running", players: [] }, t0, true)).toBe(true);
    expect(shouldSnapshot(prev, { state: "Stopped", players: [] }, at(1), false)).toBe(true);
    expect(shouldSnapshot(prev, { state: "Running", players: ["a", "b"] }, at(1), true)).toBe(true);
    expect(shouldSnapshot(prev, { state: "Running", players: ["b"] }, at(1), true)).toBe(true);
  });
  it("otherwise every 15 s while running and every 5 min while not", () => {
    const same = { state: "Running", players: ["a"] };
    expect(shouldSnapshot(prev, same, at(10), true)).toBe(false);
    expect(shouldSnapshot(prev, same, at(15), true)).toBe(true);
    const idle = { at: t0, state: "Sleeping", players: [] as string[] };
    expect(shouldSnapshot(idle, { state: "Sleeping", players: [] }, at(120), false)).toBe(false);
    expect(shouldSnapshot(idle, { state: "Sleeping", players: [] }, at(300), false)).toBe(true);
  });
});

describe("StatusPoller", () => {
  function setup(answers: Array<AmpStatus | Error>) {
    let clock = Date.parse("2026-09-29T10:00:00Z");
    const saved: Snapshot[] = [];
    const store: SnapshotStore = { save: async (s) => void saved.push(s), prune: async () => ({ deleted: 0, thinned: 0 }) };
    const amp: Amp = { ping: async () => {}, call: async <T,>() => ({}) as T, getStatus: async () => { const a = answers.shift() ?? status(); if (a instanceof Error) throw a; return a; } };
    const poller = new StatusPoller(amp, null, store, noLog, () => new Date(clock));
    return { poller, saved, tick: (s: number) => (clock += s * 1000) };
  }
  it("keeps the latest status, records rows at the right rate and reports changes", async () => {
    const { poller, saved, tick } = setup([status(), status(), status({ players: ["a"] }), status({ state: "Stopped", stateCode: 0, tps: null, players: [] })]);
    const changes: string[] = [];
    poller.onStatus((next, prev) => void changes.push(`${prev?.state ?? "-"}>${next.state}`));
    await poller.poll();
    tick(10); await poller.poll();
    expect(saved).toHaveLength(1);
    tick(10); await poller.poll();
    expect(saved.at(-1)?.players).toEqual(["a"]);
    tick(10); await poller.poll();
    expect(saved.map((s) => s.state)).toEqual(["Running", "Running", "Stopped"]);
    expect(changes).toEqual(["->Running", "Running>Running", "Running>Running", "Running>Stopped"]);
    expect(poller.latest?.availability).toBe("offline");
  });
  it("survives AMP being unreachable and stops calling the old answer fresh", async () => {
    const { poller, saved, tick } = setup([status(), new Error("AMP timeout"), new Error("AMP timeout"), new Error("AMP timeout")]);
    await poller.poll();
    expect(poller.fresh()?.state).toBe("Running");
    for (let i = 0; i < 3; i++) { tick(10); await poller.poll(); }
    expect(poller.lastError).toBe("AMP timeout");
    expect(saved).toHaveLength(1);
    expect(poller.fresh()).toBeNull();
    expect(poller.latest?.state).toBe("Running");
  });
});

describe("restart countdown", () => {
  it("warns at the start if far away, then every minute for the last five", () => {
    expect(warningMinutes(5)).toEqual([5, 4, 3, 2, 1]);
    expect(warningMinutes(15)).toEqual([15, 5, 4, 3, 2, 1]);
    expect(warningMinutes(2)).toEqual([2, 1]);
    expect(warningMinutes(1)).toEqual([1]);
  });
  it("builds the in-game lines in the registry", () => {
    const ctx = { limbo: { dimension: "deepslate:limbo", x: 0.5, y: 65, z: 0.5 }, spawn: null, portalUrl: "https://deepslate.dsw.test" };
    expect(actions["server.restartWarning"].build(ctx, { minutes: 5 })).toEqual(["say Server restarts in 5 minutes. Get somewhere safe."]);
    expect(actions["server.restartWarning"].build(ctx, { minutes: 1 })).toEqual(["say Server restarts in 1 minute. Get somewhere safe."]);
    expect(actions["server.restartWarning"].build(ctx, { minutes: 0 })[0]).toMatch(/^say Restarting now/);
    expect(actions["server.restartWarning"].input.safeParse({ minutes: 1.5 }).success).toBe(false);
  });
});

describe("RestartSchedule", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  it("says the warnings on time, restarts once, and a cancel stops everything", async () => {
    vi.resetModules();
    vi.doMock("../src/audit.js", () => ({ audit: async () => {} }));
    const { RestartSchedule } = await import("../src/status/restart.js");
    const sent: string[] = [];
    const amp: Amp = { ping: async () => {}, getStatus: async () => status(), call: async <T,>(m: string, method: string, p?: Record<string, unknown>) => { sent.push(method === "SendConsoleMessage" ? String(p?.message) : `${m}.${method}`); return {} as T; } };
    const ctx = { limbo: { dimension: "deepslate:limbo", x: 0.5, y: 65, z: 0.5 }, spawn: null, portalUrl: "https://deepslate.dsw.test" };
    const s = new RestartSchedule(amp, () => ctx, noLog);
    s.schedule(3, "admin1");
    expect(s.current?.minutes).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual(["say Server restarts in 3 minutes. Get somewhere safe."]);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.filter((l) => l.startsWith("say Server restarts"))).toHaveLength(3);
    expect(sent).not.toContain("Core.Restart");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.filter((l) => l === "Core.Restart")).toHaveLength(1);
    expect(s.current).toBeNull();

    sent.length = 0;
    s.schedule(2, "admin1");
    await vi.advanceTimersByTimeAsync(1);
    expect(await s.cancel("admin1")).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sent).not.toContain("Core.Restart");
    expect(sent.at(-1)).toBe("say The restart has been called off.");
    expect(await s.cancel("admin1")).toBe(false);
    vi.doUnmock("../src/audit.js");
  });
});

describe("console stream", () => {
  it("numbers lines, sends the backlog after `since`, then new lines as they arrive, and detaches", async () => {
    const tail = new ConsoleTail(new MockAmp(), noLog);
    for (const l of ["one", "two", "three"]) tail.ingest(l);
    expect(tail.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(tail.lines).toEqual(["one", "two", "three"]);
    const gen = consoleStream(tail, 1, { maxMs: 2000, heartbeatMs: 200 });
    const got: StreamEvent[] = [];
    got.push((await gen.next()).value as StreamEvent, (await gen.next()).value as StreamEvent);
    expect(got.map((e) => ("text" in e ? e.text : "hb"))).toEqual(["two", "three"]);
    const pending = gen.next();
    setTimeout(() => tail.ingest("[10:00:00] [Server thread/INFO]: four"), 30);
    const next = (await pending).value as StreamEvent;
    expect("text" in next && next.text).toBe("[10:00:00] [Server thread/INFO]: four");
    expect("seq" in next && next.seq).toBe(4);
    const hb = (await gen.next()).value as StreamEvent;
    expect(hb).toEqual({ hb: 1, state: -1 });
    await gen.return(undefined);
    expect((tail as unknown as { handlers: unknown[] }).handlers).toHaveLength(0);
  });
  it("keeps only the last 300 lines", () => {
    const tail = new ConsoleTail(new MockAmp(), noLog);
    for (let i = 1; i <= 320; i++) tail.ingest(`line ${i}`);
    expect(tail.entries).toHaveLength(300);
    expect(tail.entries[0]?.seq).toBe(21);
    expect(tail.after(318).map((e) => e.text)).toEqual(["line 319", "line 320"]);
  });
});

describe("backups", () => {
  it("asks AMP for the permissions by the names AMP uses, and never for delete or restore", async () => {
    const { BACKUP_PERMISSION, BACKUP_LIST_PERMISSION } = await import("../src/routes/server.js");
    expect(BACKUP_PERMISSION).toBe("LocalFileBackup.Backup.CreateBackup");
    expect(BACKUP_LIST_PERMISSION).toBe("LocalFileBackup.Backup.ViewBackupsList");
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/routes/server.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/"(?:RestoreBackup|DeleteLocalBackup|DeleteFromS3|UploadToS3|DownloadFromS3|SetBackupSticky)"/);
  });
  it("reads a backup list defensively", async () => {
    const { readBackups } = await import("../src/routes/server.js");
    expect(readBackups([{ Id: "b1", Name: "Portal backup 2026-09-29 10:00", Timestamp: "2026-09-29T10:00:00Z", TotalSizeBytes: 1048576, Sticky: true }, { Title: "nightly", WasCreatedAutomatically: true }, null, "x"])).toEqual([
      { id: "b1", name: "Portal backup 2026-09-29 10:00", at: "2026-09-29T10:00:00Z", sizeBytes: 1048576, sticky: true, automatic: false },
      { id: null, name: "nightly", at: null, sizeBytes: null, sticky: false, automatic: true },
    ]);
    expect(readBackups({ Title: "Unauthorized Access", Message: "no" })).toEqual([]);
    expect(readBackups(null)).toEqual([]);
  });
});

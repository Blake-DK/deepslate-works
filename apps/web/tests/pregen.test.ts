import { describe, expect, it } from "vitest";
import { modeText, pregenCost, progress, sleepText, type Pregen } from "@/lib/pregen";

const AREA = { x: 0, z: 0, radius: 1500 };
const sleep = { node: "MinecraftModule.Limits.SleepMode", permission: "Settings.MinecraftModule.Limits.SleepMode", allowed: true, on: true, delayMin: 5, problem: null };
const base: Pregen = { status: "none", chunks: null, percent: null, eta: null, rate: null, at: null, plan: { mode: "off", area: AREA }, doing: "off", total: 35721, sleep, serverState: 20, serverRunning: true, online: 0 };
const on = { area: AREA, window: null, capHours: null, ranMs: 0, since: "2026-09-29T20:00:00.000Z", sleepWas: true } as const;

describe("progress", () => {
  it("is chunks done of the total, the percentage, and chunky's own estimate while it runs", () => {
    expect(progress({ ...base, status: "running", chunks: 24069, percent: 67.38, eta: "0:03:41", rate: 52.7 })).toEqual({ line: "24,069 of 35,721 chunks, 67.4%, about 0:03:41 to go, 53 chunks a second.", percent: 67.38 });
    expect(progress({ ...base, status: "paused", chunks: 24069, percent: 67.38 }).line).toBe("24,069 of 35,721 chunks, 67.4%.");
  });
  it("works the total out when no area is on record", () => {
    expect(progress({ ...base, total: null, status: "paused", chunks: 17860, percent: 50 }).line).toBe("17,860 of 35,720 chunks, 50.0%.");
  });
  it("says so when there is nothing to show", () => {
    expect(progress(base).line).toBe("No figures yet (the area is 35,721 chunks): chunky says where it stands when it next runs.");
    expect(progress({ ...base, plan: { mode: "off", area: null }, total: null }).line).toBe("Nothing has been generated ahead of time yet.");
    expect(progress({ ...base, status: "finished", chunks: 35721, percent: 100 })).toEqual({ line: "Done: 35,721 chunks, 100%.", percent: 100 });
    expect(progress(null).percent).toBeNull();
  });
});

describe("modeText", () => {
  it("is off by default, and says that nothing starts by itself", () => {
    expect(modeText(base)).toEqual({ on: false, label: "off", tone: "neutral", line: "Off. Nothing generates, and nothing starts by itself." });
    expect(modeText(null).on).toBe(false);
    expect(modeText({ ...base, status: "finished" }).label).toBe("done");
  });
  it("when nobody's online, with a window and hours", () => {
    const t = modeText({ ...base, plan: { mode: "empty", ...on, window: { from: "02:00", to: "08:00" }, capHours: 8, ranMs: 5_400_000 }, doing: "idle:window" });
    expect(t.label).toBe("on: when nobody's online");
    expect(t.line).toBe("On: when nobody's online, between 02:00 and 08:00, 8 hours of generating at most (1.5 so far). Right now: waiting for its time of day.");
  });
  it("now", () => {
    expect(modeText({ ...base, plan: { mode: "now", ...on }, doing: "run" }).line).toBe("On: now, whoever is playing, until the area is done. Right now: generating.");
  });
  it("says that a server which is not running is not started from here", () => {
    expect(modeText({ ...base, plan: { mode: "empty", ...on }, doing: "idle:server" }).line).toContain("It is not started from here; it carries on when it next runs");
    expect(modeText({ ...base, plan: { mode: "empty", ...on }, doing: "pause:playing" }).line).toContain("waiting: somebody is playing");
  });
});

describe("sleepText", () => {
  it("names the permission to grant while the portal may not switch sleep off", () => {
    const t = sleepText({ ...base, sleep: { ...sleep, allowed: false } });
    expect(t.ok).toBe(false);
    expect(t.grant).toBe("Settings.MinecraftModule.Limits.SleepMode");
    expect(t.line).toBe("Sleep mode is on: an empty server is put to sleep after 5 minutes. The control panel does not let the portal switch it off, so nothing can be turned on: the server would be put to sleep in the middle of generating.");
  });
  it("is fine once it may", () => {
    expect(sleepText(base)).toEqual({ ok: true, line: "Sleep mode is on: an empty server is put to sleep after 5 minutes. While a mode is on, the portal switches it off, and puts it back as it was afterwards.", grant: null });
  });
  it("does not guess when the control panel did not answer", () => {
    expect(sleepText({ ...base, sleep: { ...sleep, allowed: null, problem: "fetch failed" } })).toMatchObject({ ok: false, grant: null });
  });
});

describe("pregenCost", () => {
  it("is about twelve minutes and half a gigabyte for 1500 blocks, and a night for 10000", () => {
    const small = pregenCost(1500);
    expect(small.chunks).toBe(35721); // what chunky counted for it on 2026-09-29
    expect(Math.round(small.hours * 60)).toBe(12);
    expect(small.gb).toBeGreaterThan(0.4);
    expect(small.gb).toBeLessThan(0.5);
    const big = pregenCost(10000);
    expect(big.hours).toBeGreaterThan(8);
    expect(big.hours).toBeLessThan(9);
  });
});

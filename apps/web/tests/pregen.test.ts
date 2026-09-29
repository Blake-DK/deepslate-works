import { describe, expect, it } from "vitest";
import { mapProgress, modeText, pregenCost, progress, sleepText, type Pregen } from "@/lib/pregen";
import { describeAction } from "@/shared/events";

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

describe("the map render", () => {
  const map = { status: "rendering", percent: 10.601, waiting: 1, remaining: "59 minutes", threads: "running", at: "2026-09-29T17:20:00.000Z", stopped: false } as const;
  const render = { mode: "empty", ...on, what: "render" } as const;
  it("is not shown while the map is not part of what is turned on", () => {
    expect(mapProgress(base)).toBeNull();
    expect(mapProgress({ ...base, plan: { mode: "empty", ...on }, map })).toBeNull(); // a plan from before there was a render step
    expect(mapProgress({ ...base, plan: { mode: "empty", ...on, what: "generate" }, map })).toBeNull();
    expect(mapProgress(null)).toBeNull();
  });
  it("is BlueMap's own figures: the task in hand, what waits, its estimate", () => {
    expect(mapProgress({ ...base, plan: render, phase: "render", map })).toEqual({ line: "The map: 10.6% of the task in hand, 1 more task waiting, about 59 minutes to go.", percent: 10.601 });
    expect(mapProgress({ ...base, plan: render, phase: "render", map: { ...map, waiting: 0, remaining: null } })?.line).toBe("The map: 10.6% of the task in hand.");
    expect(mapProgress({ ...base, plan: render, phase: "render", map: { ...map, status: "pending", percent: null, waiting: 3 } })).toEqual({ line: "The map: waiting its turn in BlueMap, 3 more tasks waiting.", percent: null });
    expect(mapProgress({ ...base, plan: render, phase: "render", map: { ...map, status: "updated", percent: null, waiting: 0 } })).toEqual({ line: "The map is up to date.", percent: 100 });
  });
  it("says so when it waits for the generating, is paused, or has nothing to show", () => {
    expect(mapProgress({ ...base, plan: { ...render, what: "both" }, phase: "generate", map })?.line).toBe("The map: rendered when the generating is done.");
    expect(mapProgress({ ...base, plan: render, phase: "render", map: { ...map, stopped: true } })?.line).toBe("The map: paused at 10.6% of the task in hand. BlueMap carries on where it stopped.");
    expect(mapProgress({ ...base, plan: render, phase: "render", map: { status: null, percent: null, waiting: null, remaining: null, threads: null, at: null, stopped: false } })?.line).toBe("The map: no figures yet. BlueMap says where it stands half a minute after the server is running.");
    expect(mapProgress({ ...base, plan: render, phase: "render" })?.percent).toBeNull();
  });
  it("is named in the mode's line", () => {
    expect(modeText({ ...base, plan: render, doing: "render" }).line).toBe("On: when nobody's online, rendering the map, until the map is done. Right now: rendering the map.");
    expect(modeText({ ...base, plan: { mode: "now", ...on, what: "both", capHours: 8, ranMs: 3_600_000 }, doing: "pause:lag" }).line).toBe("On: now, whoever is playing, generating, then rendering the map, 8 hours of generating and rendering at most (1.0 so far). Right now: the map waits: the server is slow and somebody is playing.");
  });
  it("is in the event log in words", () => {
    const portal = { name: null, role: "system" } as const;
    const alex = { name: "Bramble09", role: "ADMIN" } as const;
    expect(describeAction("world.pregenOn", alex, { mode: "empty", what: "render", x: 0, z: 0, radius: 1500 }, "OK")).toBe("Bramble09 turned the map render on: when nobody's online; 1500 blocks around 0, 0");
    expect(describeAction("world.pregenOn", alex, { mode: "empty", what: "both", x: 0, z: 0, radius: 1500, newArea: true }, "OK")).toBe("Bramble09 turned the pre-generation on: when nobody's online, the map rendered afterwards; 1500 blocks around 0, 0 (a new area)");
    expect(describeAction("world.pregenOff", portal, { reason: "done", what: "render", phase: "done", percent: null, mapPercent: null, radius: 1500 }, "OK")).toBe("The map is rendered (radius 1500)");
    expect(describeAction("world.pregenOff", portal, { reason: "done", what: "both", phase: "done", percent: 100, radius: 1500 }, "OK")).toBe("Pre-generation finished and the map rendered (radius 1500)");
    expect(describeAction("world.pregenOff", alex, { reason: "asked", what: "render", phase: "render", mapPercent: 10.6, radius: 1500 }, "OK")).toBe("Bramble09 stopped the map render, at 10.6% of the task in hand");
    expect(describeAction("world.pregenOff", alex, { reason: "asked", what: "both", phase: "generate", percent: 67.4, radius: 1500 }, "OK")).toBe("Bramble09 stopped the pre-generation, at 67.4%");
    expect(describeAction("world.pregenOff", portal, { reason: "done", what: "generate", phase: "done", percent: 100, radius: 1500 }, "OK")).toBe("Pre-generation finished (100%, radius 1500)");
    expect(describeAction("map.update", alex, { map: "world", x: 0, z: 0, radius: 1500 }, "OK")).toBe("Bramble09 asked for the map to be brought up to date: 1500 blocks around 0, 0");
  });
});

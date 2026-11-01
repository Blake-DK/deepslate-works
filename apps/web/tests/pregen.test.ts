import { describe, expect, it } from "vitest";
import { mapProgress, modeText, pregenCost, progress, saidAgo, sleepText, worldName, worldsProgress, type Pregen } from "@/lib/pregen";
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

describe("two worlds at once", () => {
  it("has a line and a bar for each world, and none when there is one world", () => {
    const moon = { x: 0, z: 0, radius: 3000, world: "deepslate:moon" };
    const p: Pregen = {
      ...base,
      status: "running",
      worlds: [
        { world: "minecraft:overworld", area: AREA, total: 35721, status: "finished", chunks: 35721, percent: 100, eta: null, rate: null },
        { world: "deepslate:moon", area: moon, total: 141376, status: "running", chunks: 70688, percent: 50, eta: "0:30:00", rate: 40 },
      ],
    };
    expect(worldsProgress(p)).toEqual([
      { name: "the main world", world: "minecraft:overworld", radius: 1500, line: "Done: 35,721 chunks, 100%.", percent: 100 },
      { name: "Ashmoon", world: "deepslate:moon", radius: 3000, line: "70,688 of 141,376 chunks, 50.0%, about 0:30:00 to go, 40 chunks a second.", percent: 50 },
    ]);
    expect(worldsProgress(base)).toEqual([]);
  });
});

// 2026-10-31: one world at a time, and figures that move (Alex: "i want it to live update what its proccess it")
describe("one world at a time, live", () => {
  const nether = { x: 0, z: 0, radius: 5000, world: "minecraft:the_nether" };
  const moon = { x: 0, z: 0, radius: 5000, world: "deepslate:moon" };
  it("says where chunky is working, in blocks (chunky gives the chunk)", () => {
    expect(progress({ ...base, total: 1565001, status: "running", chunks: 37633, percent: 2.4, eta: "31:52:47", rate: 13.3, current: { x: 105, z: -94 } }).line).toBe("37,633 of 1,565,001 chunks, 2.4%, about 31:52:47 to go, 13 chunks a second, now at x 1,688, z -1,496.");
    expect(progress({ ...base, status: "paused", chunks: 100, percent: 0.3, current: { x: 1, z: 1 } }).line).toBe("100 of 35,721 chunks, 0.3%.");
  });
  it("a world whose turn has not come says so, after the world before it, with its figures when it has some", () => {
    const p: Pregen = {
      ...base,
      status: "running",
      worlds: [
        { world: "minecraft:overworld", area: { ...AREA, radius: 10000 }, total: 1565001, status: "running", chunks: 39332, percent: 2.51, eta: "76:00:30", rate: 5.6 },
        { world: "minecraft:the_nether", area: nether, total: 391876, status: "none", chunks: null, percent: null, eta: null, rate: null },
        { world: "deepslate:moon", area: moon, total: 391876, status: "paused", chunks: 99511, percent: 25.31, eta: null, rate: null },
      ],
    };
    expect(worldsProgress(p).map((w) => w.line)).toEqual([
      "39,332 of 1,565,001 chunks, 2.5%, about 76:00:30 to go, 6 chunks a second.",
      "Waits its turn, after the main world (391,876 chunks).",
      "Waits its turn, after the Nether: 99,511 of 391,876 chunks so far, 25.3%.",
    ]);
  });
  // 2026-11-01: two at a time (api's AT_ONCE); an api before then sends no atOnce and means one
  it("with two at a time, the first two unfinished worlds have their turn and the later ones wait", () => {
    const end = { x: 0, z: 0, radius: 5000, world: "minecraft:the_end" };
    const p: Pregen = {
      ...base,
      status: "running",
      atOnce: 2,
      worlds: [
        { world: "minecraft:overworld", area: { ...AREA, radius: 10000 }, total: 1565001, status: "running", chunks: 39332, percent: 2.51, eta: "76:00:30", rate: 5.6 },
        { world: "minecraft:the_nether", area: nether, total: 391876, status: "running", chunks: 1200, percent: 0.31, eta: "18:00:00", rate: 6 },
        { world: "minecraft:the_end", area: end, total: 391876, status: "none", chunks: null, percent: null, eta: null, rate: null },
        { world: "deepslate:moon", area: moon, total: 391876, status: "paused", chunks: 99511, percent: 25.31, eta: null, rate: null },
      ],
    };
    expect(worldsProgress(p).map((w) => w.line)).toEqual([
      "39,332 of 1,565,001 chunks, 2.5%, about 76:00:30 to go, 6 chunks a second.",
      "1,200 of 391,876 chunks, 0.3%, about 18:00:00 to go, 6 chunks a second.",
      "Waits its turn: two worlds generate at a time (391,876 chunks).",
      "Waits its turn: two worlds generate at a time: 99,511 of 391,876 chunks so far, 25.3%.",
    ]);
    const mainDone: Pregen = { ...p, worlds: p.worlds!.map((w, i) => (i === 0 ? { ...w, status: "finished", chunks: 1565001, percent: 100, eta: null, rate: null } : w)) };
    expect(worldsProgress(mainDone)[2]!.line).not.toContain("Waits");
  });
  it("says how old chunky's last figures are", () => {
    const now = Date.parse("2026-10-31T15:25:09Z");
    expect(saidAgo("2026-10-31T15:24:57Z", now)).toBe("12 s ago");
    expect(saidAgo("2026-10-31T15:20:09Z", now)).toBe("5 min ago");
    expect(saidAgo(null, now)).toBeNull();
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
  it("is about an hour and a half and half a gigabyte for 1500 blocks, and three days for 10000 (6 chunks a second, 2026-11-01)", () => {
    const small = pregenCost(1500);
    expect(small.chunks).toBe(35721); // what chunky counted for it on 2026-09-29
    expect(Math.round(small.hours * 60)).toBe(99);
    expect(small.gb).toBeGreaterThan(0.4);
    expect(small.gb).toBeLessThan(0.5);
    const big = pregenCost(10000);
    expect(big.hours).toBeGreaterThan(72);
    expect(big.hours).toBeLessThan(73);
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
  it("says when the old map is being deleted first", () => {
    expect(mapProgress({ ...base, plan: { ...render, purge: true }, phase: "render", map: { ...map, status: "purging", percent: 40 } })).toEqual({ line: "The map: the old one is being deleted, 40.0%. BlueMap renders it anew after that.", percent: null });
    expect(modeText({ ...base, plan: { ...render, purge: true }, doing: "render" }).line).toBe("On: when nobody's online, rendering the map anew (the old one is deleted first), until the map is done. Right now: rendering the map.");
    expect(describeAction("world.pregenOn", { name: "Bramble09", role: "ADMIN" }, { mode: "now", what: "render", purge: true, x: 0, z: 0, radius: 1500 }, "OK")).toBe("Bramble09 turned the map render on: now, whoever is playing, the old map deleted first; 1500 blocks around 0, 0");
    expect(describeAction("map.purge", { name: "Bramble09", role: "ADMIN" }, { map: "world" }, "OK")).toBe("Bramble09 had the map world deleted, to be rendered anew");
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

describe("worldName", () => {
  it("names each world that can be pre-generated in plain words, Ashmoon among them (docs/55 M5; the Moon, named by Alex on 2026-10-14)", () => {
    expect([worldName(), worldName("minecraft:the_nether"), worldName("minecraft:the_end"), worldName("deepslate:moon"), worldName("deepslate:frontier_s1")]).toEqual(["the main world", "the Nether", "the End", "Ashmoon", "the Frontier (s1)"]);
  });
});

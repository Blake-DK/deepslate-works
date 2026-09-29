import { describe, expect, it } from "vitest";
import { planText, pregenCost, pregenText, type Pregen } from "@/lib/pregen";

const base: Pregen = { status: "none", world: null, chunks: null, percent: null, eta: null, rate: null, pausedBy: null, at: null };

describe("pregenText", () => {
  it("says it is off, and that it stays off, when it is paused", () => {
    const t = pregenText({ ...base, status: "paused", chunks: 24069, percent: 67.38 });
    expect(t.label).toBe("off (paused)");
    expect(t.line).toBe("Paused at 67.4% (24,069 chunks made). It stays paused until you turn it on.");
    expect(t.can).toEqual({ start: true, continue: true, pause: false, cancel: true });
  });
  it("says why when it paused by itself", () => {
    expect(pregenText({ ...base, status: "paused", chunks: 100, percent: 1, pausedBy: "empty" }).line).toContain("by itself: the server had been empty for three minutes");
  });
  it("offers only a pause while it runs", () => {
    const t = pregenText({ ...base, status: "running", chunks: 9511, percent: 26.63, eta: "0:08:30", rate: 51.4 });
    expect(t.label).toBe("on");
    expect(t.line).toBe("Running: 9,511 chunks made, 26.6%, about 0:08:30 to go, 51 chunks a second.");
    expect(t.can).toEqual({ start: false, continue: false, pause: true, cancel: false });
  });
  it("knows done, called off, and not knowing", () => {
    expect(pregenText({ ...base, status: "finished", chunks: 35721, percent: 100 }).label).toBe("done");
    expect(pregenText({ ...base, status: "cancelled" }).can.continue).toBe(false);
    expect(pregenText(base).label).toBe("off");
    expect(pregenText(null).can).toEqual({ start: false, continue: false, pause: false, cancel: false });
  });
});

describe("planText", () => {
  it("says off, and that nothing starts by itself", () => {
    expect(planText({ ...base, plan: { mode: "off" } }, null)).toEqual({ on: false, line: "Off. Nothing generates, and nothing will start by itself." });
    expect(planText(base, null).on).toBe(false);
    expect(planText(null, null).on).toBe(false);
  });
  it("says until when, or that it goes on whenever nobody is on", () => {
    const since = "2026-09-29T20:00:00.000Z";
    expect(planText({ ...base, plan: { mode: "hours", until: "2026-09-30T04:00:00.000Z", whilePlaying: false, since }, doing: "run" }, "Wed 05:00").line).toBe("On until Wed 05:00, waiting whenever somebody is playing. Right now: generating.");
    expect(planText({ ...base, plan: { mode: "empty", until: null, whilePlaying: false, since }, doing: "pause:playing" }, null).line).toBe("On whenever nobody is on the server, until the area is done. Right now: waiting: somebody is playing.");
    expect(planText({ ...base, plan: { mode: "hours", until: null, whilePlaying: true, since } }, "Wed 05:00").line).toContain("also while people are playing");
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

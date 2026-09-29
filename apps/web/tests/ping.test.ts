import { describe, expect, it } from "vitest";
import { average, pingSlots, pingTone, worstPing } from "@/lib/ping";

describe("pingTone", () => {
  it("is green under 80, amber under 150, red from there (docs/05)", () => {
    expect([0, 79, 80, 149, 150, 900].map(pingTone)).toEqual(["good", "good", "warn", "warn", "bad", "bad"]);
  });
});

describe("average", () => {
  it("rounds, and has nothing to say about nothing", () => {
    expect(average([20, 25])).toBe(23);
    expect(average([41])).toBe(41);
    expect(average([])).toBeNull();
  });
});

describe("pingSlots", () => {
  const from = new Date("2026-09-29T10:00:00Z");
  const to = new Date("2026-09-29T10:10:00Z");
  const at = (min: number, sec = 0) => new Date(from.getTime() + min * 60_000 + sec * 1000);
  it("spreads the readings over the slots and averages what falls together", () => {
    const rows = [{ at: at(0, 15), ms: 20 }, { at: at(0, 45), ms: 30 }, { at: at(5), ms: 100 }, { at: at(10), ms: 60 }];
    expect(pingSlots(rows, from, to, 10)).toEqual([25, null, null, null, null, 100, null, null, null, 60]);
  });
  it("leaves out what is outside, and copes with no time at all", () => {
    expect(pingSlots([{ at: new Date("2026-09-29T09:00:00Z"), ms: 5 }], from, to, 2)).toEqual([null, null]);
    expect(pingSlots([], from, from, 10)).toEqual([]);
  });
});

describe("worstPing", () => {
  it("is the highest among those who have been measured", () => {
    expect(worstPing([{ name: "a_player", ping: 20 }, { name: "far_away", ping: 210 }, { name: "just_joined", ping: null }])).toEqual({ name: "far_away", ms: 210 });
    expect(worstPing([{ name: "just_joined", ping: null }])).toBeNull();
    expect(worstPing([])).toBeNull();
  });
});

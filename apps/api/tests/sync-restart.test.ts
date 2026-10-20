import { describe, expect, it } from "vitest";
import { afterSync } from "../src/modpack/sync.js";

// 2026-10-09: the reopening's Sync ran while live was stopped on purpose, and AMP's Core.Restart starts a stopped
// server, so a stopped live server is never brought up by a Sync. 2026-10-20 (Alex: "the sync script should start the
// server too"): a sleeping server is woken to load new mods, and the test server is left running whatever it was.

describe("what a Sync does to the server", () => {
  it("restarts a running server when the mods changed, and leaves it running when they did not", () => {
    for (const test of [false, true]) {
      expect(afterSync(20, true, test)).toBe("restart");
      expect(afterSync(20, false, test)).toBe("leave");
    }
  });
  it("wakes a sleeping server (AMP 45, 50) to load new mods, live or test", () => {
    for (const s of [45, 50]) for (const test of [false, true]) expect(afterSync(s, true, test), `${s} ${test}`).toBe("start");
  });
  it("lets a sleeping live server sleep on when nothing changed; the test server is started", () => {
    expect(afterSync(50, false, false)).toBe("leave");
    expect(afterSync(50, false, true)).toBe("start");
  });
  it("never starts a stopped live server (stopped on purpose), changed mods or not", () => {
    expect(afterSync(0, true, false)).toBe("leave");
    expect(afterSync(0, false, false)).toBe("leave");
  });
  it("starts a stopped test server, changed mods or not (the 2026-10-20 test: copied while it was down, never loaded)", () => {
    expect(afterSync(0, true, true)).toBe("start");
    expect(afterSync(0, false, true)).toBe("start");
  });
  it("leaves a starting, restarting, stopping, failed or unknown server alone", () => {
    for (const s of [5, 10, 30, 40, 100, 999, null, undefined]) for (const test of [false, true]) expect(afterSync(s, true, test), `${s} ${test}`).toBe("leave");
  });
});

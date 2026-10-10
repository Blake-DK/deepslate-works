import { describe, expect, it } from "vitest";
import { restartAfterSync } from "../src/modpack/sync.js";

// 2026-10-09: the reopening's Sync runs while live is stopped on purpose. AMP's Core.Restart starts a stopped server, so
// a Sync that changed the mods restarts only a server that is running.

describe("a Sync that changed the mods", () => {
  it("restarts a running server (AMP state 20)", () => {
    expect(restartAfterSync(20)).toBe(true);
  });
  it("never a stopped, sleeping, starting or unknown one", () => {
    for (const s of [0, 10, 30, 40, 50, 100, 999, null, undefined]) expect(restartAfterSync(s), String(s)).toBe(false);
  });
});

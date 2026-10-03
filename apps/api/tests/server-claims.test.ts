import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/audit.js", () => ({ audit: async () => {} }));

import { actions, parsePlace, parsePos, spawnClaimArea } from "../src/actions/registry.js";
import { runAction, setGapWait } from "../src/actions/run.js";

// docs/24 §7 (2026-10-03): the spawn claim follows SPAWN_POS, and the two claims are not sent back to back.
const ctx = (spawn: string | null) => ({ limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: spawn ? parsePos(spawn) : null, portalUrl: "https://deepslate.example" });

describe("opac.serverClaims", () => {
  afterEach(() => setGapWait((ms) => new Promise((r) => setTimeout(r, ms))));

  it("claims 128 by 128 blocks around SPAWN_POS, on chunk edges", () => {
    expect(spawnClaimArea(parsePos("107.5 126 87.5"))).toEqual({ x1: 32, z1: 16, x2: 159, z2: 143 }); // chunks 2..9, 1..8
    expect(actions["opac.serverClaims"].build(ctx("107.5 126 87.5"), {})[0]).toBe("oclaims server claim in minecraft:overworld 32 16 159 143 anyway");
  });
  it("without SPAWN_POS, around 0, 0 as before", () => {
    expect(spawnClaimArea(null)).toEqual({ x1: -64, z1: -64, x2: 63, z2: 63 });
    expect(actions["opac.serverClaims"].build(ctx(null), {})).toEqual([
      "oclaims server claim in minecraft:overworld -64 -64 63 63 anyway",
      "oclaims server claim in deepslate:limbo -16 -16 15 15 anyway",
    ]);
  });
  it("snaps a spawn west or north of 0 to the chunk it is in", () => {
    expect(spawnClaimArea(parsePos("-0.5 70 -17"))).toEqual({ x1: -80, z1: -96, x2: 47, z2: 31 }); // chunk (-1, -2)
  });
  it("waits between the two claims, and only between them", async () => {
    const events: string[] = [];
    setGapWait(async (ms) => { events.push(`wait ${ms}`); });
    const amp = { call: async (_m: string, _f: string, a: { message: string }) => { events.push(a.message.split(" in ")[1]!.split(" ")[0]!); return {}; } };
    const r = await runAction(amp as never, ctx("107.5 126 87.5"), "opac.serverClaims", {}, null);
    expect(r).toEqual({ ok: true, commands: 2 });
    expect(events).toEqual(["minecraft:overworld", "wait 10000", "deepslate:limbo"]);
  });
  it("other actions are sent without a wait", async () => {
    const waits: number[] = [];
    setGapWait(async (ms) => { waits.push(ms); });
    const amp = { call: async () => ({}) };
    await runAction(amp as never, ctx(null), "world.standable", { x: 0, y: 105, z: 0 }, null);
    expect(waits).toEqual([]);
  });
});

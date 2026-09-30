import { describe, expect, it } from "vitest";
import { toLive } from "../src/status/poller.js";
import { OnlineWatch, ASK_AGAIN_MS } from "../src/status/online.js";
import type { Amp, AmpStatus } from "../src/amp/client.js";

// 2026-09-29 22:44 to 2026-09-30 05:25: m1_owl was turned away by the server three times ("Incompatible client!"),
// but AMP's own player list kept him. Home showed him online for hours, and the portal asked the server `list`
// every 20 s and got "There are 0 … players online" back each time.

const amp = (players: string[]): AmpStatus => ({ state: "Running", stateCode: 20, players, maxPlayers: 20, cpu: 1, memMb: 1, memMaxMb: 6144, tps: 20, uptime: "0:01:00:00" });
const tail = (online: string[], listedAt: number | null, state = 20) => ({ online: new Set(online), uuidByName: new Map<string, string>(), listedAt, state });

describe("who is on", () => {
  it("before the server has answered `list`, anyone in either list counts (api just started)", () => {
    expect(toLive(amp(["m1_owl"]), tail([], null), new Date()).players).toEqual(["m1_owl"]);
  });
  it("after it has answered, the console's list is who is on: a name only AMP has is not shown", () => {
    const l = toLive(amp(["m1_owl"]), tail([], Date.now()), new Date());
    expect(l.players).toEqual([]);
    expect(l.online).toEqual([]);
    expect(l.ampPlayers).toEqual(["m1_owl"]); // kept, only to know when to ask again
    expect(toLive(amp(["m1_owl"]), tail(["bramble09"], Date.now()), new Date()).players).toEqual(["bramble09"]);
  });
  it("asks the server once per disagreement, not every 20 s", async () => {
    let asked = 0;
    const fake: Amp = { ping: async () => {}, getStatus: async () => amp([]), call: (async (_m: string, _f: string, body?: { message?: string }) => { if (body?.message === "list") asked++; return {}; }) as Amp["call"] };
    let ampList = ["m1_owl"];
    const w = new OnlineWatch(fake, tail([], Date.now()) as never, () => ({ limbo: { dimension: "deepslate:limbo", x: 0, y: 65, z: 0 }, spawn: null, portalUrl: "https://deepslate.dsw.test" }) as never, () => ampList, () => {});
    const t0 = Date.parse("2026-09-29T22:45:00Z");
    for (let i = 0; i < 30; i++) await w.check(t0 + i * 20_000); // ten minutes of the same disagreement
    expect(asked).toBe(1);
    await w.check(t0 + ASK_AGAIN_MS + 1); // asked again after a while
    expect(asked).toBe(2);
    ampList = ["m1_owl", "samoyedx"]; // AMP's list changed: a new question
    await w.check(t0 + ASK_AGAIN_MS + 20_000);
    expect(asked).toBe(3);
  });
});

describe("an admin's first join", () => {
  it("is held for the link like anyone's: admins skip Play first, not the link", async () => {
    const { decideJoin, doorReason } = await import("../src/players/limbo.js");
    // m1owl (admin) has no Minecraft account linked yet: the UUID is nobody's
    expect(decideJoin(null)).toEqual({ action: "hold", reason: "unknown uuid" });
    // once linked, the door lets an admin in whatever else is on
    expect(doorReason({ role: "ADMIN", earlyAccess: false }, { live: false, requirePlay: true, windowMin: 30, run: null, pack: "x", now: new Date(), minInstaller: "1.5.0" })).toBeNull();
  });
});

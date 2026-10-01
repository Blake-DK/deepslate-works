import { describe, expect, it } from "vitest";
import { isTpsLine, parse } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp, type Amp } from "../src/amp/client.js";
import { parsePlace } from "../src/actions/registry.js";
import { RestartSchedule } from "../src/status/restart.js";
import { changes, Distances, readProperties, Refusal, SIM_NODE, SIM_PERMISSION, VIEW_NODE, VIEW_PERMISSION } from "../src/status/distance.js";
import { describeAction } from "../src/shared/events.js";

// Admin → Server → Settings (planner, 2026-10-01): view and simulation distance through AMP, TPS/MSPT from `neoforge tps`.

describe("neoforge tps", () => {
  it("reads the overall line and each dimension's (NeoForge 1.21.1 en_us: \"%s: %s TPS (%s ms/tick)\")", () => {
    expect(parse("Overall: 20.000 TPS (12.345 ms/tick)")).toEqual([{ type: "tps", scope: "overall", tps: 20, mspt: 12.345 }]);
    expect(parse("[16:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: Overall: 19.512 TPS (51.250 ms/tick)")).toEqual([{ type: "tps", scope: "overall", tps: 19.512, mspt: 51.25 }]);
    expect(parse("minecraft:overworld: 20.000 TPS (3.133 ms/tick)")).toEqual([{ type: "tps", scope: "minecraft:overworld", tps: 20, mspt: 3.133 }]);
    expect(parse("deepslate:limbo: 20.000 TPS (0.010 ms/tick)")).toEqual([{ type: "tps", scope: "deepslate:limbo", tps: 20, mspt: 0.01 }]);
    expect(parse("Overall: 20,000 TPS (1,500 ms/tick)")).toEqual([{ type: "tps", scope: "overall", tps: 20, mspt: 1.5 }]);
  });
  it("takes nothing a player types for one", () => {
    expect(parse("<bramble09> Overall: 20.000 TPS (1.000 ms/tick)")).toEqual([{ type: "chat", name: "bramble09", text: "Overall: 20.000 TPS (1.000 ms/tick)" }]);
    expect(isTpsLine("<bramble09> Overall: 20.000 TPS (1.000 ms/tick)")).toBe(false);
    expect(isTpsLine("Overall: 20.000 TPS (1.000 ms/tick)")).toBe(true);
  });
  it("keeps the answer off the console page only while the portal has just asked", () => {
    const tail = new ConsoleTail(new MockAmp(), () => {});
    tail.ingest("Overall: 20.000 TPS (2.000 ms/tick)");
    tail.hushTps(5_000);
    tail.ingest("Overall: 20.000 TPS (3.000 ms/tick)");
    tail.ingest("bramble09 joined the game");
    expect(tail.lines).toEqual(["Overall: 20.000 TPS (2.000 ms/tick)", "bramble09 joined the game"]);
  });
});

describe("server.properties and the audit lines", () => {
  it("reads the two distances", () => {
    expect(readProperties("#Minecraft server properties\nmotd=Deepslate Works\nsimulation-distance=8\nview-distance=10\n")).toEqual({ view: 10, sim: 8 });
    expect(readProperties("view-distance=12\r\n")).toEqual({ view: 12 });
    expect(readProperties("")).toEqual({});
  });
  it("one line for each value that moves", () => {
    expect(changes({ view: 10, sim: 8 }, { view: 12, sim: 8 })).toEqual([{ what: "view", from: 10, to: 12 }]);
    expect(changes({ view: 10, sim: 8 }, { view: 10, sim: 8 })).toEqual([]);
    expect(changes({}, { view: 10, sim: 6 })).toEqual([{ what: "view", from: null, to: 10 }, { what: "simulation", from: null, to: 6 }]);
  });
  it("reads like the planner wrote it: \"Alex set view distance 10 → 12\"", () => {
    const alex = { role: "ADMIN" as const, name: "Alex" };
    expect(describeAction("server.distance", alex, { what: "view", from: 10, to: 12, apply: "next" })).toBe("Alex set view distance 10 → 12 (from the next restart)");
    expect(describeAction("server.distance", alex, { what: "simulation", from: 8, to: 6, apply: "now" })).toBe("Alex set simulation distance 8 → 6 (restart in 1 minute)");
    expect(describeAction("server.distance", alex, { what: "view", from: 10, to: 12, apply: "now", refused: "amp_permission" }, "DENIED")).toBe("Alex tried to set view distance 10 → 12: AMP does not let the portal change it (refused)");
  });
});

/** AMP as far as this card uses it: two settings, two permissions, the console. */
function fakeAmp(o: { allowed?: boolean; state?: number } = {}) {
  const config: Record<string, number> = { [VIEW_NODE]: 10, [SIM_NODE]: 8 };
  const sent: string[] = [];
  const amp: Amp = {
    async ping() {},
    async getStatus() {
      return { state: "Running", stateCode: o.state ?? 20, players: [], maxPlayers: 20, cpu: 1, memMb: 1, memMaxMb: 2, tps: 20, uptime: "0" };
    },
    async hasPermission(node: string) {
      return (node === VIEW_PERMISSION || node === SIM_PERMISSION) && o.allowed !== false;
    },
    async call<T>(module: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (method === "GetConfig") return { CurrentValue: config[String(params.node)] } as T;
      if (method === "SetConfig") {
        config[String(params.node)] = Number(params.value);
        return { Status: true } as T;
      }
      if (method === "SendConsoleMessage") {
        sent.push(String(params.message));
        return null as T;
      }
      if (module === "FileManagerPlugin") throw new Error("no files here");
      return null as T;
    },
  };
  return { amp, config, sent };
}

function setUp(o: { allowed?: boolean; state?: number } = {}) {
  const f = fakeAmp(o);
  const tail = new ConsoleTail(f.amp, () => {});
  tail.state = o.state ?? 20;
  const ctx = () => ({ limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" });
  const restarts = new RestartSchedule(f.amp, ctx, () => {});
  const d = new Distances(f.amp, tail, ctx, restarts, () => {});
  d.start();
  return { ...f, tail, restarts, d };
}

describe("setting the distances", () => {
  it("writes only what moved to AMP and, with \"next\", restarts nothing", async () => {
    const t = setUp();
    const r = await t.d.set({ view: 12, sim: 8 }, "next", null);
    expect(t.config).toEqual({ [VIEW_NODE]: 12, [SIM_NODE]: 8 });
    expect(r.changed).toBe(1);
    expect(r.restart).toBeNull();
    expect(t.restarts.current).toBeNull();
    expect(r.state.amp).toEqual({ view: 12, sim: 8 });
  });
  it("with \"now\" plans the one-minute restart with the warning", async () => {
    const t = setUp();
    const r = await t.d.set({ view: 12, sim: 6 }, "now", null);
    expect(r.changed).toBe(2);
    expect(r.restart).not.toBeNull();
    expect(t.restarts.current?.minutes).toBe(1);
    t.restarts.stop();
  });
  it("refuses without AMP's permission, out of range, and \"now\" while the server is not up", async () => {
    await expect(setUp({ allowed: false }).d.set({ view: 12, sim: 8 }, "next", null)).rejects.toMatchObject({ code: "amp_permission", status: 403 });
    await expect(setUp().d.set({ view: 17, sim: 8 }, "next", null)).rejects.toBeInstanceOf(Refusal);
    await expect(setUp().d.set({ view: 10, sim: 3 }, "next", null)).rejects.toMatchObject({ code: "validation" });
    await expect(setUp({ state: 0 }).d.set({ view: 12, sim: 8 }, "now", null)).rejects.toMatchObject({ code: "server_offline" });
  });
  it("asks for the tick report and reads the overall line", async () => {
    const t = setUp();
    setTimeout(() => {
      t.tail.ingest("minecraft:overworld: 20.000 TPS (7.500 ms/tick)");
      t.tail.ingest("Overall: 20.000 TPS (9.250 ms/tick)");
    }, 20);
    const tick = await t.d.measure();
    expect(t.sent).toEqual(["neoforge tps"]);
    expect(tick).toMatchObject({ tps: 20, mspt: 9.25 });
    expect(t.tail.lines).toEqual([]); // the portal asked: kept off the console page
    expect(await t.d.measure()).toMatchObject({ mspt: 9.25 }); // fresh: not asked again
    expect(t.sent).toHaveLength(1);
  });
  it("adds the dimensions up when there is no Overall line (this server, 2026-10-01)", async () => {
    const t = setUp();
    setTimeout(() => {
      for (const l of ["Overworld: 20.000 TPS (43.720 ms/tick)", "The Nether: 20.000 TPS (0.022 ms/tick)", "deepslate:limbo: 19.500 TPS (0.072 ms/tick)", "The End: 20.000 TPS (0.006 ms/tick)"]) t.tail.ingest(l);
    }, 20);
    expect(await t.d.measure()).toMatchObject({ tps: 19.5, mspt: 43.82 });
  });
  it("never asks a server that is not up", async () => {
    const t = setUp({ state: 50 });
    expect(await t.d.measure()).toBeNull();
    expect(t.sent).toEqual([]);
  });
});

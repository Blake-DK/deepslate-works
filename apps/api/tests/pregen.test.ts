import { describe, expect, it } from "vitest";
import { parse } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp } from "../src/amp/client.js";
import { EMPTY_PAUSE_MS, keeperStep, nextPregen, PregenKeeper, PregenWatch, roundLength, shouldPauseEmpty, type KeeperView, type PregenPlan, type PregenState } from "../src/status/pregen.js";
import { actions, parsePos } from "../src/actions/registry.js";

const NONE: PregenState = { status: "none", world: null, chunks: null, percent: null, eta: null, rate: null, pausedBy: null, at: null };
const at = new Date("2026-09-29T11:46:00Z");

// Lines as the server printed them on 2026-09-29.
describe("what chunky says", () => {
  it("is read, with and without [Chunky] in front", () => {
    expect(parse("Task running for minecraft:overworld. Processed: 9511 chunks (26.63%), ETA: 0:08:30, Rate: 51.4 cps, Current: 73, 37")).toEqual([{ type: "pregen", what: "running", world: "minecraft:overworld", chunks: 9511, percent: 26.63, eta: "0:08:30", rate: 51.4 }]);
    expect(parse("[29Sep2026 11:13:59.717] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: [Chunky] Task running for minecraft:overworld. Processed: 9511 chunks (26.63%), ETA: 0:08:30, Rate: 51.4 cps, Current: 73, 37")[0]).toMatchObject({ type: "pregen", what: "running", chunks: 9511 });
    expect(parse("Task started in minecraft:overworld for the square region centered at 0, 0 with radius 1500.")).toEqual([{ type: "pregen", what: "started", world: "minecraft:overworld" }]);
    expect(parse("Task paused for minecraft:overworld.")).toEqual([{ type: "pregen", what: "paused", world: "minecraft:overworld" }]);
    expect(parse("Task stopped for minecraft:overworld.")).toEqual([{ type: "pregen", what: "stopped", world: "minecraft:overworld" }]);
    expect(parse("Task finished for minecraft:overworld. Processed: 35721 chunks (100.00%), Total time: 0:12:40")).toEqual([{ type: "pregen", what: "finished", world: "minecraft:overworld", chunks: 35721 }]);
  });
  it("is not taken from chat or from the console's `say`", () => {
    expect(parse("<bramble09> Task finished for minecraft:overworld.").some((e) => e.type === "pregen")).toBe(false);
    expect(parse("[Server] Task finished for minecraft:overworld.")).toEqual([]);
  });
});

describe("nextPregen", () => {
  const running = nextPregen(NONE, { type: "pregen", what: "running", world: "minecraft:overworld", chunks: 24069, percent: 67.38, eta: "0:03:41", rate: 52.7 }, at);
  it("keeps where it got to when it is paused, or when the server stops under it", () => {
    expect(running.status).toBe("running");
    for (const what of ["paused", "stopped"] as const) expect(nextPregen(running, { type: "pregen", what, world: "minecraft:overworld" }, at)).toMatchObject({ status: "paused", chunks: 24069, percent: 67.38, eta: null });
  });
  it("does not call a finished task paused because the server stopped", () => {
    const done = nextPregen(running, { type: "pregen", what: "finished", world: "minecraft:overworld", chunks: 35721 }, at);
    expect(done).toMatchObject({ status: "finished", percent: 100, chunks: 35721 });
    expect(nextPregen(done, { type: "pregen", what: "stopped", world: null }, at).status).toBe("finished");
  });
});

describe("an empty server", () => {
  const running: PregenState = { ...NONE, status: "running", percent: 50, chunks: 1 };
  const now = 10_000_000;
  it("has its pre-generation paused after three minutes, not before", () => {
    expect(shouldPauseEmpty(running, true, 0, now - EMPTY_PAUSE_MS, now)).toBe(true);
    expect(shouldPauseEmpty(running, true, 0, now - EMPTY_PAUSE_MS + 1000, now)).toBe(false);
    expect(shouldPauseEmpty(running, true, 0, null, now)).toBe(false);
  });
  it("is the only one: with somebody on, or nothing running, nothing is paused", () => {
    expect(shouldPauseEmpty(running, true, 1, now - EMPTY_PAUSE_MS, now)).toBe(false);
    expect(shouldPauseEmpty({ ...running, status: "paused" }, true, 0, now - EMPTY_PAUSE_MS, now)).toBe(false);
    expect(shouldPauseEmpty(running, false, 0, now - EMPTY_PAUSE_MS, now)).toBe(false);
  });
});

describe("PregenWatch", () => {
  it("never starts or continues anything: the only thing it ever sends is a pause", async () => {
    const sent: string[] = [];
    const amp = new (class extends MockAmp {
      override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
        if (method === "SendConsoleMessage") sent.push(String(params?.message));
        return {} as T;
      }
    })();
    const tail = new ConsoleTail(amp, () => {});
    let now = 1_000_000;
    const watch = new PregenWatch(amp, tail, () => ({ limbo: parsePos("0 250 0"), spawn: null, portalUrl: "https://deepslate.dsw.test" }), () => {}, () => now);
    watch.start(); // listens to the console; `look` is called by hand
    tail.state = 20;
    await watch.look();
    tail.ingest("Task paused for minecraft:overworld.");
    now += 10 * 60_000;
    await watch.look();
    expect(sent).toEqual([]); // paused, or nothing at all: left alone, however long the server is empty
    tail.ingest("Task running for minecraft:overworld. Processed: 100 chunks (0.28%), ETA: 0:12:00, Rate: 50.0 cps, Current: 1, 1");
    await watch.look(); // empty from now
    now += EMPTY_PAUSE_MS + 1000;
    await watch.look();
    expect(sent).toEqual(["chunky pause", "save-all flush"]);
    expect(watch.state).toMatchObject({ status: "paused", pausedBy: "empty" });
  });
  it("has commands for on, pause and off, and none of them takes words from outside", () => {
    const ctx = { limbo: parsePos("0 250 0"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
    expect(actions["world.pregenContinue"].build(ctx, {})).toEqual(["chunky quiet 30", "chunky continue"]);
    expect(actions["world.pregenPause"].build(ctx, {})).toEqual(["chunky pause", "save-all flush"]);
    expect(actions["world.pregenCancel"].build(ctx, {})).toEqual(["chunky cancel", "chunky confirm"]);
  });
});

describe("running it for hours", () => {
  const now = Date.parse("2026-09-29T20:00:00Z");
  const hours: Exclude<PregenPlan, { mode: "off" }> = { mode: "hours", until: "2026-09-30T04:00:00.000Z", whilePlaying: false, task: null, started: true, since: "2026-09-29T20:00:00.000Z", by: null };
  const empty: Exclude<PregenPlan, { mode: "off" }> = { ...hours, mode: "empty", until: null };
  const v = (over: Partial<KeeperView>): KeeperView => ({ state: 20, online: 0, emptyForMs: 0, stoppingForMs: null, pregen: "paused", now, ...over });

  it("generates in rounds that end well before AMP's sleep", () => {
    expect(roundLength(null)).toBe(210_000);
    expect(roundLength(380_000)).toBe(280_000); // AMP was seen to wait 6 min 20 s: 100 s earlier
    expect(roundLength(150_000)).toBe(120_000); // never under two minutes
    expect(roundLength(3_000_000)).toBe(600_000); // never over ten
    expect(keeperStep(empty, v({ emptyForMs: 60_000 }), 210_000)).toBe("run");
    expect(keeperStep(empty, v({ emptyForMs: 210_000, pregen: "running" }), 210_000)).toBe("pause:round");
  });
  it("wakes a server that sleeps, and leaves one alone that somebody stopped", () => {
    expect(keeperStep(empty, v({ state: 50 }), 210_000)).toBe("wake");
    expect(keeperStep(empty, v({ state: 30 }), 210_000)).toBe("wake");
    expect(keeperStep(empty, v({ state: 0 }), 210_000)).toBe("wait");
    expect(keeperStep(empty, v({ state: 10 }), 210_000)).toBe("wait");
    expect(keeperStep(empty, v({ state: 100 }), 210_000)).toBe("wait");
  });
  it("waits while somebody is playing, unless it was told not to", () => {
    expect(keeperStep(empty, v({ online: 1, emptyForMs: null, pregen: "running" }), 210_000)).toBe("pause:playing");
    expect(keeperStep(hours, v({ online: 2, emptyForMs: null }), 210_000)).toBe("pause:playing");
    expect(keeperStep({ ...hours, whilePlaying: true }, v({ online: 2, emptyForMs: null }), 210_000)).toBe("run");
  });
  it("ends when the time is up or the area is done", () => {
    expect(keeperStep(hours, v({ now: Date.parse("2026-09-30T04:00:00Z") }), 210_000)).toBe("off:time");
    expect(keeperStep(hours, v({ now: Date.parse("2026-09-30T03:59:00Z") }), 210_000)).toBe("run");
    expect(keeperStep(empty, v({ pregen: "finished" }), 210_000)).toBe("off:done");
  });
  it("ends a server that hangs while stopping, after four minutes and not before", () => {
    expect(keeperStep(empty, v({ state: 45, stoppingForMs: 60_000 }), 210_000)).toBe("wait");
    expect(keeperStep(empty, v({ state: 45, stoppingForMs: 240_000 }), 210_000)).toBe("kill");
  });

  it("does a night's work: wake, carry on, pause before the sleep, wake again; and does nothing once it is off", async () => {
    const sent: string[] = [];
    const amp = new (class extends MockAmp {
      override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
        sent.push(method === "SendConsoleMessage" ? String(params?.message) : `AMP ${String(method)}`);
        return {} as T;
      }
    })();
    const tail = new ConsoleTail(amp, () => {});
    let t = now;
    let saved: PregenPlan = { mode: "off" };
    const watch = new PregenWatch(amp, tail, () => ({ limbo: parsePos("0 250 0"), spawn: null, portalUrl: "https://deepslate.dsw.test" }), () => {}, () => t);
    watch.start();
    const keeper = new PregenKeeper(amp, tail, watch, () => ({ limbo: parsePos("0 250 0"), spawn: null, portalUrl: "https://deepslate.dsw.test" }), { load: async () => saved, save: async (p) => { saved = p; } }, () => {}, () => t);
    tail.state = 50; // asleep
    await keeper.tick();
    expect(sent).toEqual([]); // off: a sleeping server is left asleep
    await keeper.turnOn({ mode: "empty", whilePlaying: false, task: null }, null);
    expect(saved.mode).toBe("empty");
    expect(sent).toEqual(["AMP Start"]);
    tail.state = 20;
    t += 20_000;
    await keeper.tick();
    expect(sent.slice(1)).toEqual(["chunky quiet 30", "chunky continue"]);
    tail.ingest("Task running for minecraft:overworld. Processed: 24500 chunks (68.59%), ETA: 0:03:30, Rate: 50.0 cps, Current: 1, 1");
    t += 100_000;
    await keeper.tick();
    expect(sent.length).toBe(3); // generating: nothing to say
    t += 120_000;
    await keeper.tick();
    expect(sent.slice(3)).toEqual(["chunky pause", "save-all flush"]);
    tail.ingest("Task paused for minecraft:overworld.");
    tail.state = 50; // AMP has put it to sleep
    t += 160_000;
    await keeper.tick();
    expect(sent.slice(5)).toEqual(["AMP Start"]);
    expect(keeper.idleSeenMs).not.toBeNull();
    tail.state = 20;
    tail.ingest("bramble09 joined the game");
    t += 30_000;
    await keeper.tick();
    expect(sent.length).toBe(6); // somebody is playing and it is paused already: nothing is sent
    await keeper.turnOff("asked", null);
    expect(saved).toEqual({ mode: "off" });
    tail.ingest("bramble09 left the game");
    tail.state = 50;
    t += 600_000;
    await keeper.tick();
    expect(sent.length).toBe(6); // off again: the server sleeps on
  });
});

import { describe, expect, it } from "vitest";
import { parse } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp } from "../src/amp/client.js";
import { chunksIn, due, inWindow, nextPregen, Pregen, PregenWatch, Refused, SLEEP_NODE, SLEEP_PERMISSION, step, ukClock, type PregenPlan, type PregenState, type View } from "../src/status/pregen.js";
import { actions, parsePlace } from "../src/actions/registry.js";

const NONE: PregenState = { status: "none", world: null, chunks: null, percent: null, eta: null, rate: null, at: null };
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

const AREA = { x: 0, z: 0, radius: 1500 };
type On = Exclude<PregenPlan, { mode: "off" }>;
const empty: On = { mode: "empty", what: "generate", area: AREA, window: null, capHours: null, ranMs: 0, since: "2026-09-29T20:00:00.000Z", by: null, fresh: false, sleepWas: true, mapAsked: null, mapStopped: false };
const now: On = { ...empty, mode: "now" };
const noon = new Date("2026-09-29T11:00:00Z"); // 12:00 in the UK (summer time)
const v = (over: Partial<View>): View => ({ serverRunning: true, online: 0, pregen: "paused", at: noon, sleepOff: true, emptyForMs: 0, sleepDelayMin: 5, mapDone: false, lag: false, ...over });

describe("the window", () => {
  it("is UK time", () => {
    expect(ukClock(new Date("2026-09-29T01:30:00Z"))).toBe("02:30"); // summer
    expect(ukClock(new Date("2026-12-01T01:30:00Z"))).toBe("01:30"); // winter
    expect(ukClock(new Date("2026-09-28T23:05:00Z"))).toBe("00:05");
  });
  it("from 02:00 to 08:00 is the night's end, not the day", () => {
    const w = { from: "02:00", to: "08:00" };
    expect(["01:59", "02:00", "05:30", "07:59", "08:00", "14:00"].map((c) => inWindow(w, c))).toEqual([false, true, true, true, false, false]);
  });
  it("may run over midnight; none, or from and to the same, is all day", () => {
    const w = { from: "22:00", to: "06:00" };
    expect(["21:59", "22:00", "23:59", "00:00", "05:59", "06:00", "12:00"].map((c) => inWindow(w, c))).toEqual([false, true, true, true, true, false, false]);
    expect(inWindow(null, "12:00")).toBe(true);
    expect(inWindow({ from: "03:00", to: "03:00" }, "12:00")).toBe(true);
    expect(inWindow({ from: "25:00", to: "03:00" }, "12:00")).toBe(false);
  });
});

describe("what it does next", () => {
  it("when nobody's online: carries on while the server is empty, pauses as soon as anyone is on", () => {
    expect(step(empty, v({}))).toBe("run");
    expect(step(empty, v({ online: 1, emptyForMs: null, pregen: "running" }))).toBe("pause:playing");
  });
  it("now: runs whoever is playing", () => {
    expect(step(now, v({ online: 3, emptyForMs: null }))).toBe("run");
  });
  it("never starts a server: asleep, stopped or failed, it waits for the next start somebody makes", () => {
    for (const mode of [empty, now]) expect(step(mode, v({ serverRunning: false }))).toBe("idle:server");
  });
  it("keeps to the window and to the hours", () => {
    const night: On = { ...empty, window: { from: "02:00", to: "08:00" } };
    expect(step(night, v({ at: noon, pregen: "running" }))).toBe("idle:window");
    expect(step(night, v({ at: new Date("2026-09-29T03:00:00Z") }))).toBe("run"); // 04:00 in the UK
    expect(due({ ...empty, capHours: 8, ranMs: 8 * 3_600_000 }, "running", noon)).toBe("cap");
    expect(due({ ...empty, capHours: 8, ranMs: 8 * 3_600_000 - 1 }, "running", noon)).toBe("yes");
    expect(step({ ...now, capHours: 2, ranMs: 2 * 3_600_000 }, v({}))).toBe("off:cap");
  });
  it("ends by itself at 100%", () => {
    expect(step(empty, v({ pregen: "finished" }))).toBe("off:done");
    expect(step(now, v({ pregen: "finished", serverRunning: false }))).toBe("off:done");
  });
  it("with sleep still on, pauses two minutes before AMP would put the server to sleep, and accepts the sleep", () => {
    expect(step(empty, v({ sleepOff: false, emptyForMs: 2 * 60_000, pregen: "running" }))).toBe("run");
    expect(step(empty, v({ sleepOff: false, emptyForMs: 3 * 60_000, pregen: "running" }))).toBe("pause:sleep");
    expect(step(empty, v({ sleepOff: false, emptyForMs: 3 * 60_000, sleepDelayMin: 10, pregen: "running" }))).toBe("run");
    expect(step(empty, v({ sleepOff: true, emptyForMs: 60 * 60_000, pregen: "running" }))).toBe("run"); // sleep is off: hours on end
  });
  it("counts chunks as chunky does", () => {
    expect(chunksIn(1500)).toBe(35721);
  });
});

/** An AMP that keeps a sleep setting, may or may not let it be written, and remembers everything it was asked. */
class SleepyAmp extends MockAmp {
  sleepOn = true;
  asked: string[] = [];
  console: string[] = [];
  constructor(private readonly mayWrite: boolean) { super(); }
  override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
    this.asked.push(String(method));
    if (method === "SendConsoleMessage") { this.console.push(String(params?.message)); return {} as T; }
    if (method === "CurrentSessionHasPermission") return (params?.PermissionNode === SLEEP_PERMISSION && this.mayWrite) as T;
    if (method === "GetConfig") return { CurrentValue: params?.node === SLEEP_NODE ? this.sleepOn : 5 } as T;
    if (method === "SetConfig") {
      if (!this.mayWrite) return { Status: false, Reason: "You do not have permission to change this setting." } as T;
      if (params?.node === SLEEP_NODE) this.sleepOn = params.value === "true";
      return { Status: true } as T;
    }
    return {} as T;
  }
}

function rig(mayWrite: boolean) {
  const amp = new SleepyAmp(mayWrite);
  const tail = new ConsoleTail(amp, () => {});
  const clock = { t: Date.parse("2026-09-29T20:00:00Z") };
  let saved: PregenPlan = { mode: "off", area: AREA }; // chunky has the area of that morning, paused at 67%
  const watch = new PregenWatch(tail, () => clock.t);
  watch.start();
  const ctx = () => ({ limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" });
  const pregen = new Pregen(amp, tail, watch, ctx, { load: async () => saved, save: async (p) => { saved = p; } }, () => {}, () => clock.t, async () => { clock.t += 1000; await new Promise((res) => setTimeout(res, 2)); });
  return { amp, tail, clock, watch, pregen, saved: () => saved };
}

describe("the mode, from turning it on to 100%", () => {
  it("refuses to start while AMP does not let the portal switch sleep off, says which permission, and touches nothing", async () => {
    const r = rig(false);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    const e = await r.pregen.turnOn({ mode: "now", area: AREA, window: null, capHours: 8 }, null).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(Refused);
    expect((e as Refused).code).toBe("sleep_permission");
    expect((e as Refused).message).toContain("Settings.MinecraftModule.Limits.SleepMode");
    expect(r.pregen.plan.mode).toBe("off");
    expect(r.amp.console).toEqual([]);
    expect(r.amp.asked).not.toContain("SetConfig");
    expect(r.amp.sleepOn).toBe(true);
  });

  it("when nobody's online: sleep off, carry on, pause on a join, carry on when they have left, sleep back on at 100%", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "empty", area: AREA, window: null, capHours: null }, null);
    expect(r.amp.sleepOn).toBe(false);
    expect(r.saved()).toMatchObject({ mode: "empty", sleepWas: true });
    expect(r.amp.console).toEqual(["chunky quiet 30", "chunky continue"]); // the same area: carried on, not begun again
    r.tail.ingest("Task running for minecraft:overworld. Processed: 24500 chunks (68.59%), ETA: 0:03:30, Rate: 50.0 cps, Current: 1, 1");
    r.clock.t += 60 * 60_000; // an hour on an empty server: sleep is off, nothing to do
    await r.pregen.tick();
    expect(r.amp.console.length).toBe(2);
    r.tail.ingest("bramble09 joined the game");
    r.clock.t += 20_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(2)).toEqual(["chunky pause", "save-all flush"]);
    r.tail.ingest("Task paused for minecraft:overworld.");
    r.clock.t += 30 * 60_000;
    await r.pregen.tick();
    expect(r.amp.console.length).toBe(4); // they are still playing
    r.tail.ingest("bramble09 left the game");
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(4)).toEqual(["chunky quiet 30", "chunky continue"]);
    r.tail.ingest("Task finished for minecraft:overworld. Processed: 35721 chunks (100.00%), Total time: 0:12:40");
    r.clock.t += 10_000;
    await r.pregen.tick();
    expect(r.pregen.plan).toEqual({ mode: "off", area: null });
    expect(r.amp.sleepOn).toBe(true);
    // and in all of it: the server was never started, never stopped, never ended
    expect(r.amp.asked.filter((m) => ["Start", "Stop", "Restart", "Kill", "Sleep"].includes(m))).toEqual([]);
  });

  it("another radius: the old area is called off and a new one begun", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: { x: 0, z: 0, radius: 3000 }, window: null, capHours: 2 }, null);
    expect(r.amp.console).toEqual(["chunky cancel", "chunky confirm", "chunky quiet 30", "chunky world minecraft:overworld", "chunky shape square", "chunky center 0 0", "chunky radius 3000", "chunky start"]);
  });

  it("now, for two hours: the hours are hours of generating; then it pauses, saves and gives sleep back", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: AREA, window: null, capHours: 2 }, null);
    r.tail.ingest("Task running for minecraft:overworld. Processed: 24500 chunks (68.59%), ETA: 0:03:30, Rate: 50.0 cps, Current: 1, 1");
    for (let i = 0; i < 119; i++) { r.clock.t += 60_000; await r.pregen.tick(); }
    expect(r.pregen.plan.mode).toBe("now");
    r.clock.t += 60_000; await r.pregen.tick();
    r.clock.t += 60_000; await r.pregen.tick();
    expect(r.pregen.plan).toEqual({ mode: "off", area: AREA });
    expect(r.amp.console.slice(-2)).toEqual(["chunky pause", "save-all flush"]);
    expect(r.amp.sleepOn).toBe(true);
  });

  it("a server that is asleep is left asleep; the pre-generation carries on at the next start somebody makes", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 50;
    await r.pregen.turnOn({ mode: "empty", area: AREA, window: null, capHours: null }, null);
    r.clock.t += 3 * 3_600_000;
    await r.pregen.tick();
    expect(r.amp.console).toEqual([]);
    expect(r.amp.asked).not.toContain("Start");
    expect(r.pregen.lastStep).toBe("idle:server");
    r.tail.state = 20; // somebody joined and AMP woke it; they have left again
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console).toEqual(["chunky quiet 30", "chunky continue"]);
  });

  it("outside the window it is paused and sleep is as it was; inside, sleep is off", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    r.clock.t = Date.parse("2026-09-29T11:00:00Z"); // noon in the UK
    await r.pregen.turnOn({ mode: "empty", area: AREA, window: { from: "02:00", to: "08:00" }, capHours: null }, null);
    expect(r.amp.console).toEqual([]);
    expect(r.amp.sleepOn).toBe(true);
    r.clock.t = Date.parse("2026-09-30T01:30:00Z"); // 02:30
    await r.pregen.tick();
    expect(r.amp.sleepOn).toBe(false);
    expect(r.amp.console).toEqual(["chunky quiet 30", "chunky continue"]);
    r.tail.ingest("Task running for minecraft:overworld. Processed: 24500 chunks (68.59%), ETA: 0:03:30, Rate: 50.0 cps, Current: 1, 1");
    r.clock.t = Date.parse("2026-09-30T07:00:30Z"); // 08:00
    await r.pregen.tick();
    expect(r.amp.console.slice(2)).toEqual(["chunky pause", "save-all flush"]);
    expect(r.amp.sleepOn).toBe(true);
    expect(r.pregen.plan.mode).toBe("empty"); // still on: tomorrow night again
  });
});

describe("before the api stops the server", () => {
  it("a running pre-generation is paused and the save is waited for", async () => {
    const r = rig(true);
    r.tail.state = 20;
    r.tail.ingest("Task running for minecraft:overworld. Processed: 100 chunks (0.28%), ETA: 0:12:00, Rate: 50.0 cps, Current: 1, 1");
    const waiting = r.pregen.quiesce();
    setTimeout(() => r.tail.ingest("Saved the game"), 10);
    expect(await waiting).toEqual({ paused: true, saved: true });
    expect(r.amp.console).toEqual(["chunky pause", "save-all flush"]);
  });
  it("says so when the save was not seen, after a minute, and nothing is ended by force", async () => {
    const r = rig(true);
    r.tail.state = 20;
    r.tail.ingest("Task running for minecraft:overworld. Processed: 100 chunks (0.28%), ETA: 0:12:00, Rate: 50.0 cps, Current: 1, 1");
    const t0 = r.clock.t;
    expect(await r.pregen.quiesce()).toEqual({ paused: true, saved: false });
    expect(r.clock.t - t0).toBe(60_000);
    expect(r.amp.asked).not.toContain("Kill");
  });
  it("has nothing to do when nothing is generating", async () => {
    const r = rig(true);
    r.tail.state = 20;
    expect(await r.pregen.quiesce()).toEqual({ paused: false, saved: true });
    expect(r.amp.console).toEqual([]);
  });
});

describe("the commands", () => {
  it("are fixed words and checked numbers", () => {
    const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
    expect(actions["world.pregenContinue"].build(ctx, {})).toEqual(["chunky quiet 30", "chunky continue"]);
    expect(actions["world.pregenPause"].build(ctx, {})).toEqual(["chunky pause", "save-all flush"]);
    expect(actions["world.pregenCancel"].build(ctx, {})).toEqual(["chunky cancel", "chunky confirm"]);
  });
});

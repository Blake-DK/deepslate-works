import { describe, expect, it } from "vitest";
import { parse } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp } from "../src/amp/client.js";
import { chunksIn, combine, due, inWindow, nextPregen, Pregen, PregenWatch, Refused, SLEEP_NODE, SLEEP_PERMISSION, step, ukClock, type PregenPlan, type PregenState, type View } from "../src/status/pregen.js";
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
const empty: On = { mode: "empty", what: "generate", area: AREA, window: null, capHours: null, ranMs: 0, since: "2026-09-29T20:00:00.000Z", by: null, fresh: false, sleepWas: true, mapAsked: null, mapStopped: false, purge: false };
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
    expect(r.amp.console).toEqual(["chunky quiet 30", "chunky continue minecraft:overworld"]); // the same area: carried on, not begun again
    r.tail.ingest("Task running for minecraft:overworld. Processed: 24500 chunks (68.59%), ETA: 0:03:30, Rate: 50.0 cps, Current: 1, 1");
    r.clock.t += 60 * 60_000; // an hour on an empty server: sleep is off, nothing to do
    r.tail.ingest("Task running for minecraft:overworld. Processed: 30500 chunks (85.38%), ETA: 0:01:30, Rate: 50.0 cps, Current: 1, 1"); // chunky's word of every half minute
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
    expect(r.amp.console.slice(4)).toEqual(["chunky quiet 30", "chunky continue minecraft:overworld"]);
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
    expect(r.amp.console).toEqual(["chunky quiet 30", "chunky continue minecraft:overworld"]);
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
    expect(r.amp.console).toEqual(["chunky quiet 30", "chunky continue minecraft:overworld"]);
    r.tail.ingest("Task running for minecraft:overworld. Processed: 24500 chunks (68.59%), ETA: 0:03:30, Rate: 50.0 cps, Current: 1, 1");
    r.clock.t = Date.parse("2026-09-30T07:00:30Z"); // 08:00
    await r.pregen.tick();
    expect(r.amp.console.slice(2)).toEqual(["chunky pause", "save-all flush"]);
    expect(r.amp.sleepOn).toBe(true);
    expect(r.pregen.plan.mode).toBe("empty"); // still on: tomorrow night again
  });
});

// Alex, 2026-10-30: the main world and Ashmoon in one plan. Since 2026-10-31 one after the other: four worlds side by
// side ran live out of memory.
const MOON = { x: 0, z: 0, radius: 3000, world: "deepslate:moon" };
const RUN_MAIN = "Task running for minecraft:overworld. Processed: 24500 chunks (68.59%), ETA: 0:03:30, Rate: 50.0 cps, Current: 1, 1";
const RUN_MOON = "Task running for deepslate:moon. Processed: 1000 chunks (6.96%), ETA: 0:20:00, Rate: 30.0 cps, Current: 1, 1";
describe("several worlds, one at a time", () => {
  it("carries the main world on; Ashmoon is begun only when the main world is done; ends when both are", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: AREA, also: [MOON], window: null, capHours: null }, null);
    // Ashmoon is new to the portal: whatever chunky may have kept for it is called off; it waits for its turn
    expect(r.amp.console).toEqual(["chunky cancel deepslate:moon", "chunky confirm", "chunky quiet 30", "chunky continue minecraft:overworld"]);
    expect(r.saved()).toMatchObject({ mode: "now", also: [MOON], alsoFresh: ["deepslate:moon"] });
    r.tail.ingest(RUN_MAIN);
    expect(r.pregen.status()).toMatchObject({ status: "running", chunks: 24500 });
    const sent = r.amp.console.length;
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.length).toBe(sent); // nothing is sent while the main world runs
    r.tail.ingest("Task finished for minecraft:overworld. Processed: 35721 chunks (100.00%), Total time: 0:12:40");
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(sent)).toEqual(["chunky quiet 30", "chunky world deepslate:moon", "chunky shape square", "chunky center 0 0", "chunky radius 3000", "chunky start"]);
    expect(r.saved()).toMatchObject({ mode: "now", alsoFresh: [] });
    r.tail.ingest("Task started in deepslate:moon for the square region centered at 0, 0 with radius 3000.");
    r.tail.ingest(RUN_MOON);
    const sent2 = r.amp.console.length;
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.length).toBe(sent2);
    expect(r.pregen.plan.mode).toBe("now");
    r.tail.ingest("Task finished for deepslate:moon. Processed: 140625 chunks (100.00%), Total time: 1:10:00");
    r.clock.t += 10_000;
    await r.pregen.tick();
    expect(r.pregen.plan).toEqual({ mode: "off", area: null });
  });

  it("two worlds found running side by side (a plan from before): the later one is paused, the first carries on", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: AREA, also: [MOON], window: null, capHours: null }, null);
    r.pregen.plan = { ...r.pregen.plan, alsoFresh: [] } as PregenPlan; // as live had it: every world handed to chunky
    r.tail.ingest(RUN_MAIN);
    r.tail.ingest(RUN_MOON);
    const sent = r.amp.console.length;
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(sent)).toEqual(["chunky pause deepslate:moon", "save-all flush"]);
    r.tail.ingest("Task paused for deepslate:moon.");
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.length).toBe(sent + 2);
  });

  it("a world whose turn has not come is still begun, not carried on, after the mode is turned off and on", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: AREA, also: [MOON], window: null, capHours: null }, null);
    await r.pregen.turnOff("asked");
    expect(r.saved()).toMatchObject({ mode: "off", unhanded: ["deepslate:moon"] });
    await r.pregen.turnOn({ mode: "empty", area: AREA, also: [MOON], window: null, capHours: null }, null);
    expect(r.saved()).toMatchObject({ mode: "empty", alsoFresh: ["deepslate:moon"] });
  });

  it("\"No tasks to continue.\" after one world was asked for is about that world alone", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: AREA, also: [MOON], window: null, capHours: null }, null);
    r.pregen.plan = { ...r.pregen.plan, alsoFresh: [] } as PregenPlan;
    r.tail.ingest("No tasks to continue.");
    expect(r.watch.worlds["minecraft:overworld"]?.status).toBe("finished");
    expect(r.watch.worlds["deepslate:moon"]?.status ?? "none").toBe("none");
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(-2)).toEqual(["chunky quiet 30", "chunky continue deepslate:moon"]);
    expect(r.pregen.plan.mode).toBe("now");
  });

  it("a pause reaches every world; carried on, the world whose turn it is goes on", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "empty", area: AREA, also: [MOON], window: null, capHours: null }, null);
    r.tail.ingest(RUN_MAIN);
    const sent = r.amp.console.length;
    r.tail.ingest("bramble09 joined the game");
    r.clock.t += 20_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(sent)).toEqual(["chunky pause", "save-all flush"]);
    r.tail.ingest("Task paused for minecraft:overworld.");
    expect(r.pregen.status().status).toBe("paused");
    r.tail.ingest("bramble09 left the game");
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(sent + 2)).toEqual(["chunky quiet 30", "chunky continue minecraft:overworld"]);
  });

  it("leaving a world out calls off that world's task alone; changing every area calls off all of chunky", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: AREA, also: [MOON], window: null, capHours: null }, null);
    const sent = r.amp.console.length;
    await r.pregen.turnOn({ mode: "now", area: AREA, window: null, capHours: null }, null);
    expect(r.amp.console.slice(sent, sent + 2)).toEqual(["chunky cancel deepslate:moon", "chunky confirm"]);
    expect(r.saved()).not.toHaveProperty("also");
    const r2 = rig(true);
    await r2.pregen.start(); r2.pregen.stop();
    r2.tail.state = 20;
    await r2.pregen.turnOn({ mode: "now", area: { ...AREA, radius: 5000 }, also: [MOON], window: null, capHours: null }, null);
    expect(r2.amp.console.slice(0, 2)).toEqual(["chunky cancel", "chunky confirm"]);
  });

  it("a world the portal had no area for: chunky's own task there is called off before the new one begins", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.cancel(null); // the portal forgets its area; chunky may still keep one of its own
    const sent = r.amp.console.length;
    await r.pregen.turnOn({ mode: "now", area: { ...AREA, radius: 5000 }, window: null, capHours: null }, null);
    expect(r.amp.console.slice(sent)).toEqual(["chunky cancel minecraft:overworld", "chunky confirm", "chunky quiet 30", "chunky world minecraft:overworld", "chunky shape square", "chunky center 0 0", "chunky radius 5000", "chunky start"]);
  });

  it("refuses two areas in one world", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    const e = await r.pregen.turnOn({ mode: "now", area: AREA, also: [MOON, { ...MOON, radius: 100 }], window: null, capHours: null }, null).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(Refused);
    expect(r.pregen.plan.mode).toBe("off");
  });

  it("adds the figures up: running while one runs, finished when all are", () => {
    const run = (chunks: number, rate: number, eta: string): PregenState => ({ status: "running", world: null, chunks, percent: 1, eta, rate, at: null });
    expect(combine([run(100, 50, "0:10:00"), run(300, 30, "1:00:00")], [1000, 1000])).toMatchObject({ status: "running", chunks: 400, percent: 20, rate: 80, eta: "1:00:00" });
    const done: PregenState = { status: "finished", world: null, chunks: 1000, percent: 100, eta: null, rate: null, at: null };
    expect(combine([done, { ...run(500, 1, "0:01:00"), status: "paused", rate: null, eta: null }], [1000, 1000])).toMatchObject({ status: "paused", chunks: 1500, percent: 75, rate: null });
    expect(combine([done, done], [1000, 1000])).toMatchObject({ status: "finished", percent: 100 });
  });
});

// 2026-10-31 03:47: live ran out of memory in the middle of generating and was restarted. chunky said nothing about
// its tasks, so the portal took them to be running and never asked for them again ("No tasks to pause." 71 times).
describe("a task that ended without a word", () => {
  it("is read from what chunky says when it has nothing going, as live printed it", () => {
    expect(parse("[31Oct2026 11:28:10.897] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: [Chunky] No tasks to pause.")).toEqual([{ type: "pregen", what: "none-running" }]);
    expect(parse("No tasks running.")).toEqual([{ type: "pregen", what: "none-running" }]);
    const running = nextPregen(NONE, { type: "pregen", what: "running", world: "minecraft:overworld", chunks: 30722, percent: 1.96, eta: "67:59:07", rate: 6.3 }, at);
    expect(nextPregen(running, { type: "pregen", what: "none-running" }, at)).toMatchObject({ status: "paused", chunks: 30722, rate: null });
    const done = { ...running, status: "finished" as const };
    expect(nextPregen(done, { type: "pregen", what: "none-running" }, at).status).toBe("finished");
  });

  it("a server that has started has nothing going: the world whose turn it is is carried on", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "empty", area: AREA, also: [MOON], window: null, capHours: null }, null);
    r.pregen.plan = { ...r.pregen.plan, alsoFresh: [] } as PregenPlan;
    r.tail.ingest(RUN_MAIN);
    r.tail.ingest("Task paused for deepslate:moon.");
    r.tail.ingest('Done (22.418s)! For help, type "help"');
    expect(r.pregen.status().status).toBe("paused");
    const sent = r.amp.console.length;
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(sent)).toEqual(["chunky quiet 30", "chunky continue minecraft:overworld"]);
  });

  it("a running task that has said nothing for three minutes is asked about, and carried on when chunky has none", async () => {
    const r = rig(true);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "now", area: AREA, window: null, capHours: null }, null);
    r.tail.ingest(RUN_MAIN);
    const sent = r.amp.console.length;
    r.clock.t += 2 * 60_000;
    await r.pregen.tick();
    expect(r.amp.console.length).toBe(sent);
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(sent)).toEqual(["chunky progress"]);
    r.tail.ingest("No tasks running.");
    r.clock.t += 60_000;
    await r.pregen.tick();
    expect(r.amp.console.slice(sent + 1)).toEqual(["chunky quiet 30", "chunky continue minecraft:overworld"]);
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
    expect(actions["world.pregenContinue"].build(ctx, { world: "deepslate:moon" })).toEqual(["chunky quiet 30", "chunky continue deepslate:moon"]);
    expect(actions["world.pregenPause"].build(ctx, { world: "deepslate:moon" })).toEqual(["chunky pause deepslate:moon", "save-all flush"]);
    expect(actions["world.pregenContinue"].input.safeParse({ world: "deepslate:moon; op someone" }).success).toBe(false);
    expect(actions["world.pregenPause"].build(ctx, {})).toEqual(["chunky pause", "save-all flush"]);
    expect(actions["world.pregenCancel"].build(ctx, {})).toEqual(["chunky cancel", "chunky confirm"]);
    expect(actions["world.pregenCancelWorld"].build(ctx, { world: "deepslate:moon" })).toEqual(["chunky cancel deepslate:moon", "chunky confirm"]);
    expect(actions["world.pregenCancelWorld"].input.safeParse({ world: "deepslate:moon; op someone" }).success).toBe(false);
  });
});

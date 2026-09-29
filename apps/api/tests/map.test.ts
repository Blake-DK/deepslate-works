import { describe, expect, it } from "vitest";
import { isMapChatter, parse, parseMapLine } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp } from "../src/amp/client.js";
import { MapWatch, nextMap, NO_MAP, rendered, type MapState } from "../src/status/map.js";
import { phase, Pregen, PregenWatch, SLEEP_NODE, SLEEP_PERMISSION, step, type PregenPlan, type View } from "../src/status/pregen.js";
import { actions, parsePlace } from "../src/actions/registry.js";

// What the server's console held on 2026-09-29, 17:1x UTC, after `bluemap` and `bluemap maps`.
const STATUS = ["[minecraft/MinecraftServer]: ", "BlueMap Status >", " ✔ 1 render-thread is running", " ⛏ map world is currently being updated", " ├ progress: 10.590%", " ├ remaining time: 59 minutes", " └ updating region (-1, 1)", " ⌛ 2 maps have pending updates"];
const MAPS = ["[minecraft/MinecraftServer]: ", "BlueMap Maps >", " ⛏ world", " ├ is currently being updated: 10.601%", " └ has 1 pending task", " ⌛ world_the_nether", " └ has 1 pending task", " ⌛ world_the_end", " └ has 1 pending task"];
// When it is done. The wording is from BlueMap's source (StatusCommand, MapListCommand, 5.7).
const STATUS_DONE = ["BlueMap Status >", " ✔ 1 render-thread is idle", " └ last active 2 minutes ago", " ✔ 3 maps are updated"];
const MAPS_DONE = ["BlueMap Maps >", " ✔ world", " ✔ world_the_nether", " ✔ world_the_end"];
const MAPS_NETHER = ["BlueMap Maps >", " ✔ world", " ⛏ world_the_nether", " └ is currently being updated: 40.000%", " ⌛ world_the_end", " └ has 1 pending task"];

const at = new Date("2026-09-29T17:20:00Z");
const read = (lines: string[], from: MapState = NO_MAP) => lines.reduce((s, l) => { const m = parseMapLine(l); return m ? nextMap(s, m, at) : s; }, from);

describe("what BlueMap says", () => {
  it("is read line by line", () => {
    expect(STATUS.slice(1).map((l) => parseMapLine(l))).toEqual([
      { what: "status" },
      { what: "threads", state: "running" },
      { what: "current", map: "world", doing: "updated" },
      { what: "progress", percent: 10.59 },
      { what: "remaining", text: "59 minutes" },
      { what: "other" },
      { what: "other" },
    ]);
    expect(MAPS.slice(1, 5).map((l) => parseMapLine(l))).toEqual([{ what: "maps" }, { what: "map", map: "world", icon: "rendering" }, { what: "rendering", percent: 10.601 }, { what: "pending", tasks: 1 }]);
    expect(parseMapLine(" ❌ render-threads are stopped")).toEqual({ what: "threads", state: "stopped" });
    expect(parseMapLine(" ⌛ render-threads are paused")).toEqual({ what: "threads", state: "paused" });
    expect(parseMapLine("❌ Render-Threads are now stopped")).toEqual({ what: "said", threads: "stopped" });
    expect(parseMapLine("⛏ Render-Threads are now running")).toEqual({ what: "said", threads: "running" });
    expect(parse(" ⛏ world")).toEqual([{ type: "map", line: { what: "map", map: "world", icon: "rendering" } }]);
  });
  it("is not taken from chat, from `say`, or from lines that only look alike", () => {
    expect(parse("<bramble09> ✔ world").some((e) => e.type === "map")).toBe(false);
    expect(parse("[Server] BlueMap Maps >")).toEqual([]);
    for (const l of ["world", "✔ World Of Mine", "progress: 100.000%", "Task finished for minecraft:overworld.", "Done (1.312s)! For help, type \"help\""]) expect(parseMapLine(l)).toBeNull();
  });
  it("is kept out of the console page only while the portal is the one asking", () => {
    expect([...STATUS, ...MAPS].every(isMapChatter)).toBe(true);
    expect(isMapChatter("bramble09 joined the game")).toBe(false);
    const tail = new ConsoleTail(new MockAmp(), () => {});
    for (const l of MAPS) tail.ingest(l);
    expect(tail.entries.length).toBe(MAPS.length); // somebody asked on the console: it is theirs to read
    tail.hushMap(5_000);
    for (const l of [...STATUS, "bramble09 joined the game"]) tail.ingest(l);
    expect(tail.entries.length).toBe(MAPS.length + 1);
  });
});

describe("where the render stands", () => {
  it("in the middle: the percentage of the task in hand, what is waiting, BlueMap's estimate", () => {
    const s = read([...STATUS, ...MAPS]);
    expect(s).toMatchObject({ threads: "running", current: "world", percent: 10.59, remaining: "59 minutes", lists: 1 });
    expect(s.maps).toEqual({ world: { status: "rendering", percent: 10.601, pending: 1 }, world_the_nether: { status: "pending", percent: null, pending: 1 }, world_the_end: { status: "pending", percent: null, pending: 1 } });
    expect(rendered(s, "world")).toBe(false);
  });
  it("finished: the list names the map as updated, nothing in hand, nothing waiting", () => {
    expect(rendered(read([...STATUS_DONE, ...MAPS_DONE]), "world")).toBe(true);
    // the overworld is what is waited for: the nether may still be at it
    expect(rendered(read([...STATUS_DONE, ...MAPS_NETHER]), "world")).toBe(true);
    expect(rendered(read([...STATUS_DONE, ...MAPS_NETHER]), "world_the_nether")).toBe(false);
  });
  it("is not finished on a list alone that leaves the map out, on stopped threads, or while the status has the map in hand", () => {
    expect(rendered(NO_MAP, "world")).toBe(false);
    expect(rendered(read(["BlueMap Maps >"]), "world")).toBe(false);
    expect(rendered(read(["BlueMap Status >", " ❌ render-threads are stopped", ...MAPS_DONE]), "world")).toBe(false);
    expect(rendered(read([...STATUS, ...MAPS_DONE]), "world")).toBe(false);
  });
  it("a new answer replaces the old one whole", () => {
    const s = read([...STATUS_DONE, ...MAPS_DONE], read([...STATUS, ...MAPS]));
    expect(s).toMatchObject({ threads: "idle", current: null, percent: null, remaining: null, lists: 2 });
    expect(s.maps.world).toEqual({ status: "updated", percent: null, pending: 0 });
  });
  it("lines under a heading of something else are not taken for a map's", () => {
    expect(read([" ├ is currently being updated: 50.000%", " ✔ world"]).maps).toEqual({});
  });
});

const AREA = { x: 0, z: 0, radius: 1500 };
type On = Exclude<PregenPlan, { mode: "off" }>;
const plan: On = { mode: "empty", what: "render", area: AREA, window: null, capHours: null, ranMs: 0, since: "2026-09-29T17:30:00.000Z", by: null, fresh: false, sleepWas: true, mapAsked: null, mapStopped: false };
const noon = new Date("2026-09-29T11:00:00Z");
const v = (over: Partial<View>): View => ({ serverRunning: true, online: 0, pregen: "finished", at: noon, sleepOff: true, emptyForMs: 0, sleepDelayMin: 5, mapDone: false, lag: false, ...over });

describe("the render step: what it does next", () => {
  it("comes after the generating, or alone", () => {
    expect(phase("both", "running", false)).toBe("generate");
    expect(phase("both", "finished", false)).toBe("render");
    expect(phase("both", "finished", true)).toBe("done");
    expect(phase("render", "none", false)).toBe("render");
    expect(phase("render", "paused", true)).toBe("done");
    expect(phase("generate", "finished", false)).toBe("done");
    expect(step({ ...plan, what: "both" }, v({ pregen: "paused" }))).toBe("run");
    expect(step({ ...plan, what: "both" }, v({}))).toBe("render");
    expect(step({ ...plan, what: "both" }, v({ mapDone: true }))).toBe("off:done");
    expect(step({ ...plan, what: "generate" }, v({}))).toBe("off:done"); // as before there was a render step
  });
  it("when nobody's online: renders on an empty server, pauses when anyone joins", () => {
    expect(step(plan, v({ pregen: "none" }))).toBe("render");
    expect(step(plan, v({ pregen: "none", online: 1, emptyForMs: null }))).toBe("pause:playing");
  });
  it("now: renders whoever is playing, and pauses while somebody is on and the server is slow", () => {
    const now: On = { ...plan, mode: "now" };
    expect(step(now, v({ online: 2, emptyForMs: null }))).toBe("render");
    expect(step(now, v({ online: 2, emptyForMs: null, lag: true }))).toBe("pause:lag");
    expect(step(now, v({ online: 0, lag: true }))).toBe("render"); // nobody is there to mind
  });
  it("never starts a server, keeps to the window and the hours", () => {
    expect(step(plan, v({ serverRunning: false }))).toBe("idle:server");
    expect(step({ ...plan, window: { from: "02:00", to: "08:00" } }, v({}))).toBe("idle:window");
    expect(step({ ...plan, capHours: 1, ranMs: 3_600_000 }, v({}))).toBe("off:cap");
  });
  it("with sleep still on it renders until the sleep comes: BlueMap puts its work down by itself", () => {
    expect(step(plan, v({ sleepOff: false, emptyForMs: 4 * 60_000 }))).toBe("render");
  });
});

/** An AMP that keeps a sleep setting and remembers everything it was asked. */
class SleepyAmp extends MockAmp {
  sleepOn = true;
  asked: string[] = [];
  console: string[] = [];
  override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
    this.asked.push(String(method));
    if (method === "SendConsoleMessage") { this.console.push(String(params?.message)); return {} as T; }
    if (method === "CurrentSessionHasPermission") return (params?.PermissionNode === SLEEP_PERMISSION) as T;
    if (method === "GetConfig") return { CurrentValue: params?.node === SLEEP_NODE ? this.sleepOn : 5 } as T;
    if (method === "SetConfig") {
      if (params?.node === SLEEP_NODE) this.sleepOn = params.value === "true";
      return { Status: true } as T;
    }
    return {} as T;
  }
}

function rig(tps: () => number | null = () => 20) {
  const amp = new SleepyAmp();
  const tail = new ConsoleTail(amp, () => {});
  const clock = { t: Date.parse("2026-09-29T17:30:00Z") };
  let saved: PregenPlan = { mode: "off", area: null };
  const watch = new PregenWatch(tail, () => clock.t);
  watch.start();
  const map = new MapWatch(tail, () => clock.t);
  const ctx = () => ({ limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" });
  const pregen = new Pregen(amp, tail, watch, ctx, { load: async () => saved, save: async (p) => { saved = p; } }, () => {}, () => clock.t, async () => { clock.t += 1000; }, { map, tps });
  const say = (lines: string[]) => { for (const l of lines) tail.ingest(l); };
  /** Half a minute on, and what the api does then. */
  const on = async (ms = 30_000) => { clock.t += ms; await pregen.tick(); };
  return { amp, tail, clock, pregen, say, on, saved: () => saved };
}
const FORBIDDEN = ["Start", "Stop", "Restart", "Kill", "Sleep"];
const ASK = ["bluemap", "bluemap maps"];

describe("the render step, from turning it on to the finished map", () => {
  it("alone: sleep off, the area asked of BlueMap once, asked where it stands every half minute, sleep back on when it has said twice that the map is updated", async () => {
    const r = rig();
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "empty", what: "render", area: AREA, window: null, capHours: null }, null);
    expect(r.amp.sleepOn).toBe(false);
    expect(r.amp.console).toEqual(["bluemap update world 0 0 1500", ...ASK]); // chunky is left alone
    expect(r.saved()).toMatchObject({ mode: "empty", what: "render", sleepWas: true, mapStopped: false });
    r.say([...STATUS, ...MAPS]);
    await r.on(10_000);
    expect(r.amp.console.length).toBe(3); // asked ten seconds ago
    await r.on(20_000);
    expect(r.amp.console.slice(3)).toEqual(ASK);
    r.say([...STATUS_DONE, ...MAPS_DONE]);
    await r.on();
    expect(r.pregen.plan.mode).toBe("empty"); // said once: it may be between two tasks
    expect(r.amp.sleepOn).toBe(false);
    r.say([...STATUS_DONE, ...MAPS_DONE]);
    await r.on(10_000);
    expect(r.pregen.plan).toEqual({ mode: "off", area: null });
    expect(r.amp.sleepOn).toBe(true);
    expect(r.amp.console.filter((c) => c.startsWith("chunky"))).toEqual([]);
    expect(r.amp.asked.filter((m) => FORBIDDEN.includes(m))).toEqual([]);
  });

  it("an answer from before the map was asked for does not count, nor one that says updated between two that do not", async () => {
    const r = rig();
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    r.say([...STATUS_DONE, ...MAPS_DONE]); // somebody asked on the console a moment ago
    await r.pregen.turnOn({ mode: "empty", what: "render", area: AREA, window: null, capHours: null }, null);
    r.say([...STATUS_DONE, ...MAPS_DONE]); // the answer to the api's first question, before BlueMap has made its tasks
    await r.on();
    await r.on();
    expect(r.pregen.plan.mode).toBe("empty");
    r.say([...STATUS_DONE, ...MAPS_DONE]);
    await r.on();
    r.say([...STATUS, ...MAPS]);
    await r.on();
    r.say([...STATUS_DONE, ...MAPS_DONE]);
    await r.on();
    expect(r.pregen.plan.mode).toBe("empty"); // updated, rendering, updated: once in a row
    r.say([...STATUS_DONE, ...MAPS_DONE]);
    await r.on();
    expect(r.pregen.plan.mode).toBe("off");
  });

  it("after the generating: chunky first, the map when chunky has finished", async () => {
    const r = rig();
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "empty", what: "both", area: AREA, window: null, capHours: null }, null);
    expect(r.amp.console).toEqual(["chunky quiet 30", "chunky world minecraft:overworld", "chunky shape square", "chunky center 0 0", "chunky radius 1500", "chunky start"]);
    expect(r.amp.console.some((c) => c.startsWith("bluemap"))).toBe(false);
    const before = r.amp.console.length;
    r.say(["Task running for minecraft:overworld. Processed: 9511 chunks (26.63%), ETA: 0:08:30, Rate: 51.4 cps, Current: 73, 37"]);
    await r.on();
    expect(r.amp.console.length).toBe(before);
    r.say(["Task finished for minecraft:overworld. Processed: 35721 chunks (100.00%), Total time: 0:12:40"]);
    await r.on();
    expect(r.pregen.plan.mode).toBe("empty"); // not off: the map is still to come
    expect(r.amp.sleepOn).toBe(false);
    expect(r.amp.console.slice(before)).toEqual(["bluemap update world 0 0 1500", ...ASK]);
  });

  it("when nobody's online: somebody joins, BlueMap is stopped; they leave, it is started again and carries on", async () => {
    const r = rig();
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "empty", what: "render", area: AREA, window: null, capHours: null }, null);
    r.say(["bramble09 joined the game"]);
    await r.on();
    expect(r.amp.console.slice(3)).toEqual(["bluemap stop"]);
    expect(r.saved()).toMatchObject({ mapStopped: true });
    await r.on(30 * 60_000);
    expect(r.amp.console.length).toBe(4); // they are still playing: nothing is asked, nothing is said twice
    r.say(["bramble09 left the game"]);
    await r.on();
    expect(r.amp.console.slice(4)).toEqual(["bluemap start", ...ASK]); // the area is not asked for a second time
    expect(r.saved()).toMatchObject({ mapStopped: false });
  });

  it("now: carries on while people play, stops while the server is slow for them, starts again when it is well", async () => {
    let tps = 20;
    const r = rig(() => tps);
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    r.say(["bramble09 joined the game"]);
    await r.pregen.turnOn({ mode: "now", what: "render", area: AREA, window: null, capHours: null }, null);
    expect(r.amp.console).toEqual(["bluemap update world 0 0 1500", ...ASK]);
    tps = 12;
    await r.on();
    expect(r.amp.console.slice(3)).toEqual(["bluemap stop"]);
    tps = 16; // better, not well
    await r.on();
    expect(r.amp.console.length).toBe(4);
    tps = 19.8;
    await r.on();
    expect(r.amp.console.slice(4)).toEqual(["bluemap start", ...ASK]);
  });

  it("turned off while BlueMap is stopped: BlueMap is started again, at once or when the server next runs", async () => {
    const r = rig();
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 20;
    await r.pregen.turnOn({ mode: "empty", what: "render", area: AREA, window: null, capHours: null }, null);
    r.say(["bramble09 joined the game"]);
    await r.on();
    await r.pregen.turnOff("asked", null);
    expect(r.amp.console.at(-1)).toBe("bluemap start");
    expect(r.pregen.plan).toEqual({ mode: "off", area: AREA });
    expect(r.amp.sleepOn).toBe(true);

    // the same, but the server has gone to sleep under it
    await r.pregen.turnOn({ mode: "empty", what: "render", area: AREA, window: null, capHours: null }, null);
    await r.on();
    expect(r.amp.console.at(-1)).toBe("bluemap stop");
    r.tail.state = 50;
    const said = r.amp.console.length;
    await r.pregen.turnOff("asked", null);
    expect(r.amp.console.length).toBe(said);
    expect(r.saved()).toEqual({ mode: "off", area: AREA, mapStopped: true });
    await r.on(60 * 60_000);
    expect(r.amp.console.length).toBe(said); // asleep: left asleep
    r.tail.state = 20; // somebody has started it
    await r.on();
    expect(r.amp.console.slice(said)).toEqual(["bluemap start"]);
    expect(r.saved()).toEqual({ mode: "off", area: AREA });
    expect(r.amp.asked.filter((m) => FORBIDDEN.includes(m))).toEqual([]);
  });

  it("a server that is asleep is left asleep: the map is asked for at the next start somebody makes", async () => {
    const r = rig();
    await r.pregen.start(); r.pregen.stop();
    r.tail.state = 50;
    await r.pregen.turnOn({ mode: "empty", what: "render", area: AREA, window: null, capHours: null }, null);
    await r.on(60 * 60_000);
    expect(r.amp.console).toEqual([]);
    expect(r.pregen.lastStep).toBe("idle:server");
    r.tail.state = 20;
    await r.on();
    expect(r.amp.console).toEqual(["bluemap update world 0 0 1500", ...ASK]);
    expect(r.amp.asked.filter((m) => FORBIDDEN.includes(m))).toEqual([]);
  });

  it("a plan saved before there was a render step is one that generates", async () => {
    const amp = new SleepyAmp();
    const tail = new ConsoleTail(amp, () => {});
    const old = { mode: "empty", area: AREA, window: null, capHours: null, ranMs: 5, since: "2026-09-29T12:00:00.000Z", by: null, fresh: false, sleepWas: true } as unknown as PregenPlan;
    const pregen = new Pregen(amp, tail, new PregenWatch(tail), () => ({ limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" }), { load: async () => old, save: async () => {} }, () => {});
    await pregen.start(); pregen.stop();
    expect(pregen.plan).toMatchObject({ mode: "empty", what: "generate", mapAsked: null, mapStopped: false });
  });
});

describe("the map's commands", () => {
  it("are fixed words and checked numbers", () => {
    const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
    expect(actions["map.update"].build(ctx, { map: "world", x: 0, z: 0, radius: 1500 })).toEqual(["bluemap update world 0 0 1500"]);
    expect(actions["map.update"].build(ctx, { map: "world" })).toEqual(["bluemap update world"]);
    expect(actions["map.stop"].build(ctx, {})).toEqual(["bluemap stop"]);
    expect(actions["map.start"].build(ctx, {})).toEqual(["bluemap start"]);
    expect(actions["map.update"].input.safeParse({ map: "world; stop", radius: 1500 }).success).toBe(false);
    expect(actions["map.update"].input.safeParse({ map: "world", radius: 1_000_000 }).success).toBe(false);
    expect(actions["map.update"].input.safeParse({ map: "world", x: 1.5, z: 0, radius: 100 }).success).toBe(false);
  });
});

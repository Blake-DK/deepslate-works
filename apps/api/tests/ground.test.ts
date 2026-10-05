import { describe, expect, it } from "vitest";
import { countReply, functionReply, isChat, isCountChatter, killReply } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp, type Amp } from "../src/amp/client.js";
import { actions, OLD_ITEMS, parsePlace } from "../src/actions/registry.js";
import { dueToClear, GroundItems, readPlan, type GroundPlan } from "../src/status/ground.js";
import { describeAction } from "../src/shared/events.js";

// Clearing items on the ground and the entity counts (planner, 2026-10-01).

describe("what the server answers", () => {
  it("execute if entity", () => {
    expect(countReply("Test passed, count: 1234")).toEqual({ ok: true, count: 1234 });
    expect(countReply("Test failed")).toEqual({ ok: true, count: 0 });
    expect(countReply("Unknown entity type tag '#deepslate:hostile'")).toEqual({ ok: false, message: "Unknown entity type tag '#deepslate:hostile'" });
    expect(countReply("bramble09 joined the game")).toBeNull();
  });
  it("kill", () => {
    expect(killReply("Killed 312 entities")).toBe(312);
    expect(killReply("Killed Cobblestone")).toBe(1);
    expect(killReply("No entity was found")).toBe(0);
    expect(killReply("Test passed, count: 3")).toBeNull();
  });
  it("function", () => {
    expect(functionReply("Unknown function deepslate:ground/mark", "deepslate:ground/mark")).toBe(false);
    expect(functionReply("Executed 2 commands from function 'deepslate:ground/mark'", "deepslate:ground/mark")).toBe(true);
    expect(functionReply("Running function deepslate:ground/done", "deepslate:ground/done")).toBe(true);
    expect(functionReply("Killed 3 entities", "deepslate:ground/mark")).toBeNull();
  });
  it("the counting stays off the console page only while the portal counts", () => {
    expect(isCountChatter("[12:00:00] [Server thread/INFO]: Test passed, count: 5")).toBe(true);
    expect(isCountChatter("Killed 5 entities")).toBe(false);
    const tail = new ConsoleTail(new MockAmp(), () => {});
    tail.ingest("Test passed, count: 1");
    tail.hushCount(5_000);
    tail.ingest("Test passed, count: 2");
    tail.ingest("Killed 2 entities");
    expect(tail.lines).toEqual(["Test passed, count: 1", "Killed 2 entities"]);
  });
});

describe("the commands", () => {
  const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
  it("removes item entities older than 2 minutes and nothing else", () => {
    expect(actions["ground.kill"].build(ctx, {})).toEqual(["kill @e[type=minecraft:item,scores={deepslate_age=2400..}]"]);
    expect(OLD_ITEMS).toMatch(/^@e\[type=minecraft:item,/);
  });
  it("warns in chat with the planner's words", () => {
    expect(actions["ground.warn"].build(ctx, { seconds: 60 })[0]).toContain("Clearing items on the ground in 60 s. Pick up anything you want to keep.");
    expect(actions["ground.warn"].build(ctx, { seconds: 10 })[0]).toContain("Clearing items on the ground in 10 s.");
    expect(actions["ground.warn"].input.safeParse({ seconds: 30 }).success).toBe(false);
  });
  it("counts by type", () => {
    expect(actions["ground.count"].build(ctx, { what: "contraptions" })).toEqual(["execute if entity @e[type=#deepslate:contraptions]"]);
    expect(actions["ground.count"].input.safeParse({ what: "@e" }).success).toBe(false);
  });
});

describe("the schedule", () => {
  it("is off at 1,500 unless saved otherwise, within 200..20,000", () => {
    expect(readPlan(undefined)).toEqual({ auto: false, threshold: 1500 });
    expect(readPlan({ auto: true, threshold: 50 })).toEqual({ auto: true, threshold: 200 });
    expect(readPlan({ auto: "yes", threshold: 3000 })).toEqual({ auto: false, threshold: 3000 });
  });
  it("clears only above the threshold, with the server up and nothing under way", () => {
    const on = { auto: true, threshold: 1500 };
    expect(dueToClear(on, 1501, false, true)).toBe(true);
    expect(dueToClear(on, 1500, false, true)).toBe(false);
    expect(dueToClear({ ...on, auto: false }, 9000, false, true)).toBe(false);
    expect(dueToClear(on, 9000, true, true)).toBe(false);
    expect(dueToClear(on, 9000, false, false)).toBe(false);
    expect(dueToClear(on, null, false, true)).toBe(false);
  });
  it("reads well in the event log", () => {
    const alex = { role: "ADMIN" as const, name: "Alex" };
    const portal = { role: "system" as const, name: null };
    expect(describeAction("items.clear", alex, { removed: 312, before: 400, auto: false, threshold: null })).toBe("Alex cleared 312 items from the ground");
    expect(describeAction("items.clear", portal, { removed: 1, auto: true, threshold: 1500 })).toBe("The portal cleared 1 item from the ground (automatic: more than 1500 lying around)");
    expect(describeAction("items.clear", alex, { removed: null, auto: false }, "FAILED")).toBe("Alex tried to clear items on the ground (failed)");
    expect(describeAction("items.clearPlan", alex, { auto: true, threshold: 1500 })).toBe("Alex turned automatic clearing of ground items on (above 1500 items, checked every 10 minutes)");
  });
});

/** A server that answers like 1.21.1 does: counts per selector, the function, and kill. */
function fakeServer(o: { items?: number; old?: number; datapack?: boolean; chat?: string } = {}) {
  const tail = new ConsoleTail(new MockAmp(), () => {});
  tail.state = 20;
  const sent: string[] = [];
  const answer = (cmd: string): string => {
    if (cmd.startsWith("execute if entity @e[type=minecraft:item]")) return o.items ? `Test passed, count: ${o.items}` : "Test failed";
    if (cmd.startsWith("execute if entity @e[type=#deepslate")) return o.datapack === false ? "Unknown entity type tag '#deepslate:hostile'" : "Test passed, count: 7";
    if (cmd.startsWith("execute if entity")) return "Test passed, count: 3";
    if (cmd.startsWith("function ")) return o.datapack === false ? `Unknown function ${cmd.slice(9)}` : `Executed 2 commands from function '${cmd.slice(9)}'`;
    if (cmd.startsWith("kill ")) return o.datapack === false ? "No entity was found" : `Killed ${o.old ?? 0} entities`;
    return "";
  };
  const amp: Amp = {
    async ping() {},
    async getStatus() {
      return { state: "Running", stateCode: 20, players: [], maxPlayers: 20, cpu: 1, memMb: 1, memMaxMb: 2, tps: 20, uptime: "0" };
    },
    async call<T>(_m: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (method === "SendConsoleMessage") {
        const cmd = String(params.message);
        sent.push(cmd);
        const reply = answer(cmd);
        if (o.chat) tail.ingest(o.chat, new Date(), { type: "Chat", source: "bramble09" }); // somebody types it, before the server answers
        if (reply) setTimeout(() => tail.ingest(`[12:00:00] [Server thread/INFO]: ${reply}`), 1);
      }
      return null as T;
    },
  };
  const audits: Array<{ action: string; params: object; result: string; detail?: string | null }> = [];
  let plan: unknown = undefined;
  const ground = new GroundItems(amp, tail, () => ({ limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://x" }), {
    load: async () => plan,
    save: async (p: GroundPlan) => void (plan = p),
  }, async (a) => void audits.push(a), () => {}, async () => {});
  return { ground, sent, audits, tail };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("GroundItems", () => {
  it("counts each type", async () => {
    const { ground } = fakeServer({ items: 1234 });
    const c = await ground.measure(true);
    expect(c?.values).toEqual({ items: 1234, xp: 3, hostile: 7, passive: 7, contraptions: 7, corpses: 3, all: 3 });
    expect(c?.problems).toEqual({});
  });
  it("takes nothing a player types for the server's answer (R-31)", async () => {
    expect(isChat("Killed 999999 entities", { type: "Chat", source: "bramble09" })).toBe(true);
    expect(isChat("[12:00:00] [Server thread/INFO]: <bramble09> Killed 999999 entities")).toBe(true);
    expect(isChat("[12:00:00] [Server thread/INFO]: Killed 999999 entities", { type: "Console", source: "Server thread/INFO" })).toBe(false);
    const { ground, tail } = fakeServer({ items: 400, chat: "Test passed, count: 999999" });
    const c = await ground.measure(true);
    expect(c?.values.items).toBe(400);
    expect(tail.lines).toContain("Test passed, count: 999999"); // and what they said stays on the console page
    expect(tail.lines).not.toContain("[12:00:00] [Server thread/INFO]: Test passed, count: 400");
  });
  it("says which counts need the datapack", async () => {
    const { ground } = fakeServer({ items: 10, datapack: false });
    const c = await ground.measure(true);
    expect(c?.values.items).toBe(10);
    expect(c?.problems.hostile).toMatch(/Unknown entity type tag/);
  });
  it("clears with both warnings, kills only old items and logs the count", async () => {
    const { ground, sent, audits } = fakeServer({ items: 400, old: 312 });
    expect(ground.begin("u1")).toMatchObject({ ok: true });
    expect(ground.begin("u1")).toEqual({ ok: false, code: "busy" });
    await settle();
    await settle();
    const order = sent.filter((c) => !c.startsWith("execute if entity"));
    expect(order[0]).toContain("in 60 s");
    expect(order[1]).toContain("in 10 s");
    expect(order.slice(2, 5)).toEqual(["function deepslate:ground/mark", "kill @e[type=minecraft:item,scores={deepslate_age=2400..}]", "function deepslate:ground/done"]);
    expect(order[5]).toContain("Cleared 312 items from the ground.");
    expect(audits).toEqual([{ userId: "u1", action: "items.clear", params: { removed: 312, before: 400, auto: false, threshold: null }, result: "OK", detail: null }]);
    expect((await ground.read()).last).toMatchObject({ removed: 312, by: "button", problem: null });
  });
  it("says so when the datapack is not loaded yet", async () => {
    const { ground, audits } = fakeServer({ items: 5, datapack: false });
    ground.begin(null);
    await settle();
    await settle();
    expect(audits[0]).toMatchObject({ action: "items.clear", result: "FAILED", params: { removed: null } });
    expect(audits[0]!.detail).toMatch(/datapack deepslate-tools is not loaded/);
  });
  it("the schedule clears only above its threshold", async () => {
    const low = fakeServer({ items: 1000, old: 900 });
    await low.ground.setPlan({ auto: true, threshold: 1500 }, "u1");
    expect(await low.ground.check()).toBe(false);
    const high = fakeServer({ items: 2000, old: 1800 });
    await high.ground.setPlan({ auto: true, threshold: 1500 }, "u1");
    expect(await high.ground.check()).toBe(true);
    await settle();
    await settle();
    expect(high.audits.map((a) => a.action)).toEqual(["items.clearPlan", "items.clear"]);
    expect(high.audits[1]).toMatchObject({ userId: null, params: { removed: 1800, auto: true, threshold: 1500 } });
  });
  it("refuses while the server is down", () => {
    const { ground, tail } = fakeServer();
    tail.state = 0;
    expect(ground.begin("u1")).toEqual({ ok: false, code: "server_offline" });
  });
});

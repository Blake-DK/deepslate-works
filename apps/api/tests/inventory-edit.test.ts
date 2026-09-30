import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serviceAuth } from "../src/auth.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { parseSnbt } from "../src/events/snbt.js";
import { invReply, isEntityDump, parse } from "../src/events/parse.js";
import { toPlayerData } from "../src/players/inventory.js";
import { clampCount, invPhrase, slotName } from "../src/shared/slots.js";
import { Catalogue, checkChange, InventoryEditor } from "../src/players/editor.js";
import { inventoryRoutes } from "../src/routes/inventory.js";
import { actions } from "../src/actions/registry.js";
import { describeAction } from "../src/shared/events.js";

// docs/13 §13 (planner, 2026-09-30): the admin's inventory and ender chest editor.
// The console lines below are written as Minecraft 1.21.1 prints them (its en_us wording and SNBT). TO REPLACE with
// lines this server printed, captured the first time a player is on (docs/11 "inventory editor").

const DUMP = 'samoyedx has the following entity data: {Brain: {memories: {}}, HurtByTimestamp: 0, SelectedItemSlot: 2, Health: 18.5f, foodLevel: 17, XpLevel: 7, Pos: [-42.5d, 88.0d, 17.25d], Dimension: "minecraft:the_nether", playerGameType: 0, Inventory: [{Slot: 0b, id: "minecraft:bow", count: 1, components: {"minecraft:damage": 12, "minecraft:enchantments": {levels: {"minecraft:power": 3}}}}, {Slot: 9b, id: "create:andesite_alloy", count: 40}, {Slot: 103b, id: "minecraft:iron_helmet", count: 1}, {Slot: -106b, id: "minecraft:shield", count: 1}], EnderItems: [{Slot: 3b, id: "minecraft:diamond", count: 5}], UUID: [I; 1, 2, 3, 4], "custom name": \'it\\\'s\'}';

describe("SNBT, as data get entity prints it", () => {
  it("reads compounds, lists, typed arrays, numbers with their letters and both kinds of string", () => {
    expect(parseSnbt('{a: 1b, b: 2.5f, c: -3L, d: 1.0d, e: "x \\"y\\"", f: \'z\', g: [I; 1, 2], h: [], i: {}, j: true}')).toEqual({ a: 1, b: 2.5, c: -3, d: 1, e: 'x "y"', f: "z", g: [1, 2], h: [], i: {}, j: 1 });
  });
  it("refuses what is not SNBT", () => {
    expect(() => parseSnbt("{a: 1")).toThrow();
    expect(() => parseSnbt("{a 1}")).toThrow();
    expect(() => parseSnbt("{a: 1} tail")).toThrow();
  });
});

describe("the whole player, from the console", () => {
  it("is read into the same shape as the save file", () => {
    const [e] = parse(DUMP);
    expect(e).toMatchObject({ type: "entitydata", name: "samoyedx" });
    const d = toPlayerData((e as { data: Record<string, never> }).data);
    expect([d.health, d.food, d.xpLevel, d.selectedSlot, d.dimension, d.pos]).toEqual([18.5, 17, 7, 2, "minecraft:the_nether", [-42.5, 88, 17.25]]);
    expect(d.inventory.map((i) => [slotName(i.slot), i.id, i.count])).toEqual([["hotbar.0", "minecraft:bow", 1], ["inventory.0", "create:andesite_alloy", 40], ["armor.head", "minecraft:iron_helmet", 1], ["weapon.offhand", "minecraft:shield", 1]]);
    expect(d.inventory[0]).toMatchObject({ damage: 12, enchantments: { "minecraft:power": 3 } });
    expect(d.ender.map((i) => [slotName(i.slot, true), i.id, i.count])).toEqual([["enderchest.3", "minecraft:diamond", 5]]);
    expect(isEntityDump(DUMP)).toBe(true); // kept off the console page
  });
  it("leaves the position and dimension answers the entrance room uses as they were", () => {
    expect(parse("samoyedx has the following entity data: [1.5d, 64.0d, -3.25d]")).toEqual([{ type: "pos", name: "samoyedx", x: 1.5, y: 64, z: -3.25 }]);
    expect(parse('samoyedx has the following entity data: "minecraft:overworld"')).toEqual([{ type: "dimension", name: "samoyedx", dimension: "minecraft:overworld" }]);
  });
});

describe("what the server answers", () => {
  it("to give and item replace, for the right player only", () => {
    expect(invReply("Gave 16 [Andesite Alloy] to samoyedx", "samoyedx")).toEqual({ ok: true, what: "gave", item: "Andesite Alloy" });
    expect(invReply("Replaced a slot on samoyedx with [Diamond Pickaxe]", "SamoyedX")).toEqual({ ok: true, what: "replaced", item: "Diamond Pickaxe" });
    expect(invReply("Replaced a slot on samoyedx with [Air]", "samoyedx")).toMatchObject({ ok: true, item: "Air" });
    expect(invReply("Gave 1 [Stone] to bramble09", "samoyedx")).toBeNull();
    expect(invReply("<samoyedx> Gave 16 [Diamond] to samoyedx", "samoyedx")).toBeNull(); // chat is not an answer
  });
  it("and the refusals, with the stack size when that is what was wrong", () => {
    expect(invReply("Unknown item 'minecraft:not_a_thing'", "x1x")).toEqual({ ok: false, message: "Unknown item 'minecraft:not_a_thing'" });
    expect(invReply("Ender Pearl can only stack up to 16", "x1x")).toEqual({ ok: false, message: "Ender Pearl can only stack up to 16", maxStack: 16 });
    for (const l of ["No player was found", "Malformed 'minecraft:enchantments' component: 'Not a map'", "The target does not have slot enderchest.40"]) expect(invReply(l, "x1x")).toMatchObject({ ok: false });
    expect(invReply("Saved the game", "x1x")).toBeNull();
  });
});

describe("slots, items and counts", () => {
  it("maps the save file's slot numbers to the names item replace takes", () => {
    expect([0, 8, 9, 35, 100, 101, 102, 103, -106].map((n) => slotName(n))).toEqual(["hotbar.0", "hotbar.8", "inventory.0", "inventory.26", "armor.feet", "armor.legs", "armor.chest", "armor.head", "weapon.offhand"]);
    expect([0, 26].map((n) => slotName(n, true))).toEqual(["enderchest.0", "enderchest.26"]);
    expect([slotName(36), slotName(27, true), slotName(-1)]).toEqual([null, null, null]);
  });
  it("keeps counts between 1 and the stack size (64 when it is not known)", () => {
    expect([clampCount(99, 16), clampCount(0, 16), clampCount(5, 1), clampCount(80, null), clampCount(Number.NaN, 64)]).toEqual([16, 1, 1, 64, 1]);
  });
  it("checks a change before anything is sent", () => {
    const known = (id: string) => id === "minecraft:diamond";
    expect(checkChange({ op: "set", slot: "hotbar.0", item: "minecraft:diamond", count: 200 }, known, 64)).toEqual({ ok: true, change: { op: "set", slot: "hotbar.0", item: "minecraft:diamond", count: 64, components: undefined } });
    expect(checkChange({ op: "set", slot: "hotbar.9", item: "minecraft:diamond" }, known, 64)).toMatchObject({ ok: false });
    expect(checkChange({ op: "give", item: "minecraft:not_a_thing", count: 1 }, known, null)).toMatchObject({ ok: false, message: 'The server has no item "minecraft:not_a_thing".' });
    expect(checkChange({ op: "give", item: "minecraft:diamond; op me", count: 1 }, () => true, null)).toMatchObject({ ok: false });
    expect(checkChange({ op: "set", slot: "hotbar.0", item: "minecraft:diamond", components: "[a]\nop me" }, known, 64)).toMatchObject({ ok: false });
    expect(checkChange({ op: "clear", slot: "enderchest.3" }, known, null)).toEqual({ ok: true, change: { op: "clear", slot: "enderchest.3" } });
  });
  it("builds the vanilla commands", () => {
    const ctx = { limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "x" };
    expect(actions["inv.set"].build(ctx, { player: "samoyedx", slot: "hotbar.0", item: "minecraft:diamond_pickaxe", count: 1 })).toEqual(["item replace entity samoyedx hotbar.0 with minecraft:diamond_pickaxe 1"]);
    expect(actions["inv.set"].build(ctx, { player: "samoyedx", slot: "hotbar.0", item: "minecraft:diamond_sword", count: 1, components: '[minecraft:enchantments={levels:{"minecraft:sharpness":5}}]' })).toEqual(['item replace entity samoyedx hotbar.0 with minecraft:diamond_sword[minecraft:enchantments={levels:{"minecraft:sharpness":5}}] 1']);
    expect(actions["inv.clear"].build(ctx, { player: "samoyedx", slot: "enderchest.3" })).toEqual(["item replace entity samoyedx enderchest.3 with air"]);
    expect(actions["inv.give"].build(ctx, { player: "samoyedx", item: "create:andesite_alloy", count: 16 })).toEqual(["give samoyedx create:andesite_alloy 16"]);
  });
  it("writes the event log the planner's way", () => {
    const alex = { role: "ADMIN" as const, name: "Alex" };
    expect(describeAction("inv.change", alex, { op: "give", player: "samoyedx", item: "create:andesite_alloy", count: 16 }, "OK")).toBe("Alex gave samoyedx 16 × create:andesite_alloy");
    expect(describeAction("inv.change", alex, { op: "clear", player: "samoyedx", slot: "enderchest.3" }, "OK")).toBe("Alex cleared samoyedx's enderchest.3");
    expect(describeAction("inv.change", alex, { op: "set", player: "bramble09", slot: "hotbar.0", item: "minecraft:diamond_pickaxe", count: 1 }, "OK")).toBe("Alex set bramble09's hotbar.0 to minecraft:diamond_pickaxe");
    expect(invPhrase({ op: "give", player: "samoyedx", item: "create:andesite_alloy", count: 16 })).toBe("gave samoyedx 16 × create:andesite_alloy");
  });
});

async function rig(o: { state?: number; online?: string[]; answer?: (cmd: string) => string | null } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "catalogue-"));
  const file = path.join(dir, "catalogue.json");
  await writeFile(file, JSON.stringify({ items: [{ id: "minecraft:diamond_pickaxe", name: "Diamond Pickaxe", mod: "Minecraft", maxStack: 1, icon: null }, { id: "create:andesite_alloy", name: "Andesite Alloy", mod: "Create", maxStack: null, icon: null }, { id: "minecraft:ender_pearl", name: "Ender Pearl", mod: "Minecraft", maxStack: 16, icon: null }] }));
  const sent: string[] = [];
  const audits: Array<{ action: string; result: string; params: Record<string, unknown>; detail?: string | null }> = [];
  const box: { tail?: ConsoleTail } = {};
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string, p?: Record<string, unknown>): Promise<T> {
      if (method === "SendConsoleMessage") {
        const cmd = String(p?.message);
        sent.push(cmd);
        const a = o.answer?.(cmd);
        if (a) setTimeout(() => box.tail!.ingest(a), 5);
      }
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  box.tail = tail;
  tail.state = o.state ?? 20;
  for (const n of o.online ?? ["samoyedx"]) tail.online.add(n);
  const editor = new InventoryEditor(amp, tail, () => ({ limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "x" }), new Catalogue(file), async (a) => { audits.push(a as never); });
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  inventoryRoutes(f, amp, tail, () => ({ limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "x" }), { savedAt: 0 }, undefined, editor);
  const as = (role = "ADMIN", id = "alex") => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": id, "content-type": "application/json" });
  return { f, as, sent, audits, editor };
}

const ANSWERS = (cmd: string) =>
  cmd.startsWith("item replace entity samoyedx hotbar.0 with minecraft:diamond_pickaxe") ? "Replaced a slot on samoyedx with [Diamond Pickaxe]"
  : cmd === "give samoyedx create:andesite_alloy 64" ? "Andesite Alloy can only stack up to 32"
  : cmd.startsWith("give samoyedx create:andesite_alloy") ? `Gave ${cmd.split(" ").at(-1)} [Andesite Alloy] to samoyedx`
  : cmd === "data get entity samoyedx" ? DUMP
  : null;

describe("POST /players/:name/inventory", () => {
  it("is for admins only: early access and players get 403", async () => {
    const r = await rig({ answer: ANSWERS });
    for (const role of ["PLAYER", "EARLY", ""]) expect((await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as(role), payload: { op: "clear", slot: "hotbar.0" } })).statusCode).toBe(403);
    expect(r.sent).toEqual([]);
  });
  it("refuses a player who is offline, and never writes their save file", async () => {
    const r = await rig({ online: [], answer: ANSWERS });
    const res = await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as(), payload: { op: "give", item: "create:andesite_alloy", count: 16 } });
    expect([res.statusCode, res.json().error.message]).toEqual([409, "Player is offline. Changes can be made when they're next on."]);
    expect(r.sent).toEqual([]);
  });
  it("sets a slot, tells the player, logs it, and reads them back", async () => {
    const r = await rig({ answer: ANSWERS });
    const res = await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as(), payload: { op: "set", slot: "hotbar.0", item: "minecraft:diamond_pickaxe", count: 5 } });
    expect(res.statusCode).toBe(200);
    expect(r.sent).toEqual(["item replace entity samoyedx hotbar.0 with minecraft:diamond_pickaxe 1", 'tellraw samoyedx {"text":"An admin changed your inventory.","color":"gray"}', "data get entity samoyedx"]);
    expect(res.json()).toMatchObject({ ok: true, reply: "set samoyedx's hotbar.0 to minecraft:diamond_pickaxe", data: { xpLevel: 7 } });
    expect(r.audits).toEqual([expect.objectContaining({ action: "inv.change", result: "OK", params: expect.objectContaining({ op: "set", player: "samoyedx", slot: "hotbar.0", item: "minecraft:diamond_pickaxe", count: 1 }) })]);
  });
  it("gives, and a refusal from the server comes back in its words, with nothing changed", async () => {
    const r = await rig({ answer: ANSWERS });
    expect((await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as(), payload: { op: "give", item: "create:andesite_alloy", count: 16 } })).statusCode).toBe(200);
    // a mod item whose stack size the catalogue does not know: the server says, and that is what is shown
    const bad = await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as("ADMIN", "other"), payload: { op: "give", item: "create:andesite_alloy", count: 64 } });
    expect([bad.statusCode, bad.json().error]).toEqual([422, { code: "refused", message: "Andesite Alloy can only stack up to 32" }]);
    const again = await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as("ADMIN", "third"), payload: { op: "give", item: "create:andesite_alloy", count: 64 } });
    expect(again.statusCode).toBe(200);
    expect(r.sent.filter((c) => c.startsWith("give"))).toEqual(["give samoyedx create:andesite_alloy 16", "give samoyedx create:andesite_alloy 64", "give samoyedx create:andesite_alloy 32"]); // learnt: 32
    const unknown = await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as("ADMIN", "fourth"), payload: { op: "give", item: "minecraft:not_a_thing", count: 1 } });
    expect([unknown.statusCode, unknown.json().error.code]).toEqual([400, "validation"]);
    expect(r.audits.map((a) => a.result)).toEqual(["OK", "FAILED", "OK"]);
    expect(r.audits[1]).toMatchObject({ detail: "Andesite Alloy can only stack up to 32" });
    expect(r.sent.filter((c) => c.startsWith("tellraw"))).toHaveLength(2); // told only about the changes that happened
  });
  it("five changes a second at most", async () => {
    const r = await rig({ answer: ANSWERS });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await r.f.inject({ method: "POST", url: "/players/samoyedx/inventory", headers: r.as(), payload: { op: "give", item: "minecraft:not_a_thing" } })).statusCode);
    expect(codes).toEqual([400, 400, 400, 400, 400, 429, 429]);
  });
});

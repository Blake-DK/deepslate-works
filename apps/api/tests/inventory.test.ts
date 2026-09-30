import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { readNbt, NbtError } from "../src/players/nbt.js";
import { plainText, toPlayerData } from "../src/players/inventory.js";
import { inventoryRoutes } from "../src/routes/inventory.js";

// A small NBT writer, only for the tests: typed values so the file is laid out the way the game writes it.
type T = { t: number; v: unknown };
const byte = (v: number): T => ({ t: 1, v }), int = (v: number): T => ({ t: 3, v }), float = (v: number): T => ({ t: 5, v }), double = (v: number): T => ({ t: 6, v });
const str = (v: string): T => ({ t: 8, v }), list = (inner: number, v: T[]): T => ({ t: 9, v: { inner, v } }), comp = (v: Record<string, T>): T => ({ t: 10, v }), ints = (v: number[]): T => ({ t: 11, v });
function payload(x: T): Buffer {
  const b = (n: number, f: (buf: Buffer) => void) => { const buf = Buffer.alloc(n); f(buf); return buf; };
  switch (x.t) {
    case 1: return b(1, (buf) => buf.writeInt8(x.v as number));
    case 3: return b(4, (buf) => buf.writeInt32BE(x.v as number));
    case 5: return b(4, (buf) => buf.writeFloatBE(x.v as number));
    case 6: return b(8, (buf) => buf.writeDoubleBE(x.v as number));
    case 8: { const s = Buffer.from(x.v as string, "utf8"); return Buffer.concat([b(2, (buf) => buf.writeUInt16BE(s.length)), s]); }
    case 9: { const { inner, v } = x.v as { inner: number; v: T[] }; return Buffer.concat([b(1, (buf) => buf.writeUInt8(inner)), b(4, (buf) => buf.writeInt32BE(v.length)), ...v.map(payload)]); }
    case 10: return Buffer.concat([...Object.entries(x.v as Record<string, T>).map(([k, e]) => Buffer.concat([b(1, (buf) => buf.writeUInt8(e.t)), payload(str(k)), payload(e)])), Buffer.from([0])]);
    case 11: { const v = x.v as number[]; return Buffer.concat([b(4, (buf) => buf.writeInt32BE(v.length)), ...v.map((n) => b(4, (buf) => buf.writeInt32BE(n)))]); }
  }
  throw new Error("type");
}
const file = (root: Record<string, T>) => gzipSync(Buffer.concat([Buffer.from([10]), payload(str("")), payload(comp(root))]));

// The shape Minecraft 1.21.1 writes into world/playerdata/<uuid>.dat (item components since 1.20.5).
const PLAYER = file({
  DataVersion: int(3955),
  UUID: ints([1, 2, 3, 4]),
  Pos: list(6, [double(212.5), double(71), double(-340.25)]),
  Dimension: str("minecraft:overworld"),
  Health: float(18),
  foodLevel: int(17),
  XpLevel: int(23),
  playerGameType: int(0),
  SelectedItemSlot: int(2),
  Inventory: list(10, [
    comp({ Slot: byte(0), id: str("minecraft:diamond_pickaxe"), count: int(1), components: comp({ "minecraft:damage": int(412), "minecraft:enchantments": comp({ levels: comp({ "minecraft:efficiency": int(4), "minecraft:unbreaking": int(3) }) }) }) }),
    comp({ Slot: byte(1), id: str("create:wrench"), count: int(1) }),
    comp({ Slot: byte(9), id: str("minecraft:shulker_box"), count: int(1), components: comp({
      "minecraft:custom_name": str('{"text":"Ores"}'),
      "minecraft:container": list(10, [comp({ slot: int(0), item: comp({ id: str("minecraft:raw_iron"), count: int(64) }) }), comp({ slot: int(4), item: comp({ id: str("minecraft:diamond"), count: int(5) }) })]),
    }) }),
    comp({ Slot: byte(18), id: str("sophisticatedbackpacks:iron_backpack"), count: int(1), components: comp({ "sophisticatedcore:storage_uuid": ints([9, 9, 9, 9]) }) }),
    comp({ Slot: byte(103), id: str("minecraft:diamond_helmet"), count: int(1) }),
    comp({ Slot: byte(-106), id: str("minecraft:shield"), count: int(1) }),
  ]),
  EnderItems: list(10, [comp({ Slot: byte(0), id: str("minecraft:ender_pearl"), count: int(8) })]),
});

describe("readNbt + toPlayerData", () => {
  const d = toPlayerData(readNbt(PLAYER));
  it("reads where they are and how they are", () => {
    expect([d.pos, d.dimension, d.health, d.food, d.xpLevel, d.gameMode, d.selectedSlot]).toEqual([[212.5, 71, -340.25], "minecraft:overworld", 18, 17, 23, 0, 2]);
  });
  it("reads every slot, armour and off-hand included", () => {
    expect(d.inventory.map((i) => [i.slot, i.id, i.count])).toEqual([[0, "minecraft:diamond_pickaxe", 1], [1, "create:wrench", 1], [9, "minecraft:shulker_box", 1], [18, "sophisticatedbackpacks:iron_backpack", 1], [103, "minecraft:diamond_helmet", 1], [-106, "minecraft:shield", 1]]);
    expect(d.ender).toEqual([{ slot: 0, id: "minecraft:ender_pearl", count: 8 }]);
  });
  it("reads damage, enchantments, names, containers, and names the mods' own data", () => {
    const [pick, , box, pack] = d.inventory;
    expect(pick).toMatchObject({ damage: 412, enchantments: { "minecraft:efficiency": 4, "minecraft:unbreaking": 3 } });
    expect(box!.name).toBe("Ores");
    expect(box!.contents).toEqual([{ slot: 0, id: "minecraft:raw_iron", count: 64 }, { slot: 4, id: "minecraft:diamond", count: 5 }]);
    expect(pack!.extra).toEqual(["sophisticatedcore:storage_uuid"]);
  });
  it("reads a pre-1.20.5 item too", () => {
    const old = toPlayerData(readNbt(file({ Inventory: list(10, [comp({ Slot: byte(0), id: str("minecraft:bow"), Count: byte(1), tag: comp({ Damage: int(7) }) })]) })));
    expect(old.inventory).toEqual([{ slot: 0, id: "minecraft:bow", count: 1, damage: 7 }]);
    expect(old.pos).toBeNull();
  });
  it("refuses a broken file instead of guessing", () => {
    expect(() => readNbt(PLAYER.subarray(0, 40))).toThrow();
    expect(() => readNbt(Buffer.from([8, 0, 0]))).toThrow(NbtError);
  });
  it("turns a text component into its words", () => {
    expect(plainText('{"text":"A","extra":[{"text":"B"},"C"]}')).toBe("ABC");
    expect(plainText("not json")).toBe("not json");
  });
});

const UUID = "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10";
function app(state: number, files: Record<string, Buffer>, onSave?: () => void) {
  const calls: string[] = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string, p: Record<string, unknown> = {}): Promise<T> {
      calls.push(`${method}${p.message ? ` ${String(p.message)}` : p.Dir ? ` ${String(p.Dir)}` : ""}`);
      if (method === "SendConsoleMessage") { onSave?.(); return {} as T; }
      if (method === "GetDirectoryListing") return Object.entries(files).map(([name, f]) => ({ Filename: name, SizeBytes: f.length, Modified: "2026-09-30T08:00:00Z" })) as T;
      if (method === "GetFileChunk") {
        const f = files[String(p.Filename).split("/").at(-1)!]!;
        const part = f.subarray(Number(p.Position), Number(p.Position) + Number(p.Length));
        return { Base64Data: part.toString("base64"), BytesLength: part.length } as T;
      }
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  tail.state = state;
  const saved = { savedAt: 0 };
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  inventoryRoutes(f, amp, tail, () => ({ limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "x" }), saved, async () => { saved.savedAt = Date.now(); });
  const as = (role: string) => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1" });
  return { f, calls, as };
}

describe("GET /players/:uuid/data", () => {
  it("is for admins", async () => {
    const { f, calls, as } = app(20, { [`${UUID}.dat`]: PLAYER });
    expect((await f.inject({ url: `/players/${UUID}/data`, headers: as("PLAYER") })).statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
  it("reads only world/playerdata/<uuid>.dat", async () => {
    const { f, calls, as } = app(0, { [`${UUID}.dat`]: PLAYER });
    const r = await f.inject({ url: `/players/${UUID.toUpperCase()}/data`, headers: as("ADMIN") });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ savedAt: "2026-09-30T08:00:00Z", fresh: false, running: false, data: { xpLevel: 23 } });
    expect(calls).toEqual(["GetDirectoryListing world/playerdata", "GetFileChunk"]);
    expect((await f.inject({ url: "/players/..%2Fops/data", headers: as("ADMIN") })).statusCode).toBe(400);
  });
  it("says so when the player has never been on", async () => {
    const { f, as } = app(20, {});
    expect((await f.inject({ url: `/players/${UUID}/data`, headers: as("ADMIN") })).statusCode).toBe(404);
  });
  it("Refresh saves first and waits for the save", async () => {
    const { f, calls, as } = app(20, { [`${UUID}.dat`]: PLAYER });
    const r = await f.inject({ url: `/players/${UUID}/data?fresh=1`, headers: as("ADMIN") });
    expect(r.json().fresh).toBe(true);
    expect(calls[0]).toBe("SendConsoleMessage save-all");
  });
  it("does not ask a stopped server to save", async () => {
    const { f, calls, as } = app(0, { [`${UUID}.dat`]: PLAYER });
    await f.inject({ url: `/players/${UUID}/data?fresh=1`, headers: as("ADMIN") });
    expect(calls.some((c) => c.startsWith("SendConsoleMessage"))).toBe(false);
  });
});

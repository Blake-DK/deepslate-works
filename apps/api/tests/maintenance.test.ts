import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryHeldStore } from "../src/players/held-store.js";
import { doorReason, Limbo, waitFor, type Back } from "../src/players/limbo.js";
import { maintenanceTellraw, screenCommands, screenText, actions } from "../src/actions/registry.js";
import { MAINTENANCE_TEXT, type Member } from "../src/shared/access.js";
import type { BlockReason } from "../src/shared/join-gate.js";

// docs/48 Part B: the site's Maintenance (not AMP's state of that name). On, the door lets in admins with the tick
// "Can join during maintenance" and nobody else; switched on, whoever has no tick is kicked; switched off, whoever is
// held for it is looked at again at once and goes back to where they stood.

const UUID_P = "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10";
const UUID_A = "9e2b7c41-0a5d-4f36-8c19-b4e07d2a6f53";
const UUID_T = "4d1a6e30-2b8c-4f71-9e05-c3a7b1d82f64";

const state = vi.hoisted(() => ({
  ran: [] as Array<{ name: string; input: Record<string, unknown>; caller: string | null }>,
  audits: [] as Array<{ action: string; params: Record<string, unknown> }>,
  users: [] as Array<{ id: string; mcUuid: string; mcUsername: string; verifiedAt: Date; guildMember: boolean; role: "PLAYER" | "ADMIN"; earlyAccess: boolean; maintenanceJoin: boolean }>,
}));

vi.mock("../src/actions/run.js", () => ({
  runAction: async (_amp: unknown, _ctx: unknown, name: string, input: Record<string, unknown>, caller: string | null) => {
    state.ran.push({ name, input, caller });
    return { ok: true, commands: 1 };
  },
}));
vi.mock("../src/audit.js", () => ({ audit: async (a: { action: string; params: Record<string, unknown> }) => void state.audits.push(a) }));
vi.mock("../src/settings.js", () => ({ getSection: async (k: string) => (k === "joining" ? { requirePlay: false, windowMin: 30 } : { name: "Deepslate Works", tagline: "" }) }));
vi.mock("../src/db.js", () => {
  type Where = { mcUuid?: string; mcUsername?: string; id?: string };
  const find = (where: Where) => state.users.find((u) => (where.mcUuid ? u.mcUuid === where.mcUuid : where.mcUsername ? u.mcUsername === where.mcUsername : u.id === where.id)) ?? null;
  return {
    db: {
      user: { findFirst: async ({ where }: { where: Where }) => find(where), findUnique: async ({ where }: { where: Where }) => find(where), update: async () => ({}), updateMany: async () => ({ count: 0 }) },
      session: { findFirst: async () => null },
      linkCode: { updateMany: async () => ({ count: 0 }), findFirst: async () => null, findUnique: async () => null, create: async () => ({}) },
    },
  };
});

const env = { LIMBO_POS: "deepslate:limbo 0.5 65 0.5", SPAWN_POS: "107.5 126 87.5", PORTAL_URL: "https://deepslate.dsw.test" } as never;
const BASE: Back = { dimension: "minecraft:overworld", x: 812.5, y: 71, z: -344.5 };

/** The real door rule (doorReason) with the site's two switches in the test's hands; Play first is off. */
class Room extends Limbo {
  live = true;
  maintenance = false;
  protected override async atTheDoor(user: Member & { id: string }): Promise<BlockReason | null> {
    return doorReason(user, { live: this.live, maintenance: this.maintenance, requirePlay: false, windowMin: 30, run: null, pack: null, now: new Date() });
  }
  protected override async where() { return BASE; }
  protected override async prompt() {}
}

const person = (id: string, uuid: string, name: string, role: "PLAYER" | "ADMIN", maintenanceJoin = false) => ({ id, mcUuid: uuid, mcUsername: name, verifiedAt: new Date("2026-09-29T18:16:00Z"), guildMember: true, role, earlyAccess: false, maintenanceJoin });

function setup() {
  const tail = { online: new Set<string>(), uuidByName: new Map<string, string>(), state: 20, on() {}, onResync() {} };
  const store = memoryHeldStore();
  const room = new Room(env, {} as never, tail as never, () => undefined, store);
  const join = async (name: string, uuid: string) => {
    tail.online.add(name);
    tail.uuidByName.set(name, uuid);
    await room.onJoin(name);
  };
  return { tail, store, room, join };
}
const ran = (name: string) => state.ran.filter((r) => r.name === name);

beforeEach(() => {
  state.ran.length = 0;
  state.audits.length = 0;
  state.users = [person("p1", UUID_P, "Bramble09", "PLAYER"), person("a1", UUID_A, "KaneFinch", "ADMIN"), person("a2", UUID_T, "m1_owl", "ADMIN", true)];
});

describe("the door while Maintenance is on (docs/48 B2)", () => {
  it("holds a player in the room with its own words, and the admin without the tick like a player", async () => {
    const t = setup();
    t.room.maintenance = true;
    await t.join("Bramble09", UUID_P);
    await t.join("KaneFinch", UUID_A);
    expect(ran("limbo.holdMaintenance").map((r) => r.input.name)).toEqual(["Bramble09", "KaneFinch"]);
    expect(t.room.heldList().map((h) => [h.name, h.kind, h.reason])).toEqual([["Bramble09", "maintenance", "maintenance"], ["KaneFinch", "maintenance", "maintenance"]]);
    expect(state.audits.filter((a) => a.action === "join.blocked").map((a) => a.params.reason)).toEqual(["maintenance", "maintenance"]);
    expect(t.store.rows.get(UUID_P)).toMatchObject({ reason: "maintenance", back: BASE });
  });

  it("lets the admin with the tick in, and nobody is held", async () => {
    const t = setup();
    t.room.maintenance = true;
    await t.join("m1_owl", UUID_T);
    expect(t.room.held.size).toBe(0);
    expect(ran("link.release").map((r) => r.input.name)).toEqual(["m1_owl"]);
  });

  it("comes before 'We're live': with both off a player waits for maintenance, not for the launch", async () => {
    const t = setup();
    t.room.maintenance = true;
    t.room.live = false;
    await t.join("Bramble09", UUID_P);
    expect(t.room.heldList()[0]?.kind).toBe("maintenance");
  });
});

describe("switched off: whoever is held for it goes on through the door, back to where they stood", () => {
  it("released at the next look, which the switch asks for at once", async () => {
    const t = setup();
    t.room.maintenance = true;
    await t.join("Bramble09", UUID_P);
    t.room.maintenance = false;
    await t.room.maintenanceSwitched(false, "a2");
    expect(ran("limbo.releaseBack")).toEqual([{ name: "limbo.releaseBack", input: { name: "Bramble09", back: BASE }, caller: null }]);
    expect(t.room.held.size).toBe(0);
    expect(state.audits.find((a) => a.action === "join.ready")?.params).toMatchObject({ name: "Bramble09", back: true, was: "maintenance" });
  });

  it("goes on through the rest of the door: not live, they now wait for the launch instead", async () => {
    const t = setup();
    t.room.maintenance = true;
    t.room.live = false;
    await t.join("Bramble09", UUID_P);
    t.room.maintenance = false;
    await t.room.maintenanceSwitched(false, "a2");
    expect(ran("limbo.releaseBack")).toHaveLength(0);
    expect(t.room.heldList()[0]?.kind).toBe("closed");
  });
});

describe("switched on: everybody without the tick is kicked at once", () => {
  it("kicks the player and the admin without the tick, the room's people too; the admin with it stays", async () => {
    const t = setup();
    for (const [n, u] of [["Bramble09", UUID_P], ["KaneFinch", UUID_A], ["m1_owl", UUID_T]] as const) await t.join(n, u);
    t.tail.online.add("owly"); // in the room, never linked
    t.tail.uuidByName.set("owly", "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b");
    state.ran.length = 0;
    const r = await t.room.maintenanceSwitched(true, "a2");
    expect(r).toEqual({ kicked: ["Bramble09", "KaneFinch", "owly"], failed: [] });
    expect(ran("maintenance.kick").map((x) => [x.input.name, x.caller])).toEqual([["Bramble09", "a2"], ["KaneFinch", "a2"], ["owly", "a2"]]);
    expect(ran("limbo.holdMaintenance")).toHaveLength(0); // not moved into the room
  });

  it("kicks nobody while the server is not running", async () => {
    const t = setup();
    t.tail.online.add("Bramble09");
    t.tail.state = 0;
    expect(await t.room.maintenanceSwitched(true, "a2")).toEqual({ kicked: [], failed: [] });
  });
});

describe("the words (docs/48 B2): the same on screen, in chat, in the reminder and in both kicks", () => {
  it("are what the planner wrote", () => {
    expect(MAINTENANCE_TEXT).toBe("Down for maintenance. You'll be let in when it's done.");
    const t = screenText("maintenance", "https://deepslate.dsw.test");
    expect(`${t.title}. ${t.subtitle}`).toBe(MAINTENANCE_TEXT);
    expect(t.bar).toBe(MAINTENANCE_TEXT);
    expect(maintenanceTellraw("Bramble09")).toContain(JSON.stringify(MAINTENANCE_TEXT));
    const ctx = { limbo: { dimension: "deepslate:limbo", x: 0.5, y: 65, z: 0.5 }, spawn: null, portalUrl: "https://deepslate.dsw.test" } as never;
    expect(actions["limbo.kickIdleMaintenance"].build(ctx, { name: "Bramble09" })).toEqual([`kick Bramble09 ${MAINTENANCE_TEXT}`]);
    expect(actions["maintenance.kick"].build(ctx, { name: "Bramble09" })).toEqual([`kick Bramble09 ${MAINTENANCE_TEXT}`]);
    expect(actions["limbo.remindMaintenance"].build(ctx, { name: "Bramble09" })).toEqual([...screenCommands("Bramble09", "maintenance", "https://deepslate.dsw.test"), maintenanceTellraw("Bramble09")]);
  });

  it("the kick is not one an admin can send by hand through /actions: only the switch sends it", () => {
    expect(actions["maintenance.kick"].role).toBe("system");
  });

  it("a hold for maintenance is its own wait", () => {
    expect(waitFor("maintenance")).toBe("maintenance");
  });
});

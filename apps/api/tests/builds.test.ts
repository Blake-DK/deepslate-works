import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { actions, ADMIN_ACTIONS, buildBox, buildPieces, OWN_ROUTE, pieceName } from "../src/actions/registry.js";
import { setGapWait } from "../src/actions/run.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { serviceAuth } from "../src/auth.js";
import { buildRoutes, type SavedBuild } from "../src/routes/builds.js";

// docs/34 §10 (T2 to T4): a build taken from the world, put somewhere else, its ground locked. What the tests cannot
// show is that Minecraft does what the commands say: that is the rehearsal's.

const ctx = { limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "https://x" };
setGapWait(async () => {});

describe("a build in pieces", () => {
  it("the box of two corners, whichever way round", () => {
    expect(buildBox({ x: 10, y: 70, z: -5 }, { x: -3, y: 64, z: 20 })).toEqual({ min: { x: -3, y: 64, z: -5 }, max: { x: 10, y: 70, z: 20 }, size: { x: 14, y: 7, z: 26 } });
  });
  it("48 a side at most: one piece, or a grid with the remainder at the far end", () => {
    expect(buildPieces({ x: 48, y: 20, z: 48 })).toHaveLength(1);
    const p = buildPieces({ x: 60, y: 50, z: 30 });
    expect(p.map((x) => [pieceName("t", x), x.dx, x.dy, x.dz, x.sx, x.sy, x.sz])).toEqual([
      ["t_0_0_0", 0, 0, 0, 48, 48, 30], ["t_1_0_0", 48, 0, 0, 12, 48, 30],
      ["t_0_1_0", 0, 48, 0, 48, 2, 30], ["t_1_1_0", 48, 48, 0, 12, 2, 30],
    ]);
    expect(p.reduce((n, x) => n + x.sx * x.sy * x.sz, 0)).toBe(60 * 50 * 30); // every block once
  });
});

describe("the console commands", () => {
  it("capture: the area loaded, a structure block above each piece, powered, and both blocks taken away again", () => {
    const input = actions["build.capture"].input.parse({ name: "boss_temple", dimension: "minecraft:overworld", from: { x: 100, y: 64, z: 200 }, to: { x: 120, y: 80, z: 215 } });
    expect(actions["build.capture"].build(ctx, input)).toEqual([
      "execute in minecraft:overworld run forceload add 100 200 120 215",
      'execute in minecraft:overworld run setblock 100 81 200 minecraft:structure_block{mode:"SAVE",name:"deepslate:boss_temple_0_0_0",posX:0,posY:-17,posZ:0,sizeX:21,sizeY:17,sizeZ:16,ignoreEntities:1b}',
      "execute in minecraft:overworld run setblock 100 82 200 minecraft:redstone_block",
      "execute in minecraft:overworld run setblock 100 82 200 minecraft:air",
      "execute in minecraft:overworld run setblock 100 81 200 minecraft:air",
      "execute in minecraft:overworld run forceload remove 100 200 120 215",
    ]);
  });
  it("place: one template per piece at its offset, in the main world or a Frontier", () => {
    const input = actions["build.place"].input.parse({ name: "boss_temple", dimension: "deepslate:frontier_s1", at: { x: 0, y: 70, z: 0 }, size: { x: 60, y: 20, z: 30 } });
    expect(actions["build.place"].build(ctx, input)).toEqual([
      "execute in deepslate:frontier_s1 run forceload add 0 0 59 29",
      "execute in deepslate:frontier_s1 run place template deepslate:boss_temple_0_0_0 0 70 0",
      "execute in deepslate:frontier_s1 run place template deepslate:boss_temple_1_0_0 48 70 0",
      "execute in deepslate:frontier_s1 run forceload remove 0 0 59 29",
    ]);
  });
  it("lock: a server claim over the ground, corners in order", () => {
    expect(actions["build.lock"].build(ctx, actions["build.lock"].input.parse({ dimension: "minecraft:overworld", x1: 59, z1: 29, x2: 0, z2: 0 }))).toEqual(["oclaims server claim in minecraft:overworld 0 0 59 29 anyway"]);
  });
  it("takes no free text: a name, a world from the list, whole numbers; never the entrance room", () => {
    const ok = { name: "temple", dimension: "minecraft:overworld", from: { x: 0, y: 64, z: 0 }, to: { x: 5, y: 70, z: 5 } };
    const c = actions["build.capture"].input;
    expect(c.safeParse(ok).success).toBe(true);
    for (const bad of [{ name: "a b" }, { name: 'x"}' }, { name: "Temple" }, { dimension: "deepslate:limbo" }, { dimension: "minecraft:the_nether" }, { dimension: "minecraft:overworld run op me" }, { from: { x: 0.5, y: 64, z: 0 } }, { to: { x: 5, y: 400, z: 5 } }, { to: { x: 900, y: 70, z: 5 } }]) {
      expect([JSON.stringify(bad), c.safeParse({ ...ok, ...bad }).success]).toEqual([JSON.stringify(bad), false]);
    }
    for (const n of ["build.capture", "build.place", "build.lock"] as const) {
      expect(ADMIN_ACTIONS).toContain(n);
      expect(OWN_ROUTE.has(n)).toBe(true);
    }
  });
});

function app(state = 20) {
  const sent: string[] = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
      if (method === "SendConsoleMessage") sent.push(String(params?.message));
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  tail.state = state;
  let book: SavedBuild[] = [];
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  buildRoutes(f, { amp, tail, ctx: () => ctx, book: { load: async () => book, save: async (l) => { book = l; } }, now: () => new Date("2026-11-20T18:00:00Z") });
  const as = (role: string) => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1", "content-type": "application/json" });
  const post = async (url: string, payload: object, role = "ADMIN") => {
    const r = await f.inject({ method: "POST", url, headers: as(role), payload });
    return { status: r.statusCode, body: r.json() as { ok?: boolean; pieces?: number; locked?: boolean; error?: { code: string } } };
  };
  return { f, sent, post, as, book: () => book };
}

describe("Admin → Seasons, Builds", () => {
  const corners = { name: "temple", dimension: "minecraft:overworld", from: { x: 10, y: 64, z: 10 }, to: { x: 30, y: 80, z: 25 } };

  it("is for admins, and needs the server running", async () => {
    const t = app();
    expect((await t.post("/builds/capture", corners, "PLAYER")).status).toBe(403);
    expect((await t.f.inject({ method: "GET", url: "/builds", headers: t.as("PLAYER") })).statusCode).toBe(403);
    const off = app(0);
    expect((await off.post("/builds/capture", corners)).body.error?.code).toBe("server_offline");
    expect(t.sent.concat(off.sent)).toEqual([]);
  });

  it("captures, remembers the size, places it elsewhere and locks its ground", async () => {
    const t = app();
    expect((await t.post("/builds/capture", corners)).body).toMatchObject({ ok: true, pieces: 1 });
    expect(t.book()).toEqual([{ name: "temple", size: { x: 21, y: 17, z: 16 }, from: { dimension: "minecraft:overworld", x: 10, y: 64, z: 10 }, at: "2026-11-20T18:00:00.000Z", by: "u1" }]);
    t.sent.length = 0;
    const r = await t.post("/builds/place", { name: "temple", dimension: "deepslate:frontier_s1", at: { x: 0, y: 70, z: 0 }, lock: true });
    expect(r.body).toMatchObject({ ok: true, pieces: 1, locked: true });
    expect(t.sent).toEqual([
      "execute in deepslate:frontier_s1 run forceload add 0 0 20 15",
      "execute in deepslate:frontier_s1 run place template deepslate:temple_0_0_0 0 70 0",
      "execute in deepslate:frontier_s1 run forceload remove 0 0 20 15",
      "oclaims server claim in deepslate:frontier_s1 0 0 20 15 anyway",
    ]);
  });

  it("refuses a build that was never captured, one too large, and one with no room above it", async () => {
    const t = app();
    expect((await t.post("/builds/place", { name: "nothing", dimension: "minecraft:overworld", at: { x: 0, y: 70, z: 0 } })).status).toBe(404);
    expect((await t.post("/builds/capture", { ...corners, to: { x: 400, y: 80, z: 25 } })).body.error?.code).toBe("too_large");
    expect((await t.post("/builds/capture", { ...corners, from: { x: 10, y: 300, z: 10 }, to: { x: 30, y: 318, z: 25 } })).body.error?.code).toBe("too_high");
    expect(t.sent).toEqual([]);
  });
});

describe("pre-generating another world (Alex, 2026-10-05)", () => {
  it("chunky is pointed at the world that was picked; the main world when none is", async () => {
    const { mapOf } = await import("../src/status/map.js");
    const { sameArea } = await import("../src/status/pregen.js");
    const a = actions["world.pregen"];
    expect(a.build(ctx, a.input.parse({ x: 0, z: 0, radius: 500, world: "deepslate:frontier_sample" }))[1]).toBe("chunky world deepslate:frontier_sample");
    expect(a.build(ctx, a.input.parse({ x: 0, z: 0, radius: 500 }))[1]).toBe("chunky world minecraft:overworld");
    for (const world of ["deepslate:limbo", "minecraft:overworld start", "ae2:spatial_storage"]) expect(a.input.safeParse({ x: 0, z: 0, radius: 500, world }).success).toBe(false);
    expect([mapOf(), mapOf("minecraft:overworld"), mapOf("minecraft:the_nether"), mapOf("minecraft:the_end"), mapOf("deepslate:frontier_s1")]).toEqual(["world", "world", "world_the_nether", "world_the_end", "frontier_s1"]);
    // the same square in another world is another area: chunky's old task is called off first
    expect(sameArea({ x: 0, z: 0, radius: 500 }, { x: 0, z: 0, radius: 500, world: "minecraft:overworld" })).toBe(true);
    expect(sameArea({ x: 0, z: 0, radius: 500 }, { x: 0, z: 0, radius: 500, world: "deepslate:frontier_s1" })).toBe(false);
  });
});

describe("Lock on its own (docs/37 Step 2: after a WorldEdit paste)", () => {
  it("a server claim over two typed corners; admins only, 512 a side at most, server running", async () => {
    const t = app();
    expect(await t.post("/builds/lock", { dimension: "minecraft:overworld", x1: 40, z1: 10, x2: 0, z2: 30 })).toEqual({ status: 200, body: { ok: true } });
    expect(t.sent).toEqual(["oclaims server claim in minecraft:overworld 0 10 40 30 anyway"]);
    expect((await t.post("/builds/lock", { dimension: "minecraft:overworld", x1: 0, z1: 0, x2: 600, z2: 0 })).body.error?.code).toBe("too_large");
    expect((await t.post("/builds/lock", { dimension: "deepslate:limbo", x1: 0, z1: 0, x2: 1, z2: 1 })).body.error?.code).toBe("validation");
    expect((await t.post("/builds/lock", { dimension: "minecraft:overworld", x1: 0, z1: 0, x2: 1, z2: 1 }, "PLAYER")).status).toBe(403);
    expect((await app(0).post("/builds/lock", { dimension: "minecraft:overworld", x1: 0, z1: 0, x2: 1, z2: 1 })).body.error?.code).toBe("server_offline");
    expect(t.sent).toHaveLength(1);
  });
});

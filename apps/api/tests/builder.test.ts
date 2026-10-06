import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { actions, ADMIN_ACTIONS, OWN_ROUTE } from "../src/actions/registry.js";
import { setGapWait } from "../src/actions/run.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { serviceAuth } from "../src/auth.js";
import { builderRoutes, type BuilderUser } from "../src/routes/builder.js";

// docs/37 Step 2: Builder mode. WorldEdit works in creative only (use-in-creative), so the mode is creative, switched
// on by a ticked admin for themselves alone, and off by any admin for anyone.

const ctx = { limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "https://x" };
setGapWait(async () => {});

const USERS: Record<string, BuilderUser> = {
  u1: { id: "u1", role: "ADMIN", builderTools: true, mcUsername: "bramble09" },
  u2: { id: "u2", role: "ADMIN", builderTools: false, mcUsername: "KaneFinch" },
  u3: { id: "u3", role: "PLAYER", builderTools: true, mcUsername: "Rowan" },
  u4: { id: "u4", role: "ADMIN", builderTools: true, mcUsername: null },
};

function app(online: string[] = ["Bramble09", "KaneFinch", "Rowan"], state = 20) {
  const sent: string[] = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
      if (method === "SendConsoleMessage") sent.push(String(params?.message));
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  tail.state = state;
  for (const n of online) tail.online.add(n);
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  builderRoutes(f, { amp, tail, ctx: () => ctx, findUser: async (id) => USERS[id] ?? null });
  const post = async (payload: object, as = "u1", role = "ADMIN") => {
    const r = await f.inject({ method: "POST", url: "/builder/mode", headers: { authorization: "Bearer secret", "x-user-role": role, "x-user-id": as, "content-type": "application/json" }, payload });
    return { status: r.statusCode, body: r.json() as { ok?: boolean; online?: boolean; error?: { code: string } } };
  };
  return { sent, post };
}

describe("Builder mode's commands", () => {
  it("creative on, survival off, for one player by name; never free text", () => {
    expect(actions["builder.on"].build(ctx, actions["builder.on"].input.parse({ player: "Bramble09" }))).toEqual(["gamemode creative Bramble09"]);
    expect(actions["builder.off"].build(ctx, actions["builder.off"].input.parse({ player: "Bramble09" }))).toEqual(["gamemode survival Bramble09"]);
    for (const bad of ["@a", "a b", "x;op me", ""]) expect(actions["builder.on"].input.safeParse({ player: bad }).success).toBe(false);
    expect(["builder.on", "builder.off"].every((n) => OWN_ROUTE.has(n) && ADMIN_ACTIONS.includes(n as never))).toBe(true);
  });
});

describe("POST /builder/mode", () => {
  it("a ticked admin switches themselves on and off, by the name the server knows them under", async () => {
    const t = app();
    expect(await t.post({ on: true })).toEqual({ status: 200, body: { ok: true, online: true } });
    expect(await t.post({ on: false })).toEqual({ status: 200, body: { ok: true, online: true } });
    expect(t.sent).toEqual(["gamemode creative Bramble09", "gamemode survival Bramble09"]);
  });

  it("refuses on for anyone else, without the tick, for a player, without a linked account, offline", async () => {
    const t = app(["Bramble09", "KaneFinch", "Rowan"]);
    expect((await t.post({ on: true, userId: "u2" })).body.error?.code).toBe("forbidden");
    expect((await t.post({ on: true }, "u2")).body.error?.code).toBe("no_builder_tools");
    expect((await t.post({ on: true }, "u3", "ADMIN")).body.error?.code).toBe("no_builder_tools");
    expect((await t.post({ on: true }, "u4")).body.error?.code).toBe("no_minecraft");
    expect((await t.post({ on: true }, "u1", "PLAYER")).status).toBe(403);
    expect((await app([]).post({ on: true })).body.error?.code).toBe("offline");
    expect((await app(["Bramble09"], 0).post({ on: true })).body.error?.code).toBe("server_offline");
    expect(t.sent).toEqual([]);
  });

  it("any admin switches another off (unticking does); offline, there is nothing to do", async () => {
    const t = app();
    expect(await t.post({ on: false, userId: "u1" }, "u2")).toEqual({ status: 200, body: { ok: true, online: true } });
    expect(t.sent).toEqual(["gamemode survival Bramble09"]);
    const off = app([]);
    expect(await off.post({ on: false, userId: "u1" }, "u2")).toEqual({ status: 200, body: { ok: true, online: false } });
    expect(off.sent).toEqual([]);
  });
});

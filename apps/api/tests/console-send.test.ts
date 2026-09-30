import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { actions, ADMIN_ACTIONS, OWN_ROUTE } from "../src/actions/registry.js";
import { consoleRoutes } from "../src/routes/console.js";
import { playerRoutes } from "../src/routes/players.js";
import { RateLimit } from "../src/console/limit.js";
import type { Limbo } from "../src/players/limbo.js";
import { describeAction } from "../src/shared/events.js";

// Planner ruling 2026-09-30 (docs/13): the Minecraft console for admins, as typed, rate-limited, in the event log.

const ctx = { limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "https://x" };

describe("console.send", () => {
  const input = actions["console.send"].input;
  it("sends the line as typed, without a leading slash", () => {
    const build = (c: string) => actions["console.send"].build(ctx, input.parse({ command: c }));
    expect(build("say hi there")).toEqual(["say hi there"]);
    expect(build("/tp bramble09 0 100 0")).toEqual(["tp bramble09 0 100 0"]);
    expect(build("  //gamerule keepInventory true ")).toEqual(["gamerule keepInventory true"]);
    expect(build("op someone")).toEqual(["op someone"]); // no list of allowed commands
  });
  it("takes one line with something on it", () => {
    for (const c of ["", "   ", "/", "say a\nop b", "x".repeat(1001)]) expect(input.safeParse({ command: c }).success).toBe(false);
  });
  it("is an admin action with a route of its own", () => {
    expect(ADMIN_ACTIONS).toContain("console.send");
    expect(OWN_ROUTE.has("console.send")).toBe(true);
  });
  it("reads as \"… ran: <command>\" in the event log", () => {
    expect(describeAction("console.send", { role: "ADMIN", name: "Alex" }, { command: "time set day" }, "OK")).toContain("Alex ran: time set day");
  });
});

describe("RateLimit", () => {
  it("lets 5 a second through for each admin", () => {
    let t = 0;
    const l = new RateLimit(5, 1000, () => t);
    for (let i = 0; i < 5; i++) expect(l.take("a")).toBe(true);
    expect(l.take("a")).toBe(false);
    expect(l.take("b")).toBe(true);
    t = 999;
    expect(l.take("a")).toBe(false);
    t = 1000;
    expect(l.take("a")).toBe(true);
  });
});

function app(state: number) {
  const sent: string[] = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
      if (method === "SendConsoleMessage") sent.push(String(params?.message));
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  tail.state = state;
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  consoleRoutes(f, amp, tail, () => ctx);
  playerRoutes(f, amp, tail, { held: new Map(), actionCtx: ctx } as unknown as Limbo);
  const as = (role: string, id = "u1") => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": id, "content-type": "application/json" });
  return { f, sent, as };
}

describe("POST /console/send", () => {
  it("is for admins only", async () => {
    const { f, sent, as } = app(20);
    for (const role of ["PLAYER", "EARLY", ""]) {
      const r = await f.inject({ method: "POST", url: "/console/send", headers: as(role), payload: { command: "op me" } });
      expect(r.statusCode).toBe(403);
    }
    expect(sent).toEqual([]);
  });
  it("sends what the admin typed", async () => {
    const { f, sent, as } = app(20);
    const r = await f.inject({ method: "POST", url: "/console/send", headers: as("ADMIN"), payload: { command: "/weather clear" } });
    expect(r.statusCode).toBe(200);
    expect(sent).toEqual(["weather clear"]);
  });
  it("needs a running server", async () => {
    const { f, sent, as } = app(0);
    const r = await f.inject({ method: "POST", url: "/console/send", headers: as("ADMIN"), payload: { command: "list" } });
    expect([r.statusCode, r.json().error.code]).toEqual([409, "server_offline"]);
    expect(sent).toEqual([]);
  });
  it("refuses more than 5 a second", async () => {
    const { f, sent, as } = app(20);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await f.inject({ method: "POST", url: "/console/send", headers: as("ADMIN"), payload: { command: `say ${i}` } })).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(sent).toHaveLength(5);
  });
  it("cannot be reached through /actions, which has no rate limit", async () => {
    const { f, sent, as } = app(20);
    const r = await f.inject({ method: "POST", url: "/actions/console.send", headers: as("ADMIN"), payload: { command: "list" } });
    expect(r.statusCode).toBe(404);
    expect(sent).toEqual([]);
  });
});

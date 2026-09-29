import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { playerRoutes } from "../src/routes/players.js";
import type { Limbo } from "../src/players/limbo.js";

// Ending the server's process (planner, 2026-09-29): it stays in the api, for an admin, audited, and only while
// the server is stuck in "Stopping".

function app(state: number, before: string[] = []) {
  const called: string[] = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string): Promise<T> {
      called.push(String(method));
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  tail.state = state;
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  playerRoutes(f, amp, tail, { held: new Map(), actionCtx: {} } as unknown as Limbo, async () => { before.push("paused and saved"); });
  const as = (role: string) => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1", "content-type": "application/json" });
  return { f, called, as };
}

describe("POST /server/kill", () => {
  it("is refused unless the server is in Stopping", async () => {
    for (const state of [20, 0, 10, 30, 50, 100]) {
      const { f, called, as } = app(state);
      const r = await f.inject({ method: "POST", url: "/server/kill", headers: as("ADMIN"), payload: {} });
      expect([state, r.statusCode, r.json().error.code]).toEqual([state, 409, "not_stopping"]);
      expect(called).not.toContain("Kill");
    }
  });
  it("is for admins", async () => {
    const { f, called, as } = app(45);
    const r = await f.inject({ method: "POST", url: "/server/kill", headers: as("PLAYER"), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(called).toEqual([]);
  });
  it("ends the process of a server that is stuck in Stopping", async () => {
    const { f, called, as } = app(45);
    const r = await f.inject({ method: "POST", url: "/server/kill", headers: as("ADMIN"), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(called).toEqual(["Kill"]);
  });
});

describe("POST /server/stop and /server/restart", () => {
  it("pause the pre-generation and wait for the save first", async () => {
    for (const op of ["stop", "restart"]) {
      const before: string[] = [];
      const { f, called, as } = app(20, before);
      const r = await f.inject({ method: "POST", url: `/server/${op}`, headers: as("ADMIN"), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(before).toEqual(["paused and saved"]);
      expect(called).toEqual([op === "stop" ? "Stop" : "Restart"]);
    }
  });
  it("a start has nothing to wait for", async () => {
    const before: string[] = [];
    const { f, as } = app(50, before);
    await f.inject({ method: "POST", url: "/server/start", headers: as("ADMIN"), payload: {} });
    expect(before).toEqual([]);
  });
});

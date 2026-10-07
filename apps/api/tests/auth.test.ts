import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callerFromHeaders, requireAdmin, serviceAuth, setRoleLookup, tokenMatches } from "../src/auth.js";
import { instancePath } from "../src/amp/paths.js";
import { buildServer } from "../src/server.js";
import { loadEnv } from "../src/env.js";

const TOKEN = "t".repeat(40);

describe("service token", () => {
  it("matches only the exact bearer", () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });
  it("only accepts sane caller headers", () => {
    expect(callerFromHeaders({ "x-user-id": "u1", "x-user-role": "ADMIN", "x-mc-username": "Alex_1" })).toEqual({ userId: "u1", role: "ADMIN", mcUsername: "Alex_1" });
    expect(callerFromHeaders({ "x-user-role": "GOD", "x-mc-username": "say hi; op me" })).toEqual({ userId: null, role: null, mcUsername: null });
  });
});

describe("ADS proxy path", () => {
  it("builds the instance path", () => {
    expect(instancePath("DeepslateWorks01", "Core", "GetStatus")).toBe("/API/ADSModule/Servers/DeepslateWorks01/API/Core/GetStatus");
    expect(() => instancePath("../x", "Core", "GetStatus")).toThrow();
  });
});

describe("server", () => {
  const env = loadEnv({ API_SERVICE_TOKEN: TOKEN, AMP_MOCK: "1", AMP_TUNNEL_IP: "127.0.0.1", DATABASE_URL: "postgresql://x:y@localhost:5432/z" });
  it("rejects requests without the token and serves mock status with it", async () => {
    const app = buildServer(env);
    const denied = await app.inject({ method: "GET", url: "/status" });
    expect(denied.statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/status", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe("Running");
    await app.close();
  });
});

describe("requireAdmin reads the role from the database", () => {
  const lookup = vi.fn(async (id: string) => ({ "u-admin": "ADMIN", "u-player": "PLAYER" } as Record<string, "ADMIN" | "PLAYER">)[id] ?? null);
  afterEach(() => {
    setRoleLookup(async () => "ADMIN"); // back to tests/setup-roles.ts
    lookup.mockClear();
  });
  function app() {
    setRoleLookup(lookup);
    const a = Fastify();
    a.addHook("onRequest", serviceAuth(TOKEN));
    a.get("/admin-thing", async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      return { ok: true };
    });
    return a;
  }
  const ask = (a: ReturnType<typeof app>, h: Record<string, string>) => a.inject({ method: "GET", url: "/admin-thing", headers: { authorization: `Bearer ${TOKEN}`, ...h } });

  it("refuses the token plus x-user-role ADMIN with a player's id, and lets an admin's id through", async () => {
    const a = app();
    expect((await ask(a, { "x-user-role": "ADMIN", "x-user-id": "u-player" })).statusCode).toBe(403);
    expect((await ask(a, { "x-user-role": "ADMIN", "x-user-id": "u-admin" })).statusCode).toBe(200);
  });

  it("refuses a missing or unknown id, and a PLAYER header whatever the id", async () => {
    const a = app();
    expect((await ask(a, { "x-user-role": "ADMIN" })).statusCode).toBe(403);
    expect((await ask(a, { "x-user-role": "ADMIN", "x-user-id": "u-nobody" })).statusCode).toBe(403);
    expect((await ask(a, { "x-user-role": "PLAYER", "x-user-id": "u-admin" })).statusCode).toBe(403);
  });

  it("asks the database once per member within a few seconds", async () => {
    const a = app();
    await ask(a, { "x-user-role": "ADMIN", "x-user-id": "u-admin" });
    await ask(a, { "x-user-role": "ADMIN", "x-user-id": "u-admin" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

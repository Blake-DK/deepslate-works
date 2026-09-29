import { describe, expect, it } from "vitest";
import { callerFromHeaders, tokenMatches } from "../src/auth.js";
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

import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { verifyRoutes, VERIFY_LIMIT } from "../src/routes/verify.js";

// POST /modpack/verify: the check after Sync that the server came back with every mod. Admins only, rate-limited by
// Fastify's limiter (code scanning's js/missing-rate-limiting, PR #65).

async function app() {
  let captures = 0;
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  verifyRoutes(f, { capture: async () => (captures++, null), latest: () => null });
  await f.ready();
  const as = (role: string, id = "u1") => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": id, "content-type": "application/json" });
  const post = (headers: Record<string, string>) => f.inject({ method: "POST", url: "/modpack/verify", headers, payload: {} });
  return { post, as, captures: () => captures };
}

describe("POST /modpack/verify", () => {
  it("is for admins only", async () => {
    const { post, as, captures } = await app();
    expect((await post(as("PLAYER"))).statusCode).toBe(403);
    expect(captures()).toBe(0);
  });
  it("answers 3 a minute for one admin, then refuses in the site's error shape; another admin is not held up", async () => {
    const { post, as, captures } = await app();
    expect(VERIFY_LIMIT).toEqual({ max: 3, timeWindow: 60_000 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await post(as("ADMIN"))).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
    const refused = await post(as("ADMIN"));
    expect(refused.json()).toEqual({ error: { code: "rate_limited", message: "The server's mods were just checked. Wait a minute." } });
    expect(captures()).toBe(3);
    expect((await post(as("ADMIN", "u2"))).statusCode).toBe(200);
  });
  it("still checks what it is sent", async () => {
    const { as } = await app();
    const f = Fastify();
    f.addHook("onRequest", serviceAuth("secret"));
    verifyRoutes(f, { capture: async () => null, latest: () => null });
    await f.ready();
    const r = await f.inject({ method: "POST", url: "/modpack/verify", headers: as("ADMIN"), payload: { since: "yesterday" } });
    expect([r.statusCode, r.json().error.code]).toEqual([400, "validation"]);
  });
});

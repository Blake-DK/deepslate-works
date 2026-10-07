import { beforeEach, describe, expect, it, vi } from "vitest";

// The forward_auth answers Caddy relies on: the map lets any member in, the test server's site only admins (docs/42).
// A member on the test host gets 403 (Caddy shows "Admins only"), not 401 (which would send them round the login again).

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; sv?: number; via?: string; pa?: string } },
  user: null as null | { role: "ADMIN" | "PLAYER" },
  loads: 0,
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/server/auth/session", () => ({ loadCurrentUser: async () => { state.loads += 1; return state.user; } }));

import { verifyAccess } from "@/server/auth/verify";

let n = 0;
function signIn(role: "ADMIN" | "PLAYER" | null) {
  n += 1; // a fresh user id per test, so the 30 s cache never carries over
  state.session = { user: { id: `u${n}`, sv: 1 } };
  state.user = role ? { role } : null;
}

describe("verifyAccess", () => {
  beforeEach(() => { state.session = null; state.user = null; state.loads = 0; });

  it("401 without a session, for both hosts", async () => {
    expect((await verifyAccess("member")).status).toBe(401);
    expect((await verifyAccess("admin")).status).toBe(401);
  });

  it("401 when the session no longer matches the database (removed or blocked)", async () => {
    signIn(null);
    expect((await verifyAccess("member")).status).toBe(401);
    expect((await verifyAccess("admin")).status).toBe(401);
  });

  it("a member gets the map but not the test site", async () => {
    signIn("PLAYER");
    const map = await verifyAccess("member");
    expect(map.status).toBe(200);
    expect(map.headers.get("X-User")).toBe(`u${n}`);
    expect((await verifyAccess("admin")).status).toBe(403);
  });

  it("an admin gets both, with the user id for Caddy's log", async () => {
    signIn("ADMIN");
    const dash = await verifyAccess("admin");
    expect(dash.status).toBe(200);
    expect(dash.headers.get("X-User")).toBe(`u${n}`);
    expect((await verifyAccess("member")).status).toBe(200);
  });

  it("asks the database once per session within 30 s", async () => {
    signIn("ADMIN");
    await verifyAccess("admin");
    await verifyAccess("admin");
    await verifyAccess("member");
    expect(state.loads).toBe(1);
  });
});

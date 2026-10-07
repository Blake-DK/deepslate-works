import { beforeEach, describe, expect, it, vi } from "vitest";

// The forward_auth answer Caddy relies on for the map: any member with a session the database still accepts.

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; sv?: number; via?: string; pa?: string } },
  user: null as null | { role: "ADMIN" | "PLAYER" },
  loads: 0,
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/server/auth/session", () => ({ loadCurrentUser: async () => { state.loads += 1; return state.user; } }));

import { verifyMember } from "@/server/auth/verify";

let n = 0;
function signIn(role: "ADMIN" | "PLAYER" | null) {
  n += 1; // a fresh user id per test, so the 30 s cache never carries over
  state.session = { user: { id: `u${n}`, sv: 1 } };
  state.user = role ? { role } : null;
}

describe("verifyMember", () => {
  beforeEach(() => { state.session = null; state.user = null; state.loads = 0; });

  it("401 without a session", async () => {
    expect((await verifyMember()).status).toBe(401);
  });

  it("401 when the session no longer matches the database (removed or blocked)", async () => {
    signIn(null);
    expect((await verifyMember()).status).toBe(401);
  });

  it("200 with the user id for a member", async () => {
    signIn("PLAYER");
    const r = await verifyMember();
    expect(r.status).toBe(200);
    expect(r.headers.get("X-User")).toBe(`u${n}`);
  });

  it("asks the database once per session within 30 s", async () => {
    signIn("ADMIN");
    await verifyMember();
    await verifyMember();
    expect(state.loads).toBe(1);
  });
});

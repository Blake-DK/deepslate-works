import { describe, expect, it } from "vitest";
import { can, PERMISSIONS } from "@/server/auth/can";

describe("can", () => {
  it("lets players do player things", () => {
    expect(can("PLAYER", "ballot.submit")).toBe(true);
    expect(can("PLAYER", "player.actionSelf")).toBe(true);
  });
  it("keeps admin things to admins", () => {
    for (const p of ["vote.manage", "invites.manage", "users.manage", "server.control", "modpack.manage", "audit.read"] as const) {
      expect(can("PLAYER", p)).toBe(false);
      expect(can("ADMIN", p)).toBe(true);
    }
  });
  it("denies missing roles", () => {
    expect(can(null, "catalogue.view")).toBe(false);
    expect(can(undefined, "catalogue.view")).toBe(false);
  });
  it("every permission lists at least one role", () => {
    for (const roles of Object.values(PERMISSIONS)) expect(roles.length).toBeGreaterThan(0);
  });
});

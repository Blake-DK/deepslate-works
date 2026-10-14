import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { roleChangeData } from "@/lib/role-change";

// Alex, 2026-10-14: admins can join during the site's Maintenance by default (docs/48 B1's tick).

describe("what changes with a member's role", () => {
  it("made an admin: the maintenance tick comes with it", () => {
    expect(roleChangeData("PLAYER", "ADMIN")).toEqual({ maintenanceJoin: true });
    expect(roleChangeData(null, "ADMIN")).toEqual({ maintenanceJoin: true });
  });
  it("an admin saved as admin again keeps whatever tick they have (it can be taken away in their menu)", () => {
    expect(roleChangeData("ADMIN", "ADMIN")).toEqual({});
  });
  it("made a player: Builder tools and the tick go", () => {
    expect(roleChangeData("ADMIN", "PLAYER")).toEqual({ builderTools: false, maintenanceJoin: false });
    expect(roleChangeData("PLAYER", "PLAYER")).toEqual({ builderTools: false, maintenanceJoin: false });
  });
  it("migration 0035 gives every admin there is the tick, and nobody else", () => {
    const sql = readFileSync(path.join(__dirname, "..", "prisma", "migrations", "0035_admins_join_maintenance", "migration.sql"), "utf8");
    expect(sql.split("\n").filter((l) => l && !l.startsWith("--"))).toEqual([`UPDATE "User" SET "maintenanceJoin" = true WHERE "role" = 'ADMIN';`]);
  });
});

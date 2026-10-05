import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INVITE_CODE_RE, generateInviteCode, inviteState, normaliseInviteCode } from "@/server/auth/invite-codes";

describe("invite codes", () => {
  it("generates 8 readable characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(INVITE_CODE_RE);
      expect(code).not.toMatch(/[01IO]/);
    }
  });
  it("normalises pasted codes", () => {
    expect(normaliseInviteCode(" ab-cd ef23 ")).toBe("ABCDEF23");
  });
  it("reports state", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const future = new Date("2026-10-08T00:00:00Z");
    const past = new Date("2026-09-01T00:00:00Z");
    expect(inviteState(null, now)).toBe("unknown");
    expect(inviteState({ usedBy: "u1", expiresAt: future }, now)).toBe("used");
    expect(inviteState({ usedBy: null, expiresAt: past }, now)).toBe("expired");
    expect(inviteState({ usedBy: null, expiresAt: future }, now)).toBe("valid");
  });
});

// docs/35 R-01: an existing member with an earlier invite (came in by one, left the Discord server, was sent a new
// one). The second invite is marked with the same member, so `usedBy` must not be unique again.
describe("a second invite for the same member", () => {
  it("is not refused by the database: Invite.usedBy has an index, not a unique one", () => {
    const schema = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
    const invite = /model Invite \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
    expect(invite).toMatch(/^\s*usedBy\s+String\?/m);
    expect(invite).not.toMatch(/^\s*usedBy\s+String\?\s+@unique/m);
    expect(invite).toContain("@@index([usedBy])");
    const migration = readFileSync(path.join(__dirname, "..", "prisma", "migrations", "0028_invite_used_again", "migration.sql"), "utf8");
    expect(migration).toContain('DROP INDEX "Invite_usedBy_key"');
  });
});

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

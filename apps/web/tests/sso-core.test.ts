import { describe, expect, it } from "vitest";
import { ADMIN_GROUP, parseSsoClaims, ssoLink, ssoNewAdmin, ssoRole, type Linkable } from "@/server/auth/sso-core";

// docs/04, sign-in through Authentik (Alex, 2026-10-20): accounts are found by Discord ID only, never by email; the
// group deepslate-admins makes an admin, with three guards.

const BRAMBLE = "100000000000000001";
const OWL = "100000000000000002";

describe("the id token's claims", () => {
  it("reads sub, the Discord ID, the deepslate- groups and a name", () => {
    expect(parseSsoClaims({ sub: "abc", discord_id: BRAMBLE, deepslate_roles: [ADMIN_GROUP], name: "Bramble09", preferred_username: "discord-1" })).toEqual({ sub: "abc", discordId: BRAMBLE, roles: [ADMIN_GROUP], name: "Bramble09" });
    expect(parseSsoClaims({ sub: "abc", preferred_username: "owly" })?.name).toBe("owly");
  });

  it("has no Discord ID without a Discord connection, or with a malformed one", () => {
    for (const discord_id of [null, undefined, "", "abc", "12", "1".repeat(26), {}]) {
      expect(parseSsoClaims({ sub: "abc", discord_id })?.discordId).toBeNull();
    }
    // as a JSON number a Discord ID is already rounded (past 2^53): never read as an ID
    expect(parseSsoClaims({ sub: "abc", discord_id: Number(BRAMBLE) })?.discordId).toBeNull();
    expect(parseSsoClaims({ sub: "abc", discord_id: 123456789 })?.discordId).toBeNull();
  });

  it("tells a missing roles claim (null: change nothing) from an empty one (no group)", () => {
    expect(parseSsoClaims({ sub: "abc" })?.roles).toBeNull();
    expect(parseSsoClaims({ sub: "abc", deepslate_roles: "deepslate-admins" })?.roles).toBeNull();
    expect(parseSsoClaims({ sub: "abc", deepslate_roles: [] })?.roles).toEqual([]);
    expect(parseSsoClaims({ sub: "abc", deepslate_roles: [ADMIN_GROUP, 7, null] })?.roles).toEqual([ADMIN_GROUP]);
  });

  it("refuses a token without a usable sub", () => {
    expect(parseSsoClaims({ discord_id: BRAMBLE })).toBeNull();
    expect(parseSsoClaims({ sub: "  " })).toBeNull();
    expect(parseSsoClaims({ sub: 42 })).toBeNull();
    expect(parseSsoClaims(null)).toBeNull();
  });

  it("never reads an email, whatever the token carries", () => {
    expect(Object.keys(parseSsoClaims({ sub: "abc", email: "name@example.com", email_verified: true })!)).not.toContain("email");
  });
});

describe("which account a sign-in is", () => {
  const acct = (id: string, discordId: string | null, authentikSub: string | null): Linkable => ({ id, discordId, authentikSub });

  it("first sign-in: found by Discord ID and linked, keeping its role this once", () => {
    const u = acct("u1", BRAMBLE, null);
    expect(ssoLink({ sub: "s1", discordId: BRAMBLE }, null, u)).toEqual({ kind: "existing", user: u, firstLink: true, relink: false, setDiscordId: null });
  });

  it("later sign-ins: by sub and Discord ID together", () => {
    const u = acct("u1", BRAMBLE, "s1");
    expect(ssoLink({ sub: "s1", discordId: BRAMBLE }, u, u)).toEqual({ kind: "existing", user: u, firstLink: false, relink: false, setDiscordId: null });
  });

  it("follows the Discord ID when it turns up on a new Authentik user", () => {
    const u = acct("u1", BRAMBLE, "old");
    expect(ssoLink({ sub: "new", discordId: BRAMBLE }, null, u)).toMatchObject({ kind: "existing", user: u, firstLink: false, relink: true });
  });

  it("a Microsoft-only sign-in never lands in an account made before: it is a new account (the door wants an invite)", () => {
    expect(ssoLink({ sub: "s9", discordId: null }, null, null)).toEqual({ kind: "new" });
  });

  it("a Microsoft-only account already linked signs in by its sub", () => {
    const u = acct("u5", null, "s5");
    expect(ssoLink({ sub: "s5", discordId: null }, u, null)).toMatchObject({ kind: "existing", user: u, setDiscordId: null });
  });

  it("a linked account without a Discord ID takes the one its Authentik user is now connected to", () => {
    const u = acct("u5", null, "s5");
    expect(ssoLink({ sub: "s5", discordId: OWL }, u, null)).toMatchObject({ kind: "existing", user: u, setDiscordId: OWL });
  });

  it("an unknown Discord ID with no account is a new account", () => {
    expect(ssoLink({ sub: "s2", discordId: OWL }, null, null)).toEqual({ kind: "new" });
  });

  it("refuses, never merges, when the sub and the Discord ID name two accounts", () => {
    expect(ssoLink({ sub: "s5", discordId: BRAMBLE }, acct("u5", null, "s5"), acct("u1", BRAMBLE, null)).kind).toBe("conflict");
  });

  it("refuses when a linked account's Discord ID is another one", () => {
    expect(ssoLink({ sub: "s1", discordId: OWL }, acct("u1", BRAMBLE, "s1"), null).kind).toBe("conflict");
  });
});

describe("the role a sign-in leaves", () => {
  const admins = [ADMIN_GROUP];
  it("the group decides, both ways", () => {
    expect(ssoRole({ current: "PLAYER", roles: admins, owner: false, firstLink: false })).toBe("ADMIN");
    expect(ssoRole({ current: "ADMIN", roles: [], owner: false, firstLink: false })).toBe("PLAYER");
    expect(ssoRole({ current: "ADMIN", roles: ["deepslate-players"], owner: false, firstLink: false })).toBe("PLAYER");
  });

  it("no change when it already matches", () => {
    expect(ssoRole({ current: "ADMIN", roles: admins, owner: false, firstLink: false })).toBeNull();
    expect(ssoRole({ current: "PLAYER", roles: [], owner: false, firstLink: false })).toBeNull();
  });

  it("guard 1: a missing claim changes nothing", () => {
    expect(ssoRole({ current: "ADMIN", roles: null, owner: false, firstLink: false })).toBeNull();
    expect(ssoRole({ current: "PLAYER", roles: null, owner: false, firstLink: false })).toBeNull();
  });

  it("guard 2: the owner is never made a player", () => {
    expect(ssoRole({ current: "ADMIN", roles: [], owner: true, firstLink: false })).toBeNull();
  });

  it("guard 3: the sign-in that first links an account keeps its role", () => {
    expect(ssoRole({ current: "ADMIN", roles: [], owner: false, firstLink: true })).toBeNull();
    expect(ssoRole({ current: "PLAYER", roles: admins, owner: false, firstLink: true })).toBeNull();
  });

  it("only deepslate-admins makes an admin, by its exact name", () => {
    expect(ssoRole({ current: "PLAYER", roles: ["deepslate-admins-old", "homelab-admins", "Deepslate-Admins"], owner: false, firstLink: false })).toBeNull();
    expect(ssoNewAdmin([ADMIN_GROUP])).toBe(true);
    expect(ssoNewAdmin(["deepslate-players"])).toBe(false);
    expect(ssoNewAdmin(null)).toBe(false);
  });
});

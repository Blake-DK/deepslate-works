import { describe, expect, it } from "vitest";
import { discordDoor, type DoorInput } from "@/server/auth/discord-door";

const at = (over: Partial<DoorInput>) => discordDoor({ gate: true, inGuild: false, existing: null, invite: false, autoJoin: true, bootstrapAdmin: false, ...over });

describe("discordDoor", () => {
  it("keeps the Discord server rule for everyone without an invite", () => {
    expect(at({})).toEqual({ door: "refuse", why: "not-in-server" });
    expect(at({ existing: { outsideAuth: false } })).toEqual({ door: "refuse", why: "not-in-server" });
    expect(at({ bootstrapAdmin: true })).toEqual({ door: "refuse", why: "not-in-server" });
    expect(at({ inGuild: true })).toEqual({ door: "create", outside: false });
    expect(at({ inGuild: true, autoJoin: false })).toEqual({ door: "refuse", why: "no-invite" });
    expect(at({ inGuild: true, existing: { outsideAuth: false } })).toEqual({ door: "in" });
  });
  it("lets an invite stand in for the server, and puts them on the outside list", () => {
    expect(at({ invite: true })).toEqual({ door: "create", outside: true });
    expect(at({ invite: true, inGuild: true })).toEqual({ door: "create", outside: true });
    expect(at({ invite: true, gate: false })).toEqual({ door: "create", outside: true });
  });
  it("never asks someone on the outside list about the server again", () => {
    expect(at({ existing: { outsideAuth: true } })).toEqual({ door: "in" });
  });
  it("takes a member who left the server back in on a new invite", () => {
    expect(at({ existing: { outsideAuth: false }, invite: true })).toEqual({ door: "exempt" });
    expect(at({ existing: { outsideAuth: false }, invite: true, inGuild: true })).toEqual({ door: "in" });
  });
  it("says so when the link they came by no longer works", () => {
    expect(at({ staleInvite: true })).toEqual({ door: "refuse", why: "invite-invalid" });
    expect(at({ staleInvite: true, gate: false })).toEqual({ door: "refuse", why: "invite-invalid" });
    expect(at({ staleInvite: true, existing: { outsideAuth: false } })).toEqual({ door: "refuse", why: "invite-invalid" });
    // a stale link changes nothing for someone who gets in anyway
    expect(at({ staleInvite: true, inGuild: true })).toEqual({ door: "create", outside: false });
    expect(at({ staleInvite: true, existing: { outsideAuth: true } })).toEqual({ door: "in" });
  });
  it("without the rule, asks for an invite as before", () => {
    expect(at({ gate: false })).toEqual({ door: "refuse", why: "no-invite" });
    expect(at({ gate: false, bootstrapAdmin: true })).toEqual({ door: "create", outside: false });
    expect(at({ gate: false, existing: { outsideAuth: false } })).toEqual({ door: "in" });
  });
});

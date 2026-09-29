import { describe, expect, it } from "vitest";
import { doorRule, downloadRule, earlyBanner, isAdmin, isOpenFor, playFirstApplies, playRule, type Member } from "@/shared/access";
import { playGate } from "@/shared/join-gate";

// docs/13 "Early access": the table, as it is written there.

const admin: Member = { role: "ADMIN", earlyAccess: false };
const early: Member = { role: "PLAYER", earlyAccess: true };
const player: Member = { role: "PLAYER", earlyAccess: false };
const LIVE = [true, false] as const;

describe("download (the installer, the pack, the mod list)", () => {
  it.each([
    // who, live, server available, may they, why
    ["admin", admin, false, true, true, "admin"],
    ["admin", admin, false, false, true, "admin"],
    ["admin", admin, true, true, true, "admin"],
    ["early access", early, false, true, true, "online"],
    ["early access", early, false, false, false, "offline"],
    ["early access", early, true, true, true, "online"],
    ["early access", early, true, false, false, "offline"],
    ["player", player, false, true, false, "not_live"],
    ["player", player, false, false, false, "not_live"],
    ["player", player, true, true, true, "online"],
    ["player", player, true, false, false, "offline"],
  ] as const)("%s, live %s, server available %s: %s (%s)", (_n, who, live, up, ok, reason) => {
    expect(downloadRule(who, live, up)).toEqual({ ok, reason });
  });
  it("nobody who is not signed in", () => {
    for (const live of LIVE) expect(downloadRule(null, live, true)).toEqual({ ok: false, reason: "anonymous" });
  });
});

describe("Play", () => {
  it("is for whoever may download: early access while not live, everybody once live", () => {
    expect(playRule(early, false, true).ok).toBe(true);
    expect(playRule(player, false, true).ok).toBe(false);
    expect(playRule(player, true, true).ok).toBe(true);
    expect(playRule(early, true, true).ok).toBe(true);
  });
});

describe("join (the door)", () => {
  const now = new Date("2026-09-29T14:00:00Z");
  const PACK = "0.1.0+47b0b579";
  const pressed = playGate({ at: new Date("2026-09-29T13:50:00Z"), packVersion: PACK }, PACK, 30, now).ok;
  const never = playGate(null, PACK, 30, now).ok;

  it("Play first applies to early access as to any player: no exemption, that is the admins' alone", () => {
    expect(playFirstApplies(early, true)).toBe(true);
    expect(playFirstApplies(player, true)).toBe(true);
    expect(playFirstApplies(admin, true)).toBe(false);
    for (const who of [admin, early, player]) expect(playFirstApplies(who, false)).toBe(false);
  });
  it.each([
    // who, live, pressed Play, at the door
    ["admin", admin, false, false, "in"],
    ["admin", admin, true, false, "in"],
    ["early access", early, false, true, "in"],
    ["early access", early, false, false, "play first"],
    ["early access", early, true, true, "in"],
    ["early access", early, true, false, "play first"],
    ["player", player, true, true, "in"],
    ["player", player, true, false, "play first"],
  ] as const)("%s, live %s, has pressed Play %s: %s", (_n, who, _live, played, door) => {
    expect(doorRule(who, true, played ? pressed : never)).toBe(door);
  });
  it("a player without the flag, while not live, cannot press Play and so waits at the door", () => {
    expect(playRule(player, false, true)).toEqual({ ok: false, reason: "not_live" }); // no run of Play can come from them
    expect(doorRule(player, true, never)).toBe("play first");
    // the same evening with the flag: Play, then in
    expect(playRule(early, false, true).ok).toBe(true);
    expect(doorRule(early, true, pressed)).toBe("in");
  });
});

describe("what they see", () => {
  it("the address and the downloads: early access while not live, everybody once live", () => {
    expect([admin, early, player].map((w) => isOpenFor(w, false))).toEqual([true, true, false]);
    expect([admin, early, player].map((w) => isOpenFor(w, true))).toEqual([true, true, true]);
    expect(isOpenFor(null, true)).toBe(false);
  });
  it("nothing of an admin's, flag or no flag", () => {
    expect([admin, early, player].map(isAdmin)).toEqual([true, false, false]);
    expect(isAdmin({ role: "PLAYER", earlyAccess: true })).toBe(false);
  });
  it("the banner: with the flag, while not live, and not for admins", () => {
    expect(earlyBanner(early, false)).toBe(true);
    expect(earlyBanner(early, true)).toBe(false); // live: the flag changes nothing
    expect(earlyBanner(player, false)).toBe(false);
    expect(earlyBanner({ role: "ADMIN", earlyAccess: true }, false)).toBe(false);
    expect(earlyBanner(null, false)).toBe(false);
  });
  it("says what the planner wrote", async () => {
    const { EARLY_TEXT } = await import("@/components/early-banner");
    expect(EARLY_TEXT).toBe("Early access: things may still break. Tell Alex in Discord if they do.");
  });
  it("is in the event log when it is given and when it is taken away", async () => {
    const { describeAction } = await import("@/shared/events");
    const alex = { role: "ADMIN" as const, name: "Bramble09" };
    expect(describeAction("user.earlyAccess", alex, { displayName: "Pabulum", on: true })).toBe("Bramble09 gave Pabulum early access");
    expect(describeAction("user.earlyAccess", alex, { displayName: "Pabulum", on: false })).toBe("Bramble09 took early access away from Pabulum");
  });
});

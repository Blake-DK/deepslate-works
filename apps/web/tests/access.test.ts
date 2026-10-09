import { describe, expect, it } from "vitest";
import { doorRule, downloadRule, earlyBanner, isAdmin, isOpenFor, mayReport, NOT_OPEN_TEXT, playFirstApplies, playRule, type Member } from "@/shared/access";
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

  // docs/13 §9: live on/off x flag on/off x Play first on/off, and whether they have pressed Play.
  it.each([
    // live, flag, Play first, pressed Play, at the door
    [false, false, true, false, "not open"],
    [false, false, true, true, "not open"], // whatever Play first says
    [false, false, false, false, "not open"], // Play first off does not open the door
    [false, false, false, true, "not open"],
    [false, true, true, false, "play first"],
    [false, true, true, true, "in"],
    [false, true, false, false, "in"],
    [false, true, false, true, "in"],
    [true, false, true, false, "play first"],
    [true, false, true, true, "in"],
    [true, false, false, false, "in"],
    [true, false, false, true, "in"],
    [true, true, true, false, "play first"], // live: the flag changes nothing
    [true, true, true, true, "in"],
    [true, true, false, false, "in"],
    [true, true, false, true, "in"],
  ] as const)("a player: live %s, early access %s, Play first %s, has pressed Play %s: %s", (live, flag, requirePlay, played, door) => {
    expect(doorRule({ role: "PLAYER", earlyAccess: flag }, { live, requirePlay, hasPlayed: played ? pressed : never })).toBe(door);
  });
  it("a run of Play from an installer below the minimum is no run of Play (installer 1.5.0)", () => {
    const recent = new Date("2026-09-29T13:55:00Z");
    const old = playGate({ at: recent, packVersion: PACK, installerVersion: "1.4.3" }, PACK, 30, now, "1.5.0");
    expect(old).toEqual({ ok: false, reason: "old installer" });
    expect(doorRule(player, { live: true, requirePlay: true, hasPlayed: old.ok })).toBe("play first");
    expect(doorRule(early, { live: false, requirePlay: true, hasPlayed: old.ok })).toBe("play first");
    expect(doorRule(admin, { live: true, requirePlay: true, hasPlayed: old.ok })).toBe("in"); // admins are not held
    expect(playGate({ at: recent, packVersion: PACK, installerVersion: "1.5.0" }, PACK, 30, now, "1.5.0").ok).toBe(true);
  });
  it("admins come in, whatever is on or off", () => {
    for (const live of LIVE) for (const flag of [true, false]) for (const requirePlay of [true, false]) for (const hasPlayed of [true, false]) expect(doorRule({ role: "ADMIN", earlyAccess: flag }, { live, requirePlay, hasPlayed })).toBe("in");
  });
  it("says what the planner wrote to whoever waits because the server is not open", () => {
    expect(NOT_OPEN_TEXT).toBe("Not open yet. You'll be let in when the server goes live.");
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
    expect(describeAction("user.earlyAccess", alex, { displayName: "KaneFinch", on: true })).toBe("Bramble09 gave KaneFinch early access");
    expect(describeAction("user.earlyAccess", alex, { displayName: "KaneFinch", on: false })).toBe("Bramble09 took early access away from KaneFinch");
  });
});

describe("a report that a run of Play went through", () => {
  it("is not taken from a player the portal is not open for: it would open the door", () => {
    expect(mayReport(player, false, "ok")).toBe(false);
    expect(mayReport(early, false, "ok")).toBe(true);
    expect(mayReport(admin, false, "ok")).toBe(true);
    expect(mayReport(player, true, "ok")).toBe(true);
    expect(mayReport(null, true, "ok")).toBe(false);
  });
  it("of a run that failed or was stopped is taken from every member: that is what Alex reads", () => {
    for (const who of [admin, early, player]) for (const live of LIVE) for (const outcome of ["failed", "cancelled"]) expect(mayReport(who, live, outcome)).toBe(true);
  });
});

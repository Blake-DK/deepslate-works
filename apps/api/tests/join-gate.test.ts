import { describe, expect, it } from "vitest";
import { playGate } from "../src/shared/join-gate.js";
import { parse } from "../src/events/parse.js";
import { actions, closedTellraw, parsePlace, playTellraw } from "../src/actions/registry.js";
import { doorRule } from "../src/shared/access.js";
import { describeAction, kindOf } from "../src/shared/events.js";
import { parseSection } from "../src/shared/settings.js";

const now = new Date("2026-09-29T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const PACK = "0.1.0+9e578404";

describe("playGate (docs/14 \"Play first\")", () => {
  it("lets in a member whose run of Play is recent and has the server's pack", () => {
    expect(playGate({ at: ago(5), packVersion: PACK }, PACK, 30, now)).toEqual({ ok: true, until: new Date("2026-09-29T12:25:00Z") });
    expect(playGate({ at: ago(30), packVersion: PACK }, PACK, 30, now).ok).toBe(true); // to the minute
  });
  it("holds with the reason", () => {
    expect(playGate(null, PACK, 30, now)).toEqual({ ok: false, reason: "no report" });
    expect(playGate({ at: ago(31), packVersion: PACK }, PACK, 30, now)).toEqual({ ok: false, reason: "stale" });
    expect(playGate({ at: ago(5), packVersion: "0.1.0+47b0b579" }, PACK, 30, now)).toEqual({ ok: false, reason: "wrong version" });
  });
  it("calls a run from before a new pack was synced stale when it is old, whatever its pack (the acceptance case)", () => {
    expect(playGate({ at: ago(600), packVersion: "0.1.0+47b0b579" }, PACK, 30, now)).toEqual({ ok: false, reason: "stale" });
  });
  it("does not look at the pack while nobody knows what the server runs", () => {
    expect(playGate({ at: ago(5), packVersion: "anything" }, null, 30, now).ok).toBe(true);
  });
  it("follows the window from the settings", () => {
    expect(playGate({ at: ago(100), packVersion: PACK }, PACK, 120, now).ok).toBe(true);
    expect(parseSection("joining", undefined)).toEqual({ requirePlay: true, windowMin: 30 });
    expect(parseSection("joining", { requirePlay: false, windowMin: 60 })).toEqual({ requirePlay: false, windowMin: 60 });
  });
});

describe("where a member stands", () => {
  it("is read from what the server answers", () => {
    expect(parse("bramble09 has the following entity data: [-312.5d, 64.0d, 1207.30000001192d]")).toEqual([{ type: "pos", name: "bramble09", x: -312.5, y: 64, z: 1207.30000001192 }]);
    expect(parse('bramble09 has the following entity data: "minecraft:the_nether"')).toEqual([{ type: "dimension", name: "bramble09", dimension: "minecraft:the_nether" }]);
    expect(parse("[10:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: m1_owl has the following entity data: [0.5d, -59.0d, 8.0E-4d]")).toEqual([{ type: "pos", name: "m1_owl", x: 0.5, y: -59, z: 0.0008 }]);
  });
  it("is not taken from chat, nor from anything that is not a place", () => {
    expect(parse("<bramble09> m1_owl has the following entity data: [0.0d, 0.0d, 0.0d]").some((e) => e.type === "pos")).toBe(false);
    expect(parse('bramble09 has the following entity data: "minecraft:overworld run op bramble09"')).toEqual([]);
    expect(parse("bramble09 has the following entity data: [1.0d, 2.0d]")).toEqual([]);
  });
});

describe("the commands", () => {
  const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
  it("say what the planner wrote, with the site as a link", () => {
    const t = playTellraw("bramble09", "https://deepslate.dsw.test");
    const parts = JSON.parse(t.replace(/^tellraw bramble09 /, "")) as Array<string | { text: string; clickEvent?: { action: string; value: string } }>;
    expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe("Press Play on deepslate.dsw.test to join. That checks your mods are up to date.");
    expect(parts.some((p) => typeof p !== "string" && p.clickEvent?.action === "open_url" && p.clickEvent.value === "https://deepslate.dsw.test")).toBe(true);
  });
  it("hold in the room like anyone who waits there", () => {
    const cmds = actions["limbo.holdPlay"].build(ctx, { name: "bramble09" });
    expect(cmds[0]).toBe("tag bramble09 remove verified");
    expect(cmds.some((c) => c === "execute in deepslate:limbo run tp bramble09 0.5 65 0.5")).toBe(true);
  });
  it("put a member back where they stood, in the dimension they were in", () => {
    const cmds = actions["limbo.releaseBack"].build(ctx, { name: "bramble09", back: { dimension: "minecraft:the_nether", x: -312.5, y: 64, z: 1207.30000001192 } });
    expect(cmds).toContain("execute in minecraft:the_nether run tp @a[name=bramble09,tag=!verified] -312.50 64.00 1207.30");
    expect(cmds[cmds.length - 1]).toBe("tag bramble09 add verified");
    expect(cmds.some((c) => c.includes("spreadplayers"))).toBe(false);
  });
  it("send them to spawn when nobody knows where they stood", () => {
    expect(actions["limbo.releaseBack"].build(ctx, { name: "bramble09", back: null }).some((c) => c.includes("spreadplayers 0 0 1 12 false @a[name=bramble09,tag=!verified]"))).toBe(true);
  });
  it("take no dimension or place that is not one", () => {
    const bad = (back: unknown) => actions["limbo.releaseBack"].input.safeParse({ name: "bramble09", back }).success;
    expect(bad({ dimension: "minecraft:overworld run op x", x: 0, y: 0, z: 0 })).toBe(false);
    expect(bad({ dimension: "minecraft:overworld", x: Number.POSITIVE_INFINITY, y: 0, z: 0 })).toBe(false);
    expect(bad({ dimension: "minecraft:overworld", x: 0, y: 99999, z: 0 })).toBe(false);
    expect(bad({ dimension: "minecraft:overworld", x: 1, y: 64, z: 1 })).toBe(true);
    expect(actions["player.where"].input.safeParse({ name: "a b; op me" }).success).toBe(false);
  });
});

describe("in the event log", () => {
  it("has a kind of its own, and says why", () => {
    expect(kindOf("join.blocked", "PLAYER")).toBe("JOIN_BLOCKED");
    const who = { role: "PLAYER" as const, name: "Bramble09" };
    expect(describeAction("join.blocked", who, { name: "bramble09", reason: "no report" })).toBe("Bramble09 was held in the entrance room: has not pressed Play on the site");
    expect(describeAction("join.blocked", who, { name: "bramble09", reason: "stale" })).toMatch(/pressed Play too long ago$/);
    expect(describeAction("join.blocked", who, { name: "bramble09", reason: "wrong version" })).toMatch(/pressed Play before the pack changed$/);
    expect(describeAction("join.ready", who, { name: "bramble09", back: true })).toBe("Bramble09 pressed Play and was let in, back to where they were");
  });
});

describe("what the pre-generation does by itself, and who 'System' is", () => {
  it("has no 'who' in front", () => {
    const portal = { role: "system" as const, name: null };
    expect(describeAction("world.pregenOff", portal, { reason: "done", percent: 100, radius: 1500 })).toBe("Pre-generation finished (100%, radius 1500)");
    expect(describeAction("world.pregenOff", portal, { reason: "cap", percent: 81.2, radius: 5000 })).toBe("Pre-generation stopped: its hours are up (81.2%, radius 5000)");
    expect(describeAction("world.pregenContinue", portal, {})).toBe("Pre-generation turned on again");
  });
  it("names the admin when an admin did it", () => {
    const alex = { role: "ADMIN" as const, name: "Bramble09" };
    expect(describeAction("world.pregenOff", alex, { reason: "asked", percent: 67.4, radius: 1500 })).toBe("Bramble09 stopped the pre-generation, at 67.4%");
    expect(describeAction("world.pregenContinue", alex, {})).toBe("Bramble09 turned the pre-generation on again");
  });
  it("calls a caller with the service token and no portal account System", () => {
    const system = { role: "system" as const, name: "System" };
    expect(describeAction("world.pregenOn", system, { mode: "empty", x: 0, z: 0, radius: 1500 })).toBe("System turned the pre-generation on: when nobody's online; 1500 blocks around 0, 0");
    expect(describeAction("server.start", system, {})).toBe("System started the server");
    expect(describeAction("auth.login", { role: null, name: null }, {}, "DENIED")).toBe("Someone tried to sign in (refused)"); // a visitor nobody knows is still "Someone"
  });
});

describe("the door checks live or early access before anything else (docs/13 §9)", () => {
  const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
  it("holds a linked player without the flag while the site is not live, Play first or not, Play pressed or not", () => {
    for (const requirePlay of [true, false]) for (const hasPlayed of [true, false]) expect(doorRule({ role: "PLAYER", earlyAccess: false }, { live: false, requirePlay, hasPlayed })).toBe("not open");
  });
  it("then Play first, for whoever the server is open for", () => {
    expect(doorRule({ role: "PLAYER", earlyAccess: true }, { live: false, requirePlay: true, hasPlayed: false })).toBe("play first");
    expect(doorRule({ role: "PLAYER", earlyAccess: true }, { live: false, requirePlay: true, hasPlayed: true })).toBe("in");
    expect(doorRule({ role: "PLAYER", earlyAccess: false }, { live: true, requirePlay: false, hasPlayed: false })).toBe("in");
    expect(doorRule({ role: "ADMIN", earlyAccess: false }, { live: false, requirePlay: true, hasPlayed: false })).toBe("in");
  });
  it("says so in the room, in the planner's words, in the room's dimension", () => {
    const parts = JSON.parse(closedTellraw("bramble09").replace(/^tellraw bramble09 /, "")) as Array<string | { text: string }>;
    expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe("Not open yet. You'll be let in when the server goes live.");
    const cmds = actions["limbo.holdClosed"].build(ctx, { name: "bramble09" });
    expect(cmds[0]).toBe("tag bramble09 remove verified");
    expect(cmds).toContain("execute in deepslate:limbo run tp bramble09 0.5 65 0.5");
    expect(cmds).toContain("gamemode adventure bramble09");
    expect(actions["limbo.remindClosed"].build(ctx, { name: "bramble09" })).toEqual([closedTellraw("bramble09")]);
    expect(actions["limbo.kickIdleClosed"].build(ctx, { name: "bramble09" })).toEqual(["kick bramble09 Not open yet. You'll be let in when the server goes live."]);
  });
  it("is in the event log with its reason", () => {
    expect(kindOf("join.blocked", "PLAYER")).toBe("JOIN_BLOCKED");
    expect(describeAction("join.blocked", { role: "PLAYER", name: "Pabulum" }, { name: "pabulum", reason: "not live" })).toBe("Pabulum was held in the entrance room: the server is not open yet");
    expect(describeAction("join.ready", { role: "PLAYER", name: "Pabulum" }, { name: "pabulum", was: "not live", back: true })).toBe("Pabulum was let in: the server is open for them now, back to where they were");
  });
});

import { describe, expect, it } from "vitest";
import { olderThan, PLAY_MODES, playGate, type BlockReason } from "../src/shared/join-gate.js";
import { doorReason, waitFor } from "../src/players/limbo.js";
import { parse } from "../src/events/parse.js";
import { actions, closedTellraw, parsePlace, playTellraw, screenCommands } from "../src/actions/registry.js";
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
    // Alex, 2026-10-06: no minimum to set any more; the app the site hands out is the one needed. One saved before is dropped.
    expect(parseSection("joining", { requirePlay: true, windowMin: 30, minInstaller: "1.5.0" })).toEqual({ requirePlay: true, windowMin: 30 });
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
    expect(cmds.slice(0, 2)).toEqual(["tag @a[name=bramble09,tag=verified] add deepslate.released", "tag bramble09 remove verified"]);
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
    expect(cmds.slice(0, 2)).toEqual(["tag @a[name=bramble09,tag=verified] add deepslate.released", "tag bramble09 remove verified"]);
    expect(cmds).toContain("execute in deepslate:limbo run tp bramble09 0.5 65 0.5");
    expect(cmds).toContain("gamemode adventure bramble09");
    expect(actions["limbo.remindClosed"].build(ctx, { name: "bramble09" })).toEqual([...screenCommands("bramble09", "closed", ctx.portalUrl), closedTellraw("bramble09")]);
    expect(actions["limbo.kickIdleClosed"].build(ctx, { name: "bramble09" })).toEqual(["kick bramble09 Not open yet. You'll be let in when the server goes live."]);
  });
  it("is in the event log with its reason", () => {
    expect(kindOf("join.blocked", "PLAYER")).toBe("JOIN_BLOCKED");
    expect(describeAction("join.blocked", { role: "PLAYER", name: "KaneFinch" }, { name: "KaneFinch", reason: "not live" })).toBe("KaneFinch was held in the entrance room: the server is not open yet");
    expect(describeAction("join.ready", { role: "PLAYER", name: "KaneFinch" }, { name: "KaneFinch", was: "not live", back: true })).toBe("KaneFinch was let in: the server is open for them now, back to where they were");
  });
});

// Planner, 2026-09-29: linking must not skip Play first. KaneFinch linked in the room and was let straight in. The
// order is linked → open for them → Play first (Play, or a run of the installer that went through, inside the
// window) → in, and it is the same whether they walk in linked or have just linked in the room.
describe("the door after linking: the same order as at a join", () => {
  const early = { role: "PLAYER" as const, earlyAccess: true };
  const player = { role: "PLAYER" as const, earlyAccess: false };
  const admin = { role: "ADMIN" as const, earlyAccess: false };
  const run = (mode: "play" | "install" | "first_install" | "update", min: number, pack = PACK, installer = "1.5.0") => ({ mode, at: ago(min), packVersion: pack, installerVersion: installer });

  it.each([
    // who, live, Play first, their latest run that went through, at the door
    ["player", player, false, true, run("play", 5), "not live"], // open first, whatever else
    ["player", player, false, true, run("install", 5), "not live"],
    ["early access", early, false, true, null, "no report"],
    ["early access", early, false, true, run("play", 5), null],
    ["early access", early, false, true, run("install", 5), null], // Setup.bat counts as pressing Play
    ["early access", early, false, true, run("install", 45), "stale"],
    ["early access", early, false, true, run("install", 5, "0.1.0+47b0b579"), "wrong version"],
    ["early access", early, false, false, null, null], // Play first off
    ["player", player, true, true, null, "no report"],
    ["player", player, true, true, run("install", 10), null],
    ["player", player, true, true, run("play", 31), "stale"],
    ["admin", admin, false, true, null, null],
    // a run from an installer older than the one needed (here 1.5.0; since 2026-10-06 always the app the site hands out)
    ["player", player, true, true, run("play", 5, PACK, "1.4.3"), "old installer"], // a fresh run of Play, but from 1.4.3
    ["early access", early, false, true, run("install", 5, PACK, "1.4.1"), "old installer"],
    ["player", player, true, true, run("play", 45, PACK, "1.4.3"), "old installer"], // said before "stale": pressing Play again with it would not help
    ["player", player, true, true, run("first_install", 5, PACK, "1.5.0"), null],
    ["player", player, true, true, run("update", 5, PACK, "1.5.1"), null],
    ["player", player, true, true, run("play", 5, PACK, "unknown"), "old installer"], // an installer that did not say
    ["player", player, false, true, run("play", 5, PACK, "1.4.3"), "not live"], // open first, whatever else
    ["admin", admin, true, true, run("play", 5, PACK, "1.3.0"), null], // admins are not held
    // the same rule for both ways to the door: walking in linked (onJoin) and having just linked (release, below)
  ] as const)("%s, live %s, Play first %s, run %o: %s", (_who, user, live, requirePlay, r, expected) => {
    expect(doorReason(user, { live, requirePlay, windowMin: 30, run: r, pack: PACK, now, minInstaller: "1.5.0" })).toBe(expected);
  });

  it("counts a run of the installer as a run of Play, but not a run that found another one already running", () => {
    expect(PLAY_MODES).toEqual(["play", "install", "first_install", "update", "update_only"]);
    expect(PLAY_MODES).not.toContain("already_running");
  });
  it("needs the newest app the site hands out, and holds nobody for it when the site has none", () => {
    const at = (v: string) => doorReason(player, { live: true, requirePlay: true, windowMin: 30, run: run("play", 5, PACK, v), pack: PACK, now, minInstaller: "3.5.1" });
    expect(at("3.5.1")).toBeNull();
    expect(at("3.6.0")).toBeNull(); // newer than the download (a test build): not held
    expect(at("3.5.0")).toBe("old installer"); // one behind: Play updates it first
    expect(at("2.2.0")).toBe("old installer"); // the old launcher, even after "Not now"
    expect(at("1.5.6")).toBe("old installer");
    expect(doorReason(player, { live: true, requirePlay: true, windowMin: 30, run: run("play", 5, PACK, "1.3.0"), pack: PACK, now, minInstaller: "" })).toBeNull();
  });
  it("compares versions as versions", () => {
    expect([olderThan("1.4.3", "1.5.0"), olderThan("1.5.0", "1.5.0"), olderThan("1.10.0", "1.5.0"), olderThan("1.5", "1.5.0"), olderThan(null, "1.5.0"), olderThan("unknown", "1.5.0"), olderThan("1.4.9", "")]).toEqual([true, false, false, false, true, true, false]);
  });
  it("puts a member with an old installer in the room with the planner's words, as a title that stays and in chat", () => {
    const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
    const cmds = actions["limbo.holdOld"].build(ctx, { name: "samoyedx" });
    expect(cmds).toContain("execute in deepslate:limbo run tp samoyedx 0.5 65 0.5");
    expect(cmds).toContain('title @a[name=samoyedx,tag=!verified] title {"text":"Update Deepslate Works","color":"gold"}');
    expect(cmds).toContain('title @a[name=samoyedx,tag=!verified] subtitle {"text":"Press Play on deepslate.dsw.test: it updates itself","color":"white"}');
    expect(cmds).toContain("title @a[name=samoyedx,tag=!verified] times 0 400 0");
    const chat = JSON.parse(cmds.at(-1)!.replace(/^tellraw samoyedx /, "")) as Array<string | { text: string }>;
    expect(chat.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe("Press Play on deepslate.dsw.test: Deepslate Works updates itself, then you can join. If Play does nothing, download it again from deepslate.dsw.test/install.");
    expect(actions["limbo.remindOld"].build(ctx, { name: "samoyedx" })).toEqual(cmds.slice(-5));
    expect(actions["limbo.kickIdleOld"].build(ctx, { name: "samoyedx" })).toEqual(["kick samoyedx Press Play on deepslate.dsw.test to update Deepslate Works, then join again."]);
    expect(waitFor("old installer")).toBe("old");
    expect(describeAction("join.blocked", { role: "PLAYER", name: "KaneFinch" }, { name: "KaneFinch", reason: "old installer" })).toBe("KaneFinch was held in the entrance room: their installer is older than the minimum; they were told to press Play to update it");
  });

  async function roomWith(blocked: BlockReason | null) {
    const { Limbo } = await import("../src/players/limbo.js");
    const tail = { online: new Set(["kanefinch"]), uuidByName: new Map([["kanefinch", "uuid-p"]]), on() {}, onResync() {} };
    const env = { LIMBO_POS: "deepslate:limbo 0.5 65 0.5", SPAWN_POS: "", PORTAL_URL: "https://deepslate.dsw.test" } as never;
    const limbo = new Limbo(env, {} as never, tail as never, () => {});
    const did: string[] = [];
    const l = limbo as unknown as Record<string, unknown>;
    l.memberByUuid = async () => ({ id: "u1", role: "PLAYER", earlyAccess: true, verifiedAt: new Date(), guildMember: true, outsideAuth: false });
    l.atTheDoor = async () => blocked;
    l.holdMember = async (name: string, _u: string, _id: string, reason: BlockReason, inRoom: boolean) => { did.push(`hold ${name} ${reason} inRoom=${inRoom}`); };
    l.letIn = async (name: string) => { did.push(`let in ${name}`); return { ok: true, commands: 1 }; };
    limbo.held.set("kanefinch", { uuid: "uuid-p", code: "ABCDEFGH", since: 0, lastReminder: 0, kind: "link" });
    return { limbo, did };
  }

  it("holds a member who has just linked but not pressed Play, with the Play line, not the link line", async () => {
    const { limbo, did } = await roomWith("no report");
    expect(await limbo.release("uuid-p")).toEqual({ released: false, name: "kanefinch" });
    expect(did).toEqual(["hold kanefinch no report inRoom=true"]);
  });
  it("holds one the server is not open for with the 'not open' line", async () => {
    const { limbo, did } = await roomWith("not live");
    await limbo.release("uuid-p");
    expect(did).toEqual(["hold kanefinch not live inRoom=true"]);
  });
  it("lets in one who has just linked and has pressed Play (or installed) inside the window", async () => {
    const { limbo, did } = await roomWith(null);
    expect(await limbo.release("uuid-p")).toEqual({ released: true, name: "kanefinch" });
    expect(did).toEqual(["let in kanefinch"]);
    expect(limbo.held.has("kanefinch")).toBe(false);
  });
});

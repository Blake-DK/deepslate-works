import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reportSchema, sanitizeReport, suggestTier } from "@/lib/install-report";
import { playGate } from "@/shared/join-gate";
import { packHash, type LockFile } from "modpack";

// The Deepslate Works app (installer 2.0.0, planner 2026-10-01): extras are the PC's own business, and a member who
// declines install reports still sends "pressed Play, pack version".

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../../modpack/${f}`, import.meta.url), "utf8")) as unknown;

describe("the Play ping with reports declined", () => {
  const ping = { packVersion: "0.1.0+02e48265", installerVersion: "2.0.0", mode: "play", outcome: "ok", durationSec: 41, log: "", system: null, minimal: true };
  it("is a valid report: no log, no PC details, marked minimal", () => {
    const r = sanitizeReport(reportSchema.parse(ping));
    expect(r).toMatchObject({ mode: "play", outcome: "ok", minimal: true, log: "" });
    expect(suggestTier(r.system)).toBeNull(); // it measures nothing: the tier stays as it was
  });
  it("opens the door like any run of Play (Play first)", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const run = { at: new Date("2026-10-01T11:55:00Z"), packVersion: ping.packVersion, installerVersion: ping.installerVersion };
    expect(playGate(run, ping.packVersion, 30, now, "1.5.0")).toMatchObject({ ok: true });
  });
  it("a full report is not minimal", () => {
    expect(reportSchema.parse({ ...ping, minimal: undefined, log: "x" }).minimal).toBe(false);
  });
});

describe("extras and the join check", () => {
  it("the pack's version comes from mods.lock.json alone: the extras' files are not in it", () => {
    const lock = read("mods.lock.json") as LockFile;
    expect(packHash(lock.neoforge, lock.files, lock.configs, lock.resourcepack)).toBe(lock.hash);
    const extras = read("extras.lock.json") as { extras: Array<{ files: Array<{ slug: string }> }> };
    const inPack = new Set(lock.files.map((f) => f.slug));
    for (const x of extras.extras) for (const f of x.files) expect(inPack.has(f.slug)).toBe(false);
  });
  it("so two members on the same pack, one with extras and one without, both pass the gate", () => {
    const lock = read("mods.lock.json") as LockFile;
    const pack = `0.1.0+${lock.hash.slice(0, 8)}`;
    const now = new Date("2026-10-01T12:00:00Z");
    for (const who of ["with extras", "without"]) expect([who, playGate({ at: new Date("2026-10-01T11:59:00Z"), packVersion: pack, installerVersion: "2.0.0" }, pack, 30, now).ok]).toEqual([who, true]);
  });
});

// Installer 2.0.1: the extras block of a report, and the line Admin → Installs and the player page show.
import { extrasLine, extrasReportSchema } from "@/lib/extras-line";

describe("the extras line", () => {
  const names = { iris: "Iris (shaders)", "falling-leaves": "Falling Leaves", "fresh-animations": "Fresh Animations" };
  const block = (over: Record<string, unknown> = {}) => extrasReportSchema.parse({ on: ["iris", "shader-light", "falling-leaves"], shader: "light", queued: false, lastApply: { at: "2026-10-01T15:00:00Z", ok: true }, verify: { ok: true, failed: [] }, inGame: { state: "active", active: ["iris", "falling-leaves"], problems: [] }, ...over });
  it("says what is on, with the shader choice, verified and active in game", () => {
    expect(extrasLine(block(), names)).toBe("Extras: Iris (Light shaders), Falling Leaves. Verified, active in game.");
  });
  it("says when the game has not run since, when checks failed, when changes wait, and when there is nothing", () => {
    expect(extrasLine(block({ inGame: { state: "waiting" } }), names)).toBe("Extras: Iris (Light shaders), Falling Leaves. Verified, not started in game yet.");
    expect(extrasLine(block({ verify: { ok: false, failed: ["fl.jar is missing"] } }), names)).toMatch(/1 check failed/);
    expect(extrasLine(block({ queued: true }), names)).toMatch(/changes wait for the game to close/);
    expect(extrasLine(block({ inGame: { state: "problems", problems: ["falling-leaves: the game did not load it"] } }), names)).toMatch(/problems in game: falling-leaves: the game did not load it/);
    expect(extrasLine(block({ on: [] }), names)).toBe("Extras: none.");
    expect(extrasLine(null)).toBeNull();
  });
  it("a report without the block (installers before 2.0.1) is still valid", async () => {
    const { reportSchema } = await import("@/lib/install-report");
    const r = reportSchema.parse({ packVersion: "x", installerVersion: "2.0.0", mode: "play", outcome: "ok", durationSec: 1, log: "", system: null });
    expect(r.extras).toBeNull();
    expect(reportSchema.parse({ packVersion: "x", installerVersion: "2.0.1", mode: "play", outcome: "ok", durationSec: 1, log: "", system: null, extras: block() }).extras?.on).toContain("iris");
  });
});

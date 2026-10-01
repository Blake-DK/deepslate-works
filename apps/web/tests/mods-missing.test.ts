import { describe, expect, it } from "vitest";
import { missingLine, reportSchema, MODES } from "@/lib/install-report";
import { joinLine } from "@/lib/play";
import { MISSING_MODS_TEXT, modsMissingSince, playGate } from "@/shared/join-gate";

// 2.1.0 (kanefinch's TaCZ kick, 2026-10-01): a game seen without some of the pack's mods holds the member with
// "Your game is missing some mods. Press Play on the site to fix it." until a Play goes through.

const run = { at: new Date("2026-10-01T17:55:00Z"), packVersion: "0.1.0+af76cd89", installerVersion: "2.1.0" };
const now = new Date("2026-10-01T18:00:00Z");

describe("modsMissingSince", () => {
  it("a game check after the last Play that says something is missing", () => {
    expect(modsMissingSince(run, { at: new Date("2026-10-01T17:58:00Z"), ok: false }, null)).toBe(true);
  });
  it("cleared by a Play that went through after it", () => {
    expect(modsMissingSince(run, { at: new Date("2026-10-01T17:50:00Z"), ok: false }, null)).toBe(false);
    expect(modsMissingSince(run, { at: run.at, ok: true }, null)).toBe(false);
  });
  it("the server refusing them at the handshake after the last Play counts too", () => {
    expect(modsMissingSince(run, null, new Date("2026-10-01T17:59:00Z"))).toBe(true);
    expect(modsMissingSince(run, null, new Date("2026-10-01T17:40:00Z"))).toBe(false);
    expect(modsMissingSince(null, null, new Date("2026-10-01T17:40:00Z"))).toBe(true);
  });
});

describe("the gate and its words", () => {
  it("missing mods comes before stale and wrong version, and Play is what fixes it", () => {
    expect(playGate(run, "0.1.0+other", 30, now, "", true)).toEqual({ ok: false, reason: "missing mods" });
    expect(playGate(run, "0.1.0+af76cd89", 30, now, "", false).ok).toBe(true);
    expect(joinLine({ ok: false, reason: "missing mods" })).toEqual({ text: MISSING_MODS_TEXT, ready: false });
    expect(MISSING_MODS_TEXT).toBe("Your game is missing some mods. Press Play on the site to fix it.");
  });
});

describe("reports carry the mod check", () => {
  const base = { packVersion: "0.1.0+af76cd89", installerVersion: "2.1.0", outcome: "failed", durationSec: 0, log: "" };
  it("a game_check report with TaCZ missing", () => {
    expect(MODES).toContain("game_check");
    const r = reportSchema.parse({ ...base, mode: "game_check", mods: { ok: false, where: "game", checked: 45, missing: [{ slug: "tacz-1.21.1", name: "TaCZ (Timeless and Classics Zero)", filename: "tacz.jar", why: "not loaded" }] } });
    expect(r.mods).toEqual({ ok: false, where: "game", checked: 45, missing: [{ slug: "tacz-1.21.1", name: "TaCZ (Timeless and Classics Zero)", filename: "tacz.jar" }], elsewhere: false });
    expect(missingLine(r.mods)).toBe("TaCZ (Timeless and Classics Zero)");
  });
  it("older installers send none", () => {
    expect(reportSchema.parse({ ...base, mode: "play" }).mods).toBeNull();
  });
  it("several missing, or another launcher profile", () => {
    expect(missingLine({ ok: false, where: "folder", checked: 45, missing: [{ slug: "a", name: "A", filename: "a.jar" }, { slug: "b", name: null, filename: "b.jar" }], elsewhere: false })).toBe("A and 1 more");
    expect(missingLine({ ok: false, where: "game", checked: 45, missing: [], elsewhere: true })).toBe("the game started from another launcher profile");
  });
});

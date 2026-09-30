import { describe, expect, it } from "vitest";
import { playLinkMissing, reportSchema, sanitizeReport } from "@/lib/install-report";

// Installer 1.5.6 (planner, 2026-09-30): Setup could not set up the Play button on Rowan's PC.
const base = { packVersion: "0.1.0+7df6ae2c", installerVersion: "1.5.6", mode: "play", outcome: "ok", durationSec: 5, log: "", system: {} };

describe("setupProblems in a report", () => {
  it("is taken with its reason codes and stored with names taken out of the message", () => {
    const r = reportSchema.parse({ ...base, setupProblems: [{ part: "copy", code: "copy_denied", message: "Your antivirus or Windows stopped the installer copying itself to C:\\Users\\player\\AppData\\Local\\DeepslateWorks." }] });
    const s = sanitizeReport(r, ["rowan"]);
    expect(s.setupProblems).toEqual([{ part: "copy", code: "copy_denied", message: "Your antivirus or Windows stopped the installer copying itself to C:\\Users\\~\\AppData\\Local\\DeepslateWorks." }]);
  });
  it("is null from installers that do not say, and refuses codes it does not know", () => {
    expect(reportSchema.parse(base).setupProblems).toBeNull();
    expect(reportSchema.safeParse({ ...base, setupProblems: [{ part: "copy", code: "exploded", message: "x" }] }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, setupProblems: [{ part: "registry", code: "other", message: "x" }] }).success).toBe(false);
  });
});

describe("Play button not set up", () => {
  it("when run from the zip, the copy was refused, or the link failed; not for a blocked desktop shortcut", () => {
    const p = (code: "in_zip" | "copy_denied" | "link_failed" | "shortcut_blocked" | "other", part: "copy" | "link" | "shortcuts" | "apps" | "setup" = "copy") => ({ part, code, message: "m" });
    expect(playLinkMissing([p("in_zip", "setup")])).toBe(true);
    expect(playLinkMissing([p("copy_denied")])).toBe(true);
    expect(playLinkMissing([p("link_failed", "link")])).toBe(true);
    expect(playLinkMissing([p("shortcut_blocked", "shortcuts")])).toBe(false);
    expect(playLinkMissing([p("other", "apps")])).toBe(false);
    expect(playLinkMissing([])).toBe(false); // everything in place: clears the badge
    expect(playLinkMissing(null)).toBeNull(); // the report does not say: the badge stays as it was
  });
});

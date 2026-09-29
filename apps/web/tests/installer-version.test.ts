import { describe, expect, it } from "vitest";
import { compareVersions, isOutdated, outdatedNotice, reportedVersion, UNKNOWN_INSTALLER } from "@/lib/installer-version";
import { reportSchema } from "@/lib/install-report";
import { describeAction } from "@/shared/events";
import { GuessLimiter } from "@/shared/join-code";

// Planner, 2026-09-29: every install and Play report carries the installer that ran; the portal compares it with
// the one it hands out now.

describe("installer versions", () => {
  it("compares like version numbers, not like text", () => {
    expect(compareVersions("1.4.0", "1.4.1")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
    expect(compareVersions("unknown", "1.4.1")).toBeNull();
  });
  it("is out of date when older than the current one, or not known at all", () => {
    expect(isOutdated("1.4.0", "1.4.1")).toBe(true);
    expect(isOutdated("1.4.1", "1.4.1")).toBe(false);
    expect(isOutdated("1.5.0", "1.4.1")).toBe(false); // a newer one (Alex's test copy) is not old
    expect(isOutdated(UNKNOWN_INSTALLER, "1.4.1")).toBe(true);
    expect(isOutdated(null, "1.4.1")).toBe(true);
  });
  it("calls nothing out of date while the site has no installer to hand out", () => {
    expect(isOutdated("1.0.0", null)).toBe(false);
    expect(isOutdated("unknown", "")).toBe(false);
  });
  it("stores what a report says, or \"unknown\" when an old installer says nothing (or nonsense)", () => {
    expect(reportedVersion(" 1.4.2 ")).toBe("1.4.2");
    expect(reportedVersion(undefined)).toBe("unknown");
    expect(reportedVersion("1.4.2; drop table")).toBe("unknown");
    const base = { packVersion: "0.1.0+dbcbe9e1", outcome: "ok", durationSec: 12, log: "", system: {} };
    expect(reportSchema.parse(base).installerVersion).toBe("unknown"); // accepted, not refused
    expect(reportSchema.parse({ ...base, installerVersion: null }).installerVersion).toBe("unknown");
    expect(reportSchema.parse({ ...base, installerVersion: "1.4.0" }).installerVersion).toBe("1.4.0");
  });
  it("tells the Play window what to do", () => {
    expect(outdatedNotice("1.4.0", "1.4.1", "deepslate.dsw.test")).toBe("This PC has installer 1.4.0; the current one is 1.4.1. Download it again from deepslate.dsw.test/install before your next run, and run Setup.bat once.");
    expect(outdatedNotice("unknown", "1.4.1", "deepslate.dsw.test")).toContain("This PC has an old installer;");
  });
  it("says in the event log which installer ran, when it was an old one", () => {
    const who = { role: "PLAYER" as const, name: "m1owl" };
    expect(describeAction("installer.report", who, { mode: "play", outcome: "ok", packVersion: "0.1.0+dbcbe9e1", installerVersion: "1.4.0", currentInstaller: "1.4.1" }, "OK")).toBe("m1owl pressed Play: 0.1.0+dbcbe9e1, launcher opened (installer 1.4.0, current 1.4.1)");
    expect(describeAction("installer.report", who, { mode: "install", outcome: "ok", packVersion: "0.1.0+dbcbe9e1", installerVersion: "unknown", currentInstaller: "1.4.1" }, "OK")).toBe("m1owl installed 0.1.0+dbcbe9e1: all good (installer unknown, current 1.4.1)");
    expect(describeAction("installer.report", who, { mode: "play", outcome: "ok", packVersion: "0.1.0+dbcbe9e1", installerVersion: "1.4.1" }, "OK")).toBe("m1owl pressed Play: 0.1.0+dbcbe9e1, launcher opened");
  });
});

describe("guessing join codes", () => {
  const T = 1_790_000_000_000;
  it("allows five wrong codes per member in 15 minutes, then makes them wait until the oldest is 15 minutes old", () => {
    const g = new GuessLimiter();
    for (let i = 0; i < 5; i++) {
      expect(g.wait("u1", T + i * 1000)).toBeNull();
      g.miss("u1", T + i * 1000);
    }
    expect(g.wait("u1", T + 5000)).toBe(15 * 60_000 - 5000);
    expect(g.wait("u1", T + 15 * 60_000 - 1)).toBe(1);
    expect(g.wait("u1", T + 15 * 60_000)).toBeNull(); // the first miss has left the window
    expect(g.wait("u2", T + 5000)).toBeNull(); // somebody else is not held up by it
  });
  it("counts only misses: a member who gets it right is never slowed down", () => {
    const g = new GuessLimiter();
    for (let i = 0; i < 50; i++) expect(g.wait("u1", T + i)).toBeNull();
  });
  it("caps everyone together, so that many accounts cannot guess side by side", () => {
    const g = new GuessLimiter(5, 30);
    for (let i = 0; i < 30; i++) g.miss(`u${i % 10}`, T + i); // ten members, three misses each
    expect(g.wait("u0", T + 100)).not.toBeNull();
    expect(g.wait("somebody-new", T + 100)).not.toBeNull();
    expect(g.wait("somebody-new", T + 15 * 60_000 + 30)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { PLAY_LINK, PLAY_WAIT_MS, nothingHappened, updateAvailable } from "@/lib/play";
import { reportSchema } from "@/lib/install-report";

describe("the Play link", () => {
  it("is the one link the installer accepts", () => {
    expect(PLAY_LINK).toBe("deepslate://play");
    expect(PLAY_LINK).toMatch(/^deepslate:\/\/play\/?$/); // install.ps1 Test-PlayLink
    expect(PLAY_WAIT_MS).toBe(2500);
  });
});

describe("updateAvailable", () => {
  it("is on when what they launched is not what is current", () => {
    expect(updateAvailable("0.2.0+aaaaaaaa", "0.1.0+47b0b579")).toBe(true);
    expect(updateAvailable("0.1.0+bbbbbbbb", "0.1.0+47b0b579")).toBe(true); // same number, other mods
  });
  it("is off when they are level, have never launched, or there is no pack", () => {
    expect(updateAvailable("0.1.0+47b0b579", "0.1.0+47b0b579")).toBe(false);
    expect(updateAvailable("0.1.0+47b0b579", null)).toBe(false);
    expect(updateAvailable(null, "0.1.0+47b0b579")).toBe(false);
    expect(updateAvailable(undefined, undefined)).toBe(false);
  });
});

describe("nothingHappened", () => {
  it("says so only when the page stayed in front the whole time", () => {
    expect(nothingHappened({ visible: true, focused: true, lostFocus: false })).toBe(true);
  });
  it("takes any loss of focus for the link having been taken", () => {
    expect(nothingHappened({ visible: true, focused: false, lostFocus: true })).toBe(false); // the installer's window is in front
    expect(nothingHappened({ visible: true, focused: true, lostFocus: true })).toBe(false); // the browser asked, they answered
    expect(nothingHappened({ visible: false, focused: false, lostFocus: true })).toBe(false);
    expect(nothingHappened({ visible: true, focused: false, lostFocus: false })).toBe(false);
  });
});

describe("the mode of an install report", () => {
  const base = { packVersion: "0.1.0+47b0b579", installerVersion: "1.3.0", outcome: "ok", failedStep: null, durationSec: 7, log: "", system: {} };
  it("is play when the installer says so", () => {
    expect(reportSchema.parse({ ...base, mode: "play" }).mode).toBe("play");
    expect(reportSchema.parse({ ...base, mode: "install" }).mode).toBe("install");
  });
  it("is install for installers from before there was a Play button", () => {
    expect(reportSchema.parse(base).mode).toBe("install");
    expect(reportSchema.parse({ ...base, mode: null }).mode).toBe("install");
  });
  it("is nothing else", () => {
    expect(reportSchema.safeParse({ ...base, mode: "deepslate://play -Root x" }).success).toBe(false);
  });
  it("is said in the event log", async () => {
    const { describeAction } = await import("@/shared/events");
    const who = { role: "PLAYER" as const, name: "m1owl" };
    expect(describeAction("installer.report", who, { mode: "play", outcome: "ok", packVersion: "0.1.0+47b0b579" }, "OK")).toBe("m1owl pressed Play: 0.1.0+47b0b579, launcher opened");
    expect(describeAction("installer.report", who, { mode: "play", outcome: "failed", failedStep: "Setting up the mods" }, "FAILED")).toBe('m1owl pressed Play and it failed at "Setting up the mods"');
    expect(describeAction("installer.report", who, { mode: "play", outcome: "cancelled" }, "FAILED")).toBe("m1owl pressed Play and closed the window");
    expect(describeAction("installer.report", who, { mode: "install", outcome: "ok", packVersion: "0.1.0+47b0b579" }, "OK")).toBe("m1owl installed 0.1.0+47b0b579: all good");
  });
});

describe("the installer updates itself", () => {
  const sha = "a".repeat(64);
  const base = { packVersion: "0.1.0+47b0b579", installerVersion: "1.4.0", mode: "play", outcome: "ok", failedStep: null, durationSec: 9, log: "", system: {} };

  it("names the installer in the mod list only while installer.json describes the zip that is there", async () => {
    const { installerInfo } = await import("@/lib/installer-info");
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, { sha256: sha, size: 16022 })).toEqual({ version: "1.4.0", sha256: sha, size: 16022 });
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, { sha256: "b".repeat(64), size: 16022 })).toBeNull(); // another zip
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, { sha256: sha, size: 1 })).toBeNull();
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, null)).toBeNull(); // no zip
    expect(installerInfo(null, { sha256: sha, size: 16022 })).toBeNull(); // built before there was an installer.json
    expect(installerInfo({ version: "1.4.0; calc", sha256: sha, size: 16022 }, { sha256: sha, size: 16022 })).toBeNull();
    expect(installerInfo({ version: "1.4.0", sha256: "A".repeat(64), size: 16022 }, { sha256: "A".repeat(64), size: 16022 })).toBeNull(); // lower case only
    expect(installerInfo({ version: "1.4.0", sha256: "abc", size: 3 }, { sha256: "abc", size: 3 })).toBeNull();
  });

  it("is in the report", () => {
    expect(reportSchema.parse({ ...base, updatedFrom: "1.3.0" }).updatedFrom).toBe("1.3.0");
    expect(reportSchema.parse(base).updatedFrom).toBeNull();
    expect(reportSchema.parse(base).updateProblem).toBeNull();
    expect(reportSchema.safeParse({ ...base, updatedFrom: "1.3.0 <script>" }).success).toBe(false);
  });

  it("has names and addresses taken out of the reason an update was not applied", async () => {
    const { sanitizeReport } = await import("@/lib/install-report");
    const r = sanitizeReport(reportSchema.parse({ ...base, updateProblem: "it could not be fetched or written: C:\\Users\\player\\AppData\\Local\\DeepslateWorks\\install.ps1.new from 203.0.113.10" }));
    expect(r.updateProblem).toBe("it could not be fetched or written: C:\\Users\\~\\AppData\\Local\\DeepslateWorks\\install.ps1.new from ~ip~");
  });

  it("is said in the event log and marked in the log", async () => {
    const { describeAction } = await import("@/shared/events");
    const { markLog } = await import("@/lib/install-report");
    const who = { role: "PLAYER" as const, name: "m1owl" };
    expect(describeAction("installer.report", who, { mode: "play", outcome: "ok", packVersion: "0.1.0+47b0b579", installerVersion: "1.4.0", updatedFrom: "1.3.0" }, "OK")).toBe("m1owl pressed Play: 0.1.0+47b0b579, launcher opened (the installer updated itself, 1.3.0 to 1.4.0)");
    expect(describeAction("installer.report", who, { mode: "play", outcome: "ok", packVersion: "0.1.0+47b0b579", installerVersion: "1.3.0", updateProblem: "the checksum …" }, "OK")).toBe("m1owl pressed Play: 0.1.0+47b0b579, launcher opened (the installer could not update itself)");
    expect(markLog("[t] STEP Updating the installer 1.3.0 → 1.4.0\n[t] UPDATE NOT APPLIED: the checksum of the download (55f8...) is not the one the site gave (0000...)", null)[1]!.mark).toBe("fail");
  });
});

describe("Play first (docs/14)", () => {
  it("says until when they may join, or what to do first", async () => {
    const { joinLine } = await import("@/lib/play");
    expect(joinLine({ ok: true, time: "10:35" })).toEqual({ text: "Ready to join until 10:35", ready: true });
    expect(joinLine({ ok: false, reason: "no report" })?.ready).toBe(false);
    expect(joinLine({ ok: false, reason: "no report" })?.text).toMatch(/^Press Play before you join/);
    expect(joinLine({ ok: false, reason: "stale" })?.text).toMatch(/a while ago/);
    expect(joinLine({ ok: false, reason: "wrong version" })?.text).toMatch(/pack has changed/);
    expect(joinLine(null)).toBeNull(); // admins, or Play first switched off
  });
  it("writes the time in UK time", async () => {
    const { clock } = await import("@/lib/utils");
    expect(clock(new Date("2026-09-29T09:35:00Z"))).toBe("10:35"); // summer time
    expect(clock(new Date("2026-12-01T09:35:00Z"))).toBe("09:35");
  });
});

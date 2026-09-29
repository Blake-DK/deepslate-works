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

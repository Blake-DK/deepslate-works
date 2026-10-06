import { describe, expect, it } from "vitest";
import { PLAY_LINK, PLAY_WAIT_MS, nothingHappened, updateAvailable } from "@/lib/play";
import { reportSchema } from "@/lib/install-report";

describe("the Play link", () => {
  it("is the one link the installer accepts", () => {
    expect(PLAY_LINK).toBe("deepslate://play");
    expect(PLAY_LINK).toMatch(/^deepslate:\/\/play\/?$/); // DeepslateWorks.ps1 Test-PlayLink
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
    const { installerInfo } = await import("@/shared/installer-info");
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, { sha256: sha, size: 16022 })).toEqual({ version: "1.4.0", sha256: sha, size: 16022, script: null, exe: null, current: "1.4.0", download: "installer.zip", downloadSize: 16022 });
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, { sha256: "b".repeat(64), size: 16022 })).toBeNull(); // another zip
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, { sha256: sha, size: 1 })).toBeNull();
    expect(installerInfo({ version: "1.4.0", sha256: sha, size: 16022 }, null)).toBeNull(); // no zip
    expect(installerInfo(null, { sha256: sha, size: 16022 })).toBeNull(); // built before there was an installer.json
    expect(installerInfo({ version: "1.4.0; calc", sha256: sha, size: 16022 }, { sha256: sha, size: 16022 })).toBeNull();
    expect(installerInfo({ version: "1.4.0", sha256: "A".repeat(64), size: 16022 }, { sha256: "A".repeat(64), size: 16022 })).toBeNull(); // lower case only
    expect(installerInfo({ version: "1.4.0", sha256: "abc", size: 3 }, { sha256: "abc", size: 3 })).toBeNull();
  });

  it("names DeepslateWorks.ps1 (1.5.0) only while installer.json describes the script that is there", async () => {
    const { installerInfo } = await import("@/shared/installer-info");
    const ps = "c".repeat(64);
    const side = { version: "1.5.0", sha256: sha, size: 30000, script: { sha256: ps, size: 70000 } };
    const zip = { sha256: sha, size: 30000 };
    expect(installerInfo(side, zip, { sha256: ps, size: 70000 })).toEqual({ version: "1.5.0", sha256: sha, size: 30000, script: { sha256: ps, size: 70000 }, exe: null, current: "1.5.0", download: "installer.zip", downloadSize: 30000 });
    expect(installerInfo(side, zip, { sha256: "d".repeat(64), size: 70000 })?.script).toBeNull(); // another script: no PC is told to fetch it
    expect(installerInfo(side, zip, null)?.script).toBeNull(); // not on disk
    expect(installerInfo({ ...side, script: { sha256: "nope", size: 70000 } }, zip, { sha256: "nope", size: 70000 })?.script).toBeNull();
    expect(installerInfo(side, { sha256: "e".repeat(64), size: 30000 }, { sha256: ps, size: 70000 })).toBeNull(); // the zip decides whether there is an installer at all
  });

  it("names DeepslateWorks.exe (3.0) only while installer.json describes the exe that is there; it is then current and the download", async () => {
    const { installerInfo } = await import("@/shared/installer-info");
    const ex = "f".repeat(64);
    const side = { version: "2.1.3", sha256: sha, size: 30000, exe: { version: "3.0.0", sha256: ex, size: 400000 } };
    const zip = { sha256: sha, size: 30000 };
    const i = installerInfo(side, zip, null, { sha256: ex, size: 400000 });
    expect(i?.exe).toEqual({ version: "3.0.0", sha256: ex, size: 400000 });
    expect(i?.version).toBe("2.1.3"); // what 2.x copies update to: the bridge
    expect(i?.current).toBe("3.0.0");
    expect(i?.download).toBe("DeepslateWorks.exe");
    expect(i?.downloadSize).toBe(400000);
    expect(installerInfo(side, zip, null, { sha256: "0".repeat(64), size: 400000 })?.exe).toBeNull(); // another exe
    expect(installerInfo(side, zip, null, null)?.download).toBe("installer.zip"); // not on disk
    expect(installerInfo({ ...side, exe: { ...side.exe, version: "3.0.0 x" } }, zip, null, { sha256: ex, size: 400000 })?.exe).toBeNull();
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
    expect(joinLine({ ok: false, reason: "old installer" })?.text).toMatch(/^Download Deepslate Works again/); // 1.3.x
    expect(joinLine({ ok: false, reason: "old installer" }, true)?.text).toBe("Press Play before you join: it updates Deepslate Works first."); // 1.4.x and on
  });
  it("writes the time in UK time", async () => {
    const { clock } = await import("@/lib/utils");
    expect(clock(new Date("2026-09-29T09:35:00Z"))).toBe("10:35"); // summer time
    expect(clock(new Date("2026-12-01T09:35:00Z"))).toBe("09:35");
  });
});

// Installer 1.5.3: a copy older than 1.4.0 has no update step; the Play button is the new download until a newer report.
describe("tooOldToUpdate", () => {
  it("is true only when the latest report is from an installer older than 1.4.0", async () => {
    const { tooOldToUpdate } = await import("@/lib/play");
    const r = (installerVersion: string, mode = "play", outcome = "ok") => ({ mode, outcome, installerVersion });
    expect(tooOldToUpdate(r("1.3.0"))).toBe(true);
    expect(tooOldToUpdate(r("1.3.0", "install", "failed"))).toBe(true); // any report counts, a failed one too
    expect(tooOldToUpdate(r("unknown"))).toBe(true);
    expect(tooOldToUpdate(r("1.4.0"))).toBe(false);
    expect(tooOldToUpdate(r("1.4.3"))).toBe(false); // updates itself through the bridge
    expect(tooOldToUpdate(r("1.5.3"))).toBe(false);
    expect(tooOldToUpdate(null)).toBe(false); // never ran: the usual first-time offer
    expect(tooOldToUpdate(r("1.3.0", "uninstall"))).toBe(false); // taken off the PC: the download is offered anyway
  });
});

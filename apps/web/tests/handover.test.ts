import { describe, expect, it } from "vitest";
import { installerFor, isApp, type InstallerInfo } from "@/lib/installer-info";
import { installerKind } from "@/lib/installer-version";
import { MODES, reportSchema } from "@/lib/install-report";
import { describeAction } from "@/shared/events";
import { PLAY_MODES } from "@/shared/join-gate";

// Planner, 2026-10-02: the old launcher (DeepslateWorks.ps1, 2.x) asks before it moves a PC to the app
// (DeepslateWorks.exe, 3.x). 2.1.3 moves without asking the moment the mod list names `exe`, so only the app sees `exe`.

const info: InstallerInfo = {
  version: "2.2.0", sha256: "a".repeat(64), size: 10, script: { sha256: "b".repeat(64), size: 20 },
  exe: { version: "3.1.0", sha256: "c".repeat(64), size: 30 }, current: "3.1.0", download: "DeepslateWorks.exe", downloadSize: 30,
};
const POWERSHELL = "Mozilla/5.0 (Windows NT; Windows NT 10.0; en-GB) WindowsPowerShell/5.1.26100.1882";

describe("the hand-over offer", () => {
  it("knows the app by its user agent", () => {
    expect(isApp("DeepslateWorks/3.0.0 (Windows)")).toBe(true);
    expect(isApp(POWERSHELL)).toBe(false);
    expect(isApp(null)).toBe(false);
    expect(isApp("Mozilla/5.0 DeepslateWorks/3.0.0")).toBe(false);
  });
  it("gives the app its own update as `exe`, as before", () => {
    expect(installerFor(info, "DeepslateWorks/3.0.0 (Windows)", "1.5.0")).toEqual(info);
  });
  it("never shows the old launcher `exe`, so 2.1.3 updates to the script that asks first", () => {
    const o = installerFor(info, POWERSHELL, "1.5.0")!;
    expect(o.exe).toBeNull();
    expect(o.script).toEqual(info.script);
    expect(o.version).toBe("2.2.0");
    expect(o.app).toEqual(info.exe);
    expect(o.minimum).toBe("1.5.0");
  });
  it("says when there is no minimum, and offers nothing when there is no installer", () => {
    expect(installerFor(info, POWERSHELL, "")!.minimum).toBeNull();
    expect(installerFor(null, POWERSHELL, "3.0")).toBeNull();
  });
});

describe("app or old launcher", () => {
  it("names each kind with its version", () => {
    expect(installerKind("3.1.0")).toEqual({ kind: "app", label: "app 3.1.0" });
    expect(installerKind("2.1.3")).toEqual({ kind: "old launcher", label: "old launcher 2.1.3" });
    expect(installerKind("1.4.0")).toEqual({ kind: "old installer", label: "old installer 1.4.0" });
    expect(installerKind("unknown")).toBeNull();
    expect(installerKind(null)).toBeNull();
  });
});

describe("hand-over reports", () => {
  const base = { packVersion: "0.1.0+43978c76", durationSec: 3, log: "", system: {} };
  it("are taken, and never count as pressing Play", () => {
    expect(MODES).toContain("handover");
    expect(reportSchema.parse({ ...base, mode: "handover", outcome: "ok", installerVersion: "3.1.0" }).mode).toBe("handover");
    expect(PLAY_MODES as readonly string[]).not.toContain("handover");
  });
  it("read as what happened, from either side", () => {
    const say = (p: Record<string, unknown>) => describeAction("installer.report", { role: "PLAYER", name: "Pabulum" }, { mode: "handover", ...p });
    expect(say({ installerVersion: "2.2.0", outcome: "ok" })).toContain("said Update now");
    expect(say({ installerVersion: "2.2.0", outcome: "skipped" })).toContain("said Not now");
    expect(say({ installerVersion: "2.2.0", outcome: "failed", updateProblem: "the checksum did not match" })).toContain("the checksum did not match");
    expect(say({ installerVersion: "3.1.0", outcome: "ok" })).toContain("moved over to the app (3.1.0)");
    expect(say({ installerVersion: "3.1.0", outcome: "cancelled", failedStep: "Move over" })).toContain("carries on at the next Play");
  });
});

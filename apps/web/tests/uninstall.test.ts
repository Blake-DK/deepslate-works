import { describe, expect, it } from "vitest";
import { reportSchema } from "@/lib/install-report";
import { installedNow } from "@/lib/play";
import { describeAction } from "@/shared/events";

// The uninstaller (DeepslateWorks.ps1 -Uninstall, installer 1.5.2; planner 2026-09-30).

const base = { packVersion: "0.1.0+47b0b579", installerVersion: "1.5.2", outcome: "ok", durationSec: 4, log: "[t] uninstall" };

describe("an uninstall report", () => {
  it("is taken, without any PC details", () => {
    const r = reportSchema.safeParse({ ...base, mode: "uninstall", system: null });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ mode: "uninstall", system: { ramGb: null } });
  });
  it("reads as such in the event log", () => {
    expect(describeAction("installer.report", { role: "PLAYER", name: "Pabulum" }, { mode: "uninstall", outcome: "ok" }, "OK")).toBe("Pabulum removed Deepslate Works from their PC");
    expect(describeAction("installer.report", { role: "PLAYER", name: "Pabulum" }, { mode: "uninstall", outcome: "failed" }, "FAILED")).toBe("Pabulum tried to remove Deepslate Works from their PC");
    expect(describeAction("launcher.revoke.self", { role: "PLAYER", name: "Pabulum" }, {}, "OK")).toBe("Pabulum signed this PC's installer out (uninstall)");
  });
});

describe("installedNow", () => {
  it("is false only when the latest report is an uninstall that went through", () => {
    expect(installedNow({ mode: "uninstall", outcome: "ok" })).toBe(false);
    expect(installedNow({ mode: "uninstall", outcome: "failed" })).toBe(true);
    expect(installedNow({ mode: "play", outcome: "ok" })).toBe(true);
    expect(installedNow(null)).toBe(true); // nothing known: the button behaves as it always has
  });
});

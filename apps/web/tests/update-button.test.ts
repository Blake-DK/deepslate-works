import { describe, expect, it } from "vitest";
import { MODE_LABEL, MODES, reportSchema } from "@/lib/install-report";
import { describeAction } from "@/shared/events";
import { PLAY_MODES, playGate } from "@/shared/join-gate";

// App 3.3.0 (planner 2026-10-02): the Update button. Its report has a type of its own, "update_only", shown as "Update"
// in Admin → Installs, and it counts at the door like an install: it proves the right pack is on the PC.

const base = { packVersion: "0.1.0+43978c76", durationSec: 41, log: "STEP Setting up the mods\nOK 39 mods in place (3 downloaded)", system: {} };

describe("the Update button's report", () => {
  it("is taken, listed as Update, and counts for the door", () => {
    expect(MODES).toContain("update_only");
    expect(reportSchema.parse({ ...base, mode: "update_only", outcome: "ok", installerVersion: "3.3.0" }).mode).toBe("update_only");
    expect(MODE_LABEL.update_only).toBe("Update");
    expect(MODE_LABEL.update).toBe("Play (new pack)"); // a Play that brought a new pack is still what it was
    expect(PLAY_MODES as readonly string[]).toContain("update_only");
    const now = new Date("2026-10-02T15:50:00Z");
    expect(playGate({ at: new Date("2026-10-02T15:42:00Z"), packVersion: "0.1.0+43978c76", installerVersion: "3.3.0" }, "0.1.0+43978c76", 30, now).ok).toBe(true);
  });
  it("reads as what happened, without the game", () => {
    const say = (p: Record<string, unknown>) => describeAction("installer.report", { role: "PLAYER", name: "Pabulum" }, { mode: "update_only", packVersion: "0.1.0+43978c76", ...p });
    expect(say({ outcome: "ok" })).toBe("Pabulum pressed Update: 0.1.0+43978c76 is on their PC, game not started");
    expect(say({ outcome: "failed", failedStep: "Setting up the mods" })).toBe('Pabulum pressed Update and it failed at "Setting up the mods"');
  });
});

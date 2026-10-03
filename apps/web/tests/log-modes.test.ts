import { describe, expect, it } from "vitest";
import { MODES, MODE_LABEL, reportSchema } from "@/lib/install-report";
import { PLAY_MODES } from "@/shared/join-gate";
import { describeAction } from "@/shared/events";

// App 3.4.2 (Alex, 2026-10-03): the Log tab's Send to Alex (log_sent), and a run that never reported, sent by the next
// one (unfinished). Neither is a Play: they never open the door.
describe("the app's log reports", () => {
  it("are modes the site takes, with labels, and neither counts as a Play", () => {
    for (const m of ["log_sent", "unfinished"] as const) {
      expect(MODES).toContain(m);
      expect(MODE_LABEL[m]).toBeTruthy();
      expect(PLAY_MODES as readonly string[]).not.toContain(m);
    }
  });
  it("a Send to Alex report with no PC details passes the schema", () => {
    const r = reportSchema.safeParse({ packVersion: "0.1.0+c99f2aae", installerVersion: "3.4.2", mode: "log_sent", outcome: "ok", durationSec: 0, log: "===== deepslate-works.log =====\nline", system: null });
    expect(r.success).toBe(true);
  });
  it("the event log says what happened", () => {
    const who = { role: "PLAYER" as const, name: "Bramble09" };
    expect(describeAction("installer.report", who, { mode: "log_sent", outcome: "ok" })).toContain("sent their logs from the app's Log tab");
    expect(describeAction("installer.report", who, { mode: "unfinished", outcome: "failed" })).toContain("never finished");
  });
});

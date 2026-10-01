import { describe, expect, it } from "vitest";
import { clearingText, countTone, planText } from "../src/lib/ground";

describe("ground items card words", () => {
  it("says what the schedule does", () => {
    expect(planText({ auto: false, threshold: 1500 })).toBe("Off. Items are only cleared when someone presses the button.");
    expect(planText({ auto: true, threshold: 1500 })).toBe("On: every 10 minutes, clears when more than 1,500 items are lying around.");
  });
  it("colours the counts", () => {
    expect(countTone("items", 100)).toBe("good");
    expect(countTone("items", 900)).toBe("warn");
    expect(countTone("items", 1500)).toBe("bad");
    expect(countTone("corpses", 99)).toBe("neutral");
  });
  it("counts down", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(clearingText({ by: "button", step: "warned60", clearsAt: "2026-10-01T12:00:45Z" }, now)).toBe("Players have been warned; clearing in about 45 s.");
    expect(clearingText({ by: "schedule", step: "warned10", clearsAt: "2026-10-01T12:00:08Z" }, now)).toBe("Players have been warned; clearing in about 8 s (automatic).");
    expect(clearingText({ by: "button", step: "clearing", clearsAt: "2026-10-01T12:00:00Z" }, now)).toBe("Clearing now…");
  });
});

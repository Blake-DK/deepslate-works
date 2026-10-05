import { describe, expect, it } from "vitest";
import { ukLocalToDate } from "@/lib/uk-time";
import { launchText } from "@/lib/launch";

describe("ukLocalToDate", () => {
  it("handles BST (UTC+1) and GMT (UTC+0)", () => {
    expect(ukLocalToDate("2026-07-01T19:00")?.toISOString()).toBe("2026-07-01T18:00:00.000Z");
    expect(ukLocalToDate("2026-12-01T19:00")?.toISOString()).toBe("2026-12-01T19:00:00.000Z");
  });
  it("rejects junk", () => {
    expect(ukLocalToDate("tomorrow")).toBeNull();
    expect(ukLocalToDate("")).toBeNull();
  });
});

describe("launchText (docs/35 R-22: days of the UK's calendar, not blocks of 24 hours)", () => {
  const launch = new Date("2026-07-10T18:00:00Z"); // 19:00 in the UK
  it("says today on the day, from just after midnight in the UK", () => {
    expect(launchText(launch, new Date("2026-07-10T09:00:00Z"))).toMatch(/^Launching today, /);
    expect(launchText(launch, new Date("2026-07-09T23:30:00Z"))).toMatch(/^Launching today, /); // 00:30 on the 10th in the UK
  });
  it("says tomorrow the day before, however many hours that is", () => {
    expect(launchText(launch, new Date("2026-07-09T22:30:00Z"))).toMatch(/, tomorrow\.$/); // 23:30 on the 9th
    expect(launchText(launch, new Date("2026-07-08T23:30:00Z"))).toMatch(/, tomorrow\.$/); // 00:30 on the 9th, 42 hours before
  });
  it("counts whole days before that", () => {
    expect(launchText(launch, new Date("2026-07-08T22:30:00Z"))).toMatch(/, in 2 days\.$/);
    expect(launchText(launch, new Date("2026-07-03T12:00:00Z"))).toMatch(/, in 7 days\.$/);
  });
  it("says so once the time has passed, and when there is no date", () => {
    expect(launchText(launch, new Date("2026-07-10T18:00:01Z"))).toMatch(/^Launch was planned for /);
    expect(launchText(launch, new Date("2026-07-12T09:00:00Z"))).toMatch(/^Launch was planned for /);
    expect(launchText(null)).toBe("Launch date to be announced.");
  });
});

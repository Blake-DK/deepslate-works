import { describe, expect, it } from "vitest";
import { ukLocalToDate } from "@/lib/uk-time";

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

import { describe, expect, it } from "vitest";
import { downloadsOpen } from "@/lib/gate-rule";

describe("downloads for players", () => {
  it("are open while the server runs or sleeps", () => {
    expect(downloadsOpen("online")).toBe(true);
    expect(downloadsOpen("sleeping")).toBe(true);
  });
  it("are closed while it starts, is off, or cannot be reached", () => {
    expect(downloadsOpen("starting")).toBe(false);
    expect(downloadsOpen("offline")).toBe(false);
    expect(downloadsOpen("unknown")).toBe(false);
    expect(downloadsOpen(null)).toBe(false);
    expect(downloadsOpen(undefined)).toBe(false);
  });
});

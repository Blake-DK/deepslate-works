import { describe, expect, it } from "vitest";
import { downloadsOpen } from "@/lib/gate-rule";

describe("downloads for players", () => {
  it("are open while the server runs, sleeps, or is being woken by a Play", () => {
    expect(downloadsOpen("online")).toBe(true);
    expect(downloadsOpen("asleep")).toBe(true);
    expect(downloadsOpen("waking")).toBe(true);
  });
  it("are closed while it starts, stops, is switched off, crashed, or cannot be reached", () => {
    for (const s of ["starting", "stopping", "restarting", "off", "crashed", "unreachable"] as const) expect([s, downloadsOpen(s)]).toEqual([s, false]);
    expect(downloadsOpen(null)).toBe(false);
    expect(downloadsOpen(undefined)).toBe(false);
  });
});

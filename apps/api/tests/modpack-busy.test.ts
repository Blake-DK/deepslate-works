import { describe, expect, it } from "vitest";
import { OneAtATime } from "../src/modpack/busy.js";

describe("one build or sync at a time, and the second caller is told who holds it", () => {
  it("names the holder and when it began", () => {
    const b = new OneAtATime();
    expect(b.take("sync", "vps-session-437560c9", new Date("2026-10-03T17:38:09Z"))).toEqual({ ok: true });
    expect(b.take("build", "vps-session-825effe7")).toEqual({ ok: false, message: "a sync is already running, held by vps-session-437560c9 since 2026-10-03 17:38:09 UTC" });
  });
  it("is free again once released", () => {
    const b = new OneAtATime();
    b.take("build", "u1");
    b.release();
    expect(b.current).toBeNull();
    expect(b.take("sync", "u2").ok).toBe(true);
    expect(b.current?.by).toBe("u2");
  });
  it("still says something when the caller gave no name", () => {
    const b = new OneAtATime();
    b.take("build", undefined, new Date("2026-10-03T18:00:00Z"));
    expect(b.take("sync", "x")).toEqual({ ok: false, message: "a build is already running, held by an unnamed caller since 2026-10-03 18:00:00 UTC" });
  });
});

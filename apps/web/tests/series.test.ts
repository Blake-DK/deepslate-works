import { describe, expect, it } from "vitest";
import { fillBuckets, formatUptime, sparkSegments, timeAgo, tpsTone } from "@/lib/series";

describe("fillBuckets", () => {
  const now = new Date("2026-09-29T12:10:00Z");
  const b = (iso: string) => Math.floor(Date.parse(iso) / 1000 / 1800);
  it("lays sparse rows onto the window, newest slot last, gaps as null", () => {
    const out = fillBuckets([{ bucket: b("2026-09-29T12:00:00Z"), value: 3 }, { bucket: b("2026-09-29T11:00:00Z"), value: 1 }], now, 1800, 4);
    expect(out).toEqual([null, 1, null, 3]);
  });
  it("ignores rows outside the window and keeps the larger value of a repeated bucket", () => {
    const out = fillBuckets([{ bucket: b("2026-09-28T01:00:00Z"), value: 9 }, { bucket: b("2026-09-29T12:00:00Z"), value: 2 }, { bucket: b("2026-09-29T12:00:00Z"), value: 5 }], now, 1800, 48);
    expect(out).toHaveLength(48);
    expect(out.at(-1)).toBe(5);
    expect(out.filter((v) => v !== null)).toEqual([5]);
  });
});

describe("formatUptime", () => {
  it("reads AMP's d:hh:mm:ss", () => {
    expect(formatUptime("0:01:23:45")).toBe("1 h 23 min");
    expect(formatUptime("2:03:00:00")).toBe("2 d 3 h");
    expect(formatUptime("0:00:07:10")).toBe("7 min");
    expect(formatUptime("0:00:00:20")).toBe("under a minute");
    expect(formatUptime(null)).toBeNull();
    expect(formatUptime("soon")).toBe("soon");
  });
});

describe("tpsTone", () => {
  it("follows docs/05", () => {
    expect(tpsTone(20)).toBe("good");
    expect(tpsTone(19)).toBe("good");
    expect(tpsTone(18.9)).toBe("warn");
    expect(tpsTone(15)).toBe("warn");
    expect(tpsTone(14.9)).toBe("bad");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  it("speaks plainly", () => {
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo(new Date("2026-09-29T11:59:30Z"), now)).toBe("just now");
    expect(timeAgo(new Date("2026-09-29T11:30:00Z"), now)).toBe("30 min ago");
    expect(timeAgo(new Date("2026-09-29T07:00:00Z"), now)).toBe("5 h ago");
    expect(timeAgo(new Date("2026-09-22T12:00:00Z"), now)).toBe("7 days ago");
  });
});

describe("sparkSegments", () => {
  it("breaks the line at gaps and scales to the peak", () => {
    const { segments, max } = sparkSegments([0, 2, null, 4, 4], 100, 40, 0);
    expect(max).toBe(4);
    expect(segments).toEqual(["0.0,40.0 25.0,20.0", "75.0,0.0 100.0,0.0"]);
  });
  it("never divides by zero", () => {
    expect(sparkSegments([0, 0], 100, 40, 0).segments).toEqual(["0.0,40.0 100.0,40.0"]);
    expect(sparkSegments([3], 100, 40, 0).segments).toEqual(["0.0,0.0"]);
  });
});

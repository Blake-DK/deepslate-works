import { describe, expect, it } from "vitest";
import { arrangeNews, isExpired, isPinnedNow, parseNewsDates, type Dated } from "@/lib/news";
import { dateToUkLocal } from "@/lib/uk-time";

// docs/05: "pinned until" and "hide from" on news items, handled by the app (no host timer).

const now = new Date("2026-09-30T04:30:00Z");
const at = (iso: string) => new Date(iso);
const item = (id: string, over: Partial<Dated> = {}) => ({ id, pinned: false, pinnedUntil: null, expiresAt: null, createdAt: at("2026-09-29T12:00:00Z"), ...over });

describe("pinned until", () => {
  it.each([
    // pinned, pinned until, pinned now?
    [false, null, false],
    [true, null, true], // until unpinned
    [true, "2026-10-02T04:20:00Z", true], // the map notice, before the date
    [true, "2026-09-30T04:30:00Z", false], // to the second: over
    [true, "2026-09-29T00:00:00Z", false], // the date has passed: an ordinary item, nobody had to unpin it
    [false, "2026-10-02T04:20:00Z", false], // unpinned by hand before the date
  ] as const)("pinned %s, until %s: %s", (pinned, until, expected) => {
    expect(isPinnedNow(item("a", { pinned, pinnedUntil: until ? at(until) : null }), now)).toBe(expected);
  });
});

describe("hide from", () => {
  it("hides from the moment on, not before", () => {
    expect(isExpired(item("a"), now)).toBe(false);
    expect(isExpired(item("a", { expiresAt: at("2026-09-30T04:31:00Z") }), now)).toBe(false);
    expect(isExpired(item("a", { expiresAt: at("2026-09-30T04:30:00Z") }), now)).toBe(true);
  });
});

describe("what Home shows", () => {
  const rows = [
    item("old-pinned", { pinned: true, createdAt: at("2026-09-01T00:00:00Z") }),
    item("map-notice", { pinned: true, pinnedUntil: at("2026-10-02T04:20:00Z"), createdAt: at("2026-09-30T04:20:00Z") }),
    item("was-pinned", { pinned: true, pinnedUntil: at("2026-09-29T20:00:00Z"), createdAt: at("2026-09-28T00:00:00Z") }),
    item("gone", { expiresAt: at("2026-09-30T00:00:00Z"), createdAt: at("2026-09-29T23:00:00Z") }),
    item("new-world", { createdAt: at("2026-09-29T13:46:00Z") }),
  ];
  it("pinned ones on top, newest first; a lapsed pin among the rest by date; hidden ones left out", () => {
    expect(arrangeNews(rows, now, 3).map((r) => r.id)).toEqual(["map-notice", "old-pinned", "new-world", "was-pinned"]);
  });
  it("after the pin date the notice is an ordinary item, by its date", () => {
    expect(arrangeNews(rows, at("2026-10-02T04:20:00Z"), 5).map((r) => [r.id, r.pinnedNow])).toEqual([["old-pinned", true], ["map-notice", false], ["new-world", false], ["was-pinned", false]]);
  });
  it("admins see the hidden ones too, marked", () => {
    const all = arrangeNews(rows, now, 10, true);
    expect(all.find((r) => r.id === "gone")?.expired).toBe(true);
    expect(all).toHaveLength(5);
  });
  it("a hidden pinned item is not on top", () => {
    const r = arrangeNews([item("p", { pinned: true, expiresAt: at("2026-09-30T00:00:00Z") }), item("n")], now, 5, true);
    expect(r.map((x) => [x.id, x.pinnedNow && !x.expired])).toEqual([["p", false], ["n", false]]);
  });
});

describe("the two boxes on Admin → Server (UK time)", () => {
  it("reads both, empty is none", () => {
    expect(parseNewsDates("", "", now)).toEqual({ ok: true, pinnedUntil: null, expiresAt: null });
    expect(parseNewsDates("2026-10-02T05:20", "", now)).toEqual({ ok: true, pinnedUntil: at("2026-10-02T04:20:00Z"), expiresAt: null }); // BST
    expect(parseNewsDates("", "2026-11-02T09:00", now)).toEqual({ ok: true, pinnedUntil: null, expiresAt: at("2026-11-02T09:00:00Z") }); // GMT
  });
  it("refuses a date in the past, junk, and a pin that outlasts the item", () => {
    expect(parseNewsDates("2026-09-29T10:00", "", now).ok).toBe(false);
    expect(parseNewsDates("soon", "", now).ok).toBe(false);
    expect(parseNewsDates("2026-10-05T10:00", "2026-10-04T10:00", now).ok).toBe(false);
  });
  it("shows a stored date back in the box as it was typed", () => {
    expect(dateToUkLocal(at("2026-10-02T04:20:00Z"))).toBe("2026-10-02T05:20");
    expect(dateToUkLocal(at("2026-12-01T00:30:00Z"))).toBe("2026-12-01T00:30");
    expect(dateToUkLocal(null)).toBe("");
  });
});

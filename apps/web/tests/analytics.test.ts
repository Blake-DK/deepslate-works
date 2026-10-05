import { describe, expect, it } from "vitest";
import { byCountry, byPlayer, change, flag, heatmap, hours, peakConcurrent, percent, rangeFor, series, slots, sortPlayers, together, totals, ukParts, type S } from "@/lib/analytics";

const NOW = new Date("2026-09-29T12:00:00Z"); // 13:00 in the UK (summer time), a Tuesday
const at = (iso: string) => new Date(iso);
const s = (mcUuid: string, join: string, left: string | null, country: string | null = "GB", mcName = mcUuid): S => ({ mcUuid, mcName, userId: null, joinedAt: at(join), leftAt: left ? at(left) : null, country });

const SESSIONS: S[] = [
  s("alex", "2026-09-29T09:00:00Z", "2026-09-29T10:30:00Z"), // 90 min
  s("owly", "2026-09-29T09:30:00Z", "2026-09-29T10:00:00Z", "DK"), // 30 min, inside alex's
  s("pab", "2026-09-29T09:45:00Z", "2026-09-29T09:46:00Z", "GB"), // 1 min: a bounce
  s("alex", "2026-09-29T11:30:00Z", null), // still on: 30 min so far
  s("owly", "2026-09-25T18:00:00Z", "2026-09-25T20:00:00Z", "DK"), // 2 h, four days ago
  s("old", "2026-08-20T18:00:00Z", "2026-08-20T19:00:00Z", null), // before the 30-day window
];
const FIRST = new Map([["alex", at("2026-09-29T09:00:00Z")], ["owly", at("2026-09-25T18:00:00Z")], ["pab", at("2026-09-29T09:45:00Z")], ["old", at("2026-08-20T18:00:00Z")]]);

describe("rangeFor", () => {
  it("defaults to 30 days and knows the window before", () => {
    const r = rangeFor(undefined, NOW, null);
    expect(r.key).toBe("30d");
    expect(r.from.toISOString()).toBe("2026-08-30T12:00:00.000Z");
    expect(r.prevFrom?.toISOString()).toBe("2026-07-31T12:00:00.000Z");
    expect(rangeFor("nonsense", NOW, null).key).toBe("30d");
  });
  it("uses hours for a day, days for a week, and the first session ever for all time", () => {
    expect(rangeFor("24h", NOW, null).bucket).toBe("hour");
    expect(rangeFor("7d", NOW, null).bucket).toBe("day");
    const all = rangeFor("all", NOW, at("2026-08-20T18:00:00Z"));
    expect(all.from.toISOString()).toBe("2026-08-20T18:00:00.000Z");
    expect(all.prevFrom).toBeNull();
    expect(all.bucket).toBe("day");
    expect(rangeFor("all", NOW, at("2025-01-01T00:00:00Z")).bucket).toBe("week");
  });
});

describe("totals", () => {
  it("counts the sessions that started in the range, at their full length", () => {
    const r = rangeFor("24h", NOW, null);
    const t = totals(SESSIONS, r.from, r.to, NOW, FIRST);
    expect(t.sessions).toBe(4);
    expect(t.players).toBe(3);
    expect(t.newPlayers).toBe(2); // alex and pab; owly first played four days ago
    expect(t.playMs).toBe((90 + 30 + 1 + 30) * 60_000);
    expect(t.bounceRate).toBe(0.25);
    expect(t.avgMs).toBe((151 / 4) * 60_000);
    expect(t.perPlayer).toBeCloseTo(4 / 3);
    expect(t.longestMs).toBe(90 * 60_000);
  });
  it("does not call a session that is still open a bounce", () => {
    const t = totals([s("x", "2026-09-29T11:59:30Z", null)], at("2026-09-29T00:00:00Z"), NOW, NOW, new Map());
    expect(t.bounceRate).toBe(0);
  });
  it("has no averages when nothing happened", () => {
    expect(totals([], at("2026-09-01T00:00:00Z"), NOW, NOW, new Map())).toEqual({ sessions: 0, players: 0, newPlayers: 0, playMs: 0, bounceRate: null, avgMs: null, perPlayer: null, longestMs: 0 });
  });
  it("compares with the window before", () => {
    expect(change(15, 10)).toBe(0.5);
    expect(change(5, 10)).toBe(-0.5);
    expect(change(5, 0)).toBeNull();
    expect(change(null, 3)).toBeNull();
  });
});

describe("peakConcurrent", () => {
  it("finds the most people on at once", () => {
    expect(peakConcurrent(SESSIONS, at("2026-09-29T00:00:00Z"), NOW, NOW)).toBe(3); // 09:45: alex, owly, pab
    expect(peakConcurrent(SESSIONS, at("2026-09-29T11:00:00Z"), NOW, NOW)).toBe(1);
    expect(peakConcurrent([], at("2026-09-29T00:00:00Z"), NOW, NOW)).toBe(0);
  });
  it("does not count someone who left at the moment another joined as overlap", () => {
    expect(peakConcurrent([s("a", "2026-09-29T09:00:00Z", "2026-09-29T10:00:00Z"), s("b", "2026-09-29T10:00:00Z", "2026-09-29T11:00:00Z")], at("2026-09-29T00:00:00Z"), NOW, NOW)).toBe(1);
  });
});

describe("UK time", () => {
  it("follows the clocks, summer and winter", () => {
    expect(ukParts(at("2026-09-29T12:00:00Z"))).toEqual({ day: "2026-09-29", hour: 13, weekday: 1 });
    expect(ukParts(at("2026-12-25T23:30:00Z"))).toEqual({ day: "2026-12-25", hour: 23, weekday: 4 });
    expect(ukParts(at("2026-06-30T23:30:00Z"))).toEqual({ day: "2026-07-01", hour: 0, weekday: 2 });
  });
});

describe("slots and series", () => {
  it("has 25 hour slots for the last 24 h (the hour it started in and the hour it ends in) and 8 days for a week", () => {
    expect(slots(rangeFor("24h", NOW, null))).toHaveLength(25);
    const week = slots(rangeFor("7d", NOW, null));
    expect(week.map((x) => x.label)).toEqual(["22/09", "23/09", "24/09", "25/09", "26/09", "27/09", "28/09", "29/09"]);
  });
  it("finds every day once across a clock change", () => {
    const r = rangeFor("7d", at("2026-10-28T12:00:00Z"), null); // clocks go back on 25 Oct 2026
    const labels = slots(r).map((x) => x.label);
    expect(labels).toEqual(["21/10", "22/10", "23/10", "24/10", "25/10", "26/10", "27/10", "28/10"]);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("cuts hours and days where the UK's clock does, each slot ending where the next starts (docs/35 R-26)", () => {
    const now = at("2026-09-29T12:37:00Z"); // not on the hour
    for (const key of ["24h", "7d", "30d"]) {
      const r = rangeFor(key, now, null);
      const all = slots(r);
      expect([key, all[0]!.start.toISOString()]).toEqual([key, r.from.toISOString()]);
      for (let i = 1; i < all.length; i++) expect([key, i, all[i]!.start.toISOString()]).toEqual([key, i, all[i - 1]!.end.toISOString()]);
    }
    const hoursOf = slots(rangeFor("24h", now, null));
    expect(hoursOf).toHaveLength(25);
    expect([hoursOf[0]!.label, hoursOf[0]!.end.toISOString()]).toEqual(["13:00", "2026-09-28T13:00:00.000Z"]); // 13:37 to 14:00 in the UK
    expect([hoursOf[1]!.start.toISOString(), hoursOf[1]!.end.toISOString()]).toEqual(["2026-09-28T13:00:00.000Z", "2026-09-28T14:00:00.000Z"]);
    expect([hoursOf.at(-1)!.start.toISOString(), hoursOf.at(-1)!.end.toISOString()]).toEqual(["2026-09-29T12:00:00.000Z", "2026-09-29T13:00:00.000Z"]);
    const days = slots(rangeFor("7d", now, null));
    expect([days[0]!.label, days[0]!.end.toISOString()]).toEqual(["22/09", "2026-09-22T23:00:00.000Z"]); // midnight in the UK, summer time
    expect([days.at(-1)!.label, days.at(-1)!.start.toISOString(), days.at(-1)!.end.toISOString()]).toEqual(["29/09", "2026-09-28T23:00:00.000Z", "2026-09-29T23:00:00.000Z"]);
  });
  it("gives the day the clocks go back its 25 hours", () => {
    const day = slots(rangeFor("7d", at("2026-10-28T12:37:00Z"), null)).find((x) => x.label === "25/10")!;
    expect([day.start.toISOString(), day.end.toISOString()]).toEqual(["2026-10-24T23:00:00.000Z", "2026-10-26T00:00:00.000Z"]);
  });
  it("puts each minute played in one day's bar only", () => {
    const now = at("2026-09-29T12:37:00Z");
    const played = [s("owly", "2026-09-25T18:00:00Z", "2026-09-25T20:00:00Z"), s("alex", "2026-09-26T22:30:00Z", "2026-09-26T23:30:00Z")]; // alex: 23:30 to 00:30 in the UK
    const minutes = series(played, rangeFor("7d", now, null), now).map((p) => [p.slot.label, Math.round(played.reduce((a, x) => a + Math.max(0, Math.min((x.leftAt ?? now).getTime(), p.slot.end.getTime()) - Math.max(x.joinedAt.getTime(), p.slot.start.getTime())), 0) / 60_000)] as const);
    expect(minutes.filter(([, m]) => m > 0)).toEqual([["25/09", 120], ["26/09", 30], ["27/09", 30]]);
  });
  it("counts sessions where they started and the peak wherever they reached", () => {
    const pts = series(SESSIONS, rangeFor("24h", NOW, null), NOW);
    const get = (label: string) => pts.find((p) => p.slot.label === label)!;
    expect(get("10:00")).toMatchObject({ sessions: 3, peak: 3 }); // 09:00Z to 10:00Z is 10:00 to 11:00 in the UK
    expect(get("11:00")).toMatchObject({ sessions: 0, peak: 1 }); // alex until 10:30Z
    expect(get("12:00")).toMatchObject({ sessions: 1, peak: 1 });
    expect(get("09:00")).toMatchObject({ sessions: 0, peak: 0 });
    expect(pts.reduce((n, p) => n + p.sessions, 0)).toBe(4);
  });
  it("adds up to the same number of sessions as the tiles, whatever the range", () => {
    for (const key of ["24h", "7d", "30d", "all"]) {
      const r = rangeFor(key, NOW, at("2026-08-20T18:00:00Z"));
      expect([key, series(SESSIONS, r, NOW).reduce((n, p) => n + p.sessions, 0)]).toEqual([key, totals(SESSIONS, r.from, r.to, NOW, FIRST).sessions]);
    }
  });
  it("uses weeks when all time is long", () => {
    const r = rangeFor("all", NOW, at("2026-01-01T00:00:00Z"));
    const pts = series(SESSIONS, r, NOW);
    expect(r.bucket).toBe("week");
    expect(pts.length).toBeGreaterThan(30);
    expect(pts.reduce((n, p) => n + p.sessions, 0)).toBe(6);
  });
});

describe("players", () => {
  it("adds up each player and their share", () => {
    const r = rangeFor("7d", NOW, null);
    const rows = byPlayer(SESSIONS, r.from, r.to, NOW);
    expect(rows.map((x) => [x.mcUuid, x.sessions, x.playMs / 60_000])).toEqual([["owly", 2, 150], ["alex", 2, 120], ["pab", 1, 1]]);
    expect(rows[0]!.share).toBeCloseTo(150 / 271);
    expect(rows.find((x) => x.mcUuid === "alex")!.lastSeen).toEqual(NOW); // still on
    expect(rows.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1);
  });
  it("shows the name they play under now", () => {
    const rows = byPlayer([s("u1", "2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z", "GB", "OldName"), s("u1", "2026-09-28T10:00:00Z", "2026-09-28T11:00:00Z", "GB", "NewName")], at("2026-09-01T00:00:00Z"), NOW, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mcName).toBe("NewName");
  });
  it("sorts by any column, either way", () => {
    const r = rangeFor("7d", NOW, null);
    const rows = byPlayer(SESSIONS, r.from, r.to, NOW);
    expect(sortPlayers(rows, "time", undefined).map((x) => x.mcUuid)).toEqual(["owly", "alex", "pab"]);
    expect(sortPlayers(rows, "time", "asc").map((x) => x.mcUuid)).toEqual(["pab", "alex", "owly"]);
    expect(sortPlayers(rows, "name", "asc").map((x) => x.mcUuid)).toEqual(["alex", "owly", "pab"]);
    expect(sortPlayers(rows, "seen", undefined)[0]!.mcUuid).toBe("alex");
    expect(sortPlayers(rows, "bogus", "bogus").map((x) => x.mcUuid)).toEqual(["owly", "alex", "pab"]);
  });
});

describe("countries", () => {
  it("groups by country and counts what has none", () => {
    const r = rangeFor("all", NOW, at("2026-08-20T18:00:00Z"));
    const c = byCountry(SESSIONS, r.from, r.to, NOW);
    expect(c.rows).toEqual([{ code: "DK", players: 1, sessions: 2, playMs: 150 * 60_000 }, { code: "GB", players: 2, sessions: 3, playMs: 121 * 60_000 }]);
    expect(c.unknown).toBe(1);
  });
  it("makes flags from codes", () => {
    expect(flag("GB")).toBe("🇬🇧");
    expect(flag("DK")).toBe("🇩🇰");
    expect(flag("??")).toBe("");
  });
});

describe("heatmap", () => {
  it("puts minutes in the hour of the week they were played, UK time", () => {
    const g = heatmap(SESSIONS, at("2026-09-29T00:00:00Z"), NOW, NOW);
    expect(g[1]![10]).toBe(60 + 30 + 1); // Tuesday 10:00 to 11:00: alex 60, owly 30, pab 1
    expect(g[1]![11]).toBe(30); // alex until 11:30
    expect(g[1]![12]).toBe(30); // alex again from 12:30
    expect(g.flat().reduce((a, b) => a + b, 0)).toBe(151);
  });
  it("is seven days of twenty-four hours", () => {
    const g = heatmap([], at("2026-09-01T00:00:00Z"), NOW, NOW);
    expect(g).toHaveLength(7);
    expect(g.every((row) => row.length === 24)).toBe(true);
  });
});

describe("together", () => {
  it("ranks pairs by the minutes they overlapped", () => {
    expect(together(SESSIONS, at("2026-09-29T00:00:00Z"), NOW, NOW)).toEqual([{ a: "alex", b: "owly", minutes: 30 }, { a: "alex", b: "pab", minutes: 1 }, { a: "owly", b: "pab", minutes: 1 }]);
  });
  it("never pairs someone with themselves", () => {
    expect(together([s("a", "2026-09-29T09:00:00Z", "2026-09-29T10:00:00Z"), s("a", "2026-09-29T09:30:00Z", "2026-09-29T10:30:00Z")], at("2026-09-29T00:00:00Z"), NOW, NOW)).toEqual([]);
  });
});

describe("words", () => {
  it("writes lengths of time", () => {
    expect(hours(0)).toBe("0 min");
    expect(hours(20_000)).toBe("under a minute");
    expect(hours(45 * 60_000)).toBe("45 min");
    expect(hours(90 * 60_000)).toBe("1 h 30 min");
    expect(hours(120 * 60_000)).toBe("2 h");
    expect(hours(250 * 3_600_000)).toBe("250 h");
  });
  it("writes percentages", () => {
    expect(percent(0.25)).toBe("25%");
    expect(percent(0.256, 1)).toBe("25.6%");
    expect(percent(null)).toBe("–");
  });
});

import { describe, expect, it } from "vitest";
import { csv, csvField, EVENT_GROUPS, eventWhere, everything, filterDay, filterToQuery, filterWords, groupLit, groupsFor, readFilter, toggleGroup, type EventGroup } from "@/lib/event-query";
import { Prisma } from "@prisma/client";
import { EVENT_KINDS, PLAYER_KINDS } from "@/shared/events";

describe("readFilter", () => {
  it("reads kinds from repeated and comma-separated values, dates as whole days, and trims the rest", () => {
    const f = readFilter({ kind: ["JOIN", "death,chat", "nonsense"], player: "  Bramble09 ", from: "2026-09-01", to: "2026-09-29", q: " creeper ", before: "120" }, true);
    expect(f.kinds).toEqual(["JOIN", "DEATH", "CHAT"]);
    expect(f.player).toBe("Bramble09");
    // days of the UK's calendar (docs/35 R-27): in September the UK is an hour ahead of UTC
    expect(f.from?.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-09-29T22:59:59.999Z");
    expect(f.text).toBe("creeper");
    expect(f.before).toBe(120n);
  });
  it("takes From and To as UK days, summer and winter, and the days the clocks change", () => {
    const f = (from: string, to: string) => readFilter({ from, to }, true);
    const winter = f("2026-12-01", "2026-12-01");
    expect(winter.from?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(winter.to?.toISOString()).toBe("2026-12-01T23:59:59.999Z");
    const back = f("2026-10-25", "2026-10-25"); // 25 hours long
    expect(back.from?.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(back.to?.toISOString()).toBe("2026-10-25T23:59:59.999Z");
    const forward = f("2026-03-29", "2026-03-29"); // 23 hours long
    expect(forward.from?.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(forward.to?.toISOString()).toBe("2026-03-29T22:59:59.999Z");
    // and the URL and the date fields give the same days back
    expect(filterToQuery(f("2026-07-01", "2026-07-31"))).toBe("?from=2026-07-01&to=2026-07-31");
    expect(filterDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(filterWords(f("2026-07-01", "2026-07-31"), true)).toBe("Showing everything · 1 Jul to 31 Jul");
  });
  it("ignores what it cannot read", () => {
    const f = readFilter({ from: "yesterday", to: "2026-13-45", before: "-1; drop table", kind: "" }, true);
    expect(f).toEqual({ kinds: [], player: null, from: null, to: null, text: null, before: null });
  });
  it("round-trips through the URL", () => {
    const f = readFilter({ kind: "JOIN,LEAVE", player: "m1_owl", from: "2026-09-01", q: "left after" }, true);
    expect(filterToQuery(f)).toBe("?kind=JOIN%2CLEAVE&player=m1_owl&from=2026-09-01&q=left+after");
    expect(filterToQuery(f, { before: "55" })).toContain("&before=55");
    expect(filterToQuery(readFilter({}, true))).toBe("");
  });
});

describe("what a player may see", () => {
  it("never includes chat, warnings, or anything admins did, whatever is asked for", () => {
    const asked = readFilter({ kind: "CHAT,ADMIN_ACTION,WARN,ERROR,CRASH,LINK,REVOKE,SYNC,BACKUP,PLAYER_ACTION,JOIN" }, false);
    expect(asked.kinds).toEqual(["JOIN"]);
    expect(eventWhere(asked, false, null).kind.in).toEqual(["JOIN"]);
    // a filter built for an admin and replayed as a player is cut down again
    const forged = readFilter({ kind: "CHAT,ADMIN_ACTION" }, true);
    expect(eventWhere(forged, false, null).kind.in).toEqual([...PLAYER_KINDS]);
    expect(eventWhere(readFilter({}, false), false, null).kind.in).toEqual(["JOIN", "LEAVE", "DEATH", "ADVANCEMENT", "SEASON", "SERVER_START", "SERVER_STOP"]);
  });
  it("admins get everything by default", () => {
    expect(eventWhere(readFilter({}, true), true, null).kind.in).toHaveLength(20);
    // superseded rows are kept, not shown, and rows without the mark (most of them: meta null or no key) are shown
    expect(eventWhere(readFilter({}, true), true, null)).not.toHaveProperty("NOT");
    expect(eventWhere(readFilter({}, true), true, null).OR).toEqual([{ meta: { equals: Prisma.AnyNull } }, { meta: { path: ["superseded"], equals: Prisma.AnyNull } }, { meta: { path: ["superseded"], equals: false } }]);
    expect(eventWhere(readFilter({}, false), false, null).kind.in).not.toContain("JOIN_BLOCKED");
    expect(eventWhere(readFilter({ kind: "INSTALL" }, false), false, null).kind.in).not.toContain("INSTALL");
  });
});

describe("eventWhere", () => {
  it("builds the rest of the query", () => {
    const w = eventWhere(readFilter({ player: "m1_owl", from: "2026-09-01", q: "lava", before: "90" }, true), true, ["uuid-1", "user-1"]);
    expect(w.actor).toEqual({ in: ["uuid-1", "user-1"] });
    expect(w.at).toEqual({ gte: new Date("2026-08-31T23:00:00.000Z") });
    expect(w.message).toEqual({ contains: "lava", mode: "insensitive" });
    expect(w.id).toEqual({ lt: 90n });
  });
  it("finds nothing for a player nobody knows, rather than everything", () => {
    expect(eventWhere(readFilter({ player: "ghost" }, true), true, []).actor).toEqual({ in: [] });
    expect(eventWhere(readFilter({ player: "ghost" }, true), true, null).actor).toEqual({ in: [] });
  });
});

describe("csv", () => {
  it("quotes what needs quoting", () => {
    expect(csvField('say "hi", all')).toBe('"say ""hi"", all"');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
    expect(csvField(12n)).toBe("12");
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvField(new Date("2026-09-29T10:00:00Z"))).toBe("2026-09-29T10:00:00.000Z");
  });
  it("defuses what a spreadsheet would run as a formula", () => {
    expect(csvField("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("-m1_owl left")).toBe("'-m1_owl left");
    expect(csvField("@everyone")).toBe("'@everyone");
  });
  it("writes a header and rows", () => {
    expect(csv(["a", "b"], [[1, "x,y"], [2, null]])).toBe('a,b\r\n1,"x,y"\r\n2,\r\n');
  });
});

// docs/29 §3 and §4: the chip row of the Activity page.
const group = (key: string) => EVENT_GROUPS.find((g) => g.key === key) as EventGroup;

describe("the chip groups", () => {
  it("hold every kind exactly once, and the players' five hold exactly PLAYER_KINDS", () => {
    const all = EVENT_GROUPS.flatMap((g) => g.kinds);
    expect([...all].sort()).toEqual([...EVENT_KINDS].sort()); // a new kind fails here until it joins a group
    expect(new Set(all).size).toBe(all.length);
    const players = groupsFor(false);
    expect(players.map((g) => g.label)).toEqual(["Joins and leaves", "Deaths", "Advancements", "Season", "Server"]);
    expect([...players.flatMap((g) => g.kinds)].sort()).toEqual([...PLAYER_KINDS].sort());
    expect(groupsFor(true)).toHaveLength(12); // and Everything makes thirteen
  });
});

describe("a click on a chip", () => {
  const start = readFilter({ player: "samoyedx", from: "2026-10-01", to: "2026-10-03", q: "lava", before: "500" }, true);
  it("from Everything gives only that group, a second adds, a lit one removes, the last one gives Everything", () => {
    expect(start.kinds).toEqual([]);
    const deaths = toggleGroup(start, group("deaths"));
    expect(deaths.kinds).toEqual(["DEATH"]);
    const both = toggleGroup(deaths, group("advancements"));
    expect(both.kinds).toEqual(["DEATH", "ADVANCEMENT"]);
    expect(toggleGroup(both, group("deaths")).kinds).toEqual(["ADVANCEMENT"]);
    expect(toggleGroup(toggleGroup(both, group("deaths")), group("advancements")).kinds).toEqual([]);
    expect(toggleGroup(start, group("problems")).kinds).toEqual(["CRASH", "WARN", "ERROR"]);
  });
  it("starts at the top again and keeps player, dates and words", () => {
    const f = toggleGroup(start, group("deaths"));
    expect(f.before).toBeNull();
    expect(f).toMatchObject({ player: "samoyedx", from: start.from, to: start.to, text: "lava" });
    expect(filterToQuery(f)).toBe("?kind=DEATH&player=samoyedx&from=2026-10-01&to=2026-10-03&q=lava");
    expect(everything(toggleGroup(start, group("deaths")))).toEqual({ ...start, kinds: [], before: null });
  });
  it("lights a group when one of its kinds is asked for, and a click takes it out", () => {
    const f = readFilter({ kind: "JOIN" }, true);
    expect(groupLit(f, group("joins"))).toBe(true);
    expect(groupLit(f, group("deaths"))).toBe(false);
    expect(toggleGroup(f, group("joins")).kinds).toEqual([]);
  });
  it("never gives a player an admin kind, whatever the query says", () => {
    const f = readFilter({ kind: "CHAT,DEATH,BACKUP" }, false);
    expect(f.kinds).toEqual(["DEATH"]);
    expect(groupsFor(false).some((g) => g.kinds.includes("CHAT"))).toBe(false);
    const forged = toggleGroup(f, group("chat")); // a chip the player is never shown, clicked anyway
    expect(eventWhere(forged, false, null).kind.in).toEqual(["DEATH"]);
  });
});

describe("the Showing line", () => {
  it("says what is narrowed, and is not there when nothing is", () => {
    expect(filterWords(readFilter({}, true), true)).toBeNull();
    expect(filterWords(readFilter({ before: "40" }, true), true)).toBeNull();
    expect(filterWords(readFilter({ kind: "DEATH,ADVANCEMENT", player: "samoyedx", from: "2026-10-01" }, true), true)).toBe("Showing deaths and advancements · samoyedx · from 1 Oct");
    expect(filterWords(readFilter({ kind: "JOIN" }, false), false)).toBe("Showing joins");
    expect(filterWords(readFilter({ player: "m1_owl", from: "2026-10-01", to: "2026-10-03", q: "creeper" }, false), false)).toBe("Showing everything · m1_owl · 1 Oct to 3 Oct · with “creeper”");
  });
});

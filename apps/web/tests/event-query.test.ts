import { describe, expect, it } from "vitest";
import { csv, csvField, eventWhere, filterToQuery, readFilter } from "@/lib/event-query";
import { PLAYER_KINDS } from "@/shared/events";

describe("readFilter", () => {
  it("reads kinds from repeated and comma-separated values, dates as whole days, and trims the rest", () => {
    const f = readFilter({ kind: ["JOIN", "death,chat", "nonsense"], player: "  Bramble09 ", from: "2026-09-01", to: "2026-09-29", q: " creeper ", before: "120" }, true);
    expect(f.kinds).toEqual(["JOIN", "DEATH", "CHAT"]);
    expect(f.player).toBe("Bramble09");
    expect(f.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-09-29T23:59:59.999Z");
    expect(f.text).toBe("creeper");
    expect(f.before).toBe(120n);
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
    expect(eventWhere(readFilter({}, false), false, null).kind.in).toEqual(["JOIN", "LEAVE", "DEATH", "ADVANCEMENT", "SERVER_START", "SERVER_STOP"]);
  });
  it("admins get everything by default", () => {
    expect(eventWhere(readFilter({}, true), true, null).kind.in).toHaveLength(16);
  });
});

describe("eventWhere", () => {
  it("builds the rest of the query", () => {
    const w = eventWhere(readFilter({ player: "m1_owl", from: "2026-09-01", q: "lava", before: "90" }, true), true, ["uuid-1", "user-1"]);
    expect(w.actor).toEqual({ in: ["uuid-1", "user-1"] });
    expect(w.at).toEqual({ gte: new Date("2026-09-01T00:00:00.000Z") });
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

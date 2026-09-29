import { describe, expect, it } from "vitest";
import { memberRows } from "@/lib/admin-lists";

const m = (displayName: string, mcUsername: string | null, earlyAccess = false) => ({ displayName, mcUsername, earlyAccess });
const all = [m("Bramble09", "bramble09"), m("Pabulum", null, true), m("Maximilian_Featherstonehaugh_032", "Maximilian_F_032", true), m("Bertie", null)];

describe("memberRows", () => {
  it("shows everyone, those with early access, or those without", () => {
    expect(memberRows(all, undefined, undefined).rows.length).toBe(4);
    expect(memberRows(all, "early", undefined).rows.map((r) => r.displayName)).toEqual(["Pabulum", "Maximilian_Featherstonehaugh_032"]);
    expect(memberRows(all, "rest", undefined).rows.map((r) => r.displayName)).toEqual(["Bramble09", "Bertie"]);
    expect(memberRows(all, "nonsense", undefined).only).toBe("all");
  });
  it("finds by part of either name, in any case", () => {
    expect(memberRows(all, undefined, "BLAKE").rows.map((r) => r.displayName)).toEqual(["Bramble09"]);
    expect(memberRows(all, undefined, "_f_0").rows.map((r) => r.displayName)).toEqual(["Maximilian_Featherstonehaugh_032"]);
    expect(memberRows(all, undefined, "  bert ").rows.map((r) => r.displayName)).toEqual(["Bertie"]);
    expect(memberRows(all, undefined, "nobody").rows).toEqual([]);
  });
  it("counts within what was found, so the numbers on the filters are those of the search", () => {
    expect(memberRows(all, undefined, undefined).count).toEqual({ all: 4, early: 2, rest: 2, outdated: 0 });
    expect(memberRows(all, "early", "max").count).toEqual({ all: 1, early: 1, rest: 0, outdated: 0 });
    expect(memberRows(all, "rest", "max").rows).toEqual([]);
  });
  it("shows those whose latest run came from an outdated installer, and nothing odd for a made-up filter", () => {
    const some = [{ ...m("Pabulum", null, true), installerOutdated: true }, m("Bertie", null), { ...m("Bramble09", "bramble09"), installerOutdated: false }];
    expect(memberRows(some, "outdated", undefined).rows.map((r) => r.displayName)).toEqual(["Pabulum"]);
    expect(memberRows(some, undefined, undefined).count.outdated).toBe(1);
    expect(memberRows(some, "outdated", "bert").rows).toEqual([]);
    expect(memberRows(some, "toString", undefined).only).toBe("all");
  });
  it("takes no more than forty characters of a search", () => {
    expect(memberRows(all, undefined, "x".repeat(200)).query.length).toBe(40);
  });
});

import { describe, expect, it } from "vitest";
import type { Mod } from "modpack";
import { decide, parseQuestions, tally, type BallotRow } from "@/server/vote/tally";

const mod = (slug: string, extra: Partial<Mod> = {}): Mod => ({
  slug, name: slug, category: "factories", side: "both", enabled: false, load: "M", recommended: false, hidden: false,
  exclusiveGroup: null, description: "x", wiki: "https://modrinth.com/mod/" + slug, videos: [], version: "latest", requires: [], ...extra,
});
const mods: Mod[] = [mod("create", { recommended: true }), mod("mekanism", { load: "H" }), mod("tacz", { exclusiveGroup: "guns" }), mod("pointblank", { exclusiveGroup: "guns" })];
const questions = [{ id: "pvp", text: "PvP", options: ["Off", "On"] }];
const ballots: BallotRow[] = [
  { modIds: ["create", "mekanism", "tacz"], answers: { pvp: "Off" }, pcTier: "HIGH" },
  { modIds: ["create", "tacz"], answers: { pvp: "Off" }, pcTier: "LOW" },
  { modIds: ["mekanism", "pointblank"], answers: { pvp: "On" }, pcTier: "LOW" },
  { modIds: ["create"], answers: {}, pcTier: null },
];

describe("tally", () => {
  const t = tally(mods, questions, ballots);
  it("counts yes votes and percentages", () => {
    const create = t.mods.find((m) => m.slug === "create")!;
    expect(create.yes).toBe(3);
    expect(create.pct).toBe(75);
    expect(t.ballots).toBe(4);
    expect(t.byTier).toEqual({ LOW: 2, MID: 0, HIGH: 1, UNKNOWN: 1 });
  });
  it("breaks down by tier and flags heavy mods without weak-PC majority", () => {
    const mek = t.mods.find((m) => m.slug === "mekanism")!;
    expect(mek.byTier.LOW).toEqual({ yes: 1, total: 2 });
    expect(mek.lowTierMajority).toBe(false);
    expect(t.mods.find((m) => m.slug === "create")!.lowTierMajority).toBeNull();
  });
  it("counts question answers and ignores junk", () => {
    expect(t.questions[0]!.options).toEqual([{ option: "Off", count: 2 }, { option: "On", count: 1 }]);
    expect(t.questions[0]!.answered).toBe(3);
  });
});

describe("decide", () => {
  const d = decide(mods, tally(mods, questions, ballots));
  const by = (s: string) => d.find((x) => x.slug === s)!;
  it("applies the threshold and picks one gun mod", () => {
    expect(by("create").to).toBe(true);
    expect(by("mekanism").to).toBe(true); // 50% meets the default threshold
    expect(by("mekanism").reason).toMatch(/WARNING/);
    expect(by("tacz").to).toBe(true);
    expect(by("pointblank").to).toBe(false);
  });
  it("enables nothing when nobody voted", () => {
    const none = decide(mods, tally(mods, questions, []));
    expect(none.every((x) => x.to === false)).toBe(true);
  });
});

describe("parseQuestions", () => {
  it("keeps well-formed questions only", () => {
    expect(parseQuestions([{ id: "a", text: "A?", options: ["x", "y"] }, { id: "BAD ID", text: "B", options: ["x", "y"] }, { id: "c", text: "C", options: ["only"] }])).toEqual([{ id: "a", text: "A?", options: ["x", "y"] }]);
    expect(parseQuestions("nope")).toEqual([]);
  });
});

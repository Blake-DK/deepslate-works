import { describe, expect, it } from "vitest";
import { driftHealth, driftLine } from "../src/lib/pack-drift";

describe("the server's pack against main's (2026-10-03: main fell behind the server)", () => {
  it("says nothing when the server runs main's pack and nothing is unpushed", () => {
    expect(driftLine({ server: "0.1.0+d7521da9", main: "0.1.0+d7521da9", unpushed: [] })).toBeNull();
    expect(driftHealth({ server: "0.1.0+d7521da9", main: "0.1.0+d7521da9", unpushed: [] })).toEqual({ server: "0.1.0+d7521da9", main: "0.1.0+d7521da9", same: true, unpushed: 0 });
  });
  it("names both packs when they differ", () => {
    expect(driftLine({ server: "0.1.0+d7521da9", main: "0.1.0+c99f2aae", unpushed: [] })).toBe("The server runs pack 0.1.0+d7521da9, but main has 0.1.0+c99f2aae.");
    expect(driftHealth({ server: "0.1.0+d7521da9", main: "0.1.0+c99f2aae", unpushed: [] }).same).toBe(false);
  });
  it("names the unpushed commits", () => {
    const line = driftLine({ server: "0.1.0+d7521da9", main: "0.1.0+c99f2aae", unpushed: ["2417f23 chore(modpack): lock d7521da9 (13 changes)", "4c18fa0 Revert …"] });
    expect(line).toContain("2 commits on the deploy checkout are not on main (2417f23, 4c18fa0)");
  });
  it("says nothing it cannot know", () => {
    expect(driftLine({ server: null, main: "0.1.0+c99f2aae", unpushed: [] })).toBeNull();
    expect(driftHealth({ server: null, main: null, unpushed: [] }).same).toBeNull();
  });
});

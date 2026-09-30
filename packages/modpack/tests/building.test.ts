import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintManifest } from "../src/lint";
import { distancesFor, type Manifest } from "../src/schema";

// Planner, 2026-09-30: "Building and decoration", and render distance by PC tier.
const load = async (): Promise<Manifest> => {
  const { manifest, issues } = lintManifest(JSON.parse(await readFile(path.join(__dirname, "../../../modpack/mods.json"), "utf8")));
  expect(issues.filter((i) => i.level === "error")).toEqual([]);
  return manifest!;
};

describe("Building and decoration", () => {
  it("comes right after world, and is voted on", async () => {
    const m = await load();
    const ids = m.categories.map((c) => c.id);
    expect(ids.indexOf("building")).toBe(ids.indexOf("world") + 1);
    const c = m.categories.find((x) => x.id === "building")!;
    expect(c.title).toBe("Building and decoration");
    expect(c.votable).toBe(true);
  });
  it("suggests six light mods; the rest are votable", async () => {
    const m = await load();
    const b = m.mods.filter((x) => x.category === "building");
    const suggested = ["create-deco", "copycats", "macaws-roofs", "macaws-windows", "macaws-doors", "handcrafted"];
    expect(b.filter((x) => x.recommended).map((x) => x.slug)).toEqual(suggested);
    for (const x of b) {
      expect([x.slug, x.side]).toEqual([x.slug, "both"]);
      expect([x.slug, x.videos.length > 0]).toEqual([x.slug, true]);
      expect([x.slug, x.hidden]).toEqual([x.slug, false]);
    }
    expect(b.filter((x) => x.load !== "L").map((x) => x.slug).sort()).toEqual(["rechiseled", "supplementaries"]);
    expect(b.some((x) => x.slug === "chipped")).toBe(false);
  });
  it("has each library a building mod needs, as a hidden base entry", async () => {
    const m = await load();
    const by = new Map(m.mods.map((x) => [x.slug, x]));
    for (const x of m.mods.filter((y) => y.category === "building")) {
      for (const dep of x.requires) expect([x.slug, dep, Boolean(by.get(dep))]).toEqual([x.slug, dep, true]);
    }
    for (const lib of ["resourceful-lib", "moonlight", "supermartijn642s-core-lib", "supermartijn642s-config-lib", "fusion-connected-textures"]) {
      expect([lib, by.get(lib)?.hidden, by.get(lib)?.category]).toEqual([lib, true, "base"]);
    }
    expect(by.get("fusion-connected-textures")?.side).toBe("client"); // Modrinth: not on servers
  });
});

describe("render distance by PC tier", () => {
  it("is 12 / 10 / 8 to see and 8 / 8 / 6 to simulate, and the server sees 12", async () => {
    const m = await load();
    expect(distancesFor(m, "HIGH")).toEqual({ render: 12, simulation: 8 });
    expect(distancesFor(m, "MID")).toEqual({ render: 10, simulation: 8 });
    expect(distancesFor(m, "LOW")).toEqual({ render: 8, simulation: 6 });
    expect(m.server_properties["view-distance"]).toBe("12");
    expect(m.server_properties["simulation-distance"]).toBe("8");
  });
  it("gives a member with no tier (or nonsense) the weak PC's values", async () => {
    const m = await load();
    expect(distancesFor(m, null)).toEqual({ render: 8, simulation: 6 });
    expect(distancesFor(m, "ULTRA")).toEqual({ render: 8, simulation: 6 });
  });
});

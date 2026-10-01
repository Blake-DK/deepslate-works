import { describe, expect, it } from "vitest";
import { lintManifest } from "../src/lint";
import { estimateLoad } from "../src/load";

const base: Record<string, unknown> & { mods: Array<Record<string, unknown>> } = {
  name: "T", version: "0.1.0", minecraft: "1.21.1", loader: "neoforge", server_address: "mc.example",
  profile: { id: "t", dir: ".t", icon: "Furnace" }, ram: { min_gb: 3, max_gb: 6 },
  categories: [{ id: "base", title: "Base", votable: false }, { id: "guns", title: "Guns" }],
  mods: [
    { slug: "sodium", name: "Sodium", category: "base", side: "client", enabled: true, load: "L", guide: "behind", description: "x", wiki: "https://modrinth.com/mod/sodium", videos: [{ title: "v", url: "https://www.youtube.com/watch?v=abcdefghijk" }] },
    { slug: "gun-a", name: "A", category: "guns", side: "both", enabled: true, load: "M", exclusiveGroup: "guns", guide: "game", howTo: "Press **R** to reload.", description: "x", wiki: "https://modrinth.com/mod/gun-a", videos: [{ title: "v", url: "https://www.youtube.com/watch?v=abcdefghijk" }] },
    { slug: "gun-b", name: "B", category: "guns", side: "both", enabled: false, load: "M", exclusiveGroup: "guns", guide: "game", description: "x", wiki: "https://modrinth.com/mod/gun-b", videos: [{ title: "v", url: "https://www.youtube.com/watch?v=abcdefghijk" }] },
  ],
};

describe("lintManifest", () => {
  it("accepts a valid manifest", () => {
    const { manifest, issues } = lintManifest(base);
    expect(manifest).not.toBeNull();
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
  it("catches duplicates, unknown categories, missing requires and exclusive-group clashes", () => {
    const bad = structuredClone(base);
    bad.mods[2]!.enabled = true;
    bad.mods.push({ ...bad.mods[0]!, slug: "sodium" });
    bad.mods.push({ ...bad.mods[0]!, slug: "odd", category: "nope", requires: ["ghost"] });
    const { issues } = lintManifest(bad);
    const msgs = issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/duplicate slug sodium/);
    expect(msgs).toMatch(/unknown category nope/);
    expect(msgs).toMatch(/requires ghost/);
    expect(msgs).toMatch(/exclusive group guns has more than one/);
  });
  it("warns on missing videos", () => {
    const m = structuredClone(base);
    m.mods[0]!.videos = [];
    expect(lintManifest(m).issues.some((i) => i.level === "warn" && /no videos/.test(i.message))).toBe(true);
  });
});

describe("estimateLoad", () => {
  it("bands by points", () => {
    expect(estimateLoad([{ load: "L" }, { load: "L" }]).label).toBe("Light");
    expect(estimateLoad([{ load: "M" }, { load: "M" }, { load: "L" }]).label).toBe("Medium");
    expect(estimateLoad([{ load: "H" }, { load: "H" }, { load: "M" }]).label).toBe("Heavy");
    expect(estimateLoad([]).points).toBe(0);
  });
  it("the Mods guide: every listed mod says where it goes, every player-facing one says how to use it", () => {
    const m = structuredClone(base);
    delete m.mods[0]!.guide;
    delete m.mods[1]!.howTo;
    const msgs = lintManifest(m).issues.filter((i) => i.level === "error").map((i) => i.message).join("\n");
    expect(msgs).toMatch(/sodium: no "guide"/);
    expect(msgs).toMatch(/gun-a: switched on and player-facing, but has no "howTo"/);
    expect(msgs).not.toMatch(/gun-b/); // switched off: not on the page yet
  });
  it("keys are a short list of key + what it does", () => {
    const m = structuredClone(base);
    m.mods[1]!.keys = [{ key: "R", does: "Reload" }];
    expect(lintManifest(m).manifest?.mods[1]!.keys).toEqual([{ key: "R", does: "Reload" }]);
    m.mods[1]!.keys = [{ key: "R" }];
    expect(lintManifest(m).manifest).toBeNull();
  });
});

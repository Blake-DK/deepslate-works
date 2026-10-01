import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extrasForApp, lintExtras, type ExtrasLock } from "../src/extras";
import { lintManifest } from "../src/lint";

// The app's Extras tab (planner, 2026-10-01): personal extras, apart from the pack and the vote.

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../../modpack/${f}`, import.meta.url), "utf8")) as unknown;

describe("modpack/extras.json", () => {
  const { extras, errors } = lintExtras(read("extras.json"));
  it("lints clean", () => expect(errors).toEqual([]));
  it("has the planner's extras, the two shader packs under Iris, Fresh Animations with EMF and ETF behind one switch", () => {
    const ids = extras!.extras.map((x) => x.id);
    expect(ids).toEqual(["iris", "shader-light", "shader-full", "not-enough-animations", "skin-layers", "falling-leaves", "particle-rain", "sound-physics", "fresh-animations"]);
    expect(extras!.extras.filter((x) => x.shader).map((x) => [x.shader, x.requires])).toEqual([["light", ["iris"]], ["full", ["iris"]]]);
    expect(extras!.extras.find((x) => x.id === "fresh-animations")!.projects.map((p) => p.slug)).toEqual(["fresh-animations", "entity-model-features", "entitytexturefeatures"]);
  });
  it("catches a duplicate, an unknown requirement and two shaders for one choice", () => {
    const x = { id: "aa", name: "A", description: "a", fps: "Low", projects: [{ slug: "aa" }] };
    expect(lintExtras({ extras: [x, x] }).errors.join()).toMatch(/duplicate/);
    expect(lintExtras({ extras: [{ ...x, requires: ["ghost"] }] }).errors.join()).toMatch(/ghost/);
    expect(lintExtras({ extras: [{ ...x, shader: "full" }, { ...x, id: "bb", shader: "full" }] }).errors.join()).toMatch(/more than one shader/);
  });
});

describe("extras are not part of the pack", () => {
  it("mods.json has no visuals category and none of the extras' mods (the vote never sees them)", () => {
    const { manifest } = lintManifest(read("mods.json"));
    expect(manifest!.categories.map((c) => c.id)).not.toContain("visuals");
    for (const slug of ["iris", "not-enough-animations", "3dskinlayers", "fresh-animations", "complementary-reimagined"]) expect(manifest!.mods.find((m) => m.slug === slug)).toBeUndefined();
  });
  it("the pack's lock holds none of the extras' files", () => {
    const pack = read("mods.lock.json") as { files: Array<{ slug: string }> };
    const extras = read("extras.lock.json") as ExtrasLock;
    const inPack = new Set(pack.files.map((f) => f.slug));
    for (const x of extras.extras) for (const f of x.files) expect([x.id, f.slug, inPack.has(f.slug)]).toEqual([x.id, f.slug, false]);
  });
});

describe("extrasForApp", () => {
  it("gives the app ids, words, FPS cost, sizes, pictures and files with checksums", () => {
    const body = extrasForApp(read("extras.lock.json") as ExtrasLock);
    expect(body.extras).toHaveLength(9);
    expect(body.size).toBe(body.extras.reduce((n, x) => n + x.size, 0));
    for (const x of body.extras) {
      expect(["Low", "Medium", "High"]).toContain(x.fps);
      expect(x.files.length).toBeGreaterThan(0);
      for (const f of x.files) expect(f.sha512).toMatch(/^[0-9a-f]{128}$/);
      expect(x.picture === null || /^[A-Za-z0-9+/=]+$/.test(x.picture)).toBe(true);
    }
    expect(body.extras.find((x) => x.id === "fresh-animations")!.files.map((f) => f.kind).sort()).toEqual(["mod", "mod", "resourcepack"]);
    expect(body.extras.find((x) => x.id === "shader-full")!.files[0]!.kind).toBe("shader");
  });
});

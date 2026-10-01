import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintManifest } from "../src/lint";
import { loaderFor, settleOptional, type LockEntry } from "../src/lock";
import { NO_EXTRAS, packFor, visualChoice } from "../src/visuals";

// Visual extras (planner, 2026-10-01): optional, client-only, chosen per member on the Me page.

const e = (slug: string, more: Partial<LockEntry> = {}): LockEntry => ({
  slug, name: slug, projectId: "p-" + slug, versionId: "v", versionNumber: "1", versionType: "release", filename: `${slug}.jar`, url: "https://cdn/x",
  sha512: "0", sha1: "0", size: 1, side: "both", requiredBy: [], ...more,
});

describe("settleOptional", () => {
  it("a dependency only an optional mod needs is optional and client-only; one everyone's mods need is everyone's", () => {
    const sodium = e("sodium", { side: "client" });
    const iris = e("iris", { optional: "visuals" });
    const lib = e("glsl-lib", { requiredBy: ["iris"] });
    const shared = e("shared-lib", { requiredBy: ["iris", "create"] });
    const create = e("create");
    const files = [sodium, iris, lib, shared, create];
    settleOptional(files, new Set(["sodium", "iris", "create"]));
    expect(lib.optional).toBe("visuals");
    expect(lib.side).toBe("client");
    expect(iris.side).toBe("client");
    expect(shared.optional).toBeUndefined();
    expect(shared.side).toBe("both");
    expect(create.optional).toBeUndefined();
  });
  it("follows a chain of dependencies", () => {
    const a = e("emf", { optional: "visuals" });
    const b = e("b", { requiredBy: ["emf"] });
    const c = e("c", { requiredBy: ["b"] });
    settleOptional([c, b, a], new Set(["emf"]));
    expect(c.optional).toBe("visuals");
  });
});

describe("packFor", () => {
  const lock = {
    files: [
      e("sodium", { side: "client" }), e("create"), e("chunky", { side: "server" }),
      e("iris", { optional: "visuals", side: "client" }),
      e("fresh-animations", { optional: "visuals", side: "client", kind: "resourcepack", filename: "FA.zip" }),
      e("makeup", { optional: "visuals", side: "client", kind: "shader", shader: "light", filename: "MakeUp.zip" }),
      e("complementary", { optional: "visuals", side: "client", kind: "shader", shader: "full", filename: "Comp.zip" }),
    ],
  };
  it("extras off: everyone's mods only, nothing to switch on, but the pack's own files are named for taking out", () => {
    const p = packFor(lock, NO_EXTRAS);
    expect(p.mods.map((f) => f.slug)).toEqual(["sodium", "create", "chunky"]);
    expect(p.resourcepacks).toEqual([]);
    expect(p.shaderpack).toBeNull();
    expect(p.known).toEqual({ resourcepacks: ["FA.zip"], shaderpacks: ["MakeUp.zip", "Comp.zip"] });
  });
  it("extras on: the optional mods, the resource pack, and only the chosen shader pack; never a .zip among the mods", () => {
    expect(packFor(lock, { extras: true, shader: "none" }).shaderpack).toBeNull();
    const p = packFor(lock, { extras: true, shader: "full" });
    expect(p.mods.map((f) => f.slug)).toEqual(["sodium", "create", "chunky", "iris"]);
    expect(p.resourcepacks.map((f) => f.filename)).toEqual(["FA.zip"]);
    expect(p.shaderpack?.filename).toBe("Comp.zip");
    expect(packFor(lock, { extras: true, shader: "light" }).shaderpack?.filename).toBe("MakeUp.zip");
  });
  it("a lock from before 1.6.0 (no kind, no optional) is everyone's mods, as it always was", () => {
    const old = { files: [e("a"), e("b")] };
    expect(packFor(old, { extras: true, shader: "full" }).mods).toHaveLength(2);
  });
});

describe("visualChoice", () => {
  it("off unless switched on; a shader only with extras on; anything odd is none", () => {
    expect(visualChoice(null)).toEqual(NO_EXTRAS);
    expect(visualChoice({ visualExtras: false, shaders: "full" })).toEqual(NO_EXTRAS);
    expect(visualChoice({ visualExtras: true, shaders: "full" })).toEqual({ extras: true, shader: "full" });
    expect(visualChoice({ visualExtras: true, shaders: "ultra" })).toEqual({ extras: true, shader: "none" });
  });
});

describe("where Modrinth files each kind", () => {
  it("mods under the loader, resource packs under minecraft, shaders under iris", () => {
    expect(loaderFor(undefined, "neoforge")).toBe("neoforge");
    expect(loaderFor("resourcepack", "neoforge")).toBe("minecraft");
    expect(loaderFor("shader", "neoforge")).toBe("iris");
  });
});

describe("mods.json's visual extras", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../modpack/mods.json", import.meta.url), "utf8")) as unknown;
  const { manifest, issues } = lintManifest(raw);
  it("lints clean", () => expect(issues.filter((i) => i.level === "error")).toEqual([]));
  it("is optional, not votable, client-only, with one shader pack per choice", () => {
    const cat = manifest!.categories.find((c) => c.id === "visuals")!;
    expect(cat).toMatchObject({ optional: true, votable: false });
    const mods = manifest!.mods.filter((m) => m.category === "visuals");
    expect(mods.every((m) => m.side === "client")).toBe(true);
    expect(mods.filter((m) => m.kind === "shader").map((m) => m.shader).sort()).toEqual(["full", "light"]);
    expect(mods.filter((m) => m.kind === "resourcepack").map((m) => m.slug)).toEqual(["fresh-animations"]);
  });
  it("never has Embeddium, Radium or C2ME (planner: conflicts, duplicates, alpha)", () => {
    for (const slug of ["embeddium", "radium", "c2me", "c2me-neoforge"]) expect(manifest!.mods.find((m) => m.slug === slug)).toBeUndefined();
  });
});

describe("lint rules for optional categories", () => {
  const base = {
    name: "T", version: "0.1.0", minecraft: "1.21.1", loader: "neoforge", server_address: "mc", profile: { id: "t", dir: ".t", icon: "F" }, ram: { min_gb: 3, max_gb: 6 },
    categories: [{ id: "base", title: "B", votable: false }, { id: "visuals", title: "V", votable: false, optional: true }],
    mods: [{ slug: "x", name: "X", category: "base", side: "both", enabled: true, load: "L", description: "x", wiki: "https://modrinth.com/mod/x" }],
  };
  const msgs = (mods: unknown[]) => lintManifest({ ...base, mods: [...base.mods, ...mods] }).issues.filter((i) => i.level === "error").map((i) => i.message).join("\n");
  it("an optional mod must be client-only; packs only in optional categories; a shader needs its choice", () => {
    expect(msgs([{ slug: "v", name: "V", category: "visuals", side: "both", enabled: true, load: "L", description: "x", wiki: "https://modrinth.com/mod/v" }])).toMatch(/must be side "client"/);
    expect(msgs([{ slug: "r", name: "R", category: "base", side: "client", enabled: true, load: "L", description: "x", wiki: "https://modrinth.com/mod/r", kind: "resourcepack" }])).toMatch(/only be in an optional category/);
    expect(msgs([{ slug: "s", name: "S", category: "visuals", side: "client", enabled: true, load: "L", description: "x", wiki: "https://modrinth.com/mod/s", kind: "shader" }])).toMatch(/goes with kind "shader"/);
  });
});

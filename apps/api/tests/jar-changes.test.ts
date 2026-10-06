import { describe, expect, it } from "vitest";
import { jarChangeLines, jarChanges, jarStem } from "../src/modpack/jar-changes.js";

// Alex, 2026-10-06: a mod that was updated says "updated", not removed and added. The lines are rsync's own
// (--itemize-changes) as Sync gets them; the jar names are the lock's.

describe("Sync's words for the mods folder", () => {
  it("a jar's name without its versions", () => {
    expect(["Placebo-1.21.1-9.9.2.jar", "Placebo-1.21.1-9.9.3.jar"].map(jarStem)).toEqual(["placebo", "placebo"]);
    expect(jarStem("appleskin-neoforge-mc1.21-3.0.6.jar")).toBe("appleskin-neoforge");
    expect(jarStem("CustomWindowTitle-1.21.4+v1.4.1.jar")).toBe("customwindowtitle");
    expect(jarStem("worldedit-mod-7.3.8.jar")).toBe("worldedit-mod");
    expect(jarStem("Jade-1.21.1-NeoForge-15.10.6.jar")).toBe("jade");
  });

  it("an old jar and a new one of the same mod: updated; a new mod: added; one gone: removed", () => {
    const c = jarChanges(["*deleting   Placebo-1.21.1-9.9.2.jar", ">f+++++++++ Placebo-1.21.1-9.9.3.jar", ">f+++++++++ worldedit-mod-7.3.8.jar", "*deleting   OldMod-1.0.jar"]);
    expect(c).toEqual({ updated: [{ from: "Placebo-1.21.1-9.9.2.jar", to: "Placebo-1.21.1-9.9.3.jar" }], added: ["worldedit-mod-7.3.8.jar"], removed: ["OldMod-1.0.jar"], replaced: [], dated: [] });
    expect(jarChangeLines(c)).toEqual(["mods: 1 updated, 1 added, 1 removed", "  updated Placebo-1.21.1-9.9.2.jar → Placebo-1.21.1-9.9.3.jar", "  added worldedit-mod-7.3.8.jar", "  removed OldMod-1.0.jar"]);
  });

  it("two old jars of one mod and one new: not guessed, each said as it is", () => {
    const c = jarChanges(["*deleting   Mod-1.0.jar", "*deleting   Mod-1.1.jar", ">f+++++++++ Mod-1.2.jar"]);
    expect([c.updated, c.added, c.removed]).toEqual([[], ["Mod-1.2.jar"], ["Mod-1.0.jar", "Mod-1.1.jar"]]);
  });

  it("a jar sent again under its name, one with a new date only, and nothing at all", () => {
    expect(jarChangeLines(jarChanges([">f.st...... Jade-1.21.1-NeoForge-15.10.6.jar", ".f..t...... FastFurnace-1.21.1-9.0.1.jar"]))).toEqual([
      "mods: 1 sent again, 1 with a new date only", "  sent again Jade-1.21.1-NeoForge-15.10.6.jar (same name, the file differed)", "  new date only FastFurnace-1.21.1-9.0.1.jar",
    ]);
    expect(jarChangeLines(jarChanges([]))).toEqual(["mods: up to date"]);
  });
});

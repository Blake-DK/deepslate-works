import { describe, expect, it } from "vitest";
import { aboutModsNoLongerLoaded, leftoverNamespaces } from "../src/events/parse.js";
import { parseModIds } from "../src/modpack/server-mods.js";

// The shapes are the lines the live server printed from 2026-10-10 07:53 UTC, after six mods came off; the namespaces
// here are made up ("oldmod", "goneworld" are gone, "keptmod" is still loaded).
const LOADED = new Set(["minecraft", "neoforge", "keptmod", "create"]);
const BLOCK = (id: string) => `(Unknown registry key in ResourceKey[minecraft:root / minecraft:block]: ${id} -> using default)`;
const SECTION = (...ids: string[]) => `Recoverable errors when loading section [420, 6, 180]: ${ids.map(BLOCK).join("; ")}`;
const ITEM = (id: string) => `Tried to load invalid item: 'Unknown registry key in ResourceKey[minecraft:root / minecraft:item]: ${id}'`;
const ATTACHMENT = (id: string) => `Encountered unknown or non-serializable data attachment ${id}. Skipping.`;
/** parse.ts keeps the first 500 characters of a problem line. */
const cut = (s: string) => s.slice(0, 500);

describe("problem lines about mods that are no longer in the pack (events/parse.ts)", () => {
  it("reads the namespaces of the three kinds, and of nothing else", () => {
    expect(leftoverNamespaces(ATTACHMENT("oldmod:frozen_data"))).toEqual(["oldmod"]);
    expect(leftoverNamespaces(ITEM("oldmod:ember_seed"))).toEqual(["oldmod"]);
    expect(leftoverNamespaces(SECTION("goneworld:clawed_log"))).toEqual(["goneworld"]);
    expect(leftoverNamespaces(SECTION("goneworld:stone_bricks", "goneworld:stone_brick_wall"))).toEqual(["goneworld", "goneworld"]);
    expect(leftoverNamespaces("Couldn't load chunk [12, 35]")).toBeNull();
    expect(leftoverNamespaces("Recoverable errors when loading section [1, 2, 3]: (Invalid length given for storage, got: 222 but expected: 256)")).toBeNull();
  });

  it("leaves out a line whose every id is from a namespace no loaded mod has", () => {
    for (const line of [ATTACHMENT("oldmod:living_data"), ITEM("oldmod:mask_of_rage"), SECTION("goneworld:clawed_log"), SECTION("goneworld:a", "oldmod:b")]) {
      expect(aboutModsNoLongerLoaded(line, LOADED), line).toBe(true);
    }
  });

  it("a section line cut at 500 characters is still read, as far as it goes", () => {
    const long = cut(SECTION(...Array.from({ length: 8 }, (_, i) => `goneworld:frosted_stone_brick_${i}`)));
    expect(long).toHaveLength(500);
    expect(aboutModsNoLongerLoaded(long, LOADED)).toBe(true);
    // a loaded mod among the entries that were kept: posted
    const mixed = cut(SECTION("keptmod:casing", ...Array.from({ length: 7 }, (_, i) => `goneworld:frosted_stone_brick_${i}`)));
    expect(mixed).toHaveLength(500);
    expect(aboutModsNoLongerLoaded(mixed, LOADED)).toBe(false);
  });

  it("still posts a line about a mod that IS in the pack, or a mix of both", () => {
    expect(aboutModsNoLongerLoaded(ITEM("keptmod:no_such_item"), LOADED)).toBe(false);
    expect(aboutModsNoLongerLoaded(ATTACHMENT("keptmod:inventory"), LOADED)).toBe(false);
    expect(aboutModsNoLongerLoaded(SECTION("goneworld:clawed_log", "keptmod:casing"), LOADED)).toBe(false);
    expect(aboutModsNoLongerLoaded(ITEM("minecraft:no_such_item"), LOADED)).toBe(false);
  });

  it("still posts every other kind of line: a chunk that cannot be read, a crash, an unknown error", () => {
    for (const line of [
      "Couldn't load chunk [12, 35]",
      "Chunk file at [12, 35] is in the wrong location; relocating. (Expected [12, 35], got [0, 0])",
      "Failed to read chunk [12, 35]",
      "Recoverable errors when loading section [1, 2, 3]: (Invalid length given for storage, got: 222 but expected: 256)",
      `${SECTION("goneworld:clawed_log")} and then something else`,
      "This crash report has been saved to: /AMP/Minecraft/crash-reports/crash-2026-10-10_08.00.00-server.txt",
      "Something broke",
    ]) {
      expect(aboutModsNoLongerLoaded(line, LOADED), line).toBe(false);
    }
  });

  it("without a list of loaded mods (no capture yet) nothing is left out", () => {
    expect(aboutModsNoLongerLoaded(ITEM("oldmod:ember_seed"), null)).toBe(false);
    expect(aboutModsNoLongerLoaded(ITEM("oldmod:ember_seed"), new Set())).toBe(false);
  });
});

describe("the mod ids of a start (modpack/server-mods.ts, parseModIds)", () => {
  it("reads NeoForge's Mod List, minecraft and neoforge included, and stops at the next log line", () => {
    const log = [
      "[10Oct2026 07:01:03.684] [main/INFO] [net.neoforged.fml.loading.moddiscovery.ModDiscoverer/]: ",
      "     Mod List:",
      "\t\tName Version (Mod Id)",
      "",
      "\t\tAlternate Current 1.9.0 (alternate_current)",
      "\t\tKept Mod 2.0.1+mc1.21 (keptmod)",
      "\t\tMinecraft 1.21.1 (minecraft)",
      "\t\tNeoForge 21.1.252 (neoforge)",
      "[10Oct2026 07:01:04.449] [main/INFO] [net.neoforged.fml.loading.FMLServiceProvider/CORE]: Loading coremod script-engine",
    ].join("\n");
    expect(parseModIds(log)).toEqual(["alternate_current", "keptmod", "minecraft", "neoforge"]);
    expect(parseModIds("no list here")).toEqual([]);
  });
});

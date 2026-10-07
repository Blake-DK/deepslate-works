import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBuild, structureInfo } from "../src/builds";
import { blockCounts, blockListText, compileGrid, DESIGN_LIMITS, DesignError, parseRecipe, picture, render, renderTurns, type BlockList, type DesignGrid } from "../src/design";
import { compile, gridToStructure } from "../src/design-nbt";
import { designPrompt, recipeFrom } from "../src/design-cli";
import { child, numberOf, readNbt, writeNbt } from "../src/nbt";

// docs/39 Step 0: the recipe compiler. The recipes here are written by hand. modpack/designer/examples/ has two
// written by hand (boss_hall, gate), three the designer wrote in Step 0.4 (temple, boss_arena, watchtower) and the
// planner's temple in the recipe language as it is (temple_b, docs/40): all of them must always compile.

const ROOT = path.join(__dirname, "..", "..", "..", "modpack");
const BLOCKS = JSON.parse(readFileSync(path.join(ROOT, "designer", "blocks.json"), "utf8")) as BlockList;
const VANILLA = new Set(Object.keys((JSON.parse(readFileSync(path.join(ROOT, "items", "vanilla-1.21.1.json"), "utf8")) as { items: Record<string, number> }).items));

type Json = Record<string, unknown>;
const recipe = (steps: unknown[], more: Json = {}): Json => ({ name: "test", size: { x: 8, y: 8, z: 8 }, ground: 0, seed: 1, steps, ...more });
const grid = (steps: unknown[], more: Json = {}) => compileGrid(parseRecipe(recipe(steps, more), BLOCKS), BLOCKS);
const at = (g: DesignGrid, x: number, y: number, z: number) => {
  const c = g.cells[x + g.size.x * (z + g.size.z * y)]!;
  return c < 0 ? null : g.palette[c]!;
};
const placed = (g: DesignGrid) => g.cells.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0);
const refused = (steps: unknown[], more: Json = {}) => {
  try {
    compileGrid(parseRecipe(recipe(steps, more), BLOCKS), BLOCKS);
  } catch (e) {
    if (e instanceof DesignError) return e.message;
    throw e;
  }
  throw new Error("not refused");
};
const STONE = "minecraft:stone";
const EXAMPLES = readdirSync(path.join(ROOT, "designer", "examples")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();

describe("the block list", () => {
  it("names each block once, with a colour and a kind it defines", () => {
    const ids = BLOCKS.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(150);
    for (const b of BLOCKS.blocks) {
      expect(b.colour, b.id).toMatch(/^#[0-9a-f]{6}$/);
      if (b.kind) expect(BLOCKS.kinds[b.kind], b.id).toBeDefined();
    }
  });
  it("has only blocks the game knows (the vanilla ones are its items, wall torches aside) and none of the refused kinds", () => {
    for (const b of BLOCKS.blocks.filter((x) => x.id.startsWith("minecraft:"))) {
      const name = b.id.slice("minecraft:".length);
      if (b.kind !== "wall_torch" && !name.startsWith("potted_")) expect(VANILLA.has(name), b.id).toBe(true);
    }
    const refusedKinds = /(^|_)(lava|water|tnt|command_block|structure_block|structure_void|jigsaw|spawner|chest|barrel|shulker_box|hopper|dispenser|dropper|piston|observer|lever|button|pressure_plate|repeater|comparator|redstone|portal|bedrock|obsidian|sand|red_sand|gravel|concrete_powder|anvil|bulb|drawer|cabinet|wardrobe|cupboard|counter|sink|oven|furnace|smoker)$/;
    for (const b of BLOCKS.blocks) expect(b.id.slice(b.id.indexOf(":") + 1), b.id).not.toMatch(refusedKinds);
    // the season's portal frame (docs/34 §10) is on it, so a frame can be designed into a temple
    expect(BLOCKS.blocks.some((b) => b.id === "minecraft:reinforced_deepslate")).toBe(true);
  });
  it("as the designer reads it: grouped, with the properties each group takes", () => {
    const text = blockListText(BLOCKS);
    expect(text).toContain("Stairs (facing, half; the stairs step sets facing itself): facing=north|east|south|west, half=bottom|top");
    expect(text).toContain("minecraft:deepslate_bricks");
  });
});

describe("parseRecipe", () => {
  it("takes every example recipe", () => {
    expect(EXAMPLES).toEqual(["boss_arena", "boss_hall", "gate", "temple", "temple_b", "watchtower"]);
    for (const name of EXAMPLES) {
      const r = parseRecipe(readFileSync(path.join(ROOT, "designer", "examples", `${name}.json`), "utf8"), BLOCKS);
      expect(r.name).toBe(name);
    }
  });
  it("refuses a block that is not on the list, a property it does not take and a value it cannot have", () => {
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "minecraft:tnt" }])).toBe("step 1: minecraft:tnt is not on the block list");
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "minecraft:stone[facing=north]" }])).toBe('step 1: minecraft:stone has no property "facing" (it takes none)');
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "minecraft:oak_stairs[facin=north]" }])).toBe('step 1: minecraft:oak_stairs has no property "facin" (it takes facing, half)');
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "minecraft:lantern[hanging=yes]" }])).toBe("step 1: minecraft:lantern[hanging=yes]: hanging is one of false, true");
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "stone" }])).toBe('step 1: uses the material "stone", which is not in materials');
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "wall" }], { materials: { wall: [["minecraft:stone", 2], ["minecraft:water", 1]] } })).toBe("material \"wall\": minecraft:water is not on the block list");
  });
  it("names the step, and the copy, that reaches outside the size", () => {
    expect(refused([{ op: "box", from: [0, 0, 0], to: [8, 1, 1], with: STONE }])).toBe("step 1 reaches outside the size: x goes to 8, the size is 8 (0 to 7)");
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: STONE }, { op: "repeat", times: 5, move: [0, 2, 0], steps: [{ op: "line", from: [1, 0, 1], to: [1, 0, 3], with: STONE }] }]))
      .toBe("step 2.1 reaches outside the size (moved by 0, 8, 0): y goes to 8, the size is 8 (0 to 7)");
    expect(refused([{ op: "dome", base: [4, 0, 4], radius: 5, with: STONE }])).toBe("step 1 reaches outside the size: x goes to -1, the lowest is 0");
    expect(refused([{ op: "stairs", from: [0, 0, 0], dir: "north", length: 3, width: 3, with: "minecraft:oak_stairs" }])).toBe("step 1 reaches outside the size: z goes to -2, the lowest is 0");
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: STONE }], { markers: [{ name: "boss", at: [0, 9, 0] }] })).toBe('marker "boss" is outside the size (y)');
  });
  it("refuses what is not a recipe: no JSON, an unknown step, a field it does not know, a ground above the top", () => {
    expect(() => parseRecipe("here is your temple: {", BLOCKS)).toThrow("the recipe is not JSON");
    expect(refused([{ op: "sphere", base: [1, 1, 1], radius: 1, with: STONE }])).toMatch(/^step 1, op: Invalid discriminator value/);
    expect(refused([{ op: "box", from: [0, 0, 0], to: [1, 1, 1], with: STONE, hollw: true }])).toMatch(/^step 1: Unrecognized key\(s\) in object: 'hollw'/);
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: STONE }], { ground: 8 })).toBe("ground is 8, but the build is only 8 high (0 to 7)");
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: STONE }], { name: "Temple!" })).toMatch(/^name: a-z, 0-9 and _/);
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: STONE }], { size: { x: 129, y: 8, z: 8 } })).toMatch(/^size\.x: Number must be less than or equal to 128/);
  });
  it("keeps to the limits: steps as written, steps unrolled, blocks, bytes", () => {
    const one = { op: "set", at: [[0, 0, 0]], with: STONE };
    expect(refused(Array.from({ length: DESIGN_LIMITS.steps + 1 }, () => one))).toBe(`the recipe has more than ${DESIGN_LIMITS.steps} steps; use repeat and mirror`);
    expect(refused([{ op: "repeat", times: 128, move: [0, 0, 0], steps: [{ op: "repeat", times: 79, move: [0, 0, 0], steps: [one, one] }] }])).toBe("the recipe has more than 20,000 steps once repeat and mirror are unrolled");
    expect(refused([{ op: "repeat", times: 128, move: [0, 0, 0], steps: [{ op: "mirror", axis: "both", steps: [{ op: "repeat", times: 40, move: [0, 0, 0], steps: [one] }] }] }])).toBe("the recipe has more than 20,000 steps once repeat and mirror are unrolled");
    expect(refused([{ op: "box", from: [0, 0, 0], to: [99, 50, 99], with: STONE }], { size: { x: 100, y: 51, z: 100 } })).toBe("the build has 510,000 blocks; the most is 500,000");
    expect(() => parseRecipe(JSON.stringify(recipe([one], { pad: "x".repeat(DESIGN_LIMITS.bytes) })), BLOCKS)).toThrow("the recipe is larger than 64 KB");
  });
});

describe("compile", () => {
  it("box, hollow box and walls fill what they say", () => {
    expect(placed(grid([{ op: "box", from: [1, 1, 1], to: [5, 5, 5], with: STONE }]))).toBe(125);
    expect(placed(grid([{ op: "box", from: [5, 5, 5], to: [1, 1, 1], with: STONE, hollow: true }]))).toBe(125 - 27);
    const w = grid([{ op: "walls", from: [0, 0, 0], to: [4, 2, 4], with: STONE }]);
    expect(placed(w)).toBe(16 * 3);
    expect(at(w, 2, 1, 2)).toBeNull();
  });
  it("clear writes air; a place no step touches is left out; a later step writes over an earlier one", () => {
    const g = grid([
      { op: "box", from: [0, 0, 0], to: [2, 2, 2], with: STONE },
      { op: "clear", from: [1, 0, 0], to: [1, 1, 0] },
      { op: "set", at: [[1, 0, 0]], with: "minecraft:glowstone" },
    ]);
    expect([at(g, 0, 0, 0), at(g, 1, 0, 0), at(g, 1, 1, 0), at(g, 5, 5, 5)]).toEqual([STONE, "minecraft:glowstone", "minecraft:air", null]);
    const s = gridToStructure(g);
    expect(structureInfo(s)).toEqual({ size: { x: 8, y: 8, z: 8 }, blocks: 27 });
    expect(child(s, "palette", 9)?.v.map((p) => child(p, "Name", 8)?.v)).toEqual(["minecraft:air", STONE, "minecraft:glowstone"]);
  });
  it("a mix is the same for the same seed, follows its weights and changes with the seed", () => {
    const steps = [{ op: "box", from: [0, 0, 0], to: [7, 7, 7], with: "wall" }];
    const materials = { wall: [["minecraft:deepslate_bricks", 3], ["minecraft:cracked_deepslate_bricks", 1]] };
    const a = grid(steps, { materials });
    expect(grid(steps, { materials }).cells).toEqual(a.cells);
    expect(grid(steps, { materials, seed: 2 }).cells).not.toEqual(a.cells);
    const counts = Object.fromEntries(blockCounts(a).map((c) => [c.block, c.count]));
    expect(counts["minecraft:deepslate_bricks"]! / 512).toBeGreaterThan(0.65);
    expect(counts["minecraft:deepslate_bricks"]! / 512).toBeLessThan(0.85);
  });
  it("stairs rise one a block towards dir, as wide as asked, every stair turned up the flight", () => {
    const g = grid([{ op: "stairs", from: [2, 0, 6], dir: "north", length: 4, width: 2, with: "minecraft:oak_stairs" }]);
    expect(placed(g)).toBe(8);
    for (let i = 0; i < 4; i++) for (const x of [2, 3]) expect(at(g, x, i, 6 - i)).toBe("minecraft:oak_stairs[facing=north,half=bottom]");
    // a full block in a flight stays a full block
    expect(at(grid([{ op: "stairs", from: [0, 0, 0], dir: "east", length: 2, width: 1, with: STONE }]), 1, 1, 0)).toBe(STONE);
  });
  it("mirror writes the mirror image and turns stairs and torches to match; both gives four", () => {
    const g = grid([{ op: "mirror", axis: "x", steps: [
      { op: "set", at: [[0, 0, 1]], with: "minecraft:oak_stairs[facing=east]" },
      { op: "set", at: [[1, 0, 1]], with: "minecraft:wall_torch[facing=west]" },
      { op: "set", at: [[2, 0, 1]], with: "minecraft:oak_stairs[facing=north]" },
    ] }]);
    expect([at(g, 7, 0, 1), at(g, 6, 0, 1), at(g, 5, 0, 1)]).toEqual(["minecraft:oak_stairs[facing=west]", "minecraft:wall_torch[facing=east]", "minecraft:oak_stairs[facing=north]"]);
    const b = grid([{ op: "mirror", axis: "both", steps: [{ op: "set", at: [[0, 0, 0]], with: "minecraft:oak_stairs[facing=north,half=top]" }] }]);
    expect([at(b, 0, 0, 0), at(b, 7, 0, 0), at(b, 0, 0, 7), at(b, 7, 0, 7)]).toEqual(["minecraft:oak_stairs[facing=north,half=top]", "minecraft:oak_stairs[facing=north,half=top]", "minecraft:oak_stairs[facing=south,half=top]", "minecraft:oak_stairs[facing=south,half=top]"]);
  });
  it("a mirror hangs a door or a shutter on the other side, and keeps a door's two halves together (docs/40, interiors)", () => {
    const g = grid([{ op: "mirror", axis: "x", steps: [
      { op: "set", at: [[1, 0, 0]], with: "minecraft:oak_door[facing=north,half=lower,hinge=left]" },
      { op: "set", at: [[1, 1, 0]], with: "minecraft:oak_door[facing=north,half=upper,hinge=left]" },
      { op: "set", at: [[2, 0, 3]], with: "another_furniture:oak_shutter[facing=east,hinge=right,open=true]" },
    ] }]);
    expect([at(g, 6, 0, 0), at(g, 6, 1, 0), at(g, 5, 0, 3)]).toEqual(["minecraft:oak_door[facing=north,half=lower,hinge=right]", "minecraft:oak_door[facing=north,half=upper,hinge=right]", "another_furniture:oak_shutter[facing=west,hinge=left,open=true]"]);
  });
  it("furniture takes only what a designer chooses: the way it faces, a cushion's colour; the game sets its joins", () => {
    expect(at(grid([{ op: "set", at: [[0, 0, 0]], with: "handcrafted:oak_chair[facing=south,color=red]" }]), 0, 0, 0)).toBe("handcrafted:oak_chair[color=red,facing=south]");
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "mcwfurnitures:oak_table[north=true]" }])).toBe('step 1: mcwfurnitures:oak_table has no property "north" (it takes none)');
    expect(refused([{ op: "set", at: [[0, 0, 0]], with: "another_furniture:oak_drawer" }])).toBe("step 1: another_furniture:oak_drawer is not on the block list");
  });
  it("repeat moves its steps each time, nested too", () => {
    const g = grid([{ op: "repeat", times: 3, move: [3, 0, 0], steps: [{ op: "repeat", times: 2, move: [0, 0, 4], steps: [{ op: "line", from: [0, 0, 0], to: [0, 3, 0], with: STONE }] }] }]);
    expect(placed(g)).toBe(3 * 2 * 4);
    expect([at(g, 6, 3, 4), at(g, 1, 0, 0)]).toEqual([STONE, null]);
  });
  it("cylinder, dome, pyramid and line have the shapes they say", () => {
    const solid = grid([{ op: "cylinder", base: [4, 0, 4], radius: 3, height: 2, with: STONE }], { size: { x: 9, y: 8, z: 9 } });
    const hollow = grid([{ op: "cylinder", base: [4, 0, 4], radius: 3, height: 2, with: STONE, hollow: true }], { size: { x: 9, y: 8, z: 9 } });
    expect(placed(solid)).toBe(2 * 37); // a circle of radius 3, as the game's own tools draw it
    expect(at(hollow, 4, 0, 4)).toBeNull();
    expect(at(hollow, 4, 0, 1)).toBe(STONE);
    const dome = grid([{ op: "dome", base: [4, 0, 4], radius: 3, with: STONE, hollow: true }], { size: { x: 9, y: 8, z: 9 } });
    expect([at(dome, 4, 3, 4), at(dome, 4, 1, 4), at(dome, 4, 4, 4)]).toEqual([STONE, null, null]);
    const roof = grid([{ op: "pyramid", from: [0, 0, 0], to: [6, 7, 6], with: STONE, hollow: true }]);
    expect([at(roof, 0, 0, 0), at(roof, 3, 0, 3), at(roof, 1, 1, 1), at(roof, 3, 3, 3), at(roof, 3, 4, 3)]).toEqual([STONE, null, STONE, STONE, null]);
    expect(placed(grid([{ op: "pyramid", from: [0, 0, 0], to: [4, 7, 4], with: STONE }]))).toBe(25 + 9 + 1);
    const line = grid([{ op: "line", from: [0, 0, 0], to: [6, 3, 0], with: STONE }]);
    expect(placed(line)).toBe(7);
    expect([at(line, 0, 0, 0), at(line, 6, 3, 0)]).toEqual([STONE, STONE]);
  });
  it("leaves are always written persistent", () => {
    expect(at(grid([{ op: "set", at: [[0, 0, 0]], with: "minecraft:oak_leaves" }]), 0, 0, 0)).toBe("minecraft:oak_leaves[persistent=true]");
  });
  it("every example recipe gives a structure file the upload check takes, with every block on the list", () => {
    for (const name of EXAMPLES) {
      const r = parseRecipe(readFileSync(path.join(ROOT, "designer", "examples", `${name}.json`), "utf8"), BLOCKS);
      const { structure, blocks } = compile(r, BLOCKS);
      const { check } = readBuild(writeNbt(structure), "nbt", { builtAt: "", namespaces: { minecraft: "Minecraft", create: "Create", createdeco: "Create Deco" } });
      expect(check.size).toEqual(r.size);
      expect(check.missing).toEqual([]);
      expect(blocks).toBeGreaterThan(100);
      expect(numberOf(readNbt(writeNbt(structure)), "DataVersion")).toBe(3955);
    }
  }, 60_000); // temple_b is 133,000 places: writing its NBT alone takes about 2 s
});

describe("picture", () => {
  it("shows only blocks with a side open to the air, and cuts above a layer", () => {
    const g = grid([{ op: "box", from: [0, 0, 0], to: [2, 2, 2], with: STONE }]);
    expect(picture(g, BLOCKS).blocks).toHaveLength(26);
    expect(picture(g, BLOCKS, 0).blocks).toHaveLength(9);
    // glass hides nothing behind it
    const glass = grid([{ op: "box", from: [0, 0, 0], to: [2, 2, 2], with: "minecraft:glass" }]);
    expect(picture(glass, BLOCKS).blocks).toHaveLength(27);
    expect(picture(g, BLOCKS).colours).toEqual([BLOCKS.blocks.find((b) => b.id === STONE)!.colour]);
  });
  it("puts no block outside the build's outline at any tile size (docs/40 3c: tiles of 6 and 10 put half a row)", () => {
    const g = grid([{ op: "box", from: [0, 0, 0], to: [40, 5, 58], with: STONE }], { size: { x: 41, y: 6, z: 59 } });
    const pic = picture(g, BLOCKS);
    for (const tile of [4, 6, 8, 10, 12]) {
      const { width, height, rgba } = render(pic, { tile });
      const w = Math.floor(tile / 4) * 4;
      const [sx, sy, sz] = [41, 6, 59];
      const offX = (sz - 1) * (w / 2);
      const offY = (sy - 1) * (w / 2);
      const at = (x: number, y: number, z: number): [number, number] => [(x - z) * (w / 2) + offX, (x + z) * (w / 4) - y * (w / 2) + offY];
      // the box's outline: six corners of the cubes at its ends
      const poly: Array<[number, number]> = [
        [at(0, sy - 1, 0)[0] + w / 2, at(0, sy - 1, 0)[1]],
        [at(sx - 1, sy - 1, 0)[0] + w, at(sx - 1, sy - 1, 0)[1] + w / 4],
        [at(sx - 1, 0, 0)[0] + w, at(sx - 1, 0, 0)[1] + w - w / 4],
        [at(sx - 1, 0, sz - 1)[0] + w / 2, at(sx - 1, 0, sz - 1)[1] + w],
        [at(0, 0, sz - 1)[0], at(0, 0, sz - 1)[1] + w - w / 4],
        [at(0, sy - 1, sz - 1)[0], at(0, sy - 1, sz - 1)[1] + w / 4],
      ];
      // inside a convex outline (clockwise on screen), a pixel's centre is on the inner side of every edge
      const inside = (px: number, py: number) => poly.every(([ax, ay], i) => {
        const [bx, by] = poly[(i + 1) % poly.length]!;
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= -1.5 * Math.hypot(bx - ax, by - ay);
      });
      let drawn = 0;
      let outside = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (rgba[i] === 30 && rgba[i + 1] === 31 && rgba[i + 2] === 36) continue;
        drawn++;
        if (!inside(x + 0.5, y + 0.5)) outside++;
      }
      expect([tile, outside]).toEqual([tile, 0]);
      expect(drawn).toBeGreaterThan(width * height * 0.3);
    }
  });
  it("draws four turns of a build", () => {
    const g = grid([{ op: "box", from: [0, 0, 0], to: [3, 1, 1], with: STONE }], { markers: [{ name: "boss", at: [1, 1, 1] }] });
    const pic = picture(g, BLOCKS);
    const one = render(pic, { tile: 8 });
    expect([one.width, one.height]).toEqual([(8 + 8) * 4, 7 * 4 + 14 * 2 + 8]);
    const sideways = render(pic, { tile: 8, turn: 1 });
    expect(sideways.width).toBe(one.width);
    let drawn = 0;
    for (let i = 0; i < one.rgba.length; i += 4) if (one.rgba[i] !== 30 || one.rgba[i + 1] !== 31) drawn++;
    expect(drawn).toBeGreaterThan(100);
    const all = renderTurns(pic, 8);
    expect(all.rgba.length).toBe(all.width * all.height * 4);
  });
});

describe("the command", () => {
  it("takes a recipe, the designer's answer or the command's whole JSON output", () => {
    const r = recipe([{ op: "set", at: [[0, 0, 0]], with: STONE }]);
    expect(recipeFrom(JSON.stringify(r))).toEqual({ recipe: r });
    expect(recipeFrom(JSON.stringify({ say: "A stone.", recipe: r }))).toEqual({ recipe: r, say: "A stone." });
    expect(recipeFrom(JSON.stringify({ type: "result", result: JSON.stringify({ say: "A stone.", recipe: r }), usage: {} }))).toEqual({ recipe: r, say: "A stone." });
    expect(() => recipeFrom(JSON.stringify({ say: "I only design builds. Tell me what to build or what to change." }))).toThrow("the designer did not return a build: I only design builds.");
  });
  it("the system prompt is the instructions and then the block list", async () => {
    const prompt = await designPrompt({ root: ROOT, repo: path.join(ROOT, "..") });
    expect(prompt.startsWith("You are the build designer for a Minecraft 1.21.1 server.")).toBe(true);
    expect(prompt).toContain("## The steps");
    expect(prompt.indexOf("## Blocks you may use")).toBeGreaterThan(prompt.indexOf("## Limits"));
    expect(prompt).toContain("minecraft:reinforced_deepslate");
  });
});

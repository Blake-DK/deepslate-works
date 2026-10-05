import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuildError, buildBuilds, paletteEntry, schemToStructure, structureInfo, toStructure } from "../src/builds";
import { byte, child, compound, int, ints, list, numberOf, readNbt, short, str, writeNbt, type Tag } from "../src/nbt";

// docs/34 §10: builds an admin uploads. A WorldEdit .schem is turned into the game's structure file; a structure
// .nbt goes through as it is. The fixtures are made here with the same writer, since no real file is in the repo:
// that the game takes the result is for the server to show.

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const bytes = (v: number[]): Tag => ({ t: 7, v: Buffer.from(v) });
const PALETTE = { "minecraft:air": int(0), "minecraft:stone": int(1), "minecraft:oak_stairs[facing=north,half=bottom]": int(2), "minecraft:chest[facing=west]": int(3) };
// 2 wide, 2 high, 1 long; order x, then z, then y: (0,0,0) stone, (1,0,0) stairs, (0,1,0) air, (1,1,0) chest
const DATA = [1, 2, 0, 3];
const chest = (v3: boolean): Tag => (v3
  ? compound({ Pos: { t: 11, v: [1, 1, 0] }, Id: str("minecraft:chest"), Data: compound({ Lock: str("") }) })
  : compound({ Pos: { t: 11, v: [1, 1, 0] }, Id: str("minecraft:chest"), Lock: str("") }));
const schemV2 = (): Tag => compound({ Version: int(2), DataVersion: int(3465), Width: short(2), Height: short(2), Length: short(1), Palette: compound(PALETTE), BlockData: bytes(DATA), BlockEntities: list(10, [chest(false)]) });
const schemV3 = (): Tag => compound({ Schematic: compound({ Version: int(3), DataVersion: int(3955), Width: short(2), Height: short(2), Length: short(1), Blocks: compound({ Palette: compound(PALETTE), Data: bytes(DATA), BlockEntities: list(10, [chest(true)]) }) }) });

describe("NBT, read and written", () => {
  it("comes back as it went, every type kept", () => {
    const tree = compound({ b: byte(-3), s: short(300), i: int(-70000), l: { t: 4, v: 2n ** 40n }, f: { t: 5, v: 0.5 }, d: { t: 6, v: 1.25 }, bytes: bytes([1, 2, 255]), text: str("Frontier · é"), ia: { t: 11, v: [1, -2] }, la: { t: 12, v: [3n] }, empty: list(10, []), nested: list(10, [compound({ pos: ints([1, 2, 3]) })]) });
    expect(readNbt(writeNbt(tree))).toEqual({ ...tree, v: { ...(tree as { v: Record<string, Tag> }).v, empty: { t: 9, e: 0, v: [] } } });
  });
  it("refuses what is not NBT, and a file that ends early", () => {
    expect(() => readNbt(Buffer.from("PK\u0003\u0004 a zip"))).toThrow(/not an NBT file/);
    const whole = writeNbt(compound({ a: str("hello") }));
    expect(() => readNbt(Buffer.from([0x1f, 0x8b, 1, 2, 3]))).toThrow(/does not unpack/);
    expect(readNbt(whole)).toEqual(compound({ a: str("hello") }));
  });
});

describe("a WorldEdit .schem as a structure file", () => {
  it("a block state with its properties", () => {
    expect(paletteEntry("minecraft:oak_stairs[facing=north,half=bottom]")).toEqual(compound({ Name: str("minecraft:oak_stairs"), Properties: compound({ facing: str("north"), half: str("bottom") }) }));
    expect(paletteEntry("create:cogwheel")).toEqual(compound({ Name: str("create:cogwheel") }));
    expect(() => paletteEntry("not a block")).toThrow(BuildError);
  });

  for (const [label, make] of [["version 2", schemV2], ["version 3", schemV3]] as const) {
    it(`${label}: size, palette in order, every block at its place, the chest's data kept`, () => {
      const { size, structure, blocks } = schemToStructure(make());
      expect([size, blocks]).toEqual([{ x: 2, y: 2, z: 1 }, 4]);
      expect(child(structure, "size", 9)?.v.map((t) => (t as { v: number }).v)).toEqual([2, 2, 1]);
      expect(child(structure, "palette", 9)?.v.map((p) => child(p, "Name", 8)?.v)).toEqual(["minecraft:air", "minecraft:stone", "minecraft:oak_stairs", "minecraft:chest"]);
      const at = (child(structure, "blocks", 9)?.v ?? []).map((b) => [child(b, "pos", 9)?.v.map((t) => (t as { v: number }).v).join(","), numberOf(b, "state"), child(child(b, "nbt", 10), "id", 8)?.v ?? null]);
      expect(at).toEqual([["0,0,0", 1, null], ["1,0,0", 2, null], ["0,1,0", 0, null], ["1,1,0", 3, "minecraft:chest"]]);
      expect(numberOf(structure, "DataVersion")).toBe(label === "version 2" ? 3465 : 3955);
      // and it is a structure file the reader of structure files accepts
      expect(structureInfo(readNbt(writeNbt(structure)))).toEqual({ size: { x: 2, y: 2, z: 1 }, blocks: 4 });
    });
  }

  it("a palette of more than 127 blocks: the numbers are varints", () => {
    const palette = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`minecraft:b${i}`, int(i)]));
    const s = compound({ Version: int(2), Width: short(2), Height: short(1), Length: short(1), Palette: compound(palette), BlockData: bytes([0xc7, 0x01, 0x05]) }); // 199, then 5
    expect((child(schemToStructure(s).structure, "blocks", 9)?.v ?? []).map((b) => numberOf(b, "state"))).toEqual([199, 5]);
  });

  it("says what is wrong: too large, cut short, not a .schem at all", () => {
    expect(() => schemToStructure(compound({ Width: short(300), Height: short(1), Length: short(1) }))).toThrow(/300 blocks wide; the most is 256/);
    expect(() => schemToStructure(compound({ Width: short(200), Height: short(200), Length: short(200), Palette: compound(PALETTE), BlockData: bytes([]) }))).toThrow(/a \.schem may hold 500,000/);
    expect(() => schemToStructure(compound({ ...(schemV2() as { v: Record<string, Tag> }).v, BlockData: bytes([1, 2]) }))).toThrow(/ends early/);
    expect(() => schemToStructure(compound({ Width: short(1), Height: short(1), Length: short(1) }))).toThrow(/no block palette/);
    expect(() => toStructure(Buffer.from("hello"), "schem")).toThrow(/not an NBT file/);
    expect(() => structureInfo(compound({ size: ints([1, 1, 1]) }))).toThrow(/not a structure file/);
  });
});

describe("build builds", () => {
  it("every upload becomes a structure of deepslate-builds; one that does not read is named and left out", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "builds-"));
    dirs.push(repo);
    const from = path.join(repo, "data", "builds");
    await mkdir(from, { recursive: true });
    const structure = writeNbt(schemToStructure(schemV2()).structure);
    await writeFile(path.join(from, "temple.schem"), writeNbt(schemV3()));
    await writeFile(path.join(from, "gate.nbt"), structure);
    await writeFile(path.join(from, "broken.schem"), Buffer.from("not a build"));
    await writeFile(path.join(from, "Bad Name.nbt"), structure);
    const paths = { repo, dist: path.join(repo, "dist") };
    const done = await buildBuilds(paths, () => undefined);
    expect(done.map((b) => [b.name, b.format, b.size])).toEqual([["gate", "nbt", { x: 2, y: 2, z: 1 }], ["temple", "schem", { x: 2, y: 2, z: 1 }]]);
    const pack = path.join(paths.dist, "server", "datapacks", "deepslate-builds");
    expect((await readdir(path.join(pack, "data", "deepslate", "structure", "upload"))).sort()).toEqual(["gate.nbt", "temple.nbt"]);
    expect(await readFile(path.join(pack, "data", "deepslate", "structure", "upload", "gate.nbt"))).toEqual(structure); // a structure file goes through untouched
    expect(JSON.parse(await readFile(path.join(pack, "pack.mcmeta"), "utf8"))).toMatchObject({ pack: { pack_format: 48 } });
    const listed = JSON.parse(await readFile(path.join(paths.dist, "builds.json"), "utf8")) as { builds: unknown[]; problems: Array<{ file: string }> };
    expect([listed.builds.length, listed.problems.map((p) => p.file)]).toEqual([2, ["broken.schem"]]);
    // an upload that is removed leaves the datapack at the next build
    await rm(path.join(from, "gate.nbt"));
    await rm(path.join(from, "temple.schem"));
    expect(await buildBuilds(paths, () => undefined)).toEqual([]);
    expect(await readdir(path.join(paths.dist, "server", "datapacks"))).toEqual([]);
  });
});

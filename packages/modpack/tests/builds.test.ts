import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import { afterEach, describe, expect, it } from "vitest";
import { BuildError, buildBuilds, jarBlockNamespaces, structureToSchem, litematicToStructure, missingLine, packBlocks, paletteEntry, readBuild, schemToStructure, structureInfo, structureNeeds, toStructure, withoutNamespaces } from "../src/builds";
import { byte, child, compound, int, ints, list, numberOf, readNbt, short, str, writeNbt, type Tag } from "../src/nbt";
import { openZip } from "../src/zip";

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

// docs/37: Litematica's file. Block states are packed into longs at max(2, bits for the palette) each, an entry's bits
// running on into the next long; a region's size may be negative, reaching back from its position.
function packed(values: number[], paletteSize: number): Tag {
  const bits = BigInt(Math.max(2, 32 - Math.clz32(paletteSize - 1)));
  const longs = Array.from({ length: Math.ceil((values.length * Number(bits)) / 64) }, () => 0n);
  values.forEach((v, i) => {
    const bit = BigInt(i) * bits;
    const at = Number(bit >> 6n);
    const off = bit & 63n;
    longs[at] = BigInt.asUintN(64, longs[at]! | (BigInt(v) << off));
    if (off + bits > 64n) longs[at + 1] = BigInt.asUintN(64, longs[at + 1]! | (BigInt(v) >> (64n - off)));
  });
  return { t: 12, v: longs.map((l) => BigInt.asIntN(64, l)) };
}
const v3 = (x: number, y: number, z: number) => compound({ x: int(x), y: int(y), z: int(z) });
const state = (name: string, props?: Record<string, string>) => compound({ Name: str(name), ...(props ? { Properties: compound(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, str(v)]))) } : {}) });
const region = (pos: Tag, size: Tag, palette: Tag[], values: number[], tiles: Tag[] = []) => compound({ Position: pos, Size: size, BlockStatePalette: list(10, palette), BlockStates: packed(values, palette.length), TileEntities: list(10, tiles), Entities: list(10, []) });
// region A: 2 by 1 by 2 from 0,0,0 (x, then z, then y): stone, cogwheel, air, stone
// region B: from 1,1,1 with size -2,1,-1, so 0,1,1 to 1,1,1: a chest (with its data), then air
const litematic = (): Tag => compound({
  Version: int(6), MinecraftDataVersion: int(3955),
  Metadata: compound({ Name: str("test") }),
  Regions: compound({
    A: region(v3(0, 0, 0), v3(2, 1, 2), [state("minecraft:air"), state("minecraft:stone"), state("create:cogwheel", { axis: "y" })], [1, 2, 0, 1]),
    B: region(v3(1, 1, 1), v3(-2, 1, -1), [state("minecraft:air"), state("minecraft:chest", { facing: "west" })], [1, 0], [compound({ id: str("minecraft:chest"), x: int(0), y: int(0), z: int(0), Lock: str("") })]),
  }),
});
const blocksOf = (structure: Tag) => (child(structure, "blocks", 9)?.v ?? []).map((b) => [child(b, "pos", 9)?.v.map((t) => (t as { v: number }).v).join(","), numberOf(b, "state"), child(child(b, "nbt", 10), "id", 8)?.v ?? null]);

describe("a .litematic as a structure file", () => {
  it("its regions in one box: every block at its place, a place no region covers left out, the chest's data kept", () => {
    const { size, structure, blocks } = litematicToStructure(litematic());
    expect([size, blocks]).toEqual([{ x: 2, y: 2, z: 2 }, 6]);
    expect(child(structure, "palette", 9)?.v.map((p) => child(p, "Name", 8)?.v)).toEqual(["minecraft:air", "minecraft:stone", "create:cogwheel", "minecraft:chest"]);
    expect(blocksOf(structure)).toEqual([["0,0,0", 1, null], ["1,0,0", 2, null], ["0,0,1", 0, null], ["1,0,1", 1, null], ["0,1,1", 3, "minecraft:chest"], ["1,1,1", 0, null]]);
    // the chest's data keeps its id and loses Litematica's x, y and z
    const chest = child((child(structure, "blocks", 9)?.v ?? [])[4], "nbt", 10);
    expect(Object.keys(chest?.v ?? {}).sort()).toEqual(["Lock", "id"]);
    expect(structureInfo(readNbt(writeNbt(structure)))).toEqual({ size: { x: 2, y: 2, z: 2 }, blocks: 6 });
  });

  it("an entry whose bits run on into the next long", () => {
    const palette = ["air", "stone", "dirt", "sand", "gravel"].map((n) => state(`minecraft:${n}`));
    const values = Array.from({ length: 30 }, (_, i) => i % 5); // 3 bits each: entry 21 spans the first two longs
    const { structure } = litematicToStructure(compound({ Regions: compound({ R: region(v3(0, 0, 0), v3(30, 1, 1), palette, values) }) }));
    expect((child(structure, "blocks", 9)?.v ?? []).map((b) => numberOf(b, "state"))).toEqual(values);
  });

  it("says what is wrong", () => {
    expect(() => litematicToStructure(compound({}))).toThrow(/no regions/);
    expect(() => litematicToStructure(compound({ Regions: compound({ R: compound({ Position: v3(0, 0, 0) }) }) }))).toThrow(/no Size/);
    expect(() => litematicToStructure(compound({ Regions: compound({ R: region(v3(0, 0, 0), v3(300, 1, 1), [state("minecraft:air")], []) }) }))).toThrow(/300 blocks wide/);
    const short_ = compound({ Regions: compound({ R: compound({ ...(region(v3(0, 0, 0), v3(40, 1, 1), [state("minecraft:air"), state("minecraft:stone")], [1]) as { v: Record<string, Tag> }).v }) }) });
    expect(() => litematicToStructure(short_)).toThrow(/ends early/);
  });
});

describe("the mods a build needs (docs/37)", () => {
  it("per namespace: how many blocks and which, air not counted, Minecraft first", () => {
    const { structure } = litematicToStructure(litematic());
    expect(structureNeeds(structure)).toEqual([{ namespace: "minecraft", blocks: 3, ids: ["minecraft:chest", "minecraft:stone"] }, { namespace: "create", blocks: 1, ids: ["create:cogwheel"] }]);
  });

  it("checked against the pack: missing names the mods the pack does not have", () => {
    const file = writeNbt(litematic());
    expect(readBuild(file, "litematic", { builtAt: "", namespaces: { minecraft: "Minecraft", create: "Create" } }).check.missing).toEqual([]);
    const { check } = readBuild(file, "litematic", { builtAt: "", namespaces: { minecraft: "Minecraft" } });
    expect(check.missing).toEqual(["create"]);
    expect(missingLine(check.needs, check.missing)).toBe("create (1 block: cogwheel)");
    // with no list of the pack's blocks, nothing is called missing
    expect(readBuild(file, "litematic", null).check.missing).toEqual([]);
  });

  it("the missing mods' blocks made air, their data dropped", () => {
    const { structure } = litematicToStructure(litematic());
    const cut = withoutNamespaces(structure, new Set(["create"]));
    expect(cut.airFor).toBe(1);
    expect(blocksOf(cut.structure)[1]).toEqual(["1,0,0", 0, null]);
    // nothing to cut: the same structure back
    expect(withoutNamespaces(structure, new Set(["copycats"]))).toEqual({ structure, airFor: 0 });
  });

  it("a jar's block namespaces, by its blockstates, nested jars too, with the mod's name", async () => {
    const inner = await zip({ "assets/flywheel/blockstates/x.json": Buffer.from("{}") });
    const outer = await zip({ "META-INF/neoforge.mods.toml": Buffer.from('displayName="Create"'), "assets/create/blockstates/cogwheel.json": Buffer.from("{}"), "assets/create/lang/en_us.json": Buffer.from("{}"), "assets/ponder/textures/a.png": Buffer.from(""), "META-INF/jarjar/flywheel.jar": inner });
    const into: Record<string, string> = {};
    jarBlockNamespaces(openZip(outer), into);
    expect(into).toEqual({ create: "Create", flywheel: "flywheel" });
  });
});

function zip(files: Record<string, Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const a = archiver("zip", { store: true });
    const out = new PassThrough();
    const parts: Buffer[] = [];
    out.on("data", (c: Buffer) => parts.push(c));
    out.on("end", () => resolve(Buffer.concat(parts)));
    a.on("error", reject);
    a.pipe(out);
    for (const [name, body] of Object.entries(files)) a.append(body, { name });
    void a.finalize();
  });
}

describe("build builds, with the pack's blocks (docs/37)", () => {
  it("writes pack-blocks.json; leaves out a build with a missing mod's blocks unless its admin ticked air", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "builds-"));
    dirs.push(repo);
    const paths = { repo, dist: path.join(repo, "dist") };
    await mkdir(path.join(paths.dist, "server", "mods"), { recursive: true });
    await writeFile(path.join(paths.dist, "server", "mods", "create.jar"), await zip({ "META-INF/neoforge.mods.toml": Buffer.from('displayName="Create"'), "assets/create/blockstates/cogwheel.json": Buffer.from("{}") }));
    const from = path.join(repo, "data", "builds");
    await mkdir(from, { recursive: true });
    const withCopycats = compound({ Regions: compound({ R: region(v3(0, 0, 0), v3(2, 1, 1), [state("minecraft:stone"), state("copycats:copycat_block")], [0, 1]) }) });
    await writeFile(path.join(from, "mill.litematic"), writeNbt(litematic()));
    await writeFile(path.join(from, "hut.litematic"), writeNbt(withCopycats));

    expect((await buildBuilds(paths, () => undefined)).map((b) => b.name)).toEqual(["mill"]);
    expect(JSON.parse(await readFile(path.join(paths.dist, "pack-blocks.json"), "utf8"))).toMatchObject({ namespaces: { minecraft: "Minecraft", create: "Create" } });
    const listed = JSON.parse(await readFile(path.join(paths.dist, "builds.json"), "utf8")) as { problems: Array<{ file: string; why: string }> };
    expect(listed.problems).toEqual([{ file: "hut.litematic", why: expect.stringMatching(/mods the pack does not have: copycats \(1 block: copycat_block\)/) as string }]);

    await writeFile(path.join(from, "hut.json"), JSON.stringify({ allowMissing: true }));
    const done = await buildBuilds(paths, () => undefined);
    expect(done.map((b) => [b.name, b.format, b.missing, b.airFor])).toEqual([["hut", "litematic", ["copycats"], 1], ["mill", "litematic", [], 0]]);
    const hut = readNbt(await readFile(path.join(paths.dist, "server", "datapacks", "deepslate-builds", "data", "deepslate", "structure", "upload", "hut.nbt")));
    expect(blocksOf(hut).map((b) => b[1])).toEqual([0, 2]);
    expect(child(hut, "palette", 9)?.v.map((p) => child(p, "Name", 8)?.v)).toEqual(["minecraft:stone", "copycats:copycat_block", "minecraft:air"]);
  });

  it("no server jars yet: pack-blocks is not written and nothing is called missing", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "builds-"));
    dirs.push(repo);
    expect(await packBlocks(path.join(repo, "dist"))).toBeNull();
  });
});

describe("a build as a WorldEdit .schem (docs/37 Step 2)", () => {
  it("version 3 with Offset 0 and no origin, so the lowest corner lands at the player's feet; reads back block for block", () => {
    const { structure } = litematicToStructure(litematic());
    const schem = readNbt(structureToSchem(structure));
    const s = child(schem, "Schematic", 10);
    expect([numberOf(s, "Version"), numberOf(s, "Width"), numberOf(s, "Height"), numberOf(s, "Length"), child(s, "Offset", 11)?.v, child(s, "Metadata", 10)]).toEqual([3, 2, 2, 2, [0, 0, 0], undefined]);
    // the places the .litematic left out (0,1,0 and 1,1,0) come back as air; the chest keeps its data
    const back = schemToStructure(schem).structure;
    const named = (t: Tag) => blocksOf(t).map(([pos, st, id]) => [pos, child((child(t, "palette", 9)?.v ?? [])[st as number], "Name", 8)?.v, id]);
    expect(named(back)).toEqual([
      ["0,0,0", "minecraft:stone", null], ["1,0,0", "create:cogwheel", null], ["0,0,1", "minecraft:air", null], ["1,0,1", "minecraft:stone", null],
      ["0,1,0", "minecraft:air", null], ["1,1,0", "minecraft:air", null], ["0,1,1", "minecraft:chest", "minecraft:chest"], ["1,1,1", "minecraft:air", null],
    ]);
    expect(Object.keys(child(child(s, "Blocks", 10), "Palette", 10)?.v ?? {})).toEqual(["minecraft:air", "minecraft:stone", "create:cogwheel[axis=y]", "minecraft:chest[facing=west]"]);
  });

  it("Build writes one beside each built upload, in the server's config/worldedit/schematics/", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "builds-"));
    dirs.push(repo);
    const from = path.join(repo, "data", "builds");
    await mkdir(from, { recursive: true });
    await writeFile(path.join(from, "mill.litematic"), writeNbt(litematic()));
    await writeFile(path.join(from, "broken.schem"), Buffer.from("not a build"));
    const paths = { repo, dist: path.join(repo, "dist") };
    await buildBuilds(paths, () => undefined);
    const dir = path.join(paths.dist, "server", "config", "worldedit", "schematics");
    expect(await readdir(dir)).toEqual(["mill.schem"]);
    await rm(path.join(from, "mill.litematic"));
    await buildBuilds(paths, () => undefined);
    await expect(readdir(dir)).rejects.toThrow();
  });
});

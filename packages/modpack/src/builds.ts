import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { child, compound, int, ints, list, NbtError, numberOf, readNbt, str, writeNbt, type Tag } from "./nbt";
import { PACK_FORMAT_1_21_1 } from "./seasons";

// docs/34 §10: builds an admin uploads on the site (data/builds/, not in git). `build builds` turns each into a
// structure file of the datapack deepslate-builds, which Sync puts into the world; the server then places it with
// `place template deepslate:upload/<name>`. Two kinds of file are taken:
//   .nbt    the game's own structure file (a structure block's save; Create's schematics are these too)
//   .schem  WorldEdit's (the Sponge schematic, version 2 or 3), turned into a structure file here
// Not taken: .litematic (Litematica) and the old numbered .schematic. Open them in the game and save them again.

export const BUILD_NAME = /^[a-z0-9_]{2,24}$/;
export const MAX_SIDE = 256;
/** A .schem becomes one entry per block: more than this and the build step's memory cap is at risk. */
export const MAX_SCHEM_BLOCKS = 500_000;

export type BuildInfo = { name: string; format: "nbt" | "schem"; size: { x: number; y: number; z: number }; blocks: number };
export class BuildError extends Error {}

const side = (n: number | undefined, what: string): number => {
  if (n === undefined || !Number.isInteger(n) || n < 1) throw new BuildError(`the file has no ${what}`);
  if (n > MAX_SIDE) throw new BuildError(`the build is ${n} blocks ${what}; the most is ${MAX_SIDE}`);
  return n;
};

/** "minecraft:oak_stairs[facing=north,half=bottom]" as a structure file's palette entry. */
export function paletteEntry(state: string): Tag {
  const m = /^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[([^\]]*)\])?$/.exec(state.trim());
  if (!m) throw new BuildError(`the file names a block the game would not know: "${state.slice(0, 60)}"`);
  const out: Record<string, Tag> = { Name: str(m[1]!) };
  const props = (m[2] ?? "").split(",").map((p) => p.split("=")).filter((p): p is [string, string] => p.length === 2 && p[0] !== "" && p[1] !== "");
  if (props.length) out.Properties = compound(Object.fromEntries(props.map(([k, v]) => [k.trim(), str(v.trim())])));
  return compound(out);
}

/** A WorldEdit .schem (Sponge schematic version 2 or 3) as the game's structure file. */
export function schemToStructure(root: Tag): { size: BuildInfo["size"]; structure: Tag; blocks: number } {
  const s = child(root, "Schematic", 10) ?? root; // version 3 wraps everything in "Schematic"
  const size = { x: side(numberOf(s, "Width"), "wide"), y: side(numberOf(s, "Height"), "high"), z: side(numberOf(s, "Length"), "long") };
  const volume = size.x * size.y * size.z;
  if (volume > MAX_SCHEM_BLOCKS) throw new BuildError(`the build is ${size.x} by ${size.y} by ${size.z}, ${volume.toLocaleString("en-GB")} blocks; a .schem may hold ${MAX_SCHEM_BLOCKS.toLocaleString("en-GB")}. Cut it into parts, or save it in the game with a structure block`);
  const holder = child(s, "Blocks", 10) ?? s; // version 3 keeps the blocks in "Blocks"
  const palette = child(holder, "Palette", 10);
  const data = child(holder, "Data", 7) ?? child(holder, "BlockData", 7);
  if (!palette || !data) throw new BuildError("not a WorldEdit .schem of version 2 or 3: it has no block palette");
  const states: Tag[] = [];
  for (const [state, id] of Object.entries(palette.v)) {
    if (id.t !== 3 || id.v < 0 || id.v > 65_535) throw new BuildError("the block palette is damaged");
    states[id.v] = paletteEntry(state);
  }
  for (let i = 0; i < states.length; i++) if (!states[i]) throw new BuildError("the block palette has a gap");

  // block entities (chests, signs) by where they stand: version 2 keeps their data beside Pos and Id, version 3 in "Data"
  const extra = new Map<string, Tag>();
  for (const be of child(holder, "BlockEntities", 9)?.v ?? []) {
    const pos = child(be, "Pos", 11)?.v;
    const id = child(be, "Id", 8)?.v;
    if (be.t !== 10 || !pos || pos.length !== 3 || !id) continue;
    const inner = child(be, "Data", 10)?.v ?? Object.fromEntries(Object.entries(be.v).filter(([k]) => k !== "Pos" && k !== "Id"));
    extra.set(pos.join(","), compound({ ...inner, id: str(id) }));
  }

  // one number per block, as a varint, in the order x, then z, then y
  const blocks: Tag[] = [];
  let at = 0;
  for (let y = 0; y < size.y; y++) for (let z = 0; z < size.z; z++) for (let x = 0; x < size.x; x++) {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      if (at >= data.v.length || shift > 21) throw new BuildError("the block data ends early or is damaged");
      const b = data.v[at++]!;
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
    }
    if (!states[value]) throw new BuildError("the block data names a block that is not in the palette");
    const nbt = extra.get(`${x},${y},${z}`);
    blocks.push(compound({ pos: ints([x, y, z]), state: int(value), ...(nbt ? { nbt } : {}) }));
  }
  const structure = compound({
    DataVersion: int(numberOf(s, "DataVersion") ?? 3955), // 3955 is 1.21.1; an older number is brought up to date by the game when it loads the file
    size: ints([size.x, size.y, size.z]),
    palette: list(10, states),
    blocks: list(10, blocks),
    entities: list(10, []),
  });
  return { size, structure, blocks: blocks.length };
}

/** What a structure .nbt holds, without changing it. */
export function structureInfo(root: Tag): { size: BuildInfo["size"]; blocks: number } {
  const size = child(root, "size", 9)?.v.map((t) => (t.t === 3 ? t.v : NaN));
  const blocks = child(root, "blocks", 9);
  if (!size || size.length !== 3 || !blocks || !child(root, "palette", 9)) throw new BuildError("not a structure file: it has no size, palette and blocks. (A file with several palettes, as some of the game's own have, is not taken.)");
  return { size: { x: side(size[0], "wide"), y: side(size[1], "high"), z: side(size[2], "long") }, blocks: blocks.v.length };
}

/** One uploaded file as the structure file that goes into the datapack. Throws BuildError with words for the admin. */
export function toStructure(file: Buffer, format: BuildInfo["format"]): { bytes: Buffer; size: BuildInfo["size"]; blocks: number } {
  let root: Tag;
  try {
    root = readNbt(file);
  } catch (e) {
    throw new BuildError(e instanceof NbtError ? e.message : "the file cannot be read");
  }
  if (format === "nbt") return { bytes: file, ...structureInfo(root) };
  const made = schemToStructure(root);
  return { bytes: writeNbt(made.structure), size: made.size, blocks: made.blocks };
}

export const BUILDS_PACK = "deepslate-builds";
/** The template an uploaded build is placed by. */
export const uploadTemplate = (name: string) => `deepslate:upload/${name}`;

/**
 * `build builds`, and a step of `build server`: every file in data/builds/ becomes a structure of the datapack
 * deepslate-builds in dist/server/datapacks/, and dist/builds.json says what is in it (the site reads the sizes
 * from there). A file that does not read is named and left out; the others are still built.
 */
export async function buildBuilds(paths: { repo: string; dist: string }, log: (s: string) => void): Promise<BuildInfo[]> {
  const from = path.join(paths.repo, "data", "builds");
  const pack = path.join(paths.dist, "server", "datapacks", BUILDS_PACK);
  let names: string[] = [];
  try {
    names = (await readdir(from)).filter((n) => /\.(nbt|schem)$/.test(n)).sort();
  } catch {
    // nothing uploaded yet
  }
  await rm(pack, { recursive: true, force: true });
  const done: BuildInfo[] = [];
  const problems: Array<{ file: string; why: string }> = [];
  for (const file of names) {
    const m = /^(.+)\.(nbt|schem)$/.exec(file)!;
    const [name, format] = [m[1]!, m[2] as BuildInfo["format"]];
    if (!BUILD_NAME.test(name)) continue;
    try {
      const made = toStructure(await readFile(path.join(from, file)), format);
      const out = path.join(pack, "data", "deepslate", "structure", "upload", `${name}.nbt`);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, made.bytes);
      done.push({ name, format, size: made.size, blocks: made.blocks });
      log(`build ${name} (${format}): ${made.size.x} by ${made.size.y} by ${made.size.z}`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      problems.push({ file, why });
      log(`WARN build ${file} left out: ${why}`);
    }
  }
  if (done.length) await writeFile(path.join(pack, "pack.mcmeta"), `${JSON.stringify({ pack: { pack_format: PACK_FORMAT_1_21_1, description: "Deepslate Works: uploaded builds" } }, null, 2)}\n`);
  await mkdir(paths.dist, { recursive: true });
  await writeFile(path.join(paths.dist, "builds.json"), `${JSON.stringify({ builds: done, problems }, null, 2)}\n`);
  if (names.length === 0) log("builds: nothing uploaded");
  return done;
}

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { modNameOf } from "./items";
import { child, compound, int, ints, list, NbtError, numberOf, readNbt, str, writeNbt, type Tag } from "./nbt";
import { PACK_FORMAT_1_21_1 } from "./seasons";
import { openZip, openZipFile, type Zip } from "./zip";

// docs/34 §10: builds an admin uploads on the site (data/builds/, not in git). `build builds` turns each into a
// structure file of the datapack deepslate-builds, which Sync puts into the world; the server then places it with
// `place template deepslate:upload/<name>`. Three kinds of file are taken:
//   .nbt        the game's own structure file (a structure block's save; Create's schematics are these too)
//   .schem      WorldEdit's (the Sponge schematic, version 2 or 3), turned into a structure file here
//   .litematic  Litematica's (docs/37), its regions put together into one box, turned into a structure file here
// Not taken: the old numbered .schematic. Open it in the game and save it again.
// docs/37: the site checks a file when it is uploaded, with the same code: its size, and the mods its blocks come
// from against the mods the pack has (dist/pack-blocks.json, written here from the server's jars).

export const BUILD_NAME = /^[a-z0-9_]{2,24}$/;
export const MAX_SIDE = 256;
/** A .schem or .litematic becomes one entry per block: more than this and the build step's memory cap is at risk. */
export const MAX_SCHEM_BLOCKS = 500_000;
export const BUILD_FORMATS = ["nbt", "schem", "litematic"] as const;
export type BuildFormat = (typeof BUILD_FORMATS)[number];

/** The blocks of one mod (one namespace) in a build: how many, and their names (the first few). */
export type BuildNeed = { namespace: string; blocks: number; ids: string[] };
export type BuildInfo = { name: string; format: BuildFormat; size: { x: number; y: number; z: number }; blocks: number; needs: BuildNeed[]; missing: string[]; airFor: number };
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

const tooMany = (size: BuildInfo["size"], what: string) => {
  const volume = size.x * size.y * size.z;
  if (volume > MAX_SCHEM_BLOCKS) throw new BuildError(`the build is ${size.x} by ${size.y} by ${size.z}, ${volume.toLocaleString("en-GB")} blocks; a ${what} may hold ${MAX_SCHEM_BLOCKS.toLocaleString("en-GB")}. Cut it into parts, or save it in the game with a structure block`);
};

/** A WorldEdit .schem (Sponge schematic version 2 or 3) as the game's structure file. */
export function schemToStructure(root: Tag): { size: BuildInfo["size"]; structure: Tag; blocks: number } {
  const s = child(root, "Schematic", 10) ?? root; // version 3 wraps everything in "Schematic"
  const size = { x: side(numberOf(s, "Width"), "wide"), y: side(numberOf(s, "Height"), "high"), z: side(numberOf(s, "Length"), "long") };
  tooMany(size, ".schem");
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


/** "minecraft:oak_stairs" and its properties, as one key: the same block state gives the same key. */
const stateKey = (state: Tag) => {
  const props = Object.entries(child(state, "Properties", 10)?.v ?? {}).map(([k, v]) => `${k}=${v.t === 8 ? v.v : ""}`).sort();
  return `${child(state, "Name", 8)?.v ?? ""}[${props.join(",")}]`;
};

/** One coordinate triple of a Litematica compound ({x, y, z} as ints). */
const xyz = (of: Tag | undefined, name: string) => {
  const c = child(of, name, 10);
  const [x, y, z] = ["x", "y", "z"].map((k) => numberOf(c, k));
  if (x === undefined || y === undefined || z === undefined) throw new BuildError(`not a Litematica file: a region has no ${name}`);
  return { x, y, z };
};

/**
 * A Litematica .litematic (Version 5 to 7) as the game's structure file. Each region has a position and a size (the
 * size may be negative: the region then reaches back from its position), a palette and the block states packed into
 * longs, an entry's bits running on into the next long. The regions are put together into one box; a place no region
 * covers is left out of the structure, so placing it leaves what stands there.
 */
export function litematicToStructure(root: Tag): { size: BuildInfo["size"]; structure: Tag; blocks: number } {
  const regions = Object.values(child(root, "Regions", 10)?.v ?? {});
  if (regions.length === 0) throw new BuildError("not a Litematica file: it has no regions");
  const boxes = regions.map((r) => {
    const pos = xyz(r, "Position");
    const raw = xyz(r, "Size");
    const min = { x: pos.x + (raw.x < 0 ? raw.x + 1 : 0), y: pos.y + (raw.y < 0 ? raw.y + 1 : 0), z: pos.z + (raw.z < 0 ? raw.z + 1 : 0) };
    return { r, min, size: { x: Math.abs(raw.x), y: Math.abs(raw.y), z: Math.abs(raw.z) } };
  });
  const lo = { x: Math.min(...boxes.map((b) => b.min.x)), y: Math.min(...boxes.map((b) => b.min.y)), z: Math.min(...boxes.map((b) => b.min.z)) };
  const hi = { x: Math.max(...boxes.map((b) => b.min.x + b.size.x)), y: Math.max(...boxes.map((b) => b.min.y + b.size.y)), z: Math.max(...boxes.map((b) => b.min.z + b.size.z)) };
  const size = { x: side(hi.x - lo.x, "wide"), y: side(hi.y - lo.y, "high"), z: side(hi.z - lo.z, "long") };
  tooMany(size, ".litematic");

  const palette: Tag[] = [];
  const byKey = new Map<string, number>();
  const placed = new Map<number, { state: number; nbt?: Tag }>(); // by x + size.x * (z + size.z * y)
  for (const { r, min, size: s } of boxes) {
    if (s.x === 0 || s.y === 0 || s.z === 0) continue;
    const states = child(r, "BlockStatePalette", 9)?.v ?? [];
    const longs = child(r, "BlockStates", 12)?.v;
    if (states.length === 0 || !longs) throw new BuildError("not a Litematica file: a region has no block palette");
    const ours = states.map((st) => {
      const name = child(st, "Name", 8)?.v;
      if (!name) throw new BuildError("the block palette is damaged");
      const entry = paletteEntry(`${name}[${Object.entries(child(st, "Properties", 10)?.v ?? {}).map(([k, v]) => `${k}=${v.t === 8 ? v.v : ""}`).join(",")}]`);
      const key = stateKey(entry);
      if (!byKey.has(key)) {
        byKey.set(key, palette.length);
        palette.push(entry);
      }
      return byKey.get(key)!;
    });
    const air = states.findIndex((st) => child(st, "Name", 8)?.v === "minecraft:air");
    const bits = BigInt(Math.max(2, 32 - Math.clz32(states.length - 1)));
    const mask = (1n << bits) - 1n;
    const volume = s.x * s.y * s.z;
    if (BigInt(longs.length) * 64n < BigInt(volume) * bits) throw new BuildError("the block data ends early or is damaged");
    const tiles = new Map<string, Tag>();
    for (const te of child(r, "TileEntities", 9)?.v ?? []) {
      const [x, y, z] = ["x", "y", "z"].map((k) => numberOf(te, k));
      if (te.t !== 10 || x === undefined || y === undefined || z === undefined) continue;
      tiles.set(`${x},${y},${z}`, compound(Object.fromEntries(Object.entries(te.v).filter(([k]) => k !== "x" && k !== "y" && k !== "z"))));
    }
    for (let i = 0; i < volume; i++) {
      const bit = BigInt(i) * bits;
      const at = Number(bit >> 6n);
      const off = bit & 63n;
      let v = BigInt.asUintN(64, longs[at]!) >> off;
      if (off + bits > 64n) v |= BigInt.asUintN(64, longs[at + 1]!) << (64n - off);
      const value = Number(v & mask);
      if (value >= states.length) throw new BuildError("the block data names a block that is not in the palette");
      const x = i % s.x;
      const z = Math.floor(i / s.x) % s.z;
      const y = Math.floor(i / (s.x * s.z));
      const k = min.x - lo.x + x + size.x * (min.z - lo.z + z + size.z * (min.y - lo.y + y));
      // where regions overlap, a later region's block wins over what was there, its air does not
      if (value === air && placed.has(k)) continue;
      const nbt = tiles.get(`${x},${y},${z}`);
      placed.set(k, { state: ours[value]!, ...(nbt ? { nbt } : {}) });
    }
  }
  const blocks: Tag[] = [...placed.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => {
    const x = k % size.x;
    const z = Math.floor(k / size.x) % size.z;
    const y = Math.floor(k / (size.x * size.z));
    return compound({ pos: ints([x, y, z]), state: int(b.state), ...(b.nbt ? { nbt: b.nbt } : {}) });
  });
  const structure = compound({
    DataVersion: int(numberOf(root, "MinecraftDataVersion") ?? 3955),
    size: ints([size.x, size.y, size.z]),
    palette: list(10, palette),
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

/** The mods a structure's blocks come from: per namespace, how many blocks (air left out) and the first few names. */
export function structureNeeds(structure: Tag): BuildNeed[] {
  const names = (child(structure, "palette", 9)?.v ?? []).map((p) => child(p, "Name", 8)?.v ?? "minecraft:air");
  const count = new Map<number, number>();
  for (const b of child(structure, "blocks", 9)?.v ?? []) {
    const s = numberOf(b, "state");
    if (s !== undefined) count.set(s, (count.get(s) ?? 0) + 1);
  }
  const by = new Map<string, { blocks: number; ids: Set<string> }>();
  names.forEach((id, i) => {
    const n = count.get(i) ?? 0;
    if (n === 0 || /^minecraft:(cave_|void_)?air$/.test(id) || id === "minecraft:structure_void") return;
    const ns = id.slice(0, id.indexOf(":"));
    const e = by.get(ns) ?? { blocks: 0, ids: new Set<string>() };
    e.blocks += n;
    e.ids.add(id);
    by.set(ns, e);
  });
  return [...by.entries()]
    .map(([namespace, e]) => ({ namespace, blocks: e.blocks, ids: [...e.ids].sort().slice(0, 12) }))
    .sort((a, b) => (a.namespace === "minecraft" ? -1 : b.namespace === "minecraft" ? 1 : b.blocks - a.blocks));
}

/** The structure with every block of these namespaces made air (their block data dropped), and how many there were. */
export function withoutNamespaces(structure: Tag, gone: ReadonlySet<string>): { structure: Tag; airFor: number } {
  const palette = child(structure, "palette", 9)?.v ?? [];
  const drop = new Set<number>();
  palette.forEach((p, i) => {
    const id = child(p, "Name", 8)?.v ?? "";
    if (gone.has(id.slice(0, id.indexOf(":")))) drop.add(i);
  });
  if (drop.size === 0) return { structure, airFor: 0 };
  let air = palette.findIndex((p) => child(p, "Name", 8)?.v === "minecraft:air" && !child(p, "Properties", 10));
  const newPalette = air >= 0 ? palette : [...palette, compound({ Name: str("minecraft:air") })];
  if (air < 0) air = palette.length;
  let airFor = 0;
  const blocks = (child(structure, "blocks", 9)?.v ?? []).map((b) => {
    const s = numberOf(b, "state");
    if (s === undefined || !drop.has(s) || b.t !== 10) return b;
    airFor++;
    return compound({ pos: b.v.pos!, state: int(air) });
  });
  return { structure: compound({ ...(structure as Extract<Tag, { t: 10 }>).v, palette: list(10, newPalette), blocks: list(10, blocks) }), airFor };
}

export type PackBlocks = { builtAt: string; namespaces: Record<string, string> };

/** The namespaces of blocks the pack has (each jar's assets/<ns>/blockstates/, nested jars too), with the mod's name. */
export function jarBlockNamespaces(zip: Zip, into: Record<string, string>, depth = 0): void {
  const name = modNameOf(zip, "");
  for (const n of zip.names) {
    const m = /^assets\/([a-z0-9_.-]+)\/blockstates\/./.exec(n);
    if (m && !(m[1]! in into)) into[m[1]!] = name || m[1]!;
    else if (n.endsWith(".jar") && depth < 2) {
      const inner = zip.read(n);
      if (!inner) continue;
      try {
        jarBlockNamespaces(openZip(inner), into, depth + 1);
      } catch {
        // not a zip after all
      }
    }
  }
}

/** dist/pack-blocks.json from the jars in dist/server/mods/; null when there are none (no Build has made the server). */
export async function packBlocks(dist: string, now = new Date()): Promise<PackBlocks | null> {
  const dir = path.join(dist, "server", "mods");
  let jars: string[];
  try {
    jars = (await readdir(dir)).filter((n) => n.endsWith(".jar")).sort();
  } catch {
    return null;
  }
  if (jars.length === 0) return null;
  const namespaces: Record<string, string> = { minecraft: "Minecraft" };
  for (const j of jars) {
    try {
      jarBlockNamespaces(await openZipFile(path.join(dir, j)), namespaces);
    } catch {
      // a jar that does not open: the server will say so when it starts
    }
  }
  return { builtAt: now.toISOString(), namespaces };
}

export type BuildCheck = { size: BuildInfo["size"]; blocks: number; needs: BuildNeed[]; missing: string[] };

/** One uploaded file read and checked: its size, the mods it needs, which of them the pack does not have (if known). */
export function readBuild(file: Buffer, format: BuildFormat, pack: PackBlocks | null): { structure: Tag; check: BuildCheck } {
  let root: Tag;
  try {
    root = readNbt(file);
  } catch (e) {
    throw new BuildError(e instanceof NbtError ? e.message : "the file cannot be read");
  }
  const made = format === "nbt" ? { structure: root, ...structureInfo(root) } : format === "schem" ? schemToStructure(root) : litematicToStructure(root);
  const needs = structureNeeds(made.structure);
  const missing = pack ? needs.map((n) => n.namespace).filter((ns) => !(ns in pack.namespaces)) : [];
  return { structure: made.structure, check: { size: made.size, blocks: made.blocks, needs, missing } };
}

/** One uploaded file as the structure file that goes into the datapack. Throws BuildError with words for the admin. */
export function toStructure(file: Buffer, format: BuildFormat): { bytes: Buffer; size: BuildInfo["size"]; blocks: number } {
  const { structure, check } = readBuild(file, format, null);
  return { bytes: format === "nbt" ? file : writeNbt(structure), size: check.size, blocks: check.blocks };
}

/** What the admin chose at upload, kept beside the file as data/builds/<name>.json. */
export type BuildChoice = { allowMissing?: boolean };

/** "Create Deco (120 blocks), Copycats (4 blocks)": the missing mods, by the namespace when the pack cannot name them. */
export const missingLine = (needs: BuildNeed[], missing: string[]) =>
  needs.filter((n) => missing.includes(n.namespace)).map((n) => `${n.namespace} (${n.blocks.toLocaleString("en-GB")} block${n.blocks === 1 ? "" : "s"}: ${n.ids.slice(0, 4).map((i) => i.slice(i.indexOf(":") + 1)).join(", ")}${n.ids.length > 4 ? " …" : ""})`).join("; ");

export const BUILDS_PACK = "deepslate-builds";
/** The template an uploaded build is placed by. */
export const uploadTemplate = (name: string) => `deepslate:upload/${name}`;

/**
 * `build builds`, and a step of `build server`: every file in data/builds/ becomes a structure of the datapack
 * deepslate-builds in dist/server/datapacks/, and dist/builds.json says what is in it (the site reads the sizes
 * from there). A file that does not read is named and left out; the others are still built. docs/37: first
 * dist/pack-blocks.json is written from the server's jars; a build with blocks of a mod the pack does not have is left
 * out, unless its admin ticked "the missing blocks become air" at upload, and then they are written as air.
 */
export async function buildBuilds(paths: { repo: string; dist: string }, log: (s: string) => void): Promise<BuildInfo[]> {
  const from = path.join(paths.repo, "data", "builds");
  const pack = path.join(paths.dist, "server", "datapacks", BUILDS_PACK);
  const known = await packBlocks(paths.dist);
  await mkdir(paths.dist, { recursive: true });
  if (known) await writeFile(path.join(paths.dist, "pack-blocks.json"), `${JSON.stringify(known, null, 2)}\n`);
  else log("WARN builds: no server jars in dist/server/mods, so the mods a build needs are not checked");
  let names: string[] = [];
  try {
    names = (await readdir(from)).filter((n) => /\.(nbt|schem|litematic)$/.test(n)).sort();
  } catch {
    // nothing uploaded yet
  }
  await rm(pack, { recursive: true, force: true });
  const done: BuildInfo[] = [];
  const problems: Array<{ file: string; why: string }> = [];
  for (const file of names) {
    const m = /^(.+)\.(nbt|schem|litematic)$/.exec(file)!;
    const [name, format] = [m[1]!, m[2] as BuildFormat];
    if (!BUILD_NAME.test(name)) continue;
    try {
      const raw = await readFile(path.join(from, file));
      const { structure, check } = readBuild(raw, format, known);
      let bytes = format === "nbt" ? raw : writeNbt(structure);
      let airFor = 0;
      if (check.missing.length) {
        const choice = await readFile(path.join(from, `${name}.json`), "utf8").then((t) => JSON.parse(t) as BuildChoice).catch(() => ({}) as BuildChoice);
        if (!choice.allowMissing) throw new BuildError(`it has blocks of mods the pack does not have: ${missingLine(check.needs, check.missing)}. Upload it again with "the missing blocks become air" ticked, or leave it out`);
        const cut = withoutNamespaces(structure, new Set(check.missing));
        bytes = writeNbt(cut.structure);
        airFor = cut.airFor;
      }
      const out = path.join(pack, "data", "deepslate", "structure", "upload", `${name}.nbt`);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, bytes);
      done.push({ name, format, size: check.size, blocks: check.blocks, needs: check.needs, missing: check.missing, airFor });
      log(`build ${name} (${format}): ${check.size.x} by ${check.size.y} by ${check.size.z}${airFor ? `, ${airFor} blocks of missing mods made air` : ""}`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      problems.push({ file, why });
      log(`WARN build ${file} left out: ${why}`);
    }
  }
  if (done.length) await writeFile(path.join(pack, "pack.mcmeta"), `${JSON.stringify({ pack: { pack_format: PACK_FORMAT_1_21_1, description: "Deepslate Works: uploaded builds" } }, null, 2)}\n`);
  await writeFile(path.join(paths.dist, "builds.json"), `${JSON.stringify({ builds: done, problems }, null, 2)}\n`);
  if (names.length === 0) log("builds: nothing uploaded");
  return done;
}

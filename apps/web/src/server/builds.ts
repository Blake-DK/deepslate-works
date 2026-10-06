import "server-only";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILD_FORMATS, BuildError, missingLine, readBuild, type BuildCheck, type BuildFormat, type PackBlocks } from "modpack/builds";
import { P } from "@/server/modpack/lock";

// docs/34 §10: build files an admin uploads. Kept under data/builds (not in git, mounted into web and, read-only,
// into api). Nothing here is run on the site: the Modpack page's Build turns each into a structure file; Sync puts
// them into the world. docs/37: the file is read here when it is uploaded, with Build's own code, so the admin sees its
// size and the mods it needs straight away, and a build with blocks of a mod the pack does not have is refused unless
// the admin says those blocks may become air. That choice and what was found are kept beside it as <name>.json.

export const BUILDS_DIR = path.join(process.env.DATA_DIR ?? "/repo/data", "builds");
export const MAX_BUILD_BYTES = 8 * 1024 * 1024;
export const BUILD_FILE = /^([a-z0-9_]{2,24})\.(nbt|schem|litematic)$/;
/** What was found in the file at upload, and the admin's choice; absent for a file uploaded before docs/37. */
export type BuildNote = { allowMissing: boolean; check: BuildCheck; packKnown: boolean };
export type StoredBuild = { name: string; format: BuildFormat; bytes: number; at: Date; note: BuildNote | null };

/** The kind of file by its last name part: .nbt (the game's structure file), .schem (WorldEdit), .litematic (Litematica). */
export function buildFormat(filename: string): BuildFormat | null {
  const m = /\.(nbt|schem|litematic)$/i.exec(filename.trim());
  return m ? (m[1]!.toLowerCase() as BuildFormat) : null;
}

/** NBT begins with a compound tag (10), or is gzipped (1f 8b): anything else is not one of the formats. */
export const looksLikeNbt = (data: Uint8Array) => data.length > 3 && ((data[0] === 0x1f && data[1] === 0x8b) || data[0] === 0x0a);

/** dist/pack-blocks.json, which Build writes from the server's jars: the mods whose blocks the pack has. */
export async function readPackBlocks(): Promise<PackBlocks | null> {
  try {
    const v = JSON.parse(await readFile(path.join(P.dist, "pack-blocks.json"), "utf8")) as PackBlocks;
    return v && typeof v.namespaces === "object" ? v : null;
  } catch {
    return null;
  }
}

export async function storeBuild(name: string, upload: File, opts: { allowMissing?: boolean } = {}): Promise<{ ok: true; build: StoredBuild } | { ok: false; reason: string }> {
  if (!/^[a-z0-9_]{2,24}$/.test(name)) return { ok: false, reason: "The name is 2 to 24 small letters, digits or _." };
  const format = buildFormat(upload.name);
  if (!format) return { ok: false, reason: "The file must end in .litematic (Litematica), .schem (WorldEdit) or .nbt (a structure block's save, or a Create schematic). An old .schematic is not taken." };
  if (upload.size === 0 || upload.size > MAX_BUILD_BYTES) return { ok: false, reason: `The file is ${(upload.size / 1048576).toFixed(1)} MB. The most is ${MAX_BUILD_BYTES / 1048576} MB.` };
  const data = new Uint8Array(await upload.arrayBuffer());
  if (!looksLikeNbt(data)) return { ok: false, reason: "That does not look like a Minecraft build file, whatever its name says." };
  const pack = await readPackBlocks();
  let check: BuildCheck;
  try {
    check = readBuild(Buffer.from(data), format, pack).check;
  } catch (e) {
    if (e instanceof BuildError) return { ok: false, reason: `The file does not read: ${e.message}.` };
    throw e;
  }
  const allowMissing = opts.allowMissing === true;
  if (check.missing.length && !allowMissing) {
    return { ok: false, reason: `Not uploaded: it has blocks of mods the pack does not have: ${missingLine(check.needs, check.missing)}. Tick "the missing blocks become air" to upload it anyway, with holes where they were.` };
  }
  const note: BuildNote = { allowMissing, check, packKnown: pack !== null };
  try {
    await mkdir(BUILDS_DIR, { recursive: true });
    // one build per name: an upload under a name that exists replaces it, whichever kind it was
    for (const other of BUILD_FORMATS) if (other !== format) await rm(path.join(BUILDS_DIR, `${name}.${other}`), { force: true });
    const file = path.join(BUILDS_DIR, `${name}.${format}`);
    await writeFile(`${file}.part`, data, { mode: 0o644 });
    await rename(`${file}.part`, file);
    await writeFile(path.join(BUILDS_DIR, `${name}.json`), `${JSON.stringify(note)}\n`, { mode: 0o644 });
  } catch (e) {
    return { ok: false, reason: `The file could not be saved (${e instanceof Error ? e.message : "unknown"}).` };
  }
  return { ok: true, build: { name, format, bytes: data.length, at: new Date(), note } };
}

export async function listBuilds(): Promise<StoredBuild[]> {
  try {
    const out: StoredBuild[] = [];
    for (const f of (await readdir(BUILDS_DIR)).sort()) {
      const m = BUILD_FILE.exec(f);
      if (!m) continue;
      const s = await stat(path.join(BUILDS_DIR, f));
      const note = await readFile(path.join(BUILDS_DIR, `${m[1]}.json`), "utf8").then((t) => JSON.parse(t) as BuildNote).catch(() => null);
      out.push({ name: m[1]!, format: m[2] as BuildFormat, bytes: s.size, at: s.mtime, note: note?.check ? note : null });
    }
    return out;
  } catch {
    return [];
  }
}

export async function removeBuild(name: string): Promise<boolean> {
  if (!/^[a-z0-9_]{2,24}$/.test(name)) return false;
  let gone = false;
  for (const format of BUILD_FORMATS) {
    try {
      await rm(path.join(BUILDS_DIR, `${name}.${format}`));
      gone = true;
    } catch {
      // not that kind
    }
  }
  await rm(path.join(BUILDS_DIR, `${name}.json`), { force: true });
  return gone;
}

import "server-only";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// docs/34 §10: build files an admin uploads. Kept under data/builds (not in git, mounted into web and, read-only,
// into api). Nothing here is run or unpacked on the site: the Modpack page's Build reads them, turns each into a
// structure file and says which did not read; Sync puts them into the world.

export const BUILDS_DIR = path.join(process.env.DATA_DIR ?? "/repo/data", "builds");
export const MAX_BUILD_BYTES = 8 * 1024 * 1024;
export const BUILD_FILE = /^([a-z0-9_]{2,24})\.(nbt|schem)$/;
export type StoredBuild = { name: string; format: "nbt" | "schem"; bytes: number; at: Date };

/** The kind of file by its last name part: ".nbt" (the game's structure file) or ".schem" (WorldEdit). */
export function buildFormat(filename: string): "nbt" | "schem" | null {
  const m = /\.(nbt|schem)$/i.exec(filename.trim());
  return m ? (m[1]!.toLowerCase() as "nbt" | "schem") : null;
}

/** NBT begins with a compound tag (10), or is gzipped (1f 8b): anything else is not one of the two formats. */
export const looksLikeNbt = (data: Uint8Array) => data.length > 3 && ((data[0] === 0x1f && data[1] === 0x8b) || data[0] === 0x0a);

export async function storeBuild(name: string, upload: File): Promise<{ ok: true; build: StoredBuild } | { ok: false; reason: string }> {
  if (!/^[a-z0-9_]{2,24}$/.test(name)) return { ok: false, reason: "The name is 2 to 24 small letters, digits or _." };
  const format = buildFormat(upload.name);
  if (!format) return { ok: false, reason: "The file must end in .nbt (a structure block's save, or a Create schematic) or .schem (WorldEdit). A .litematic or an old .schematic is not taken." };
  if (upload.size === 0 || upload.size > MAX_BUILD_BYTES) return { ok: false, reason: `The file is ${(upload.size / 1048576).toFixed(1)} MB. The most is ${MAX_BUILD_BYTES / 1048576} MB.` };
  const data = new Uint8Array(await upload.arrayBuffer());
  if (!looksLikeNbt(data)) return { ok: false, reason: "That does not look like a Minecraft build file, whatever its name says." };
  try {
    await mkdir(BUILDS_DIR, { recursive: true });
    // one build per name: an upload under a name that exists replaces it, whichever kind it was
    for (const other of ["nbt", "schem"]) if (other !== format) await rm(path.join(BUILDS_DIR, `${name}.${other}`), { force: true });
    const file = path.join(BUILDS_DIR, `${name}.${format}`);
    await writeFile(`${file}.part`, data, { mode: 0o644 });
    await rename(`${file}.part`, file);
  } catch (e) {
    return { ok: false, reason: `The file could not be saved (${e instanceof Error ? e.message : "unknown"}).` };
  }
  return { ok: true, build: { name, format, bytes: data.length, at: new Date() } };
}

export async function listBuilds(): Promise<StoredBuild[]> {
  try {
    const out: StoredBuild[] = [];
    for (const f of (await readdir(BUILDS_DIR)).sort()) {
      const m = BUILD_FILE.exec(f);
      if (!m) continue;
      const s = await stat(path.join(BUILDS_DIR, f));
      out.push({ name: m[1]!, format: m[2] as "nbt" | "schem", bytes: s.size, at: s.mtime });
    }
    return out;
  } catch {
    return [];
  }
}

export async function removeBuild(name: string): Promise<boolean> {
  if (!/^[a-z0-9_]{2,24}$/.test(name)) return false;
  let gone = false;
  for (const format of ["nbt", "schem"]) {
    try {
      await rm(path.join(BUILDS_DIR, `${name}.${format}`));
      gone = true;
    } catch {
      // not that kind
    }
  }
  return gone;
}

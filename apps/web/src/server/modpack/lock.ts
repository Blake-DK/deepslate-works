import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LockFile } from "modpack";
import { modpackPaths } from "modpack/paths";

export const P = modpackPaths(process.env.MODPACK_DIR);

let cache: { mtimeMs: number; lock: LockFile } | null = null;

export async function getLock(): Promise<LockFile | null> {
  try {
    const { mtimeMs } = await stat(P.lock);
    if (cache && cache.mtimeMs === mtimeMs) return cache.lock;
    const lock = JSON.parse(await readFile(P.lock, "utf8")) as LockFile;
    cache = { mtimeMs, lock };
    return lock;
  } catch {
    return null;
  }
}

export async function distFile(name: string): Promise<{ file: string; size: number; mtime: Date } | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const file = path.join(P.dist, name);
  try {
    const s = await stat(file);
    return s.isFile() ? { file, size: s.size, mtime: s.mtime } : null;
  } catch {
    return null;
  }
}

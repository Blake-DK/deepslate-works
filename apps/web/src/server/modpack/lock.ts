import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LockFile } from "modpack";
import { modpackPaths } from "modpack/paths";
import { installerInfo, type InstallerInfo } from "@/lib/installer-info";

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

let installerCache: { key: string; sha256: string } | null = null;

/** The installer the site hands out: its version and the checksum of `installer.zip` as it is on disk now. */
export async function getInstaller(): Promise<InstallerInfo | null> {
  const zip = await distFile("installer.zip");
  if (!zip) return null;
  try {
    const key = `${zip.size}:${zip.mtime.getTime()}`;
    if (installerCache?.key !== key) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(zip.file)) hash.update(chunk as Buffer);
      installerCache = { key, sha256: hash.digest("hex") };
    }
    const sidecar: unknown = JSON.parse(await readFile(path.join(P.dist, "installer.json"), "utf8"));
    return installerInfo(sidecar, { sha256: installerCache.sha256, size: zip.size });
  } catch {
    return null;
  }
}

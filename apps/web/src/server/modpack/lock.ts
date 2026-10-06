import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LockFile } from "modpack";
import { modpackPaths } from "modpack/paths";
import { installerInfo, type InstallerInfo } from "@/shared/installer-info";

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

const hashCache = new Map<string, { key: string; sha256: string }>();

/** SHA-256 and size of a file in dist/ as it is on disk now (worked out again only when it changes). */
async function distSum(name: string): Promise<{ sha256: string; size: number } | null> {
  const f = await distFile(name);
  if (!f) return null;
  const key = `${f.size}:${f.mtime.getTime()}`;
  let c = hashCache.get(name);
  if (c?.key !== key) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(f.file)) hash.update(chunk as Buffer);
    c = { key, sha256: hash.digest("hex") };
    hashCache.set(name, c);
  }
  return { sha256: c.sha256, size: f.size };
}

/** The installer the site hands out: its version and the checksums of `installer.zip`, `DeepslateWorks.ps1` and (3.0) `DeepslateWorks.exe` as they are on disk now. */
export async function getInstaller(): Promise<InstallerInfo | null> {
  try {
    const [zip, script, exe] = await Promise.all([distSum("installer.zip"), distSum("DeepslateWorks.ps1"), distSum("DeepslateWorks.exe")]);
    if (!zip) return null;
    const sidecar: unknown = JSON.parse(await readFile(path.join(P.dist, "installer.json"), "utf8"));
    return installerInfo(sidecar, zip, script, exe);
  } catch {
    return null;
  }
}

/** Extra id → name, from modpack/extras.lock.json (the app's Extras tab), for the one-line extras summary. */
export async function getExtraNames(): Promise<Record<string, string>> {
  try {
    const lock = JSON.parse(await readFile(P.extrasLock, "utf8")) as { extras: Array<{ id: string; name: string }> };
    return Object.fromEntries(lock.extras.map((x) => [x.id, x.name]));
  } catch {
    return {};
  }
}

import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { LockFile } from "modpack";
import { PRIVATE_JAR, privateJarOf } from "modpack/mod-url";
import { P } from "./lock";

// docs/58: a mod's private jar (a patched build, never published) is handed out by the site itself, behind the same
// gate as the mod list: /downloads/mods/<filename>, from data/private-jars/. The addresses: lib/private-jar-urls.ts.

export type PrivateJar = { ok: true; file: string; size: number; mtime: Date; version: string } | { ok: false; why: "not_in_lock" | "missing" | "other" };

const sums = new Map<string, { key: string; sha512: string }>();

/** sha512 of a file, worked out again only when its size or time changes. */
async function sha512Of(file: string, size: number, mtime: Date): Promise<string> {
  const key = `${size}:${mtime.getTime()}`;
  const hit = sums.get(file);
  if (hit?.key === key) return hit.sha512;
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  const sha512 = hash.digest("hex");
  sums.set(file, { key, sha512 });
  return sha512;
}

/**
 * The private jar `name` as this site may hand it out: named in `lock` (the pack this server ships) as a private jar,
 * in `dir`, and the very file the lock names. Anything else is not served.
 */
export async function privateJar(lock: Pick<LockFile, "files"> | null, name: string, dir = P.privateJars): Promise<PrivateJar> {
  if (!PRIVATE_JAR.test(name)) return { ok: false, why: "not_in_lock" };
  const entry = lock?.files.find((f) => f.filename === name && privateJarOf(f.url) === name);
  if (!entry) return { ok: false, why: "not_in_lock" };
  const file = path.join(dir, name);
  const s = await stat(file).catch(() => null);
  if (!s?.isFile()) return { ok: false, why: "missing" };
  if ((await sha512Of(file, s.size, s.mtime)) !== entry.sha512) return { ok: false, why: "other" };
  return { ok: true, file, size: s.size, mtime: s.mtime, version: entry.versionNumber };
}

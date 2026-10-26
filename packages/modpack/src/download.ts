import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LockEntry } from "./lock";
import { modUrlProblem, privateJarOf } from "./mod-url";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hashes in chunks: a jar is never held in memory whole (the build runs under a small memory cap). */
export async function sha512File(file: string): Promise<string | null> {
  try {
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/**
 * Downloads to `dest` unless it already exists with the right sha512. Streamed to a temp file, hashed on the way,
 * renamed; 3 tries. A private jar (docs/58) is never downloaded: it is copied from `privateDir`, and only when it is
 * the very file the lock names.
 */
export async function fetchJar(entry: Pick<LockEntry, "url" | "filename" | "sha512" | "size">, dest: string, log: (m: string) => void = () => {}, opts: { privateDir?: string } = {}): Promise<"cached" | "downloaded"> {
  // before the cache too: a jar already on disk under a foreign address's name is no better
  const bad = modUrlProblem(entry.url);
  if (bad) throw new Error(`${entry.filename}: ${bad}`);
  if ((await sha512File(dest)) === entry.sha512) return "cached";
  if (privateJarOf(entry.url)) {
    await copyPrivateJar(entry, dest, opts.privateDir);
    log(`copied ${entry.filename} from the private jars (${(entry.size / 1048576).toFixed(1)} MB)`);
    return "downloaded";
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(entry.url, { signal: AbortSignal.timeout(120000), headers: { "user-agent": process.env.MODRINTH_USER_AGENT ?? "deepslate-works/0.1" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("empty response");
      const hash = createHash("sha512");
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(tmp));
      if (hash.digest("hex") !== entry.sha512) throw new Error("sha512 mismatch");
      await rename(tmp, dest);
      log(`downloaded ${entry.filename} (${(size / 1048576).toFixed(1)} MB)`);
      return "downloaded";
    } catch (e) {
      lastErr = e;
      await rm(tmp, { force: true });
      if (attempt < 2) await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`${entry.filename}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** docs/58: the private jar the lock names, from `dir`, checked before and after the copy. Missing or other: an error that says so. */
async function copyPrivateJar(entry: Pick<LockEntry, "url" | "filename" | "sha512" | "size">, dest: string, dir: string | undefined): Promise<void> {
  const name = privateJarOf(entry.url);
  if (!name || name !== entry.filename) throw new Error(`${entry.filename}: the lock's address names another file (${entry.url})`);
  if (!dir) throw new Error(`${name}: a private jar (docs/58), and no folder of private jars was given`);
  const src = path.join(dir, name);
  const sum = await sha512File(src);
  if (sum === null) throw new Error(`${name}: not in ${dir}. A private jar is put there by hand (docs/58); Build cannot fetch it`);
  if (sum !== entry.sha512) throw new Error(`${name}: the file in ${dir} is not the one the lock names (sha512 ${sum.slice(0, 16)}…, the lock says ${entry.sha512.slice(0, 16)}…)`);
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  try {
    await copyFile(src, tmp);
    if ((await sha512File(tmp)) !== entry.sha512) throw new Error(`${name}: changed while it was copied`);
    await rename(tmp, dest);
  } finally {
    await rm(tmp, { force: true });
  }
}

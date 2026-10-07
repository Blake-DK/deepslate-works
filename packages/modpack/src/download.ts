import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LockEntry } from "./lock";
import { modUrlProblem } from "./mod-url";

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

/** Downloads to `dest` unless it already exists with the right sha512. Streamed to a temp file, hashed on the way, renamed; 3 tries. */
export async function fetchJar(entry: LockEntry, dest: string, log: (m: string) => void = () => {}): Promise<"cached" | "downloaded"> {
  // before the cache too: a jar already on disk under a foreign address's name is no better
  const bad = modUrlProblem(entry.url);
  if (bad) throw new Error(`${entry.filename}: ${bad}`);
  if ((await sha512File(dest)) === entry.sha512) return "cached";
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

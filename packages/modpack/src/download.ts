import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LockEntry } from "./lock";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sha512File(file: string): Promise<string | null> {
  try {
    return createHash("sha512").update(await readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

/** Downloads to `dest` unless it already exists with the right sha512. Temp file + rename, 3 tries. */
export async function fetchJar(entry: LockEntry, dest: string, log: (m: string) => void = () => {}): Promise<"cached" | "downloaded"> {
  if ((await sha512File(dest)) === entry.sha512) return "cached";
  await mkdir(path.dirname(dest), { recursive: true });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(entry.url, { signal: AbortSignal.timeout(120000), headers: { "user-agent": process.env.MODRINTH_USER_AGENT ?? "deepslate-works/0.1" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = createHash("sha512").update(buf).digest("hex");
      if (got !== entry.sha512) throw new Error("sha512 mismatch");
      const tmp = `${dest}.part`;
      await writeFile(tmp, buf);
      await rename(tmp, dest);
      log(`downloaded ${entry.filename} (${(buf.length / 1048576).toFixed(1)} MB)`);
      return "downloaded";
    } catch (e) {
      lastErr = e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`${entry.filename}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

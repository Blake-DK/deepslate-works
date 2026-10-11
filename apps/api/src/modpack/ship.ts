import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// docs/44: one mods.json and one lock for both servers; a season's mods go only to a server that ships that season.
// The same rule as packages/modpack (lock.ts `shippedLock`, seasons.ts `shipFor`), which api does not import; the
// test in tests/pack-ship.test.ts holds the two to the same answer on the repo's own lock.

type Entry = { slug: string; versionId: string; season?: string; [k: string]: unknown };
export type ShippedLock = { neoforge: string; hash: string; files: Entry[]; configs: Array<{ path: string; sha256: string }>; resourcepack?: string; [k: string]: unknown };

const ID = /^[a-z0-9_]{1,32}$/;

/** index.json's `ship`, except on the test server (TEST_MODE=1), where SEASONS_SHIP replaces it when set. */
export function shipFor(indexShip: string[], env: Readonly<Record<string, string | undefined>>): string[] {
  const raw = env.SEASONS_SHIP?.trim();
  return env.TEST_MODE === "1" && raw ? [...new Set(raw.split(/[\s,]+/).filter((id) => ID.test(id)))] : indexShip;
}

/** The pack's hash over these files, as `modpack lock` makes it (packages/modpack lock.ts `packHash`). */
export function packHash(lock: Pick<ShippedLock, "neoforge" | "configs" | "resourcepack">, files: Array<Pick<Entry, "slug" | "versionId">>): string {
  return createHash("sha256").update([lock.neoforge, ...files.map((f) => `${f.slug}@${f.versionId}`), ...lock.configs.map((c) => `config:${c.path}@${c.sha256}`), ...(lock.resourcepack ? [`resourcepack@${lock.resourcepack}`] : [])].join("\n")).digest("hex");
}

/** The lock as a server shipping `ship` has it: the other seasons' files out, and the hash over what is left. */
export function shippedLock(lock: ShippedLock, ship: readonly string[]): ShippedLock {
  const files = lock.files.filter((f) => !f.season || ship.includes(f.season));
  return files.length === lock.files.length ? lock : { ...lock, files, hash: packHash(lock, files) };
}

/** modpack/mods.lock.json of a checkout as its server ships it; throws when the lock cannot be read. */
export async function readShippedLock(repoDir: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<ShippedLock> {
  const dir = path.join(repoDir, "modpack");
  const lock = JSON.parse(await readFile(path.join(dir, "mods.lock.json"), "utf8")) as ShippedLock;
  let ship: string[] = [];
  try {
    const index = JSON.parse(await readFile(path.join(dir, "seasons", "index.json"), "utf8")) as { ship?: unknown };
    if (Array.isArray(index.ship)) ship = index.ship.filter((x): x is string => typeof x === "string" && ID.test(x));
  } catch {
    // no index: nothing ships
  }
  return shippedLock(lock, shipFor(ship, env));
}

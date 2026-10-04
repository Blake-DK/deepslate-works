import { readFile } from "node:fs/promises";
import path from "node:path";
import { seasonFileSchema, seasonIndexFileSchema, type SeasonFile } from "../shared/season.js";

// docs/34 §4: api reads the season files from its read-only mount of the repo's modpack/ folder. Which season is the
// current one is index.json's `current`. The files are linted in CI (packages/modpack), so a file that does not
// read here is a fault to say in the log, not to work around.

export const seasonsDir = (repoDir: string) => path.join(repoDir, "modpack", "seasons");

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

/** One season's file, or null when it is not there or does not read. */
export async function readSeasonFile(dir: string, id: string): Promise<SeasonFile | null> {
  if (!/^[a-z0-9_]{1,32}$/.test(id)) return null;
  try {
    const parsed = seasonFileSchema.safeParse(await json(path.join(dir, `${id}.json`)));
    return parsed.success && parsed.data.id === id ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The id index.json names as current, or null. */
export async function currentSeasonId(dir: string): Promise<string | null> {
  try {
    const parsed = seasonIndexFileSchema.safeParse(await json(path.join(dir, "index.json")));
    return parsed.success ? parsed.data.current : null;
  } catch {
    return null;
  }
}

/** The current season's file, read again at most once a minute (a commit changes it; nothing restarts for that). */
export function currentSeason(repoDir: string, log: (o: unknown, m: string) => void, now = () => Date.now()): () => Promise<SeasonFile | null> {
  let held: { at: number; file: SeasonFile | null } | null = null;
  return async () => {
    if (held && now() - held.at < 60_000) return held.file;
    const dir = seasonsDir(repoDir);
    const id = await currentSeasonId(dir);
    const file = id ? await readSeasonFile(dir, id) : null;
    if (id && !file) log({ id }, "the current season's file is missing or does not read");
    held = { at: now(), file };
    return file;
  };
}

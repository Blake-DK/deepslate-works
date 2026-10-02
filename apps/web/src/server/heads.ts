import "server-only";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { HEAD_FETCH_TIMEOUT_MS, headUrl, isFresh, isHeadPng } from "@/lib/heads";

// docs/21 §7: players' heads for the app's "who's online", fetched from Crafatar once a day per player and kept under
// data/heads (not in git, mounted into web like data/news). Any failure answers the last head we had, or the grey
// placeholder; the app never waits on Crafatar and never talks to it itself.

export const HEADS_DIR = path.join(process.env.DATA_DIR ?? "/repo/data", "heads");

/** branding/launcher/head-placeholder.png (make-art.py), 24x24; tests/heads.test.ts checks the two are the same bytes. */
export const HEAD_PLACEHOLDER = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAdklEQVR42mPUNjBnoAZgYqASoJpBLHCWvKIKhPHl8yfi9b9982rwe40kHw2tWIODe7evQxhKqprESw0Jr+kZoec+eIRi+mhoeQ3ukaePH6BJScsqQBjfvn0dQl6Du5aLixvNI5hqxMQlIYyH9+8MVq8xDt/CHwCiOyXtUbnQmAAAAABJRU5ErkJggg==", "base64"));

export type Head = { data: Uint8Array; source: "cache" | "fetched" | "stale" | "placeholder" };
type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;
export type HeadOptions = { dir?: string; fetch?: Fetch; now?: () => number };

const inFlight = new Map<string, Promise<Head>>();
const failedAt = new Map<string, number>();
/** After a failed fetch a player's head is not asked for again for this long (Crafatar down, or slow). */
export const HEAD_RETRY_MS = 10 * 60 * 1000;

/** The head of a member (dashed UUID), or the placeholder for null. One fetch at a time per player. */
export function headFor(uuid: string | null, o: HeadOptions = {}): Promise<Head> {
  if (!uuid) return Promise.resolve({ data: HEAD_PLACEHOLDER, source: "placeholder" });
  const dir = o.dir ?? HEADS_DIR;
  const key = `${dir}|${uuid}`;
  const running = inFlight.get(key);
  if (running) return running;
  const p = load(uuid, dir, o.fetch ?? fetch, o.now ?? Date.now).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function load(uuid: string, dir: string, get: Fetch, now: () => number): Promise<Head> {
  const file = path.join(dir, `${uuid}.png`);
  const kept = await readKept(file);
  if (kept && isFresh(kept.at, now())) return { data: kept.data, source: "cache" };
  const key = `${dir}|${uuid}`;
  const failed = failedAt.get(key);
  if (failed !== undefined && now() - failed < HEAD_RETRY_MS) return kept ? { data: kept.data, source: "stale" } : { data: HEAD_PLACEHOLDER, source: "placeholder" };
  try {
    const res = await get(headUrl(uuid), { signal: AbortSignal.timeout(HEAD_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Crafatar answered ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    if (!isHeadPng(data)) throw new Error("Crafatar's answer is not a 24 px PNG");
    await mkdir(dir, { recursive: true });
    await writeFile(`${file}.part`, data, { mode: 0o644 });
    await rename(`${file}.part`, file);
    failedAt.delete(key);
    return { data, source: "fetched" };
  } catch (e) {
    failedAt.set(key, now());
    console.warn(`head ${uuid}: ${e instanceof Error ? e.message : "failed"}${kept ? "; the last one is kept" : "; the placeholder for now"}`);
    return kept ? { data: kept.data, source: "stale" } : { data: HEAD_PLACEHOLDER, source: "placeholder" };
  }
}

async function readKept(file: string): Promise<{ data: Uint8Array; at: number } | null> {
  try {
    const [data, s] = await Promise.all([readFile(file), stat(file)]);
    const bytes = new Uint8Array(data);
    return isHeadPng(bytes) ? { data: bytes, at: s.mtimeMs } : null;
  } catch {
    return null;
  }
}

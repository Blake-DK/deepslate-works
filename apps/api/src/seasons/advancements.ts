import type { Amp } from "../amp/client.js";
import { chunks } from "../files/browse.js";

// docs/34 §4, the safety net: the game's own record of a player's advancements, world/advancements/<uuid>.json, read
// through AMP's file manager as the inventory reader reads world/playerdata. What the console tail missed (api was
// restarting, the line was cut) is found here, with the time the game wrote.
//
//   { "deepslate:s1/boss/frostmaw": { "criteria": { "kill": "2026-11-30 19:22:11 +0000" }, "done": true }, "DataVersion": 3955 }

const DIR = "world/advancements";
// A long-time player's file on this pack passes 2 MB (every recipe and every mod's advancements are in it).
const MAX_BYTES = 8 * 1024 * 1024;
type Log = (o: unknown, m: string) => void;
/** Where the too-large line goes when the caller gives no log: stderr, in the form api's own log has (as audit.ts does). */
const stderr: Log = (o, m) => console.error(JSON.stringify({ level: 40, msg: m, ...(o as Record<string, unknown>) }));
/** Files already said to be too large, so the safety net's pass every ten minutes says it once. */
const tooLarge = new Set<string>();
type AmpEntry = { IsDirectory?: boolean; Filename?: string; SizeBytes?: number };

/** "2026-11-30 19:22:11 +0000" (the game's form) as an instant; null when it is not that. */
export function gameTime(raw: unknown): Date | null {
  const m = typeof raw === "string" ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(raw) : null;
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** When the advancement `key` was completed according to a player's file, or null when it is not done. */
export function doneAt(file: unknown, key: string): Date | null {
  if (!file || typeof file !== "object") return null;
  const entry = (file as Record<string, unknown>)[key];
  if (!entry || typeof entry !== "object" || (entry as { done?: unknown }).done !== true) return null;
  const criteria = (entry as { criteria?: unknown }).criteria;
  const times = criteria && typeof criteria === "object" ? Object.values(criteria).map(gameTime).filter((d): d is Date => d !== null) : [];
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((d) => d.getTime())));
}

/** The advancement of a season's boss or trial, as build seasons names it. */
export const advancementKey = (seasonId: string, kind: "boss" | "trial", itemId: string) => `deepslate:${seasonId}/${kind}/${itemId}`;

/** Which players have an advancements file, by dashed lower-case UUID, with its size. Null when AMP cannot say. */
export async function listAdvancementFiles(amp: Amp): Promise<Map<string, number> | null> {
  const listing = await amp.call<AmpEntry[] | { Title?: string }>("FileManagerPlugin", "GetDirectoryListing", { Dir: DIR }).catch(() => null);
  if (!Array.isArray(listing)) return null;
  const out = new Map<string, number>();
  for (const e of listing) {
    const m = !e.IsDirectory ? /^([0-9a-f-]{36})\.json$/i.exec(e.Filename ?? "") : null;
    if (m) out.set(m[1]!.toLowerCase(), Math.max(0, Number(e.SizeBytes) || 0));
  }
  return out;
}

/** One player's advancements file as data, or null when it cannot be read. */
export async function readAdvancements(amp: Amp, uuid: string, size: number, log: Log = stderr): Promise<unknown> {
  if (!/^[0-9a-f-]{36}$/.test(uuid) || size <= 0) return null;
  if (size > MAX_BYTES) {
    // not read: the season's safety net cannot see this player's clears, and somebody has to know
    if (!tooLarge.has(uuid)) log({ uuid, size, max: MAX_BYTES }, "season: a player's advancements file is too large to read; the safety net skips it");
    tooLarge.add(uuid);
    return null;
  }
  try {
    const parts: Buffer[] = [];
    for await (const c of chunks(amp, `${DIR}/${uuid}.json`, size, MAX_BYTES)) parts.push(c);
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

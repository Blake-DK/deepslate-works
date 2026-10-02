import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "../db.js";

// docs/14 "Play first": which pack the server runs. Written down at every sync (Setting "_packSynced"), because
// what is built and what has been synced are not the same thing between a Build and the Sync that follows it.

const DIST_SERVER = process.env.DIST_SERVER_DIR ?? "/repo/dist/server";
export const SYNCED_KEY = "_packSynced";

async function built(): Promise<string | null> {
  try {
    const v = (await readFile(path.join(DIST_SERVER, "PACK_VERSION"), "utf8")).trim();
    return /^[0-9A-Za-z.+_-]{1,60}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

const LOCK = path.join(process.env.REPO_DIR ?? "/repo", "modpack", "mods.lock.json");

/** The mods of the locked pack, slug → Modrinth version id; null when the lock cannot be read. */
async function lockedMods(): Promise<Record<string, string> | null> {
  try {
    const lock = JSON.parse(await readFile(LOCK, "utf8")) as { files?: Array<{ slug?: unknown; versionId?: unknown }> };
    const out: Record<string, string> = {};
    for (const f of lock.files ?? []) if (typeof f.slug === "string" && typeof f.versionId === "string") out[f.slug] = f.versionId;
    return out;
  } catch {
    return null;
  }
}

/** Mods added, removed or at another version between two locks (docs/21 "New pack: 3 mods changed"). */
export function modsChanged(before: Record<string, string>, after: Record<string, string>): number {
  let n = 0;
  for (const slug of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[slug] !== after[slug]) n++;
  return n;
}

export async function recordSynced(): Promise<string | null> {
  const version = await built();
  if (!version) return null;
  const before = (await db.setting.findUnique({ where: { key: SYNCED_KEY } }).catch(() => null))?.value as { version?: unknown; mods?: unknown } | null;
  const mods = await lockedMods();
  const prevMods = before?.mods && typeof before.mods === "object" ? (before.mods as Record<string, string>) : null;
  const previous = typeof before?.version === "string" ? before.version : null;
  // what the Discord feed says about it ("New pack: 3 mods changed"); a sync of the same version changed nothing
  const change = previous !== version ? { previous, changed: mods && prevMods ? modsChanged(prevMods, mods) : null } : { previous: version, changed: 0 };
  const value = { version, at: new Date().toISOString(), ...change, ...(mods ? { mods } : {}) } as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key: SYNCED_KEY }, create: { key: SYNCED_KEY, value }, update: { value } });
  return version;
}

/** The pack last synced to the server; null when nothing says (then a member's pack is not looked at). */
export async function serverPack(): Promise<string | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: SYNCED_KEY } });
    const v = (row?.value as { version?: unknown } | null)?.version;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

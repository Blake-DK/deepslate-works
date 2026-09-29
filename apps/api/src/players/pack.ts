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

export async function recordSynced(): Promise<string | null> {
  const version = await built();
  if (!version) return null;
  const value = { version, at: new Date().toISOString() } as Prisma.InputJsonValue;
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

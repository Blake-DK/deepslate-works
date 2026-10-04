import { db } from "../db.js";
import type { Back } from "./limbo.js";

// docs/31 B-02 to B-04: the entrance room's memory, in the database (table HeldPlayer). The room works without it
// (as it did before: from memory alone), so every call here swallows a database fault and says so in the log.

export type HeldRow = { mcUuid: string; mcUsername: string; since: Date; reason: string; codeId: string | null; back: Back | null };

export interface HeldStore {
  get(uuid: string): Promise<HeldRow | null>;
  /** For a name whose UUID is not in memory (after a restart of api). */
  byName(name: string): Promise<HeldRow | null>;
  put(row: HeldRow): Promise<void>;
  remove(uuid: string): Promise<void>;
}

type DbRow = { mcUuid: string; mcUsername: string; since: Date; reason: string; codeId: string | null; backDim: string | null; backX: number | null; backY: number | null; backZ: number | null };

const toRow = (r: DbRow): HeldRow => ({
  mcUuid: r.mcUuid, mcUsername: r.mcUsername, since: r.since, reason: r.reason, codeId: r.codeId,
  back: r.backDim !== null && r.backX !== null && r.backY !== null && r.backZ !== null ? { dimension: r.backDim, x: r.backX, y: r.backY, z: r.backZ } : null,
});

export function prismaHeldStore(log: (o: unknown, m: string) => void): HeldStore {
  const safe = async <T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      log({ err: String(err) }, `held players: ${what} failed; carrying on from memory`);
      return fallback;
    }
  };
  return {
    get: (uuid) => safe("read", null, async () => { const r = await db.heldPlayer.findUnique({ where: { mcUuid: uuid } }); return r ? toRow(r) : null; }),
    byName: (name) => safe("read by name", null, async () => { const r = await db.heldPlayer.findFirst({ where: { mcUsername: { equals: name, mode: "insensitive" } }, orderBy: { since: "desc" } }); return r ? toRow(r) : null; }),
    put: (row) => safe("write", undefined, async () => {
      const data = { mcUsername: row.mcUsername, since: row.since, reason: row.reason, codeId: row.codeId, backDim: row.back?.dimension ?? null, backX: row.back?.x ?? null, backY: row.back?.y ?? null, backZ: row.back?.z ?? null };
      await db.heldPlayer.upsert({ where: { mcUuid: row.mcUuid }, create: { mcUuid: row.mcUuid, ...data }, update: data });
    }),
    remove: (uuid) => safe("delete", undefined, async () => { await db.heldPlayer.deleteMany({ where: { mcUuid: uuid } }); }),
  };
}

/** For tests, and for a room that should remember nothing. */
export function memoryHeldStore(): HeldStore & { rows: Map<string, HeldRow> } {
  const rows = new Map<string, HeldRow>();
  return {
    rows,
    get: async (uuid) => rows.get(uuid) ?? null,
    byName: async (name) => [...rows.values()].find((r) => r.mcUsername.toLowerCase() === name.toLowerCase()) ?? null,
    put: async (row) => void rows.set(row.mcUuid, row),
    remove: async (uuid) => void rows.delete(uuid),
  };
}

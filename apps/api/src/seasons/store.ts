import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import type { Clear, ClearKind, SeasonState } from "../shared/season.js";

// docs/34 §4: the Season and SeasonClear tables, behind an interface so the recorder is tested without a database.

/** What the clock has already said, so nothing is said twice (and a restart of api says nothing again). */
export type Marks = { done?: string[]; leader?: string | null; leaderAt?: string | null };
export type SeasonRow = { id: string; name: string; startsAt: Date; endsAt: Date; state: SeasonState; marks: Marks; result: unknown };
export type ClearSource = "console" | "file" | "admin";
export type NewClear = { kind: ClearKind; itemId: string; mcUuid: string; mcName: string; userId: string | null; at: Date; early: boolean; source: ClearSource };

export interface SeasonStore {
  season(id: string): Promise<SeasonRow | null>;
  /**
   * Adds the clears of ONE boss or trial that are not there yet. `first` is decided here, under a lock: true for
   * everybody in the call when nobody had that item before, so two kills in the same second cannot both be first,
   * and a group that kills together shares it.
   */
  addClears(seasonId: string, clears: NewClear[]): Promise<{ added: NewClear[]; first: boolean }>;
  clears(seasonId: string): Promise<Clear[]>;
  /** Puts a mark. False when it was there already. */
  mark(seasonId: string, key: string): Promise<boolean>;
  setLeader(seasonId: string, mcUuid: string, at: Date): Promise<void>;
  /** Linked members: whose advancement files are read. */
  linked(): Promise<Array<{ mcUuid: string; mcName: string; userId: string }>>;
  userIdByUuid(uuid: string): Promise<string | null>;
}

const STATES = ["upcoming", "running", "ended"];
const marksOf = (v: unknown): Marks => (v && typeof v === "object" && !Array.isArray(v) ? (v as Marks) : {});

type Tx = Prisma.TransactionClient;
/** One at a time per key, until the transaction ends. (`::text`: the driver cannot read the function's void.) */
const lock = (tx: Tx, key: string) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;

export const prismaSeasonStore: SeasonStore = {
  async season(id) {
    const r = await db.season.findUnique({ where: { id } });
    if (!r) return null;
    return { id: r.id, name: r.name, startsAt: r.startsAt, endsAt: r.endsAt, state: (STATES.includes(r.state) ? r.state : "upcoming") as SeasonState, marks: marksOf(r.marks), result: r.resultJson };
  },
  async addClears(seasonId, clears) {
    const one = clears[0];
    if (!one) return { added: [], first: false };
    return db.$transaction(async (tx) => {
      await lock(tx, `season:${seasonId}:${one.kind}:${one.itemId}`);
      const have = new Set((await tx.seasonClear.findMany({ where: { seasonId, kind: one.kind, itemId: one.itemId }, select: { mcUuid: true } })).map((r) => r.mcUuid));
      const first = have.size === 0;
      const added: NewClear[] = [];
      for (const c of clears) {
        if (c.kind !== one.kind || c.itemId !== one.itemId || have.has(c.mcUuid)) continue;
        have.add(c.mcUuid);
        await tx.seasonClear.create({ data: { seasonId, kind: c.kind, itemId: c.itemId, mcUuid: c.mcUuid, mcName: c.mcName, userId: c.userId, at: c.at, first, early: c.early, source: c.source } });
        added.push(c);
      }
      return { added, first };
    });
  },
  async clears(seasonId) {
    const rows = await db.seasonClear.findMany({ where: { seasonId }, orderBy: { at: "asc" }, select: { kind: true, itemId: true, mcUuid: true, mcName: true, at: true, first: true, early: true } });
    return rows.map((r) => ({ ...r, kind: (r.kind === "trial" ? "trial" : "boss") as ClearKind }));
  },
  async mark(seasonId, key) {
    return db.$transaction(async (tx) => {
      await lock(tx, `season:${seasonId}:marks`);
      const row = await tx.season.findUnique({ where: { id: seasonId }, select: { marks: true } });
      if (!row) return false;
      const marks = marksOf(row.marks);
      if (marks.done?.includes(key)) return false;
      await tx.season.update({ where: { id: seasonId }, data: { marks: { ...marks, done: [...(marks.done ?? []), key] } as Prisma.InputJsonValue } });
      return true;
    });
  },
  async setLeader(seasonId, mcUuid, at) {
    await db.$transaction(async (tx) => {
      await lock(tx, `season:${seasonId}:marks`);
      const row = await tx.season.findUnique({ where: { id: seasonId }, select: { marks: true } });
      if (!row) return;
      await tx.season.update({ where: { id: seasonId }, data: { marks: { ...marksOf(row.marks), leader: mcUuid, leaderAt: at.toISOString() } as Prisma.InputJsonValue } });
    });
  },
  async linked() {
    const users = await db.user.findMany({ where: { mcUuid: { not: null } }, select: { id: true, mcUuid: true, mcUsername: true } });
    return users.flatMap((u) => (u.mcUuid ? [{ mcUuid: u.mcUuid, mcName: u.mcUsername ?? u.mcUuid, userId: u.id }] : []));
  },
  async userIdByUuid(uuid) {
    return (await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true } }))?.id ?? null;
  },
};

/** For tests. `rows` is the SeasonClear table; `seasons` the Season table. */
export function memorySeasonStore(seasons: SeasonRow[] = [], members: Array<{ mcUuid: string; mcName: string; userId: string }> = []) {
  const rows: Array<NewClear & { seasonId: string; first: boolean }> = [];
  const store: SeasonStore = {
    season: async (id) => seasons.find((s) => s.id === id) ?? null,
    async addClears(seasonId, clears) {
      const one = clears[0];
      if (!one) return { added: [], first: false };
      const have = new Set(rows.filter((r) => r.seasonId === seasonId && r.kind === one.kind && r.itemId === one.itemId).map((r) => r.mcUuid));
      const first = have.size === 0;
      const added: NewClear[] = [];
      for (const c of clears) {
        if (c.kind !== one.kind || c.itemId !== one.itemId || have.has(c.mcUuid)) continue;
        have.add(c.mcUuid);
        rows.push({ ...c, seasonId, first });
        added.push(c);
      }
      return { added, first };
    },
    clears: async (seasonId) => rows.filter((r) => r.seasonId === seasonId).map((r) => ({ kind: r.kind, itemId: r.itemId, mcUuid: r.mcUuid, mcName: r.mcName, at: r.at, first: r.first, early: r.early })),
    async mark(seasonId, key) {
      const s = seasons.find((x) => x.id === seasonId);
      if (!s || s.marks.done?.includes(key)) return false;
      s.marks = { ...s.marks, done: [...(s.marks.done ?? []), key] };
      return true;
    },
    async setLeader(seasonId, mcUuid, at) {
      const s = seasons.find((x) => x.id === seasonId);
      if (s) s.marks = { ...s.marks, leader: mcUuid, leaderAt: at.toISOString() };
    },
    linked: async () => members,
    userIdByUuid: async (uuid) => members.find((m) => m.mcUuid === uuid)?.userId ?? null,
  };
  return Object.assign(store, { rows, seasons });
}

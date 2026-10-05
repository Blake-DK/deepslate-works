import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import type { Clear, ClearKind, SeasonState } from "../shared/season.js";

// docs/34 §4: the Season and SeasonClear tables, behind an interface so the recorder is tested without a database.

/** What the clock has already said, so nothing is said twice (and a restart of api says nothing again). */
export type Marks = { done?: string[]; leader?: string | null; leaderAt?: string | null; /** ticks an admin took back, "<kind>:<item>:<uuid>": the safety net leaves them alone */ revoked?: string[] };
export const clearKey = (kind: ClearKind, itemId: string, mcUuid: string) => `${kind}:${itemId}:${mcUuid}`;
export type SeasonRow = { id: string; name: string; startsAt: Date; endsAt: Date; state: SeasonState; marks: Marks; result: unknown };
export type ClearSource = "console" | "file" | "admin";
export type NewClear = { kind: ClearKind; itemId: string; mcUuid: string; mcName: string; userId: string | null; at: Date; early: boolean; source: ClearSource };
export type AddedClear = NewClear & { first: boolean };

/** How long the first clear of a boss or trial waits for the rest of the group (docs/21 §6), and how far apart two clears may be and still share "first". */
export const GROUP_MS = 5_000;

/**
 * Which of `clears` (of ONE boss or trial) are new, and which of those are first on the server. First goes by the
 * time of the kill, not by which line reached us first: a clear is first when nobody's clear of that item is more
 * than the group's five seconds older. So a group member whose kill comes later by the safety net shares it, and a
 * tick an admin gives days later does not. A row that is there already is never changed.
 */
export function decideFirst(existing: Array<{ mcUuid: string; at: Date }>, clears: NewClear[]): AddedClear[] {
  const one = clears[0];
  if (!one) return [];
  const have = new Set(existing.map((r) => r.mcUuid));
  const fresh: NewClear[] = [];
  for (const c of clears) {
    if (c.kind !== one.kind || c.itemId !== one.itemId || have.has(c.mcUuid)) continue;
    have.add(c.mcUuid);
    fresh.push(c);
  }
  const earliest = Math.min(...existing.map((r) => r.at.getTime()), ...fresh.map((c) => c.at.getTime()));
  return fresh.map((c) => ({ ...c, first: c.at.getTime() - earliest <= GROUP_MS }));
}

export interface SeasonStore {
  season(id: string): Promise<SeasonRow | null>;
  /**
   * Adds the clears of ONE boss or trial that are not there yet. `first` is decided here, under a lock, by the time
   * of each clear (`decideFirst`): a group that kills together shares it, whichever way each of their clears came.
   * The `first` beside `added` is true when every clear that was added is first.
   */
  addClears(seasonId: string, clears: NewClear[]): Promise<{ added: AddedClear[]; first: boolean }>;
  clears(seasonId: string): Promise<Clear[]>;
  /** Puts a mark. False when it was there already. */
  mark(seasonId: string, key: string): Promise<boolean>;
  setLeader(seasonId: string, mcUuid: string, at: Date): Promise<void>;
  /** Linked members: whose advancement files are read. */
  linked(): Promise<Array<{ mcUuid: string; mcName: string; userId: string }>>;
  userIdByUuid(uuid: string): Promise<string | null>;
  // ---- Admin → Seasons (W1.4)
  /** Makes the season's row, "upcoming". False when it is there already. */
  create(s: { id: string; name: string; startsAt: Date; endsAt: Date }): Promise<boolean>;
  setState(id: string, state: SeasonState): Promise<void>;
  /** The id of a season that is running, other than this one; null when there is none. */
  runningOther(id: string): Promise<string | null>;
  /** Ends the season and freezes its result. The result is written once: false when there is one already. */
  end(id: string, result: unknown): Promise<boolean>;
  /** Takes a tick back, and remembers that it was (the safety net would otherwise put it back from the game's file). */
  removeClear(seasonId: string, kind: ClearKind, itemId: string, mcUuid: string): Promise<boolean>;
  /** Forgets that a tick was taken back: an admin has given it again. */
  unrevoke(seasonId: string, key: string): Promise<void>;
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
      const added = decideFirst(await tx.seasonClear.findMany({ where: { seasonId, kind: one.kind, itemId: one.itemId }, select: { mcUuid: true, at: true } }), clears);
      for (const c of added) {
        await tx.seasonClear.create({ data: { seasonId, kind: c.kind, itemId: c.itemId, mcUuid: c.mcUuid, mcName: c.mcName, userId: c.userId, at: c.at, first: c.first, early: c.early, source: c.source } });
      }
      return { added, first: added.length > 0 && added.every((c) => c.first) };
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
  async create(s) {
    if (await db.season.findUnique({ where: { id: s.id }, select: { id: true } })) return false;
    try {
      await db.season.create({ data: { id: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, state: "upcoming" } });
    } catch (err) {
      // a double click: the other request made the row between our look and our write
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
      throw err;
    }
    return true;
  },
  async setState(id, state) {
    await db.season.update({ where: { id }, data: { state } });
  },
  async runningOther(id) {
    return (await db.season.findFirst({ where: { state: "running", NOT: { id } }, select: { id: true } }))?.id ?? null;
  },
  async end(id, result) {
    const done = await db.season.updateMany({ where: { id, resultJson: { equals: Prisma.AnyNull } }, data: { state: "ended", resultJson: result as Prisma.InputJsonValue } });
    return done.count === 1;
  },
  async removeClear(seasonId, kind, itemId, mcUuid) {
    return db.$transaction(async (tx) => {
      await lock(tx, `season:${seasonId}:marks`);
      const gone = await tx.seasonClear.deleteMany({ where: { seasonId, kind, itemId, mcUuid } });
      const row = await tx.season.findUnique({ where: { id: seasonId }, select: { marks: true } });
      if (!row) return false;
      const marks = marksOf(row.marks);
      const key = clearKey(kind, itemId, mcUuid);
      if (!marks.revoked?.includes(key)) await tx.season.update({ where: { id: seasonId }, data: { marks: { ...marks, revoked: [...(marks.revoked ?? []), key] } as Prisma.InputJsonValue } });
      return gone.count > 0;
    });
  },
  async unrevoke(seasonId, key) {
    await db.$transaction(async (tx) => {
      await lock(tx, `season:${seasonId}:marks`);
      const row = await tx.season.findUnique({ where: { id: seasonId }, select: { marks: true } });
      const marks = marksOf(row?.marks);
      if (!row || !marks.revoked?.includes(key)) return;
      await tx.season.update({ where: { id: seasonId }, data: { marks: { ...marks, revoked: marks.revoked.filter((k) => k !== key) } as Prisma.InputJsonValue } });
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
  const rows: Array<AddedClear & { seasonId: string }> = [];
  const store: SeasonStore = {
    season: async (id) => seasons.find((s) => s.id === id) ?? null,
    async addClears(seasonId, clears) {
      const one = clears[0];
      if (!one) return { added: [], first: false };
      const added = decideFirst(rows.filter((r) => r.seasonId === seasonId && r.kind === one.kind && r.itemId === one.itemId), clears);
      for (const c of added) rows.push({ ...c, seasonId });
      return { added, first: added.length > 0 && added.every((c) => c.first) };
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
    async create(s) {
      if (seasons.some((x) => x.id === s.id)) return false;
      seasons.push({ ...s, state: "upcoming", marks: {}, result: null });
      return true;
    },
    async setState(id, state) {
      const s = seasons.find((x) => x.id === id);
      if (s) s.state = state;
    },
    runningOther: async (id) => seasons.find((x) => x.state === "running" && x.id !== id)?.id ?? null,
    async end(id, result) {
      const s = seasons.find((x) => x.id === id);
      if (!s || s.result) return false;
      s.state = "ended";
      s.result = result;
      return true;
    },
    async removeClear(seasonId, kind, itemId, mcUuid) {
      const s = seasons.find((x) => x.id === seasonId);
      if (!s) return false;
      const at = rows.findIndex((r) => r.seasonId === seasonId && r.kind === kind && r.itemId === itemId && r.mcUuid === mcUuid);
      if (at >= 0) rows.splice(at, 1);
      const key = clearKey(kind, itemId, mcUuid);
      if (!s.marks.revoked?.includes(key)) s.marks = { ...s.marks, revoked: [...(s.marks.revoked ?? []), key] };
      return at >= 0;
    },
    async unrevoke(seasonId, key) {
      const s = seasons.find((x) => x.id === seasonId);
      if (s?.marks.revoked) s.marks = { ...s.marks, revoked: s.marks.revoked.filter((k) => k !== key) };
    },
  };
  return Object.assign(store, { rows, seasons });
}

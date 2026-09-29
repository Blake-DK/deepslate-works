import "server-only";
import { db } from "@/server/db";
import { rangeFor, type Range, type S } from "@/lib/analytics";

export type Person = { userId: string; displayName: string; pcTier: "LOW" | "MID" | "HIGH" | null; mcUuid: string | null; mcUsername: string | null };

export type Loaded = {
  range: Range;
  now: Date;
  sessions: S[]; // from the start of the previous window, so both windows can be worked out
  firstSeen: Map<string, Date>;
  people: Map<string, Person>; // by Minecraft UUID
  uptime: { available: number | null; running: number | null; prevAvailable: number | null };
  snapshotPeak: { now: number | null; prev: number | null };
  deaths: Array<{ actor: string; n: number }>;
};

async function uptime(from: Date, to: Date): Promise<{ available: number | null; running: number | null }> {
  // Time between two readings belongs to the earlier one; a gap of more than ten minutes is "not known"
  // (the site's backend was not watching) and counts neither way.
  const rows = await db.$queryRaw<Array<{ running: number | null; available: number | null; known: number | null }>>`
    SELECT sum(CASE WHEN state = 'Running' THEN d ELSE 0 END)::float AS running,
           sum(CASE WHEN state IN ('Running', 'Sleeping', 'PreparingForSleep') THEN d ELSE 0 END)::float AS available,
           sum(d)::float AS known
    FROM (SELECT state, extract(epoch FROM lead(at) OVER (ORDER BY at) - at) AS d FROM "ServerSnapshot" WHERE at >= ${from} AND at < ${to}) x
    WHERE d IS NOT NULL AND d <= 600`;
  const r = rows[0];
  if (!r?.known) return { available: null, running: null };
  return { available: (r.available ?? 0) / r.known, running: (r.running ?? 0) / r.known };
}

async function peak(from: Date, to: Date): Promise<number | null> {
  const rows = await db.$queryRaw<Array<{ n: number | null }>>`SELECT max(cardinality(players))::int AS n FROM "ServerSnapshot" WHERE at >= ${from} AND at < ${to}`;
  return rows[0]?.n ?? null;
}

export async function loadAnalytics(rangeKey: string | undefined, now: Date = new Date()): Promise<Loaded> {
  const first = await db.session.findFirst({ orderBy: { joinedAt: "asc" }, select: { joinedAt: true } });
  const range = rangeFor(rangeKey, now, first?.joinedAt ?? null);
  const since = range.prevFrom ?? range.from;
  const [rows, firsts, users, up, upPrev, pk, pkPrev, deaths] = await Promise.all([
    // a session that started before the window but was still running in it counts for "who was on when"
    db.session.findMany({ where: { OR: [{ joinedAt: { gte: since } }, { leftAt: null }, { leftAt: { gte: since } }] }, select: { mcUuid: true, mcName: true, userId: true, joinedAt: true, leftAt: true, country: true }, orderBy: { joinedAt: "asc" } }),
    db.session.groupBy({ by: ["mcUuid"], _min: { joinedAt: true } }),
    db.user.findMany({ where: { mcUuid: { not: null } }, select: { id: true, displayName: true, pcTier: true, mcUuid: true, mcUsername: true } }),
    uptime(range.from, range.to),
    range.prevFrom ? uptime(range.prevFrom, range.from) : Promise.resolve({ available: null, running: null }),
    peak(range.from, range.to),
    range.prevFrom ? peak(range.prevFrom, range.from) : Promise.resolve(null),
    db.event.groupBy({ by: ["actor"], where: { kind: "DEATH", at: { gte: range.from, lt: range.to }, actor: { not: null } }, _count: { _all: true } }),
  ]);
  return {
    range,
    now,
    sessions: rows,
    firstSeen: new Map(firsts.filter((f) => f._min.joinedAt).map((f) => [f.mcUuid, f._min.joinedAt!])),
    people: new Map(users.map((u) => [u.mcUuid!, { userId: u.id, displayName: u.displayName, pcTier: u.pcTier, mcUuid: u.mcUuid, mcUsername: u.mcUsername }])),
    uptime: { available: up.available, running: up.running, prevAvailable: upPrev.available },
    snapshotPeak: { now: pk, prev: pkPrev },
    deaths: deaths.map((d) => ({ actor: d.actor!, n: d._count._all })).sort((a, b) => b.n - a.n),
  };
}

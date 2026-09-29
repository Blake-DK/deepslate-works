import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

// docs/05 "Connection": read from ServerSnapshot.pings, {"<uuid>": milliseconds}, written by api every 15 s while
// somebody is on. Snapshots older than two days are thinned to one in five minutes and dropped after thirty.

/** One player's readings between two moments, oldest first. */
export async function pingReadings(uuid: string, from: Date, to: Date): Promise<Array<{ at: Date; ms: number }>> {
  return db.$queryRaw<Array<{ at: Date; ms: number }>>`
    SELECT at, (pings->>${uuid})::int AS ms FROM "ServerSnapshot"
    WHERE at >= ${from} AND at <= ${to} AND pings ? ${uuid} ORDER BY at`;
}

/** Average ping of each of these sessions of one player; sessions nothing was measured in are left out. */
export async function sessionPings(uuid: string, sessionIds: string[]): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ id: string; ms: number }>>`
    SELECT s.id, round(avg((p.pings->>${uuid})::int))::int AS ms
    FROM "Session" s JOIN "ServerSnapshot" p ON p.at >= s."joinedAt" AND p.at <= coalesce(s."leftAt", now()) AND p.pings ? ${uuid}
    WHERE s.id IN (${Prisma.join(sessionIds)}) GROUP BY s.id`;
  return new Map(rows.map((r) => [r.id, r.ms]));
}

export async function averagePing(uuid: string, from: Date, to: Date): Promise<{ ms: number; readings: number } | null> {
  const rows = await db.$queryRaw<Array<{ ms: number | null; n: number }>>`
    SELECT round(avg((pings->>${uuid})::int))::int AS ms, count(*)::int AS n FROM "ServerSnapshot"
    WHERE at >= ${from} AND at < ${to} AND pings ? ${uuid}`;
  const r = rows[0];
  return r && r.ms !== null && r.n > 0 ? { ms: r.ms, readings: r.n } : null;
}

export type PlayerPing = { key: string; ms: number; worst: number; readings: number };

/** Average and worst ping of everyone measured in the period, best connection first. */
export async function pingByPlayer(from: Date, to: Date): Promise<PlayerPing[]> {
  return db.$queryRaw<PlayerPing[]>`
    SELECT e.key, round(avg(e.value::int))::int AS ms, max(e.value::int)::int AS worst, count(*)::int AS readings
    FROM "ServerSnapshot" s, jsonb_each_text(s.pings) e
    WHERE s.at >= ${from} AND s.at < ${to} AND s.pings IS NOT NULL AND e.value ~ '^[0-9]{1,6}$'
    GROUP BY e.key ORDER BY ms`;
}

/** The lowest the server's speed has been in the last 24 hours, while it was running. */
export async function tpsLow(now: Date = new Date()): Promise<{ tps: number; at: Date } | null> {
  const rows = await db.$queryRaw<Array<{ tps: number; at: Date }>>`
    SELECT tps, at FROM "ServerSnapshot" WHERE at >= ${new Date(now.getTime() - 86_400_000)} AND state = 'Running' AND tps IS NOT NULL
    ORDER BY tps, at DESC LIMIT 1`;
  return rows[0] ?? null;
}

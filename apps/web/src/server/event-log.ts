import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { eventWhere, type EventFilter } from "@/lib/event-query";
import type { EventKind } from "@/shared/events";

export type EventRow = {
  id: string;
  at: Date;
  kind: EventKind;
  actor: string | null;
  message: string;
  count: number;
  who: { name: string; mcUuid: string | null; mcName: string | null } | null;
  // admins only:
  raw: string | null;
  meta: unknown;
};

/** The ids a player goes by in the log: Minecraft UUID for game events, portal user id for site actions. */
export async function actorsFor(player: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { OR: [{ id: player }, { mcUuid: player.toLowerCase() }, { mcUsername: { equals: player, mode: "insensitive" } }, { displayName: { equals: player, mode: "insensitive" } }] },
    select: { id: true, mcUuid: true },
  });
  const ids = new Set<string>();
  for (const u of users) {
    ids.add(u.id);
    if (u.mcUuid) ids.add(u.mcUuid);
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(player)) ids.add(player.toLowerCase());
  if (/^[A-Za-z0-9_]{3,16}$/.test(player)) {
    ids.add(`name:${player.toLowerCase()}`);
    const seen = await db.session.findMany({ where: { mcName: { equals: player, mode: "insensitive" } }, select: { mcUuid: true }, distinct: ["mcUuid"], take: 5 });
    for (const s of seen) ids.add(s.mcUuid);
  }
  return [...ids];
}

export async function listEvents(f: EventFilter, admin: boolean, take = 100): Promise<{ rows: EventRow[]; more: boolean }> {
  const actors = f.player ? await actorsFor(f.player) : null;
  const found = await db.event.findMany({ where: eventWhere(f, admin, actors) as Prisma.EventWhereInput, orderBy: { id: "desc" }, take: take + 1 });
  const page = found.slice(0, take);
  return { rows: await decorate(page, admin), more: found.length > take };
}

export async function eventsAfter(id: bigint, f: EventFilter, admin: boolean, take = 50): Promise<EventRow[]> {
  const actors = f.player ? await actorsFor(f.player) : null;
  const where = { ...(eventWhere({ ...f, before: null }, admin, actors) as Prisma.EventWhereInput), id: { gt: id } };
  return decorate(await db.event.findMany({ where, orderBy: { id: "asc" }, take }), admin);
}

export async function latestEventId(): Promise<bigint> {
  return (await db.event.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0n;
}

type Raw = { id: bigint; at: Date; kind: string; actor: string | null; message: string; raw: string | null; meta: unknown; count: number };

async function decorate(rows: Raw[], admin: boolean): Promise<EventRow[]> {
  const ids = [...new Set(rows.map((r) => r.actor).filter((a): a is string => Boolean(a)))];
  const users = ids.length ? await db.user.findMany({ where: { OR: [{ id: { in: ids } }, { mcUuid: { in: ids } }] }, select: { id: true, displayName: true, mcUuid: true, mcUsername: true } }) : [];
  const byId = new Map<string, (typeof users)[number]>();
  for (const u of users) {
    byId.set(u.id, u);
    if (u.mcUuid) byId.set(u.mcUuid, u);
  }
  return rows.map((r) => {
    const u = r.actor ? byId.get(r.actor) : undefined;
    const metaName = r.meta && typeof r.meta === "object" && "name" in r.meta && typeof (r.meta as { name: unknown }).name === "string" ? (r.meta as { name: string }).name : null;
    const gameUuid = r.actor && /^[0-9a-f-]{36}$/.test(r.actor) ? r.actor : null;
    const who = u ? { name: u.displayName, mcUuid: u.mcUuid, mcName: u.mcUsername ?? metaName } : metaName ? { name: metaName, mcUuid: gameUuid, mcName: metaName } : null;
    return { id: r.id.toString(), at: r.at, kind: r.kind as EventKind, actor: r.actor, message: r.message, count: r.count, who, raw: admin ? r.raw : null, meta: admin ? r.meta : null };
  });
}

import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { placeholder, type RecorderStore } from "./recorder.js";

async function uuidForName(name: string): Promise<string | null> {
  const user = await db.user.findFirst({ where: { mcUsername: { equals: name, mode: "insensitive" }, mcUuid: { not: null } }, select: { mcUuid: true } });
  if (user?.mcUuid) return user.mcUuid;
  const seen = await db.session.findFirst({ where: { mcName: { equals: name, mode: "insensitive" }, NOT: { mcUuid: { startsWith: "name:" } } }, orderBy: { joinedAt: "desc" }, select: { mcUuid: true } });
  return seen?.mcUuid ?? null;
}

export const prismaRecorderStore: RecorderStore = {
  async userIdByUuid(uuid) {
    return (await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true } }))?.id ?? null;
  },
  // A name maps to the UUID it has been seen with: a linked member, or any earlier session under that name with a real
  // UUID (2026-09-30: after a restart of api the UUID line was not in the backlog, and a second record "name:m1_owl" began).
  async uuidByName(name) {
    return uuidForName(name);
  },
  async openSessions() {
    return db.session.findMany({ where: { leftAt: null }, select: { id: true, mcUuid: true, mcName: true, joinedAt: true, ip: true } });
  },
  async openSession(s) {
    // never a second record for a name that already has a UUID
    const known = s.mcUuid.startsWith("name:") ? await uuidForName(s.mcName) : null;
    const data = known ? { ...s, mcUuid: known, userId: s.userId ?? (await db.user.findFirst({ where: { mcUuid: known }, select: { id: true } }))?.id ?? null } : s;
    return db.session.create({ data, select: { id: true, mcUuid: true, mcName: true, joinedAt: true, ip: true } });
  },
  async reopenSession(id) {
    await db.session.update({ where: { id }, data: { leftAt: null } });
  },
  async closeSession(id, leftAt) {
    await db.session.updateMany({ where: { id, leftAt: null }, data: { leftAt } });
  },
  async setSessionAddress(id, ip, country) {
    await db.session.update({ where: { id }, data: { ip, country } });
  },
  async adoptUuid(name, uuid) {
    const from = placeholder(name);
    const userId = (await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true } }))?.id ?? null;
    await db.session.updateMany({ where: { mcUuid: from }, data: { mcUuid: uuid, ...(userId ? { userId } : {}) } });
    await db.event.updateMany({ where: { actor: from }, data: { actor: uuid } });
  },
  async addEvent(e) {
    const row = await db.event.create({ data: { at: e.at, kind: e.kind, actor: e.actor, message: e.message, raw: e.raw ?? null, meta: (e.meta ?? undefined) as Prisma.InputJsonValue | undefined }, select: { id: true } });
    return row.id.toString();
  },
  async bumpEvent(id) {
    await db.event.update({ where: { id: BigInt(id) }, data: { count: { increment: 1 } } });
  },
};

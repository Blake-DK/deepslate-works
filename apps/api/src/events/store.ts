import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { placeholder, type RecorderStore } from "./recorder.js";

export const prismaRecorderStore: RecorderStore = {
  async userIdByUuid(uuid) {
    return (await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true } }))?.id ?? null;
  },
  async uuidByName(name) {
    return (await db.user.findFirst({ where: { mcUsername: { equals: name, mode: "insensitive" }, mcUuid: { not: null } }, select: { mcUuid: true } }))?.mcUuid ?? null;
  },
  async openSessions() {
    return db.session.findMany({ where: { leftAt: null }, select: { id: true, mcUuid: true, mcName: true, joinedAt: true, ip: true } });
  },
  async openSession(s) {
    return db.session.create({ data: s, select: { id: true, mcUuid: true, mcName: true, joinedAt: true, ip: true } });
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

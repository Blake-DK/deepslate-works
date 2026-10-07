import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { NOTICE_ACTIONS, noticeFor, type AckDeps, type NoticeWindow } from "./signin-notice-core";

// The database side of the admin sign-in notice (signin-notice-core.ts has the decisions).

const signIns = (at: Prisma.DateTimeFilter): Prisma.EventWhereInput => ({
  kind: "ADMIN_ACTION",
  at,
  OR: NOTICE_ACTIONS.map((a) => ({ meta: { path: ["action"], equals: a } })),
});
const row = { id: true, at: true, actor: true, message: true } as const;

export const noticeDeps: AckDeps = {
  seenAt: async (userId) => (await db.user.findUnique({ where: { id: userId }, select: { signInNoticeSeenAt: true } }))?.signInNoticeSeenAt ?? null,
  list: (w: NoticeWindow, take) => db.event.findMany({ where: signIns(w), orderBy: [{ at: "desc" }, { id: "desc" }], take, select: row }),
  now: () => Date.now(),
  find: (id) => db.event.findFirst({ where: { id, ...signIns({}) }, select: row }),
  count: (w, upTo) => db.event.count({ where: signIns({ ...w, lte: upTo }) }),
  advance: async (userId, at) =>
    (await db.user.updateMany({ where: { id: userId, role: "ADMIN", OR: [{ signInNoticeSeenAt: null }, { signInNoticeSeenAt: { lt: at } }] }, data: { signInNoticeSeenAt: at } })).count === 1,
  audit: (userId, covered) => audit({ userId, action: "auth.signInNoticeSeen", params: { covered }, result: "OK" }),
};

export const signInNotice = (viewerId: string) => noticeFor(viewerId, noticeDeps);

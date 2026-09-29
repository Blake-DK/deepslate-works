import "server-only";
import { db } from "@/server/db";

export type News = { id: string; body: string; pinned: boolean; createdAt: Date; author: string };

/** Pinned first (newest pinned on top), then the newest `recent` others. */
export async function getAnnouncements(recent: number): Promise<News[]> {
  const [pinned, latest] = await Promise.all([
    db.announcement.findMany({ where: { pinned: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.announcement.findMany({ where: { pinned: false }, orderBy: { createdAt: "desc" }, take: recent }),
  ]);
  const rows = [...pinned, ...latest];
  if (rows.length === 0) return [];
  const authors = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, displayName: true } });
  const name = new Map(authors.map((a) => [a.id, a.displayName]));
  return rows.map((r) => ({ id: r.id, body: r.body, pinned: r.pinned, createdAt: r.createdAt, author: name.get(r.authorId) ?? "someone who has left" }));
}

import "server-only";
import { db } from "@/server/db";
import { getBranding } from "@/server/branding";
import { PHOTO_NAME } from "@/lib/image-kind";
import { arrangeNews } from "@/lib/news";

/** The author of what the portal itself announces (a new world, say): shown under the site's name. */
export const SYSTEM_AUTHOR = "system";

/** `pinned`: pinned right now (a "pinned until" in the past no longer counts). `expired`: members no longer see it. */
/** `mustRead`: the app asks every member to confirm it before Play (app 3.6.6). */
export type News = { id: string; body: string; pinned: boolean; pinnedUntil: Date | null; expiresAt: Date | null; expired: boolean; mustRead: boolean; createdAt: Date; author: string; image: string | null };

/** Where a news item's picture is served from; null for a name that is not one of ours. */
export const newsImageUrl = (file: string | null | undefined) => (file && PHOTO_NAME.test(file) ? `/news-image/${file}` : null);

/** Pinned first (newest pinned on top), then the newest `recent` others (lib/news). `withExpired`: for Admin → Server. */
export async function getAnnouncements(recent: number, withExpired = false): Promise<News[]> {
  const now = new Date();
  // pinned ones may be old, so they are fetched on their own; the rest are the newest few
  const [pinned, latest] = await Promise.all([
    db.announcement.findMany({ where: { pinned: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.announcement.findMany({ where: withExpired ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { createdAt: "desc" }, take: recent + 20 }),
  ]);
  const rows = arrangeNews([...new Map([...pinned, ...latest].map((r) => [r.id, r])).values()], now, recent, withExpired);
  if (rows.length === 0) return [];
  const authors = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, displayName: true } });
  const name = new Map(authors.map((a) => [a.id, a.displayName]));
  const site = rows.some((r) => r.authorId === SYSTEM_AUTHOR) ? (await getBranding()).name : "";
  return rows.map((r) => ({ id: r.id, body: r.body, pinned: r.pinnedNow, pinnedUntil: r.pinnedUntil, expiresAt: r.expiresAt, expired: r.expired, mustRead: r.mustRead, createdAt: r.createdAt, author: name.get(r.authorId) ?? (r.authorId === SYSTEM_AUTHOR ? site : "someone who has left"), image: newsImageUrl(r.image) }));
}

// ---- must-read news (app 3.6.6, Alex 2026-10-14) ------------------------------------------------------------------
// A news item an admin marks "must read" is asked in the app before Play, like a must-vote poll: the member reads it
// and presses "Seen it", which is kept (AnnouncementSeen). Only while it is not hidden; the site itself never holds
// anyone for it. Admins are asked too, so they see what the players see.

export type MustRead = { id: string; body: string; createdAt: Date; author: string };

/** The must-read items this member has not confirmed yet, oldest first. */
export async function unseenNews(userId: string, now = new Date()): Promise<MustRead[]> {
  const rows = await db.announcement.findMany({
    where: { mustRead: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], seen: { none: { userId } } },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  if (rows.length === 0) return [];
  const authors = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, displayName: true } });
  const name = new Map(authors.map((a) => [a.id, a.displayName]));
  const site = rows.some((r) => r.authorId === SYSTEM_AUTHOR) ? (await getBranding()).name : "";
  return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, author: name.get(r.authorId) ?? (r.authorId === SYSTEM_AUTHOR ? site : "someone who has left") }));
}

/** "Seen it" in the app. False for an item that is not (or no longer) a must-read one. Pressing it twice is fine. */
export async function markSeen(userId: string, announcementId: string): Promise<boolean> {
  const row = await db.announcement.findUnique({ where: { id: announcementId }, select: { mustRead: true } });
  if (!row?.mustRead) return false;
  await db.announcementSeen.upsert({ where: { announcementId_userId: { announcementId, userId } }, create: { announcementId, userId }, update: {} });
  return true;
}

/** Admin → News: who has confirmed each must-read item, by name, first first. */
export async function seenBy(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = await db.announcementSeen.findMany({ where: { announcementId: { in: ids } }, orderBy: { seenAt: "asc" }, select: { announcementId: true, user: { select: { displayName: true } } } });
  for (const r of rows) out.set(r.announcementId, [...(out.get(r.announcementId) ?? []), r.user.displayName]);
  return out;
}

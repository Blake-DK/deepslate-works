import "server-only";
import { db } from "@/server/db";
import { getBranding } from "@/server/branding";
import { PHOTO_NAME } from "@/lib/image-kind";

/** The author of what the portal itself announces (a new world, say): shown under the site's name. */
export const SYSTEM_AUTHOR = "system";

export type News = { id: string; body: string; pinned: boolean; createdAt: Date; author: string; image: string | null };

/** Where a news item's picture is served from; null for a name that is not one of ours. */
export const newsImageUrl = (file: string | null | undefined) => (file && PHOTO_NAME.test(file) ? `/news-image/${file}` : null);

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
  const site = rows.some((r) => r.authorId === SYSTEM_AUTHOR) ? (await getBranding()).name : "";
  return rows.map((r) => ({ id: r.id, body: r.body, pinned: r.pinned, createdAt: r.createdAt, author: name.get(r.authorId) ?? (r.authorId === SYSTEM_AUTHOR ? site : "someone who has left"), image: newsImageUrl(r.image) }));
}

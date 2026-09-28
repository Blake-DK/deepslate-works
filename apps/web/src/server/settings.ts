import "server-only";
import { db } from "@/server/db";

export type SiteSettings = { live: boolean; launchAt: Date | null };

let cache: { at: number; value: SiteSettings } | null = null;

export async function getSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const row = await db.siteSettings.findUnique({ where: { id: "site" } });
  const value = { live: row?.live ?? false, launchAt: row?.launchAt ?? null };
  cache = { at: Date.now(), value };
  return value;
}

export async function setSettings(next: SiteSettings, updatedById: string): Promise<void> {
  await db.siteSettings.upsert({ where: { id: "site" }, create: { id: "site", ...next, updatedById }, update: { ...next, updatedById } });
  cache = null;
}

/** Players may see the server address and downloads only once the admin has flipped "live". Admins always. */
export function canSeeServer(user: { role: "ADMIN" | "PLAYER" } | null, settings: SiteSettings): boolean {
  return user?.role === "ADMIN" || settings.live;
}

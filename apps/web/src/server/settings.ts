import "server-only";
import { db } from "@/server/db";
import { isOpenFor, type Member } from "@/shared/access";

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

/** docs/48: the site's Maintenance (not AMP's state of that name). `byId`: who switched it last, `at`: when. */
export type Maintenance = { on: boolean; at: Date | null; byId: string | null };

let maintenanceCache: { at: number; value: Maintenance } | null = null;

/** Switched by api (POST /maintenance), which the door asks; read here for the site's words. Off when nothing says. */
export async function getMaintenance(): Promise<Maintenance> {
  if (maintenanceCache && Date.now() - maintenanceCache.at < 5000) return maintenanceCache.value;
  const row = await db.siteSettings.findUnique({ where: { id: "site" }, select: { maintenance: true, maintenanceAt: true, maintenanceById: true } });
  const value = { on: row?.maintenance ?? false, at: row?.maintenanceAt ?? null, byId: row?.maintenanceById ?? null };
  maintenanceCache = { at: Date.now(), value };
  return value;
}

/** After the switch, so the admin's next page says so at once. */
export function forgetMaintenance() {
  maintenanceCache = null;
}

/** Players may see the server address and downloads only once the admin has flipped "live". Admins always; members with early access too (docs/13). */
export function canSeeServer(user: Member | null, settings: SiteSettings): boolean {
  return isOpenFor(user, settings.live);
}

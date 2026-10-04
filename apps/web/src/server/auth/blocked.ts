import "server-only";
import { db } from "@/server/db";

// docs/31 B-37: removing a member was not a ban. While the Discord server itself is the invite, their next Discord
// sign-in made a new account. "Remove and block" writes their Discord id here; a blocked id is refused at sign-in
// before any account is made. One Setting row of its own, so saving a settings section never touches it.

const KEY = "_blockedDiscordIds";
export type Blocked = { discordId: string; name: string; at: string };

export function parseBlocked(value: unknown): Blocked[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Blocked => Boolean(v) && typeof v === "object" && typeof (v as Blocked).discordId === "string" && /^\d{5,25}$/.test((v as Blocked).discordId))
    .map((v) => ({ discordId: v.discordId, name: typeof v.name === "string" ? v.name.slice(0, 80) : "", at: typeof v.at === "string" ? v.at : "" }));
}

export async function blockedList(): Promise<Blocked[]> {
  const row = await db.setting.findUnique({ where: { key: KEY } }).catch(() => null);
  return parseBlocked(row?.value);
}

export async function isBlocked(discordId: string): Promise<boolean> {
  return (await blockedList()).some((b) => b.discordId === discordId);
}

export async function block(discordId: string, name: string, byId: string): Promise<void> {
  const list = (await blockedList()).filter((b) => b.discordId !== discordId);
  list.push({ discordId, name: name.slice(0, 80), at: new Date().toISOString() });
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: list, updatedById: byId }, update: { value: list, updatedById: byId } });
}

export async function unblock(discordId: string, byId: string): Promise<boolean> {
  const before = await blockedList();
  const list = before.filter((b) => b.discordId !== discordId);
  if (list.length === before.length) return false;
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: list, updatedById: byId }, update: { value: list, updatedById: byId } });
  return true;
}

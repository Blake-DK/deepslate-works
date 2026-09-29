import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { getSection } from "../settings.js";

// docs/16 §4: chat 30 days, everything else 180 days, what admins did is kept for good. Addresses 30 days.
// Runs once a day (the time of the last run is kept in the Setting table so a restart of api doesn't repeat it).

const KEY = "_retentionLastRun";
const EVERY_MS = 20 * 3600_000;

export type Pruned = { events: number; chat: number; ips: number; sessions: number };

export async function prune(now: Date, r: { chatDays: number; eventDays: number; ipDays: number }): Promise<Pruned> {
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const chat = (await db.event.deleteMany({ where: { kind: "CHAT", at: { lt: before(r.chatDays) } } })).count;
  const events = (await db.event.deleteMany({ where: { kind: { notIn: ["CHAT", "ADMIN_ACTION"] }, at: { lt: before(r.eventDays) } } })).count;
  const sessions = (await db.session.updateMany({ where: { ip: { not: null }, joinedAt: { lt: before(r.ipDays) } }, data: { ip: null } })).count;
  // sign-in attempts keep the address in their parameters
  const stripped = await db.$executeRaw`UPDATE "Event" SET meta = meta #- '{params,ip}' WHERE at < ${before(r.ipDays)} AND meta #> '{params,ip}' IS NOT NULL`;
  return { events, chat, sessions, ips: sessions + Number(stripped) };
}

export async function runRetentionIfDue(log: (o: unknown, m: string) => void, now: Date = new Date()): Promise<Pruned | null> {
  const last = await db.setting.findUnique({ where: { key: KEY } });
  const lastAt = typeof last?.value === "string" ? Date.parse(last.value) : 0;
  if (now.getTime() - lastAt < EVERY_MS) return null;
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: now.toISOString() }, update: { value: now.toISOString() } });
  const r = await getSection("retention");
  const done = await prune(now, r);
  await audit({ userId: null, action: "retention.prune", params: { events: done.events + done.chat, ips: done.ips, ...r } as Prisma.InputJsonValue, result: "OK" });
  log(done, "retention run");
  return done;
}

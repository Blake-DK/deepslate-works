import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { parseSection, sections, type Section, type SectionName } from "@/shared/settings";

// docs/16 §5 and §6: one row per section in the Setting table. Reads are cached for 10 s per process.
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; value: unknown }>();

export async function getSection<K extends SectionName>(name: K): Promise<Section<K>> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Section<K>;
  let value: Section<K>;
  try {
    const row = await db.setting.findUnique({ where: { key: name } });
    value = parseSection(name, row?.value);
  } catch {
    value = parseSection(name, undefined); // e.g. during `next build`, with no database
  }
  cache.set(name, { at: Date.now(), value });
  return value;
}

/** Validates strictly (a bad value is an error here, not a default) and stores the whole section. */
export async function setSection<K extends SectionName>(name: K, value: unknown, updatedById: string): Promise<{ ok: true; value: Section<K> } | { ok: false; problems: string[] }> {
  const parsed = sections[name].safeParse(value);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".") || name}: ${i.message}`) };
  await db.setting.upsert({
    where: { key: name },
    create: { key: name, value: parsed.data as Prisma.InputJsonValue, updatedById },
    update: { value: parsed.data as Prisma.InputJsonValue, updatedById },
  });
  cache.delete(name);
  return { ok: true, value: parsed.data as Section<K> };
}

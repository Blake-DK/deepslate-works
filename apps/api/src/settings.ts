import { db } from "./db.js";
import type { Prisma } from "@prisma/client";
import { parseSection, sections, type Section, type SectionName } from "./shared/settings.js";

// Settings are edited in the portal (Admin → Settings) and read here; 30 s is soon enough for a change to bite.
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown }>();

export async function getSection<K extends SectionName>(name: K): Promise<Section<K>> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Section<K>;
  let value: Section<K>;
  try {
    const row = await db.setting.findUnique({ where: { key: name } });
    value = parseSection(name, row?.value);
  } catch {
    value = parseSection(name, undefined);
  }
  cache.set(name, { at: Date.now(), value });
  return value;
}

/** docs/22 §6 (/feed pause): api writes a section too, through the same schema as the site's settings page. */
export async function setSection<K extends SectionName>(name: K, value: Section<K>, updatedById: string | null): Promise<void> {
  const parsed = sections[name].parse(value) as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key: name }, create: { key: name, value: parsed, updatedById }, update: { value: parsed, updatedById } });
  cache.delete(name);
}

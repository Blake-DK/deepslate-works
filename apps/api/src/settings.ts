import { db } from "./db.js";
import { parseSection, type Section, type SectionName } from "./shared/settings.js";

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

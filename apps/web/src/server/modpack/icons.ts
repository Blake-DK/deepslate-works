import "server-only";
import { getLock } from "@/server/modpack/lock";

// The Mods guide's icons (/mods): each mod's own icon on Modrinth, asked for in one request for the whole pack and
// kept for a day. Modrinth out of reach: no icons (the cards show the first letter), never an error.
const DAY_MS = 24 * 60 * 60_000;
let cache: { at: number; key: string; icons: Record<string, string> } | null = null;

export async function getModIcons(): Promise<Record<string, string>> {
  const lock = await getLock();
  if (!lock) return {};
  const ids = lock.files.map((f) => f.projectId).filter(Boolean);
  const key = ids.join(",");
  if (cache && cache.key === key && Date.now() - cache.at < DAY_MS) return cache.icons;
  try {
    const res = await fetch(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, {
      headers: { "user-agent": process.env.MODRINTH_USER_AGENT ?? "deepslate-works/0.1 (mods guide)" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const projects = (await res.json()) as Array<{ id: string; slug: string; icon_url: string | null }>;
    const bySlug: Record<string, string> = {};
    const byId = new Map(projects.map((p) => [p.id, p]));
    for (const f of lock.files) {
      const p = byId.get(f.projectId);
      if (p?.icon_url && /^https:\/\/cdn\.modrinth\.com\//.test(p.icon_url)) bySlug[f.slug] = p.icon_url;
    }
    cache = { at: Date.now(), key, icons: bySlug };
    return bySlug;
  } catch {
    return cache?.icons ?? {};
  }
}

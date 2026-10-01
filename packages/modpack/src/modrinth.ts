// Minimal Modrinth v2 client with the User-Agent Modrinth requires, retries and a small cache.

const API = "https://api.modrinth.com/v2";
const UA = process.env.MODRINTH_USER_AGENT ?? "deepslate-works/0.1 (contact: see repo)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ModrinthProject = {
  id: string;
  slug: string;
  title: string;
  client_side: "required" | "optional" | "unsupported" | "unknown";
  server_side: "required" | "optional" | "unsupported" | "unknown";
  loaders: string[];
  game_versions: string[];
  project_type?: "mod" | "resourcepack" | "shader" | "modpack" | "datapack" | "plugin";
  icon_url?: string | null;
};

export type ModrinthVersion = {
  id: string;
  project_id: string;
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  date_published: string;
  loaders: string[];
  game_versions: string[];
  dependencies: Array<{ project_id: string | null; version_id: string | null; dependency_type: "required" | "optional" | "incompatible" | "embedded" }>;
  files: Array<{ url: string; filename: string; primary: boolean; size: number; hashes: { sha512: string; sha1: string } }>;
};

const cache = new Map<string, unknown>();

export async function modrinthGet<T>(path: string): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429) {
        const wait = Number(res.headers.get("x-ratelimit-reset") ?? 2) * 1000;
        await sleep(Math.min(wait, 10000));
        continue;
      }
      if (res.status === 404) throw new NotFound(path);
      if (!res.ok) throw new Error(`Modrinth ${path} -> HTTP ${res.status}`);
      const json = (await res.json()) as T;
      cache.set(path, json);
      return json;
    } catch (e) {
      if (e instanceof NotFound) throw e;
      lastErr = e;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Modrinth ${path} failed`);
}

export class NotFound extends Error {}

export const getProject = (idOrSlug: string) => modrinthGet<ModrinthProject>(`/project/${encodeURIComponent(idOrSlug)}`);

export function getVersions(idOrSlug: string, loader: string, gameVersion: string) {
  const q = new URLSearchParams({ loaders: JSON.stringify([loader]), game_versions: JSON.stringify([gameVersion]) });
  return modrinthGet<ModrinthVersion[]>(`/project/${encodeURIComponent(idOrSlug)}/version?${q}`);
}

export const getVersion = (id: string) => modrinthGet<ModrinthVersion>(`/version/${encodeURIComponent(id)}`);

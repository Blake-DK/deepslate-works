import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Kind, Manifest, Mod } from "./schema";
import { getProject, getVersion, getVersions, NotFound, type ModrinthProject, type ModrinthVersion } from "./modrinth";

// docs/06: mods.lock.json — exact Modrinth versions, file URLs and hashes for every enabled mod plus required deps.

export type LockFile = {
  generatedAt: string;
  minecraft: string;
  neoforge: string;
  hash: string;
  files: LockEntry[];
  configs: Array<{ path: string; sha256: string }>;
};

export type LockEntry = {
  slug: string;
  name: string;
  projectId: string;
  versionId: string;
  versionNumber: string;
  versionType: "release" | "beta" | "alpha";
  filename: string;
  url: string;
  sha512: string;
  sha1: string;
  size: number;
  side: "both" | "client" | "server";
  requiredBy: string[];
  /** Missing in locks from before 2026-10-01: "mod". */
  kind?: Kind;
  /** The optional category it belongs to ("visuals"), or missing/null: everyone gets it. */
  optional?: string | null;
  /** A shader pack: the Me page choice that installs it. */
  shader?: "light" | "full";
};

export type LockWarning = string;

const sideFromProject = (p: ModrinthProject): LockEntry["side"] => {
  if (p.client_side === "unsupported") return "server";
  if (p.server_side === "unsupported") return "client";
  return "both";
};

function pickVersion(versions: ModrinthVersion[], pinned: string | undefined, slug: string, warn: (w: string) => void): ModrinthVersion {
  const sorted = [...versions].sort((a, b) => b.date_published.localeCompare(a.date_published));
  if (pinned && pinned !== "latest") {
    const v = sorted.find((x) => x.id === pinned);
    if (!v) throw new Error(`${slug}: pinned version ${pinned} is not a NeoForge 1.21.1 build`);
    return v;
  }
  const release = sorted.find((v) => v.version_type === "release");
  if (release) return release;
  const beta = sorted.find((v) => v.version_type === "beta") ?? sorted[0];
  if (!beta) throw new Error(`${slug}: no NeoForge 1.21.1 versions on Modrinth`);
  warn(`${slug}: no release build, using ${beta.version_type} ${beta.version_number}`);
  return beta;
}

/** Newest stable 21.1.x from the NeoForged maven (docs/06). */
export async function resolveNeoForge(spec: string): Promise<string> {
  if (spec !== "latest") return spec;
  const res = await fetch("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml", { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`NeoForged maven -> HTTP ${res.status}`);
  const xml = await res.text();
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]!);
  const stable = versions.filter((v) => /^21\.1\.\d+$/.test(v));
  const best = stable.sort((a, b) => Number(a.split(".")[2]) - Number(b.split(".")[2])).at(-1);
  if (!best) throw new Error("No stable NeoForge 21.1.x found in maven-metadata.xml");
  return best;
}

async function hashConfigs(configDir: string): Promise<LockFile["configs"]> {
  const out: LockFile["configs"] = [];
  async function walk(dir: string, rel: string) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const full = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const s = await stat(full);
      if (s.isDirectory()) await walk(full, relPath);
      else out.push({ path: `config/${relPath}`, sha256: createHash("sha256").update(await readFile(full)).digest("hex") });
    }
  }
  await walk(configDir, "");
  return out;
}

/** Where Modrinth files each kind: mods under the pack's loader, resource packs under "minecraft", shader packs under "iris". */
export const loaderFor = (kind: Kind | undefined, modLoader: string) => (kind === "resourcepack" ? "minecraft" : kind === "shader" ? "iris" : modLoader);

/**
 * Optional entries pulled in as dependencies take the group of whatever needs them, unless something everyone gets
 * needs them too: then everyone gets them. Worked out once all entries are known, so the order of the queue does not matter.
 */
export function settleOptional(entries: LockEntry[], direct: Set<string>): void {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of entries) {
      if (direct.has(e.slug) || e.requiredBy.length === 0) continue;
      const groups = e.requiredBy.map((r) => bySlug.get(r)?.optional ?? null);
      const next = groups.includes(null) ? null : groups[0]!;
      if ((e.optional ?? null) !== next) {
        if (next) e.optional = next;
        else delete e.optional;
        changed = true;
      }
    }
  }
  // Optional things are for the PC only: never on the server.
  for (const e of entries) if (e.optional) e.side = "client";
}

export async function buildLock(m: Manifest, opts: { configDir: string; onProgress?: (msg: string) => void }): Promise<{ lock: LockFile; warnings: LockWarning[] }> {
  const warnings: LockWarning[] = [];
  const warn = (w: string) => warnings.push(w);
  const log = opts.onProgress ?? (() => {});
  const bySlug = new Map(m.mods.map((mod) => [mod.slug, mod]));
  const entries = new Map<string, LockEntry>(); // by project id
  const optionalCats = new Set(m.categories.filter((c) => c.optional).map((c) => c.id));
  const groupOf = (mod: Mod | undefined) => (mod && optionalCats.has(mod.category) ? mod.category : null);
  // Everyone's mods first, the optional ones after.
  const enabled = m.mods.filter((mod) => mod.enabled).sort((a, b) => Number(Boolean(groupOf(a))) - Number(Boolean(groupOf(b))));
  const queue: Array<{ ref: string; requiredBy: string | null; mod?: Mod; group: string | null }> = enabled.map((mod) => ({ ref: mod.slug, requiredBy: null, mod, group: groupOf(mod) }));
  const direct = new Set<string>();

  while (queue.length) {
    const item = queue.shift()!;
    const project = await getProject(item.ref).catch((e) => {
      if (e instanceof NotFound) throw new Error(`${item.ref}: not found on Modrinth`);
      throw e;
    });
    const existing = entries.get(project.id);
    if (existing) {
      if (item.requiredBy && !existing.requiredBy.includes(item.requiredBy)) existing.requiredBy.push(item.requiredBy);
      continue;
    }
    const mod = item.mod ?? bySlug.get(project.slug);
    const kind: Kind = mod?.kind ?? "mod";
    const loader = loaderFor(kind, m.loader);
    if (!project.loaders.includes(loader) || !project.game_versions.includes(m.minecraft)) {
      throw new Error(`${project.slug}: no ${loader} ${m.minecraft} build on Modrinth${item.requiredBy ? ` (required by ${item.requiredBy})` : ""}`);
    }
    const versions = await getVersions(project.id, loader, m.minecraft);
    const version = pickVersion(versions, mod?.version, project.slug, warn);
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) throw new Error(`${project.slug}: version ${version.version_number} has no files`);
    const side: LockEntry["side"] = mod && mod.side !== "both" ? mod.side : sideFromProject(project);
    if (!item.requiredBy) direct.add(project.slug);
    entries.set(project.id, {
      slug: project.slug, name: mod?.name ?? project.title, projectId: project.id, versionId: version.id, versionNumber: version.version_number,
      versionType: version.version_type, filename: file.filename, url: file.url, sha512: file.hashes.sha512, sha1: file.hashes.sha1, size: file.size,
      side, requiredBy: item.requiredBy ? [item.requiredBy] : [],
      ...(kind !== "mod" ? { kind } : {}), ...(item.group ? { optional: item.group } : {}), ...(mod?.shader ? { shader: mod.shader } : {}),
    });
    log(`${project.slug} ${version.version_number} (${(file.size / 1048576).toFixed(1)} MB)${item.requiredBy ? ` <- ${item.requiredBy}` : ""}`);
    for (const dep of version.dependencies) {
      if (dep.dependency_type !== "required") continue;
      let depRef = dep.project_id;
      if (!depRef && dep.version_id) depRef = (await getVersion(dep.version_id)).project_id;
      if (!depRef) continue;
      queue.push({ ref: depRef, requiredBy: project.slug, group: item.group });
    }
  }

  settleOptional([...entries.values()], direct);
  const files = [...entries.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const neoforge = await resolveNeoForge(m.neoforge);
  const configs = await hashConfigs(opts.configDir);
  const lock: LockFile = { generatedAt: new Date().toISOString(), minecraft: m.minecraft, neoforge, hash: packHash(neoforge, files, configs), files, configs };
  return { lock, warnings };
}

/**
 * What the pack's version ends in. The settings shipped with the pack are part of it: until 2026-09-29 they were
 * not, a change of settings alone left the lock "unchanged" and its list of settings empty, and no PC was sent
 * them. A pack without settings has the hash it always had.
 */
export function packHash(neoforge: string, files: Array<Pick<LockEntry, "slug" | "versionId">>, configs: LockFile["configs"]): string {
  return createHash("sha256").update([neoforge, ...files.map((f) => `${f.slug}@${f.versionId}`), ...configs.map((c) => `config:${c.path}@${c.sha256}`)].join("\n")).digest("hex");
}

export type LockDiff = { added: LockEntry[]; removed: LockEntry[]; changed: Array<{ slug: string; from: string; to: string }>; neoforge?: { from: string; to: string }; /** Settings files that are new, gone or other than they were. */ configs: string[] };

export function diffLocks(prev: LockFile | null, next: LockFile): LockDiff {
  const p = new Map((prev?.files ?? []).map((f) => [f.slug, f]));
  const n = new Map(next.files.map((f) => [f.slug, f]));
  const d: LockDiff = { added: [], removed: [], changed: [], configs: [] };
  const pc = new Map((prev?.configs ?? []).map((c) => [c.path, c.sha256]));
  const nc = new Map(next.configs.map((c) => [c.path, c.sha256]));
  for (const [file, sum] of nc) if (pc.get(file) !== sum) d.configs.push(file);
  for (const file of pc.keys()) if (!nc.has(file)) d.configs.push(file);
  d.configs.sort();
  for (const [slug, f] of n) {
    const old = p.get(slug);
    if (!old) d.added.push(f);
    else if (old.versionId !== f.versionId) d.changed.push({ slug, from: old.versionNumber, to: f.versionNumber });
  }
  for (const [slug, f] of p) if (!n.has(slug)) d.removed.push(f);
  if (prev && prev.neoforge !== next.neoforge) d.neoforge = { from: prev.neoforge, to: next.neoforge };
  return d;
}

export const shortHash = (lock: Pick<LockFile, "hash">) => lock.hash.slice(0, 8);

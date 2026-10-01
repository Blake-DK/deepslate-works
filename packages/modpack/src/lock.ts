import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Manifest, Mod } from "./schema";
import { getProject, getVersion, getVersions, NotFound, type ModrinthVersion } from "./modrinth";
import { fetchJar } from "./download";
import { jarChannels, sideFor, widenForDependents } from "./sides";
import { openZipFile } from "./zip";

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
  /** 2.1.0: what Modrinth says each side needs (client_side / server_side); the side rule and CI check read it. */
  modrinth?: { client: string; server: string };
  /** 2.1.0: NeoForge network channels the jar registers (sides.ts `jarChannels`); null when the jar was not looked at. */
  channels?: "required" | "optional" | "none" | null;
};

export type LockWarning = string;

export function pickVersion(versions: ModrinthVersion[], pinned: string | undefined, slug: string, warn: (w: string) => void): ModrinthVersion {
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

export async function buildLock(m: Manifest, opts: { configDir: string; onProgress?: (msg: string) => void; /** The NeoForge of the lock in hand: kept when the maven cannot be read. */ previousNeoForge?: string; /** 2.1.0: where jars are kept, so each can be looked into for network channels. */ jarCache?: string }): Promise<{ lock: LockFile; warnings: LockWarning[] }> {
  const warnings: LockWarning[] = [];
  const warn = (w: string) => warnings.push(w);
  const log = opts.onProgress ?? (() => {});
  const bySlug = new Map(m.mods.map((mod) => [mod.slug, mod]));
  const entries = new Map<string, LockEntry>(); // by project id
  const queue: Array<{ ref: string; requiredBy: string | null; mod?: Mod }> = m.mods.filter((mod) => mod.enabled).map((mod) => ({ ref: mod.slug, requiredBy: null, mod }));

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
    if (!project.loaders.includes(m.loader) || !project.game_versions.includes(m.minecraft)) {
      throw new Error(`${project.slug}: no ${m.loader} ${m.minecraft} build on Modrinth${item.requiredBy ? ` (required by ${item.requiredBy})` : ""}`);
    }
    const versions = await getVersions(project.id, m.loader, m.minecraft);
    const version = pickVersion(versions, mod?.version, project.slug, warn);
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) throw new Error(`${project.slug}: version ${version.version_number} has no files`);
    // 2.1.0: mods.json may narrow a mod to one side, never away from a side Modrinth says requires it (sides.ts)
    const side = sideFor(project.slug, project, mod?.side);
    entries.set(project.id, {
      slug: project.slug, name: mod?.name ?? project.title, projectId: project.id, versionId: version.id, versionNumber: version.version_number,
      versionType: version.version_type, filename: file.filename, url: file.url, sha512: file.hashes.sha512, sha1: file.hashes.sha1, size: file.size,
      side, requiredBy: item.requiredBy ? [item.requiredBy] : [], modrinth: { client: project.client_side, server: project.server_side },
    });
    log(`${project.slug} ${version.version_number} (${(file.size / 1048576).toFixed(1)} MB)${item.requiredBy ? ` <- ${item.requiredBy}` : ""}`);
    for (const dep of version.dependencies) {
      if (dep.dependency_type !== "required") continue;
      let depRef = dep.project_id;
      if (!depRef && dep.version_id) depRef = (await getVersion(dep.version_id)).project_id;
      if (!depRef) continue;
      queue.push({ ref: depRef, requiredBy: project.slug });
    }
  }

  const files = [...entries.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  widenForDependents(files);
  if (opts.jarCache) {
    await mkdir(opts.jarCache, { recursive: true });
    for (const f of files) {
      const at = path.join(opts.jarCache, f.filename);
      await fetchJar(f, at);
      f.channels = jarChannels(await openZipFile(at));
      if (f.side === "server" && f.channels === "required") throw new Error(`${f.slug}: server-only, but its jar registers network channels every PC must have. Anything both sides need is never server-only: make it "both" in mods.json.`);
    }
  }
  // The NeoForged maven's CDN answered 404 to every request for a while on 2026-10-01: the mods are not held up
  // for it, NeoForge stays where it was and the lock says so.
  const neoforge = await resolveNeoForge(m.neoforge).catch((e: unknown) => {
    if (!opts.previousNeoForge) throw e;
    warn(`NeoForge kept at ${opts.previousNeoForge}: ${e instanceof Error ? e.message : String(e)}`);
    return opts.previousNeoForge;
  });
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

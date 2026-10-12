import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Manifest, Mod } from "./schema";
import { getProject, getVersion, getVersions, NotFound, type ModrinthVersion } from "./modrinth";
import { fetchJar, sha512File } from "./download";
import { modUrlProblem, privateUrl } from "./mod-url";
import { jarChannels, sideFor, widenForDependents } from "./sides";
import { openZipFile, openZipOnDisk, type Zip } from "./zip";
import { hashConfigs, hashResourcePack } from "./hashes";

export { hashConfigs, hashResourcePack };

// docs/06: mods.lock.json — exact Modrinth versions, file URLs and hashes for every enabled mod plus required deps.

export type LockFile = {
  generatedAt: string;
  minecraft: string;
  neoforge: string;
  hash: string;
  files: LockEntry[];
  configs: Array<{ path: string; sha256: string }>;
  /** sha256 over modpack/resourcepack/ (the Deepslate texture pack in config.zip); absent when there is none. */
  resourcepack?: string;
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
  /** docs/44: the season this file belongs to (mods.json `season`, or the season of every mod that needs it). */
  season?: string;
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


export async function buildLock(m: Manifest, opts: { configDir: string; onProgress?: (msg: string) => void; /** The NeoForge of the lock in hand: kept when the maven cannot be read. */ previousNeoForge?: string; /** modpack/resourcepack/, hashed into the pack. */ resourcepackDir?: string; /** 2.1.0: where jars are kept, so each can be looked into for network channels. */ jarCache?: string; /** docs/58: data/private-jars/, where a mod's private jar is read from. */ privateDir?: string; /** docs/58: the lock in hand, whose entry for a private jar is kept when the jar is not on this machine. */ previous?: Pick<LockFile, "files"> | null }): Promise<{ lock: LockFile; warnings: LockWarning[] }> {
  const warnings: LockWarning[] = [];
  const warn = (w: string) => warnings.push(w);
  const log = opts.onProgress ?? (() => {});
  const bySlug = new Map(m.mods.map((mod) => [mod.slug, mod]));
  const entries = new Map<string, LockEntry>(); // by project id
  const queue: Array<{ ref: string; requiredBy: string | null; mod?: Mod }> = m.mods.filter((mod) => mod.enabled).map((mod) => ({ ref: mod.slug, requiredBy: null, mod }));

  while (queue.length) {
    const item = queue.shift()!;
    // docs/58: a private jar is read from disk, not asked of Modrinth; what it needs is what mods.json says it requires
    if (item.mod?.source) {
      const e = await privateEntry(item.mod, opts.privateDir, opts.previous ?? null, warn);
      entries.set(`private:${e.slug}`, e);
      log(`${e.slug} ${e.versionNumber} (${(e.size / 1048576).toFixed(1)} MB, private jar)`);
      for (const dep of item.mod.requires) queue.push({ ref: dep, requiredBy: e.slug });
      continue;
    }
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
    if (mod?.source) {
      // another mod needs a mod whose jar is private: that jar, never Modrinth's
      const own = entries.get(`private:${mod.slug}`);
      if (!own) throw new Error(`${mod.slug}: ${item.requiredBy ?? "the pack"} needs it, but it is switched off (its jar is a private one, docs/58)`);
      if (item.requiredBy && !own.requiredBy.includes(item.requiredBy)) own.requiredBy.push(item.requiredBy);
      continue;
    }
    if (!project.loaders.includes(m.loader) || !project.game_versions.includes(m.minecraft)) {
      throw new Error(`${project.slug}: no ${m.loader} ${m.minecraft} build on Modrinth${item.requiredBy ? ` (required by ${item.requiredBy})` : ""}`);
    }
    const versions = await getVersions(project.id, m.loader, m.minecraft);
    const version = pickVersion(versions, mod?.version, project.slug, warn);
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) throw new Error(`${project.slug}: version ${version.version_number} has no files`);
    const bad = modUrlProblem(file.url);
    if (bad) throw new Error(`${project.slug}: ${bad}`);
    // 2.1.0: mods.json may narrow a mod to one side, never away from a side Modrinth says requires it (sides.ts)
    const side = sideFor(project.slug, project, mod?.side);
    entries.set(project.id, {
      slug: project.slug, name: mod?.name ?? project.title, projectId: project.id, versionId: version.id, versionNumber: version.version_number,
      versionType: version.version_type, filename: file.filename, url: file.url, sha512: file.hashes.sha512, sha1: file.hashes.sha1, size: file.size,
      side, requiredBy: item.requiredBy ? [item.requiredBy] : [], modrinth: { client: project.client_side, server: project.server_side },
      ...(mod?.season ? { season: mod.season } : {}),
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
  widenForDependents(files, warn);
  seasonDependencies(files);
  if (opts.jarCache) {
    await mkdir(opts.jarCache, { recursive: true });
    for (const f of files) {
      if (f.channels !== undefined) continue; // a private jar: looked into where it lies
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
  const resourcepack = await hashResourcePack(opts.resourcepackDir);
  const lock: LockFile = { generatedAt: new Date().toISOString(), minecraft: m.minecraft, neoforge, hash: packHash(neoforge, files, configs, resourcepack), files, configs, ...(resourcepack ? { resourcepack } : {}) };
  return { lock, warnings };
}

/**
 * docs/58: the lock's entry for a mod whose jar is private: name, size and checksums from the file in `dir`, which must
 * be the very file mods.json names (`source.sha512`); its version from the jar's own neoforge.mods.toml. The version id
 * is made from the checksum, so a new jar is a version change Lock prints like any other. A jar that is not on this
 * machine keeps the lock's entry when that entry names the same file; otherwise Lock stops.
 */
export async function privateEntry(mod: Mod, dir: string | undefined, previous: Pick<LockFile, "files"> | null, warn: (w: string) => void): Promise<LockEntry> {
  const src = mod.source!;
  const name = src.private;
  const fields = { slug: mod.slug, name: mod.name, side: mod.side, ...(mod.season ? { season: mod.season } : {}) };
  const file = dir ? path.join(dir, name) : null;
  const sum = file ? await sha512File(file) : null;
  if (sum === null) {
    const kept = previous?.files.find((f) => f.slug === mod.slug && f.filename === name && f.sha512 === src.sha512 && f.url === privateUrl(name));
    if (!kept) throw new Error(`${mod.slug}: its private jar ${name} is not in ${dir ?? "the private jars folder"}. It is put there by hand, from the build's artifact (docs/58)`);
    warn(`${mod.slug}: ${name} is not in ${dir ?? "the private jars folder"} here; its entry is kept from the lock as it was`);
    const out: LockEntry = { ...kept, ...fields, requiredBy: [] };
    if (!mod.season) delete out.season;
    return out;
  }
  if (sum !== src.sha512) throw new Error(`${mod.slug}: ${name} in ${dir} is not the jar mods.json names: its sha512 is ${sum.slice(0, 16)}…, mods.json says ${src.sha512.slice(0, 16)}…`);
  const zip = openZipOnDisk(file!);
  let version: string | null;
  let channels: LockEntry["channels"];
  try {
    version = jarVersion(zip);
    channels = jarChannels(zip);
  } finally {
    zip.close?.();
  }
  if (mod.side === "server" && channels === "required") throw new Error(`${mod.slug}: server-only, but its jar registers network channels every PC must have. Anything both sides need is never server-only: make it "both" in mods.json.`);
  const sha1 = createHash("sha1");
  for await (const chunk of createReadStream(file!)) sha1.update(chunk as Buffer);
  return {
    ...fields, projectId: "", versionId: `private-${sum.slice(0, 16)}`, versionNumber: version ?? name.replace(/\.jar$/, ""), versionType: "release",
    filename: name, url: privateUrl(name), sha512: sum, sha1: sha1.digest("hex"), size: (await stat(file!)).size, requiredBy: [], channels,
  };
}

/** The version a jar gives itself in META-INF/neoforge.mods.toml (its first mod's), unless that is filled in at build time; null when there is none. */
export function jarVersion(zip: Zip): string | null {
  const toml = zip.read("META-INF/neoforge.mods.toml")?.toString("utf8");
  const v = toml?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  if (v && !v.includes("${")) return v;
  const manifest = zip.read("META-INF/MANIFEST.MF")?.toString("utf8");
  return manifest?.match(/^Implementation-Version:\s*(\S+)/m)?.[1] ?? null;
}

/**
 * docs/44: a library pulled in only by one season's mods belongs to that season too, so it ships with them and not
 * without them. A season's file that something outside that season needs would leave the other without it: refused.
 */
export function seasonDependencies(files: LockEntry[]): void {
  const bySlug = new Map(files.map((f) => [f.slug, f]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of files) {
      if (f.season || f.requiredBy.length === 0) continue;
      const seasons = new Set(f.requiredBy.map((r) => bySlug.get(r)?.season ?? null));
      const [only] = [...seasons];
      if (seasons.size === 1 && only) {
        f.season = only;
        changed = true;
      }
    }
  }
  for (const f of files) {
    if (!f.season) continue;
    const others = f.requiredBy.filter((r) => bySlug.get(r)?.season !== f.season);
    if (others.length) throw new Error(`${f.slug} is a Season ${f.season} mod, but ${others.join(", ")} needs it outside that season: take "season" off ${f.slug} in mods.json`);
  }
}

/** docs/44: the lock's files that go to a server whose ship list is `ship`: every file without a season, and the files of the seasons in it. */
export function shippedFiles(lock: Pick<LockFile, "files">, ship: readonly string[]): LockEntry[] {
  return lock.files.filter((f) => !f.season || ship.includes(f.season));
}

/**
 * docs/44: the lock as one server and its PCs see it: only its shipped files, and the hash (so the pack's version)
 * over those. With nothing left out it is the lock itself, hash and all.
 */
export function shippedLock(lock: LockFile, ship: readonly string[]): LockFile {
  const files = shippedFiles(lock, ship);
  if (files.length === lock.files.length) return lock;
  return { ...lock, files, hash: packHash(lock.neoforge, files, lock.configs, lock.resourcepack) };
}

/**
 * What the pack's version ends in. The settings shipped with the pack are part of it: until 2026-09-29 they were
 * not, a change of settings alone left the lock "unchanged" and its list of settings empty, and no PC was sent
 * them. A pack without settings has the hash it always had.
 */
export function packHash(neoforge: string, files: Array<Pick<LockEntry, "slug" | "versionId">>, configs: LockFile["configs"], resourcepack?: string): string {
  return createHash("sha256").update([neoforge, ...files.map((f) => `${f.slug}@${f.versionId}`), ...configs.map((c) => `config:${c.path}@${c.sha256}`), ...(resourcepack ? [`resourcepack@${resourcepack}`] : [])].join("\n")).digest("hex");
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
  // the texture pack counts as a settings change: Lock writes it, Build puts it into config.zip
  if ((prev?.resourcepack ?? null) !== (next.resourcepack ?? null)) d.configs.push("resourcepack");
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

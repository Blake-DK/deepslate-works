import { createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import type { LockFile, LockEntry } from "./lock";
import type { Manifest } from "./schema";
import { fetchJar } from "./download";
import { shortHash } from "./lock";

// docs/06 + docs/07: dist/server/, dist/config.zip, dist/installer.zip

const forServer = (e: LockEntry) => e.side !== "client";

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function zipDir(entries: Array<{ dir?: string; file?: string; name: string }>, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(out);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    for (const e of entries) {
      if (e.dir) archive.directory(e.dir, e.name);
      else if (e.file) archive.file(e.file, { name: e.name });
    }
    void archive.finalize();
  });
}

/** The pack runs on Windows only since 2026-09-29: no .mrpack is built. A pack left from an earlier build is removed, so nothing stale is on offer. */
export async function removeClientPack(paths: { dist: string }, log: (s: string) => void): Promise<void> {
  for (const name of ["client.mrpack", "_mrpack"]) {
    const p = path.join(paths.dist, name);
    if (await exists(p)) {
      await rm(p, { recursive: true, force: true });
      log(`removed ${name} (Windows only: the installer downloads the mods itself)`);
    }
  }
}

/** dist/server/mods + configs + server-only files; jars are downloaded and hash-checked. */
export async function buildServer(m: Manifest, lock: LockFile, paths: { dist: string; config: string; server: string }, log: (s: string) => void): Promise<string> {
  const out = path.join(paths.dist, "server");
  const modsDir = path.join(out, "mods");
  await mkdir(modsDir, { recursive: true });
  const wanted = new Set<string>();
  let downloaded = 0;
  for (const e of lock.files.filter(forServer)) {
    wanted.add(e.filename);
    if ((await fetchJar(e, path.join(modsDir, e.filename), log)) === "downloaded") downloaded++;
  }
  for (const name of await readdir(modsDir)) {
    if (!wanted.has(name)) {
      await rm(path.join(modsDir, name));
      log(`removed stale ${name}`);
    }
  }
  if (await exists(paths.config)) await cp(paths.config, path.join(out, "config"), { recursive: true });
  if (await exists(paths.server)) await cp(paths.server, out, { recursive: true });
  await writeFile(path.join(out, "PACK_VERSION"), `${m.version}+${shortHash(lock)}\n`);
  log(`server: ${wanted.size} mods (${downloaded} downloaded), NeoForge ${lock.neoforge}`);
  return out;
}

/** config.zip: the config overrides for the Windows installer. */
export async function buildConfigZip(paths: { dist: string; config: string }, log: (s: string) => void): Promise<string | null> {
  if (!(await exists(paths.config))) return null;
  const out = path.join(paths.dist, "config.zip");
  await zipDir([{ dir: paths.config, name: "config" }], out);
  log("config.zip from modpack/config");
  return out;
}

/** installer.zip: Setup.bat + install.ps1 with the manifest URL and pack version stamped in. */
export async function buildInstaller(m: Manifest, lock: LockFile, paths: { dist: string; installer: string }, portalUrl: string, log: (s: string) => void): Promise<string> {
  const stage = path.join(paths.dist, "_installer");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const ps1 = await readFile(path.join(paths.installer, "install.ps1"), "utf8");
  const stamped = ps1
    .replace(/^\$PortalUrl\s*=.*$/m, `$PortalUrl = "${portalUrl}"`)
    .replace(/^\$PackName\s*=.*$/m, `$PackName = "${m.name}"`)
    .replace(/^\$PackVersion\s*=.*$/m, `$PackVersion = "${m.version}+${shortHash(lock)}"`);
  if (stamped === ps1) throw new Error("install.ps1: config block not found to stamp");
  await writeFile(path.join(stage, "install.ps1"), stamped);
  for (const f of ["Setup.bat", "Update and Play.bat", "README.txt"]) await cp(path.join(paths.installer, f), path.join(stage, f));
  const out = path.join(paths.dist, "installer.zip");
  await zipDir([{ dir: stage, name: false as unknown as string }], out);
  await rm(stage, { recursive: true, force: true });
  log(`installer.zip stamped with ${portalUrl} and version ${m.version}+${shortHash(lock)}`);
  return out;
}

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
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
export async function buildServer(m: Manifest, lock: LockFile, paths: { dist: string; config: string; server: string; datapacks?: string }, log: (s: string) => void): Promise<string> {
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
  // Settings are copied fresh every time: a file taken out of modpack/config/ (or modpack/server/config/) must not
  // linger in dist/ and go to the server with every Sync, as TabTPS's did for a day (2026-09-29).
  await rm(path.join(out, "config"), { recursive: true, force: true });
  if (await exists(paths.config)) await cp(paths.config, path.join(out, "config"), { recursive: true });
  if (await exists(paths.server)) await cp(paths.server, out, { recursive: true });
  // Datapacks are part of the world, not of the server's folder: Sync puts them into <world>/datapacks/.
  await rm(path.join(out, "datapacks"), { recursive: true, force: true });
  if (paths.datapacks && (await exists(paths.datapacks))) {
    await cp(paths.datapacks, path.join(out, "datapacks"), { recursive: true });
    log(`datapacks: ${(await readdir(paths.datapacks)).join(", ")}`);
  }
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

/** The version a script calls itself: `$InstallerVersion = "1.4.0"`. */
export function installerVersion(ps1: string): string | null {
  return /^\$InstallerVersion\s*=\s*"(\d{1,4}(?:\.\d{1,4}){1,3})"/m.exec(ps1)?.[1] ?? null;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * The files in installer.zip (docs/07, installer 1.5.0): the one script, the bootstrap that puts it in place, a note,
 * and install.ps1.
 * install.ps1 is a byte-for-byte copy of the stamped DeepslateWorks.ps1 and exists ONLY so that 1.4.x copies can
 * update themselves: their update step takes "Setup.bat" and "install.ps1" out of the zip by those names (installer
 * 1.5.3, docs/07). Remove it once no report from a 1.4.x installer has arrived for 30 days.
 */
export const INSTALLER_ZIP_FILES = ["Setup.bat", "DeepslateWorks.ps1", "README.txt", "install.ps1"] as const;
export const INSTALLER_SCRIPT = "DeepslateWorks.ps1";
/** The name 1.4.x looks for in the zip; see INSTALLER_ZIP_FILES. */
export const INSTALLER_BRIDGE = "install.ps1";

/**
 * installer.zip: Setup.bat + DeepslateWorks.ps1 (with the site's address and the pack version stamped in) + README, and
 * the same script again as install.ps1 for 1.4.x copies. The zip's SHA-256 is what 1.4.x checks, so it stays the zip's.
 * dist/DeepslateWorks.ps1: the same stamped script on its own, which an installed copy fetches to update itself.
 * installer.json next to them: the version, the zip's SHA-256 and the script's, which the mod list passes on so that
 * an installed copy can check what it fetched (docs/07 "Updates").
 */
export async function buildInstaller(m: Manifest, lock: LockFile, paths: { dist: string; installer: string }, portalUrl: string, log: (s: string) => void): Promise<string> {
  const stage = path.join(paths.dist, "_installer");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const ps1 = await readFile(path.join(paths.installer, INSTALLER_SCRIPT), "utf8");
  const stamped = ps1
    .replace(/^\$PortalUrl\s*=.*$/m, `$PortalUrl = "${portalUrl}"`)
    .replace(/^\$PackName\s*=.*$/m, `$PackName = "${m.name}"`)
    .replace(/^\$PackVersion\s*=.*$/m, `$PackVersion = "${m.version}+${shortHash(lock)}"`);
  if (stamped === ps1) throw new Error(`${INSTALLER_SCRIPT}: config block not found to stamp`);
  const version = installerVersion(stamped);
  if (!version) throw new Error(`${INSTALLER_SCRIPT}: $InstallerVersion not found`);
  await writeFile(path.join(stage, INSTALLER_SCRIPT), stamped);
  await writeFile(path.join(stage, INSTALLER_BRIDGE), stamped);
  for (const f of INSTALLER_ZIP_FILES) if (f !== INSTALLER_SCRIPT && f !== INSTALLER_BRIDGE) await cp(path.join(paths.installer, f), path.join(stage, f));
  const script = path.join(paths.dist, INSTALLER_SCRIPT);
  await writeFile(script, stamped);
  const out = path.join(paths.dist, "installer.zip");
  await zipDir([{ dir: stage, name: false as unknown as string }], out);
  await rm(stage, { recursive: true, force: true });
  const sha256 = await sha256File(out);
  const { size } = await stat(out);
  const scriptInfo = { sha256: await sha256File(script), size: (await stat(script)).size };
  const exe = await takeCiExe(paths.dist, log);
  await writeFile(path.join(paths.dist, "installer.json"), `${JSON.stringify({ version, sha256, size, script: scriptInfo, exe, builtAt: new Date().toISOString() }, null, 2)}\n`);
  log(`installer.zip stamped with ${portalUrl} and version ${m.version}+${shortHash(lock)}`);
  log(`installer ${version}: zip sha256 ${sha256}, ${INSTALLER_SCRIPT} sha256 ${scriptInfo.sha256}`);
  return out;
}

/** Where deploy/deploy.sh puts the app CI built (3.0): DeepslateWorks.exe, its .sha256 and VERSION, from the image ghcr.io/<owner>/deepslate-installer. */
export const CI_EXE_DIR = "ci";
export const EXE_NAME = "DeepslateWorks.exe";

/**
 * Deepslate Works 3.0 (docs/07): the exe is built and tested by CI on a windows runner, never here. deploy.sh copies it
 * out of its image into dist/ci/; this checks it against the checksum CI wrote and its VERSION, and publishes it as
 * dist/DeepslateWorks.exe, described in installer.json as `exe`. No exe there (or one that does not check out): `exe`
 * is null, and the site hands out the PowerShell installer as before. The exe is never changed here: no stamping, the
 * site's address is built in (installer.yml), so the checksum CI made is the one every PC checks.
 */
export async function takeCiExe(dist: string, log: (s: string) => void): Promise<{ version: string; sha256: string; size: number } | null> {
  const dir = path.join(dist, CI_EXE_DIR);
  const out = path.join(dist, EXE_NAME);
  const drop = async (why: string) => {
    log(`DeepslateWorks.exe not published: ${why}`);
    await rm(out, { force: true });
    return null;
  };
  try {
    await stat(path.join(dir, EXE_NAME));
  } catch {
    return drop("no exe from CI in dist/ci (deploy.sh puts it there)");
  }
  const version = (await readFile(path.join(dir, "VERSION"), "utf8").catch(() => "")).trim();
  if (!/^\d{1,4}(\.\d{1,4}){1,3}$/.test(version)) return drop("dist/ci/VERSION is missing or not a version");
  const claimed = (await readFile(path.join(dir, `${EXE_NAME}.sha256`), "utf8").catch(() => "")).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const sha256 = await sha256File(path.join(dir, EXE_NAME));
  if (claimed !== sha256) return drop(`its checksum ${sha256.slice(0, 12)}... is not the one CI wrote (${claimed.slice(0, 12) || "none"})`);
  const head = (await readFile(path.join(dir, EXE_NAME))).subarray(0, 2).toString("latin1");
  if (head !== "MZ") return drop("it is not a Windows program");
  await cp(path.join(dir, EXE_NAME), out);
  const { size } = await stat(out);
  log(`DeepslateWorks.exe ${version}: sha256 ${sha256}, ${(size / 1048576).toFixed(2)} MB`);
  return { version, sha256, size };
}

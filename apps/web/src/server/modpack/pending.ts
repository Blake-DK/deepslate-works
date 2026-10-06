import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { hashConfigs, hashResourcePack } from "modpack/hashes";
import { pendingSteps, type Pending } from "modpack/pending";
import { installerVersion } from "modpack/script-version";
import { db } from "@/server/db";
import { getManifest } from "@/server/modpack/manifest";
import { getLock, P } from "@/server/modpack/lock";
import { git } from "@/server/modpack/drift";

// Admin → Modpack's "out of date" box (Alex, 2026-10-06): the facts for packages/modpack/src/pending.ts. Nothing new is
// written anywhere: the last Build is known by its files' times in dist/, and what the repo changed since then by the
// deploy checkout's reflog (which commit was checked out at that time) and git diff.

const text = (f: string) => readFile(f, "utf8").catch(() => null);
const mtime = (f: string) => stat(f).then((s) => s.mtime, () => null);

/** The commit the checkout was on at `at`, from its reflog; null when the reflog does not reach back that far. */
async function headAt(at: Date): Promise<string | null> {
  const out = await git(["reflog", "show", "--date=unix", "--format=%H %gd", "HEAD"]);
  for (const line of (out ?? "").split("\n")) {
    const m = /^([0-9a-f]{40}) HEAD@\{(\d+)\}$/.exec(line.trim());
    if (m && Number(m[2]) * 1000 <= at.getTime()) return m[1]!; // newest first
  }
  return null;
}

/** mods.json without its list of mods, which the lock covers: what else Build reads from it. */
function settingsOf(raw: string | null): string | null {
  try {
    const settings = JSON.parse(raw ?? "") as Record<string, unknown>;
    delete settings.mods;
    return JSON.stringify(settings);
  } catch {
    return null;
  }
}

export async function getPending(): Promise<Pending> {
  const dist = P.dist;
  const [manifest, lock, configs, resourcepack, packText, serverBuiltAt, installerJson, ciVersion, ciSum, repoPs1, sourceAt, logoAt, syncedRow, manifestRaw] = await Promise.all([
    getManifest(),
    getLock(),
    hashConfigs(P.config),
    hashResourcePack(P.resourcepack),
    text(path.join(dist, "server", "PACK_VERSION")),
    mtime(path.join(dist, "server", "PACK_VERSION")),
    text(path.join(dist, "installer.json")),
    text(path.join(dist, "ci", "VERSION")),
    text(path.join(dist, "ci", "DeepslateWorks.exe.sha256")),
    git(["show", "HEAD:installer/DeepslateWorks.ps1"]),
    mtime(path.join(dist, "branding", "source.json")),
    mtime(path.join(dist, "branding", "branding.json")),
    db.setting.findUnique({ where: { key: "_packSynced" } }).catch(() => null),
    text(P.manifest),
  ]);

  let built: { version?: unknown; exe?: { version?: unknown; sha256?: unknown } | null; builtAt?: unknown } = {};
  try {
    built = JSON.parse(installerJson ?? "") as typeof built;
  } catch {
    // no download built yet
  }
  const installerBuiltAt = typeof built.builtAt === "string" && !Number.isNaN(Date.parse(built.builtAt)) ? new Date(built.builtAt) : null;
  // the last full Build: the earlier of its two ends, so that nothing changed in between is missed
  const times = [serverBuiltAt, installerBuiltAt].filter((d): d is Date => d !== null);
  const lastBuild = times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null;
  const then = lastBuild ? await headAt(lastBuild) : null;
  const [diff, thenManifest] = then ? await Promise.all([git(["diff", "--name-only", then, "HEAD"]), git(["show", `${then}:modpack/mods.json`])]) : [null, null];

  const sum = (ciSum ?? "").trim().split(/\s+/)[0] ?? "";
  const s = syncedRow?.value as { version?: unknown; at?: unknown } | null | undefined;
  return pendingSteps({
    manifest,
    lock,
    configs,
    resourcepack,
    builtPack: packText?.trim() || null,
    changedSinceBuild: diff === null ? null : diff.split("\n").map((l) => l.trim()).filter(Boolean),
    settingsChanged: Boolean(thenManifest && settingsOf(thenManifest) !== null && settingsOf(thenManifest) !== settingsOf(manifestRaw)),
    ciApp: ciVersion?.trim() && /^[0-9a-f]{64}$/.test(sum) ? { version: ciVersion.trim(), sha256: sum } : null,
    builtApp: built.exe && typeof built.exe.version === "string" && typeof built.exe.sha256 === "string" ? { version: built.exe.version, sha256: built.exe.sha256 } : null,
    repoScript: repoPs1 ? installerVersion(repoPs1) : null,
    builtScript: typeof built.version === "string" ? built.version : null,
    brandingPicked: Boolean(sourceAt && (!logoAt || sourceAt.getTime() > logoAt.getTime())),
    synced: typeof s?.version === "string" && typeof s.at === "string" ? { version: s.version, at: new Date(s.at) } : null,
    serverBuiltAt,
  });
}


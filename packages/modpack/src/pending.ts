import type { ConfigHash } from "./hashes";
import type { LockFile } from "./lock";
import type { Manifest } from "./schema";

// Admin → Modpack's "out of date" box (Alex, 2026-10-06): which of Lock, Build and Sync server have to be pressed,
// and why. Pure, so it is tested; apps/web/src/server/modpack/pending.ts gathers the facts from the repo, its git
// history, dist/ and the database.

export type Step = "lock" | "build" | "sync";

/** What is true now. Anything not known is null, and then nothing is said about it. */
export type PendingFacts = {
  manifest: Manifest;
  lock: LockFile | null;
  /** modpack/config/ and modpack/resourcepack/ as they are now (hashes.ts), to hold against the lock's. */
  configs: ConfigHash[];
  resourcepack: string | undefined;
  /** dist/server/PACK_VERSION: the pack the last Build made. */
  builtPack: string | null;
  /** Files the repo changed in git since the last Build, repo-relative. null: not known. */
  changedSinceBuild: string[] | null;
  /** mods.json, apart from its list of mods (which the lock covers), is not what the last Build read. */
  settingsChanged: boolean;
  /** dist/ci: the app CI delivered (deploy.sh), and the one the download hands out (installer.json `exe`). */
  ciApp: { version: string; sha256: string } | null;
  builtApp: { version: string; sha256: string } | null;
  /** $InstallerVersion of installer/DeepslateWorks.ps1 in the repo, and installer.json's `version`. */
  repoScript: string | null;
  builtScript: string | null;
  /** A logo was picked in Admin → Branding after the last Build made its sizes. */
  brandingPicked: boolean;
  /** docs/37: builds uploaded, replaced or removed on Admin → Builds since the last Build (uploadsSinceBuild). */
  uploadsChanged?: string[];
  /** The pack the server was last synced to, and when; when dist/server was last built. */
  synced: { version: string; at: Date } | null;
  serverBuiltAt: Date | null;
};

export type Reason = { step: Step; text: string };
export type Pending = { steps: Step[]; reasons: Reason[]; pack: { repo: string | null; built: string | null; server: string | null } };

const MOST = 5;
const list = (xs: string[]) => (xs.length <= MOST ? xs.join(", ") : `${xs.slice(0, MOST).join(", ")} and ${xs.length - MOST} more`);

/** Build reads these (packages/modpack/src/cli.ts "build"). Settings and textures go through the lock, the lock through the pack's version. */
const BUILD_INPUTS: Array<{ prefix: string; server: boolean }> = [
  { prefix: "modpack/server/", server: true },
  { prefix: "modpack/datapacks/", server: true },
  { prefix: "modpack/seasons/", server: true },
  { prefix: "modpack/items/", server: false }, // the item catalogue is the site's, not the server's
  { prefix: "installer/Setup.bat", server: false },
  { prefix: "installer/README.txt", server: false },
];

/** Why the lock no longer matches mods.json and the files it keeps checksums of. */
export function lockReasons(f: Pick<PendingFacts, "manifest" | "lock" | "configs" | "resourcepack">): string[] {
  const { manifest: m, lock } = f;
  if (!lock) return ["There is no lock yet."];
  const out: string[] = [];
  const locked = new Map(lock.files.map((x) => [x.slug, x]));
  const on = m.mods.filter((x) => x.enabled);
  const onSlugs = new Set(on.map((x) => x.slug));
  const missing = on.filter((x) => !locked.has(x.slug)).map((x) => x.name);
  if (missing.length) out.push(`Switched on but not in the lock: ${list(missing)}.`);
  // a mod in the lock only because another needs it (requiredBy) is not one somebody switched on
  const off = lock.files.filter((x) => !onSlugs.has(x.slug) && (x.requiredBy ?? []).length === 0).map((x) => x.name || x.slug);
  if (off.length) out.push(`Switched off but still in the lock: ${list(off)}.`);
  const pinned = on.filter((x) => x.version !== "latest" && locked.has(x.slug) && locked.get(x.slug)!.versionId !== x.version).map((x) => x.name);
  if (pinned.length) out.push(`Set to another version than the lock has: ${list(pinned)}.`);
  if (m.neoforge !== "latest" && m.neoforge !== lock.neoforge) out.push(`NeoForge is set to ${m.neoforge}; the lock has ${lock.neoforge}.`);
  const was = new Map(lock.configs.map((c) => [c.path, c.sha256]));
  const now = new Map(f.configs.map((c) => [c.path, c.sha256]));
  const settings = [...new Set([...was.keys(), ...now.keys()])].filter((p) => was.get(p) !== now.get(p)).sort();
  if (settings.length) out.push(`Settings files changed: ${list(settings)}.`);
  if ((lock.resourcepack ?? undefined) !== f.resourcepack) out.push("The resource pack's textures changed.");
  return out;
}

export function pendingSteps(f: PendingFacts): Pending {
  const reasons: Reason[] = [];
  const add = (step: Step, text: string) => reasons.push({ step, text });
  let serverBuild = false;

  for (const t of lockReasons(f)) add("lock", t);
  const lockNeeded = reasons.length > 0;

  const repo = f.lock ? `${f.manifest.version}+${f.lock.hash.slice(0, 8)}` : null;
  if (repo && !f.builtPack) {
    add("build", "Nothing has been built yet.");
    serverBuild = true;
  } else if (repo && f.builtPack && repo !== f.builtPack) {
    add("build", `The lock has pack ${repo}; the last build made ${f.builtPack}.`);
    serverBuild = true;
  }
  if (f.ciApp && (!f.builtApp || f.ciApp.sha256 !== f.builtApp.sha256)) {
    add("build", f.builtApp && f.builtApp.version !== f.ciApp.version ? `A new app from CI is waiting: Deepslate Works ${f.ciApp.version} (the download is ${f.builtApp.version}).` : `A new app from CI is waiting: Deepslate Works ${f.ciApp.version}.`);
  }
  if (f.repoScript && f.builtScript && f.repoScript !== f.builtScript) add("build", `The old launcher script is ${f.repoScript} in the repo; the download has ${f.builtScript}.`);
  const changed = (f.changedSinceBuild ?? []).filter((p) => BUILD_INPUTS.some((i) => p.startsWith(i.prefix))).sort();
  if (changed.length) {
    add("build", `Changed since the last build: ${list(changed)}.`);
    if (changed.some((p) => BUILD_INPUTS.find((i) => p.startsWith(i.prefix))?.server)) serverBuild = true;
  }
  if (f.settingsChanged) {
    add("build", "mods.json's settings (server properties, memory, profile) changed since the last build.");
    serverBuild = true;
  }
  if (f.brandingPicked) {
    add("build", "A new logo was picked in Admin → Branding.");
    serverBuild = true; // the server's icon
  }
  if (f.uploadsChanged?.length) {
    add("build", `Builds uploaded or removed since the last build: ${list(f.uploadsChanged)}.`);
    serverBuild = true; // they go into the server's datapacks
  }

  if (f.builtPack) {
    if (!f.synced) add("sync", "The server has not been synced from the site yet.");
    else if (f.synced.version !== f.builtPack) add("sync", `The server runs pack ${f.synced.version}; the build is ${f.builtPack}.`);
    else if (f.serverBuiltAt && f.serverBuiltAt.getTime() > f.synced.at.getTime()) add("sync", "Built again after the last sync.");
  }

  const buildNeeded = reasons.some((r) => r.step === "build");
  const steps: Step[] = [];
  if (lockNeeded) steps.push("lock");
  if (lockNeeded || buildNeeded) steps.push("build");
  // a new lock always makes a new pack for the server; an app-only build does not touch it
  if (lockNeeded || serverBuild || reasons.some((r) => r.step === "sync")) steps.push("sync");
  return { steps, reasons, pack: { repo, built: f.builtPack, server: f.synced?.version ?? null } };
}

/**
 * The uploads (data/builds/) the last Build did not see as they are now: new or replaced since dist/builds.json was
 * written, or gone from data/builds/ while builds.json still has them. No builds.json: every upload is new.
 */
export function uploadsSinceBuild(built: { names: string[]; at: Date } | null, now: Array<{ name: string; at: Date }>): string[] {
  const out = new Set<string>();
  for (const u of now) if (!built || !built.names.includes(u.name) || u.at.getTime() > built.at.getTime()) out.add(u.name);
  for (const n of built?.names ?? []) if (!now.some((u) => u.name === n)) out.add(n);
  return [...out].sort();
}

const LABEL: Record<Step, string> = { lock: "Lock", build: "Build", sync: "Sync server" };

/** The box's first line: what to press, in order. */
export function pendingHeadline(p: Pick<Pending, "steps">): string {
  if (p.steps.length === 0) return "Up to date: the server runs what is in the repo.";
  const names = p.steps.map((s) => LABEL[s]);
  const order = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", then ")}, then ${names[names.length - 1]}`;
  return `Out of date: press ${order}.${p.steps.includes("build") && !p.steps.includes("sync") ? " No sync needed: only the download changed." : ""}`;
}

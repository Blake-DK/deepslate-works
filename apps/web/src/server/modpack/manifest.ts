import "server-only";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { lintManifest, type Category, type Manifest, type Mod } from "modpack";

// One manifest, read from disk (bind-mounted repo in prod), re-read when the file changes.
const MODPACK_DIR = process.env.MODPACK_DIR ?? path.resolve(process.cwd(), "..", "..", "modpack");
const REPO_DIR = process.env.REPO_DIR ?? path.resolve(MODPACK_DIR, "..");
const FILE = path.join(MODPACK_DIR, "mods.json");

let cache: { mtimeMs: number; manifest: Manifest } | null = null;

export class ManifestError extends Error {}

export async function getManifest(): Promise<Manifest> {
  const { mtimeMs } = await stat(FILE);
  if (cache && cache.mtimeMs === mtimeMs) return cache.manifest;
  const raw = JSON.parse(await readFile(FILE, "utf8")) as unknown;
  const { manifest, issues } = lintManifest(raw);
  const errors = issues.filter((i) => i.level === "error");
  if (!manifest || errors.length) throw new ManifestError(`mods.json invalid: ${errors.map((e) => e.message).join("; ")}`);
  cache = { mtimeMs, manifest };
  return manifest;
}

/**
 * The address players join. The real one is SERVER_ADDRESS in deploy/.env, so it is not in the public repository;
 * mods.json's `server_address` is a placeholder, used when SERVER_ADDRESS is not set (development).
 */
export function serverAddress(m: Manifest): string {
  return process.env.SERVER_ADDRESS || m.server_address;
}

export type Section = { category: Category; mods: Mod[] };

/**
 * Categories in manifest order, each with its visible mods. Hidden (dependency) mods are never listed; admin-only ones
 * (the coming season's) only when `admin`. A category left empty is left out, its title and blurb with it.
 */
export function sections(m: Manifest, opts: { votableOnly?: boolean; admin?: boolean } = {}): Section[] {
  return m.categories
    .filter((c) => !opts.votableOnly || c.votable)
    .map((category) => ({ category, mods: m.mods.filter((mod) => mod.category === category.id && !mod.hidden && (opts.admin || !mod.adminOnly)) }))
    .filter((s) => s.mods.length > 0);
}

export function votableMods(m: Manifest): Mod[] {
  const votable = new Set(m.categories.filter((c) => c.votable).map((c) => c.id));
  return m.mods.filter((mod) => !mod.hidden && votable.has(mod.category));
}

export function modBySlug(m: Manifest): Map<string, Mod> {
  return new Map(m.mods.map((mod) => [mod.slug, mod]));
}

/** Writes atomically (temp + rename) so a crash never leaves a half-written manifest. */
export async function writeManifest(next: Manifest): Promise<void> {
  if (process.env.TEST_MODE === "1") throw new ManifestError("The test site never writes to git"); // docs/42 T3
  const { manifest, issues } = lintManifest(next);
  const errors = issues.filter((i) => i.level === "error");
  if (!manifest || errors.length) throw new ManifestError(errors.map((e) => e.message).join("; "));
  const tmp = `${FILE}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await rename(tmp, FILE);
  cache = null;
}

function git(args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile("git", ["-C", REPO_DIR, "-c", `safe.directory=${REPO_DIR}`, ...args], { timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout}${stderr}`.trim() });
    });
  });
}

/** Commits manifest files so their history lives in git. Failure is reported, not thrown: the files are already written. */
export async function commitManifest(message: string, author: { name: string; email?: string }, files: string[] = ["modpack/mods.json"]): Promise<{ ok: boolean; output: string }> {
  // docs/42 T3: the test site's checkout follows origin/dev (deploy/test-pull.sh) and is never committed to
  if (process.env.TEST_MODE === "1") return { ok: false, output: "The test site never writes to git" };
  const add = await git(["add", "--", ...files]);
  if (!add.ok) return add;
  const email = author.email ?? "portal@deepslate.invalid";
  const res = await git(["-c", `user.name=${author.name}`, "-c", `user.email=${email}`, "commit", "-q", "-m", message, "--", ...files]);
  if (!res.ok && /nothing to commit|no changes added/i.test(res.output)) return { ok: true, output: "nothing to commit" };
  return res;
}

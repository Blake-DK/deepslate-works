import { z } from "zod";
import type { LockFile } from "./lock";
import { getProject, getVersion, getVersions, NotFound } from "./modrinth";
import { pickVersion } from "./lock";

// Extras (planner, 2026-10-01): personal, client-only, never voted on, chosen in the Deepslate Works app's Extras tab.
// modpack/extras.json says what they are; modpack/extras.lock.json pins the files. They are not part of the pack: the
// pack's version, the server, the vote and the join check never see them.

export const FPS_COSTS = ["Low", "Medium", "High"] as const;
export const EXTRA_KINDS = ["mod", "resourcepack", "shader"] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];

export const extraSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(160), // one line in the app
  fps: z.enum(FPS_COSTS), // estimated FPS cost
  // a shader pack is one of the choices under Iris ("light" or "full"), not a switch of its own
  shader: z.enum(["light", "full"]).optional(),
  requires: z.array(z.string()).default([]), // other extras that switch on with it (shaders: iris)
  // the mod ids the game loads for it, which the app looks for in the game's latest.log ("Confirmed in game")
  modIds: z.array(z.string().regex(/^[a-z0-9_.-]+$/)).default([]),
  projects: z.array(z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/), version: z.string().default("latest") })).min(1),
});
export const extrasSchema = z.object({ extras: z.array(extraSchema).min(1) });
export type Extra = z.infer<typeof extraSchema>;
export type ExtrasFile = z.infer<typeof extrasSchema>;

export type ExtraFile = { slug: string; name: string; kind: ExtraKind; versionId: string; versionNumber: string; versionType: string; filename: string; url: string; sha512: string; size: number };
export type LockedExtra = Omit<Extra, "projects"> & { files: ExtraFile[]; size: number; picture: string | null };
export type ExtrasLock = { generatedAt: string; minecraft: string; hash: string; extras: LockedExtra[] };

export function lintExtras(raw: unknown): { extras: ExtrasFile | null; errors: string[] } {
  const parsed = extrasSchema.safeParse(raw);
  if (!parsed.success) return { extras: null, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const x of parsed.data.extras) {
    if (ids.has(x.id)) errors.push(`duplicate extra ${x.id}`);
    ids.add(x.id);
  }
  for (const x of parsed.data.extras) for (const r of x.requires) if (!ids.has(r)) errors.push(`${x.id}: requires ${r}, which is not an extra`);
  for (const choice of ["light", "full"]) if (parsed.data.extras.filter((x) => x.shader === choice).length > 1) errors.push(`more than one shader for "${choice}"`);
  return { extras: errors.length ? null : parsed.data, errors };
}

const loaderFor = (kind: ExtraKind, modLoader: string) => (kind === "resourcepack" ? "minecraft" : kind === "shader" ? "iris" : modLoader);
const kindOf = (t: string | undefined): ExtraKind => (t === "resourcepack" ? "resourcepack" : t === "shader" ? "shader" : "mod");

/**
 * Pins every extra's files. A required dependency the pack already has (Iris needs Sodium) is left out; one it does
 * not have goes with the extra that needs it. `picture` turns a Modrinth icon into a small PNG (WPF cannot show WebP).
 */
export async function buildExtrasLock(
  extras: ExtrasFile,
  pack: Pick<LockFile, "files" | "minecraft">,
  opts: { loader: string; picture?: (url: string) => Promise<string | null>; onProgress?: (s: string) => void },
): Promise<{ lock: ExtrasLock; warnings: string[] }> {
  const warnings: string[] = [];
  const log = opts.onProgress ?? (() => {});
  const inPack = new Set(pack.files.map((f) => f.projectId));
  const out: LockedExtra[] = [];
  for (const x of extras.extras) {
    const files: ExtraFile[] = [];
    const seen = new Set<string>();
    let icon: string | null = null;
    const queue: Array<{ ref: string; version: string; by: string | null }> = x.projects.map((p) => ({ ref: p.slug, version: p.version, by: null }));
    while (queue.length) {
      const item = queue.shift()!;
      const project = await getProject(item.ref).catch((e) => {
        if (e instanceof NotFound) throw new Error(`${x.id}: ${item.ref} not found on Modrinth`);
        throw e;
      });
      if (seen.has(project.id) || (item.by && inPack.has(project.id))) continue;
      seen.add(project.id);
      const kind = kindOf(project.project_type);
      const loader = loaderFor(kind, opts.loader);
      if (!project.loaders.includes(loader) || !project.game_versions.includes(pack.minecraft)) throw new Error(`${x.id}: ${project.slug} has no ${loader} ${pack.minecraft} build on Modrinth`);
      const version = pickVersion(await getVersions(project.id, loader, pack.minecraft), item.version, project.slug, (w) => warnings.push(w));
      const file = version.files.find((f) => f.primary) ?? version.files[0];
      if (!file) throw new Error(`${x.id}: ${project.slug} ${version.version_number} has no files`);
      files.push({ slug: project.slug, name: project.title, kind, versionId: version.id, versionNumber: version.version_number, versionType: version.version_type, filename: file.filename, url: file.url, sha512: file.hashes.sha512, size: file.size });
      if (!icon && project.icon_url) icon = project.icon_url;
      log(`${x.id}: ${project.slug} ${version.version_number} (${(file.size / 1048576).toFixed(1)} MB)${item.by ? ` <- ${item.by}` : ""}`);
      for (const dep of version.dependencies) {
        if (dep.dependency_type !== "required") continue;
        const ref = dep.project_id ?? (dep.version_id ? (await getVersion(dep.version_id)).project_id : null);
        if (ref) queue.push({ ref, version: "latest", by: project.slug });
      }
    }
    out.push({ id: x.id, name: x.name, description: x.description, fps: x.fps, shader: x.shader, requires: x.requires, modIds: x.modIds, files, size: files.reduce((n, f) => n + f.size, 0), picture: icon && opts.picture ? await opts.picture(icon).catch(() => null) : null });
  }
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(out.flatMap((x) => [x.id, ...x.files.map((f) => `${f.slug}@${f.versionId}`)]).join("\n")).digest("hex");
  return { lock: { generatedAt: new Date().toISOString(), minecraft: pack.minecraft, hash, extras: out }, warnings };
}

/** What the app is sent (GET /api/modpack/extras): everything it needs to download, show and switch them. */
export function extrasForApp(lock: ExtrasLock) {
  return {
    hash: lock.hash,
    size: lock.extras.reduce((n, x) => n + x.size, 0),
    extras: lock.extras.map((x) => ({
      id: x.id, name: x.name, description: x.description, fps: x.fps, shader: x.shader ?? null, requires: x.requires, modIds: x.modIds ?? [], size: x.size, picture: x.picture,
      files: x.files.map((f) => ({ slug: f.slug, kind: f.kind, filename: f.filename, url: f.url, sha512: f.sha512, size: f.size })),
    })),
  };
}

/** A Modrinth icon as a 64 px PNG, base64 (sharp; WPF cannot show WebP). */
export async function pngPicture(url: string): Promise<string | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const sharp = (await import("sharp")).default;
  const png = await sharp(Buffer.from(await res.arrayBuffer())).resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return png.toString("base64");
}

/**
 * Locks modpack/extras.json into modpack/extras.lock.json (run with every Lock). Returns what changed in words;
 * the file is written only when the pinned files are not the same as before.
 */
export async function lockExtras(paths: { extras: string; extrasLock: string }, pack: Pick<LockFile, "files" | "minecraft">, loader: string, log: (s: string) => void): Promise<{ written: boolean; lock: ExtrasLock | null }> {
  const { readFile, writeFile, rename } = await import("node:fs/promises");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(paths.extras, "utf8"));
  } catch {
    log("no extras.json: no extras");
    return { written: false, lock: null };
  }
  const { extras, errors } = lintExtras(raw);
  if (!extras) throw new Error(`extras.json: ${errors.join("; ")}`);
  let prev: ExtrasLock | null = null;
  try {
    prev = JSON.parse(await readFile(paths.extrasLock, "utf8")) as ExtrasLock;
  } catch {}
  const { lock, warnings } = await buildExtrasLock(extras, pack, { loader, picture: pngPicture, onProgress: log });
  for (const w of warnings) log(`WARN  extras: ${w}`);
  const words = (l: ExtrasLock) => JSON.stringify(l.extras.map((x) => ({ ...x, picture: null })));
  const same = prev && prev.hash === lock.hash && words(prev) === words(lock);
  const mb = (lock.extras.reduce((n, x) => n + x.size, 0) / 1048576).toFixed(1);
  if (same) {
    log(`extras.lock.json unchanged (${lock.extras.length} extras, ${mb} MB)`);
    return { written: false, lock: prev };
  }
  await writeFile(`${paths.extrasLock}.tmp`, JSON.stringify(lock, null, 2) + "\n");
  await rename(`${paths.extrasLock}.tmp`, paths.extrasLock);
  log(`wrote extras.lock.json: ${lock.extras.length} extras, ${mb} MB, hash ${lock.hash.slice(0, 8)}`);
  return { written: true, lock };
}

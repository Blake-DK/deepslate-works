import { isPlayerFacing, manifestSchema, type Manifest } from "./schema";
import type { LockFile } from "./lock";
import { modUrlProblem, privateJarOf } from "./mod-url";

export type LintIssue = { level: "error" | "warn"; message: string };

/** Structural validation plus the cross-field rules from docs/06. */
export function lintManifest(raw: unknown): { manifest: Manifest | null; issues: LintIssue[] } {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { manifest: null, issues: parsed.error.issues.map((i) => ({ level: "error", message: `${i.path.join(".") || "(root)"}: ${i.message}` })) };
  }
  const m = parsed.data;
  const issues: LintIssue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warn", message });

  const catIds = new Set(m.categories.map((c) => c.id));
  const votableCats = new Set(m.categories.filter((c) => c.votable).map((c) => c.id));
  const slugs = new Set<string>();
  const enabledByGroup = new Map<string, string[]>();
  const jarNames = new Set<string>();
  for (const mod of m.mods) {
    if (slugs.has(mod.slug)) err(`duplicate slug ${mod.slug}`);
    slugs.add(mod.slug);
    if (!catIds.has(mod.category)) err(`${mod.slug}: unknown category ${mod.category}`);
    if (mod.exclusiveGroup && mod.enabled) {
      const list = enabledByGroup.get(mod.exclusiveGroup) ?? [];
      list.push(mod.slug);
      enabledByGroup.set(mod.exclusiveGroup, list);
    }
    if (!mod.hidden && !mod.noVideosFound && mod.videos.length === 0) warn(`${mod.slug}: no videos (TODO)`);
    if (mod.noVideosFound && mod.videos.length > 0) err(`${mod.slug}: has videos and "noVideosFound": take one out`);
    // the Mods guide (/mods): every listed mod says where it goes, and every one a player uses says how
    if (!mod.hidden && !mod.guide) err(`${mod.slug}: no "guide" (game, helper or behind): the Mods guide needs to know where it goes`);
    if (!mod.hidden && mod.guide === "game" && !mod.topic) err(`${mod.slug}: in the guide's "game" part but has no "topic" (docs/52): the Mods guide needs to know which section it goes in`);
    if (mod.topic && mod.guide !== "game") err(`${mod.slug}: has "topic" ${mod.topic}, but only a mod with "guide": "game" has one`);
    if (isPlayerFacing(mod) && !mod.howTo) err(`${mod.slug}: switched on and player-facing, but has no "howTo" for the Mods guide`);
    // "helper" is what a player has on their own PC; a server-only mod can't be one. One in "game" is fine when players
    // use it in the world (Server Sided Portals: they build the portal), and the guide says "On the server only".
    if (mod.guide === "helper" && mod.side === "server") warn(`${mod.slug}: server-only but in the guide's "helper" part`);
    if (mod.adminOnly && votableCats.has(mod.category)) err(`${mod.slug}: admin-only, but in a votable category: a mod up for vote is seen by everyone`);
    if (mod.side === "server" && mod.exclusiveGroup) warn(`${mod.slug}: server-only mods should not be in an exclusive group`);
    // docs/58: a private jar is that file and no Modrinth version; going back to Modrinth drops "source" and pins one
    if (mod.source && mod.version !== "latest") err(`${mod.slug}: has a private "source" and a Modrinth "version" (${mod.version}): take "version" out while the jar is private (docs/58)`);
    if (mod.source && jarNames.has(mod.source.private)) err(`${mod.slug}: private jar ${mod.source.private} is named by another mod too`);
    if (mod.source) jarNames.add(mod.source.private);
  }
  const bySlug = new Map(m.mods.map((x) => [x.slug, x]));
  for (const mod of m.mods) {
    for (const dep of mod.requires) if (!slugs.has(dep)) err(`${mod.slug}: requires ${dep}, which is not in the list`);
    // docs/31 B-28: a mod that is on needs what it requires to be on. Vanillin (base, not votable) needs Create's
    // Flywheel; were Create voted out, every PC would fail at start.
    if (mod.enabled) for (const dep of mod.requires) if (bySlug.get(dep)?.enabled === false) err(`${mod.slug}: is switched on and requires ${dep}, which is switched off`);
  }
  for (const [group, list] of enabledByGroup) if (list.length > 1) err(`exclusive group ${group} has more than one enabled mod: ${list.join(", ")}`);
  return { manifest: m, issues };
}

/** Every file in the lock must come from Modrinth's CDN, or be a private jar on the site's own /downloads/mods/ (mod-url.ts, docs/58). */
export function lintLock(lock: Pick<LockFile, "files">): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const f of lock.files ?? []) {
    const bad = modUrlProblem(f.url);
    if (bad) issues.push({ level: "error", message: `lock: ${f.slug}: ${bad}` });
    const own = privateJarOf(f.url);
    if (own && own !== f.filename) issues.push({ level: "error", message: `lock: ${f.slug}: its address names ${own}, but its file is ${f.filename}` });
  }
  return issues;
}

import { isPlayerFacing, manifestSchema, type Manifest } from "./schema";

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
  const slugs = new Set<string>();
  const enabledByGroup = new Map<string, string[]>();
  for (const mod of m.mods) {
    if (slugs.has(mod.slug)) err(`duplicate slug ${mod.slug}`);
    slugs.add(mod.slug);
    if (!catIds.has(mod.category)) err(`${mod.slug}: unknown category ${mod.category}`);
    if (mod.exclusiveGroup && mod.enabled) {
      const list = enabledByGroup.get(mod.exclusiveGroup) ?? [];
      list.push(mod.slug);
      enabledByGroup.set(mod.exclusiveGroup, list);
    }
    if (!mod.hidden && mod.videos.length === 0) warn(`${mod.slug}: no videos (TODO)`);
    // the Mods guide (/mods): every listed mod says where it goes, and every one a player uses says how
    if (!mod.hidden && !mod.guide) err(`${mod.slug}: no "guide" (game, helper or behind): the Mods guide needs to know where it goes`);
    if (isPlayerFacing(mod) && !mod.howTo) err(`${mod.slug}: switched on and player-facing, but has no "howTo" for the Mods guide`);
    if (mod.guide !== "behind" && mod.side === "server") warn(`${mod.slug}: server-only but in the guide's "${mod.guide}" part`);
    if (mod.side === "server" && mod.exclusiveGroup) warn(`${mod.slug}: server-only mods should not be in an exclusive group`);
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

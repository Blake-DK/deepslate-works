import { manifestSchema, type Manifest } from "./schema";

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
    if (mod.side === "server" && mod.exclusiveGroup) warn(`${mod.slug}: server-only mods should not be in an exclusive group`);
  }
  for (const mod of m.mods) {
    for (const dep of mod.requires) if (!slugs.has(dep)) err(`${mod.slug}: requires ${dep}, which is not in the list`);
  }
  for (const [group, list] of enabledByGroup) if (list.length > 1) err(`exclusive group ${group} has more than one enabled mod: ${list.join(", ")}`);
  return { manifest: m, issues };
}

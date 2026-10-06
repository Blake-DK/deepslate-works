// What Sync did to the server's mods folder, in words (Alex, 2026-10-06: "if it updates it should just say updated").
// rsync knows files, not mods: a new version of a mod is one jar deleted and another sent. They are put together
// again by the jar's name without its versions ("Placebo-1.21.1-9.9.2.jar" and "…-9.9.3.jar" are both "placebo").
// packages/modpack/src/build.ts has the same rule for Build's own line.

/** "placebo" from "Placebo-1.21.1-9.9.2.jar": the name's parts up to the first that is a version (or "mc1.21"). */
export function jarStem(file: string): string {
  const parts = file.replace(/\.jar$/i, "").split(/[-_+ ]/);
  const i = parts.findIndex((p, n) => n > 0 && /^(v|mc)?\d/i.test(p));
  return (i < 0 ? parts : parts.slice(0, i)).join("-").toLowerCase();
}

export type JarChanges = { updated: Array<{ from: string; to: string }>; added: string[]; removed: string[]; replaced: string[]; dated: string[] };

/**
 * rsync --itemize-changes lines: a new jar (>f+++), a deleted one (*deleting), a jar of the same name sent again, one
 * whose date alone differs (.f..t: nothing is sent, but Sync counts it as a change).
 */
export function jarChanges(rsyncLines: string[]): JarChanges {
  const added: string[] = [];
  const removed: string[] = [];
  const replaced: string[] = [];
  const dated: string[] = [];
  for (const l of rsyncLines) {
    const del = /^\*deleting\s+(.+)$/.exec(l);
    const sent = /^[<>]f(\S+)\s+(.+)$/.exec(l);
    const touched = /^\.f\S*\s+(.+)$/.exec(l);
    if (del && !del[1]!.endsWith("/")) removed.push(del[1]!.trim());
    else if (sent) (sent[1]!.startsWith("+++") ? added : replaced).push(sent[2]!.trim());
    else if (touched) dated.push(touched[1]!.trim());
  }
  // an old jar and a new one of the same name, one each: that mod was updated
  const updated: JarChanges["updated"] = [];
  for (const from of [...removed]) {
    const stem = jarStem(from);
    const olds = removed.filter((r) => jarStem(r) === stem);
    const news = added.filter((a) => jarStem(a) === stem);
    if (olds.length !== 1 || news.length !== 1) continue;
    updated.push({ from, to: news[0]! });
    removed.splice(removed.indexOf(from), 1);
    added.splice(added.indexOf(news[0]!), 1);
  }
  return { updated, added, removed, replaced, dated };
}

/** "mods: 1 updated, 1 added", and one line per jar. Nothing changed: "mods: up to date". */
export function jarChangeLines(c: JarChanges, most = 60): string[] {
  const parts = [[c.updated.length, "updated"], [c.added.length, "added"], [c.removed.length, "removed"], [c.replaced.length, "sent again"], [c.dated.length, "with a new date only"]].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`);
  if (parts.length === 0) return ["mods: up to date"];
  const each = [
    ...c.updated.map((u) => `  updated ${u.from} → ${u.to}`),
    ...c.added.map((a) => `  added ${a}`),
    ...c.removed.map((r) => `  removed ${r}`),
    ...c.replaced.map((r) => `  sent again ${r} (same name, the file differed)`),
    ...c.dated.map((r) => `  new date only ${r}`),
  ];
  return [`mods: ${parts.join(", ")}`, ...each.slice(0, most), ...(each.length > most ? [`  … and ${each.length - most} more`] : [])];
}

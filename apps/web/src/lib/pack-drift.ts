// When the server runs a pack that main does not have (2026-10-03: six lock commits sat on the deploy checkout,
// unpushed, and main fell behind the server). Pure, so it can be tested; server/modpack/drift.ts reads the values.

export type PackDrift = {
  /** The pack last synced to the server (api's Setting `_packSynced`), e.g. "0.1.0+d7521da9". */
  server: string | null;
  /** The pack in origin/main's modpack/ as of the checkout's last fetch. */
  main: string | null;
  /** Commits on the deploy checkout that are not on origin/main, "<short sha> <subject>". */
  unpushed: string[];
};

/** null when all is well or nothing can be said; otherwise the line Admin → Pack shows. */
export function driftLine(d: PackDrift): string | null {
  const parts: string[] = [];
  if (d.server && d.main && d.server !== d.main) parts.push(`The server runs pack ${d.server}, but main has ${d.main}.`);
  if (d.unpushed.length > 0)
    parts.push(`${d.unpushed.length} ${d.unpushed.length === 1 ? "commit" : "commits"} on the deploy checkout ${d.unpushed.length === 1 ? "is" : "are"} not on main (${d.unpushed.map((c) => c.split(" ")[0]).join(", ")}): push them in a PR and merge it, or the next deploy refuses.`);
  return parts.length ? parts.join(" ") : null;
}

/** For /api/health: the same facts, and whether the server's pack is main's. */
export function driftHealth(d: PackDrift) {
  return { server: d.server, main: d.main, same: d.server != null && d.main != null ? d.server === d.main : null, unpushed: d.unpushed.length };
}

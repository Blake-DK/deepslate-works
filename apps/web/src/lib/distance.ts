// Admin → Server → Settings: what the view and simulation distance numbers mean, in plain words.

export type Distance = {
  amp: { view?: number; sim?: number } | null;
  running: { view?: number; sim?: number } | null;
  allowed: { view: boolean | null; sim: boolean | null };
  permissions: { view: string; sim: string };
  limits: { view: { min: number; max: number }; sim: { min: number; max: number } };
  tick: { tps: number; mspt: number; at: string } | null;
  problem: string | null;
};

export function distanceWords(view: number, sim: number): { view: string; sim: string; note: string | null } {
  return {
    view: `Players see terrain about ${view * 16} blocks away (${view} chunks) in every direction, if their own render distance is at least that.`,
    sim: `Within ${sim * 16} blocks (${sim} chunks) of a player, crops grow, machines run and mobs move. Further out the world stands still.`,
    note: sim > view ? "Simulation distance above view distance does nothing extra: the server only runs what it also sends." : null,
  };
}

/** Saved in AMP but not yet what the server runs with: the next start brings it in. */
export function waiting(d: Pick<Distance, "amp" | "running">): Array<{ what: string; now: number | null; next: number }> {
  const out: Array<{ what: string; now: number | null; next: number }> = [];
  if (d.amp?.view !== undefined && d.running && d.running.view !== d.amp.view) out.push({ what: "View distance", now: d.running.view ?? null, next: d.amp.view });
  if (d.amp?.sim !== undefined && d.running && d.running.sim !== d.amp.sim) out.push({ what: "Simulation distance", now: d.running.sim ?? null, next: d.amp.sim });
  return out;
}

/** "MSPT 12.3 ms": the share of the 50 ms a tick may take, as a tone. */
export function msptTone(mspt: number): "good" | "warn" | "bad" {
  return mspt < 35 ? "good" : mspt < 50 ? "warn" : "bad";
}

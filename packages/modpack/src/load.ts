import type { Load, Mod } from "./schema";

// Load estimate rules from docs/05: Light=1, Medium=3, Heavy=6; total <=6 Light, <=14 Medium, else Heavy.
export const LOAD_POINTS: Record<Load, number> = { L: 1, M: 3, H: 6 };
export const LOAD_LABEL: Record<Load, string> = { L: "Light", M: "Medium", H: "Heavy" };

export function loadPoints(mods: Pick<Mod, "load">[]): number {
  return mods.reduce((sum, m) => sum + LOAD_POINTS[m.load], 0);
}

export function loadBand(points: number): Load {
  return points <= 6 ? "L" : points <= 14 ? "M" : "H";
}

export function estimateLoad(mods: Pick<Mod, "load">[]): { points: number; band: Load; label: string } {
  const points = loadPoints(mods);
  const band = loadBand(points);
  return { points, band, label: LOAD_LABEL[band] };
}

import { COUNTRIES, LAND_PATH, WORLD_VIEWBOX } from "@/lib/geo-data";
import { hours, type CountryRow } from "@/lib/analytics";

/** The world with a dot per country, sized by play time. Drawn from data in the code: no map tiles, nothing fetched. */
export function WorldMap({ rows }: { rows: CountryRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.playMs));
  const dots = rows
    .map((r) => ({ r, c: COUNTRIES[r.code] }))
    .filter((d): d is { r: CountryRow; c: readonly [string, number, number] } => Boolean(d.c))
    .sort((a, b) => b.r.playMs - a.r.playMs);
  return (
    <svg viewBox={WORLD_VIEWBOX} role="img" aria-label={`World map. ${dots.map((d) => `${d.c[0]}: ${hours(d.r.playMs)}`).join(". ") || "No countries yet"}.`} className="w-full rounded-[4px] border bg-panel text-dim">
      <path d={LAND_PATH} fill="currentColor" fillOpacity="0.5" />
      {dots.map(({ r, c }) => {
        const radius = 1.5 + 5 * Math.sqrt(r.playMs / max);
        return (
          <g key={r.code} className="text-primary">
            <circle cx={c[2] + 180} cy={90 - c[1]} r={radius} fill="currentColor" fillOpacity="0.55" stroke="currentColor" strokeWidth="0.4">
              <title>{`${c[0]}: ${r.players} ${r.players === 1 ? "player" : "players"}, ${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}, ${hours(r.playMs)}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

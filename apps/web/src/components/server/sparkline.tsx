import { sparkSegments } from "@/lib/series";

/** Small line chart, drawn on the server. `values` are evenly spaced; null means nothing was recorded. */
export function Sparkline({ values, label, width = 280, height = 48, unit = ["player", "players"] }: { values: Array<number | null>; label: string; width?: number; height?: number; unit?: [string, string] }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return <p className="text-xs text-muted-foreground">{label}: nothing recorded yet.</p>;
  const { segments } = sparkSegments(values, width, height);
  const peak = Math.max(...known);
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}. Peak ${peak} ${peak === 1 ? unit[0] : unit[1]}.`} className="h-12 w-full text-primary" preserveAspectRatio="none">
        <line x1="0" y1={height - 2} x2={width} y2={height - 2} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
        {segments.map((points, i) =>
          points.includes(" ") ? (
            <polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ) : (
            <circle key={i} cx={points.split(",")[0]} cy={points.split(",")[1]} r="1.5" fill="currentColor" />
          ),
        )}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>peak {peak} {peak === 1 ? unit[0] : unit[1]}</span>
      </figcaption>
    </figure>
  );
}

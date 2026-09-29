import { Card } from "@/components/ui/card";

/** One number. `delta` is the change against the window before, as a fraction; `goodWhenUp` decides its colour. */
export function Tile({ label, value, hint, delta, goodWhenUp = true }: { label: string; value: string; hint?: string; delta?: number | null; goodWhenUp?: boolean }) {
  const shown = delta !== null && delta !== undefined && Number.isFinite(delta);
  const up = shown && delta! > 0.0005;
  const down = shown && delta! < -0.0005;
  const good = (up && goodWhenUp) || (down && !goodWhenUp);
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums leading-tight">{value}</p>
      <p className="mt-1 min-h-4 text-xs text-muted-foreground">
        {shown && (up || down) && <span className={good ? "text-accent" : "text-danger"} title="Compared with the same length of time just before">{up ? "▲" : "▼"} {Math.abs(delta! * 100).toFixed(0)}% </span>}
        {shown && !up && !down && <span title="Compared with the same length of time just before">no change </span>}
        {hint}
      </p>
    </Card>
  );
}

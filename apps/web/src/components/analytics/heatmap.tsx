const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Minutes played in each hour of the week (UK time). Darker is busier. */
export function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  const total = grid.flat().reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground">Nobody has played in this period yet.</p>;
  let best = { d: 0, h: 0, v: -1 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-0.5 text-[10px]" aria-label="Minutes played by day and hour, UK time">
          <thead>
            <tr><td />{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col" className="font-normal text-muted-foreground">{h % 3 === 0 ? String(h).padStart(2, "0") : ""}</th>)}</tr>
          </thead>
          <tbody>
            {grid.map((row, d) => (
              <tr key={d}>
                <th scope="row" className="pr-1 text-right font-normal text-muted-foreground">{DAYS[d]}</th>
                {row.map((v, h) => (
                  <td key={h} className="h-5 rounded-sm bg-primary" style={{ opacity: v === 0 ? 0.06 : 0.2 + 0.8 * (v / max) }} title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00, ${v} min played`}><span className="sr-only">{v}</span></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Busiest: {DAYS[best.d]} {String(best.h).padStart(2, "0")}:00 to {String((best.h + 1) % 24).padStart(2, "0")}:00, UK time.</p>
    </div>
  );
}

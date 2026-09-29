/** Area chart drawn on the server. One value per slot; every point has a tooltip. */
export function AreaChart({ points, unit, height = 160 }: { points: Array<{ label: string; value: number }>; unit: [string, string]; height?: number }) {
  const width = 720;
  const padL = 28;
  const padB = 20;
  const padT = 8;
  const max = Math.max(1, ...points.map((p) => p.value));
  const top = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const n = points.length;
  const x = (i: number) => padL + (n > 1 ? (i * (width - padL - 4)) / (n - 1) : (width - padL) / 2);
  const y = (v: number) => padT + (1 - v / top) * (height - padT - padB);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.ceil(n / 8));
  const total = points.reduce((a, p) => a + p.value, 0);
  if (n === 0) return <p className="text-sm text-muted-foreground">Nothing to draw yet.</p>;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${unit[1]} over time. Highest ${max}.`} className="w-full text-primary">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={width} y1={y(top * f)} y2={y(top * f)} stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
          <text x={padL - 6} y={y(top * f) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">{Math.round(top * f)}</text>
        </g>
      ))}
      {total > 0 && n > 1 && <polygon points={`${x(0).toFixed(1)},${y(0)} ${line} ${x(n - 1).toFixed(1)},${y(0)}`} fill="currentColor" fillOpacity="0.15" />}
      {n > 1 && <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => (
        <g key={i}>
          {i % every === 0 && <text x={x(i)} y={height - 5} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-muted-foreground" fontSize="10">{p.label}</text>}
          <circle cx={x(i)} cy={y(p.value)} r={p.value > 0 || n === 1 ? 2.5 : 0} fill="currentColor" />
          <rect x={x(i) - (width - padL) / n / 2} y={padT} width={(width - padL) / n} height={height - padT - padB} fill="transparent">
            <title>{`${p.label}: ${p.value} ${p.value === 1 ? unit[0] : unit[1]}`}</title>
          </rect>
        </g>
      ))}
    </svg>
  );
}

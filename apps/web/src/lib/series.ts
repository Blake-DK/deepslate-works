// Pure helpers for the dashboard numbers. No imports from server code so they can be tested on their own.

export type Bucket = { bucket: number; value: number };

/** Lays sparse buckets (index = floor(epochSeconds / size)) onto a fixed window of `count` slots ending at `now`; gaps are null. */
export function fillBuckets(rows: Bucket[], now: Date, sizeSeconds: number, count: number): Array<number | null> {
  const last = Math.floor(now.getTime() / 1000 / sizeSeconds);
  const first = last - count + 1;
  const out: Array<number | null> = Array.from({ length: count }, () => null);
  for (const r of rows) {
    const i = r.bucket - first;
    if (i >= 0 && i < count) out[i] = Math.max(out[i] ?? 0, r.value);
  }
  return out;
}

/** AMP reports uptime as d:hh:mm:ss. */
export function formatUptime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d+):(\d{1,2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return raw;
  const [d, h, min] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${min} min`;
  if (min > 0) return `${min} min`;
  return "under a minute";
}

export type TpsTone = "good" | "warn" | "bad";
/** docs/05: 19 and over good, 15 to 19 warning, under 15 bad. */
export function tpsTone(tps: number): TpsTone {
  if (tps >= 19) return "good";
  if (tps >= 15) return "warn";
  return "bad";
}

export function timeAgo(then: Date | null | undefined, now: Date = new Date()): string {
  if (!then) return "never";
  const s = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (s < 90) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

/** Points for an SVG polyline; nulls break the line into segments. */
export function sparkSegments(values: Array<number | null>, width: number, height: number, pad = 2): { segments: string[]; max: number } {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
      return;
    }
    const x = pad + i * step;
    const y = height - pad - (v / max) * (height - pad * 2);
    cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(" "));
  return { segments, max };
}

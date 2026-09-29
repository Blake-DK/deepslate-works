// docs/05 "Connection". Pure, so it is tested.

export type PingTone = "good" | "warn" | "bad";

/** Under 80 ms green, under 150 amber, red from there. */
export function pingTone(ms: number): PingTone {
  if (ms < 80) return "good";
  if (ms < 150) return "warn";
  return "bad";
}

export function average(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, v) => a + v, 0) / values.length) : null;
}

/** Readings spread over evenly spaced slots between `from` and `to`; a slot nothing fell into is null. */
export function pingSlots(rows: Array<{ at: Date; ms: number }>, from: Date, to: Date, slots = 60): Array<number | null> {
  const span = to.getTime() - from.getTime();
  if (span <= 0 || slots < 1) return [];
  const sums = Array.from({ length: slots }, () => ({ total: 0, n: 0 }));
  for (const r of rows) {
    const t = r.at.getTime();
    if (t < from.getTime() || t > to.getTime()) continue;
    const slot = sums[Math.min(slots - 1, Math.floor(((t - from.getTime()) / span) * slots))]!;
    slot.total += r.ms;
    slot.n++;
  }
  return sums.map((s) => (s.n ? Math.round(s.total / s.n) : null));
}

/** The highest ping among the players who have one, with whose it is. */
export function worstPing(online: Array<{ name: string; ping: number | null }>): { name: string; ms: number } | null {
  let worst: { name: string; ms: number } | null = null;
  for (const p of online) if (p.ping !== null && (!worst || p.ping > worst.ms)) worst = { name: p.name, ms: p.ping };
  return worst;
}

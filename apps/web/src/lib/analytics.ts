// docs/16 §2: every number on /analytics is worked out here, from plain rows, so it can be tested.
// A session belongs to a range when it STARTED in it (the way AMP counts), and counts with its whole length.

export type S = { mcUuid: string; mcName: string; userId: string | null; joinedAt: Date; leftAt: Date | null; country: string | null };
export type RangeKey = "24h" | "7d" | "30d" | "all";
export type Range = { key: RangeKey; label: string; from: Date; to: Date; prevFrom: Date | null; bucket: "hour" | "day" | "week" };

export const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "24h", label: "Last 24 h" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const BOUNCE_MS = 2 * 60_000;

export function rangeFor(key: string | undefined, now: Date, firstEver: Date | null): Range {
  const k: RangeKey = key === "24h" || key === "7d" || key === "all" ? key : "30d";
  const label = RANGES.find((r) => r.key === k)!.label;
  if (k === "all") {
    const from = firstEver && firstEver < now ? firstEver : new Date(now.getTime() - 30 * DAY);
    const days = (now.getTime() - from.getTime()) / DAY;
    return { key: k, label, from, to: now, prevFrom: null, bucket: days > 92 ? "week" : "day" };
  }
  const ms = k === "24h" ? DAY : k === "7d" ? 7 * DAY : 30 * DAY;
  return { key: k, label, from: new Date(now.getTime() - ms), to: now, prevFrom: new Date(now.getTime() - 2 * ms), bucket: k === "24h" ? "hour" : "day" };
}

export const lengthOf = (s: S, now: Date) => Math.max(0, (s.leftAt ?? now).getTime() - s.joinedAt.getTime());
export const startedIn = (s: S, from: Date, to: Date) => s.joinedAt >= from && s.joinedAt < to;

export type Totals = {
  sessions: number;
  players: number;
  newPlayers: number;
  playMs: number;
  bounceRate: number | null; // 0..1
  avgMs: number | null;
  perPlayer: number | null;
  longestMs: number;
};

/** `firstSeen`: each player's first session ever, to tell a new player from a returning one. */
export function totals(sessions: S[], from: Date, to: Date, now: Date, firstSeen: Map<string, Date>): Totals {
  const mine = sessions.filter((s) => startedIn(s, from, to));
  const players = new Set(mine.map((s) => s.mcUuid));
  let playMs = 0;
  let longestMs = 0;
  let bounces = 0;
  for (const s of mine) {
    const ms = lengthOf(s, now);
    playMs += ms;
    if (ms > longestMs) longestMs = ms;
    if (s.leftAt && ms < BOUNCE_MS) bounces++;
  }
  let newPlayers = 0;
  for (const p of players) {
    const first = firstSeen.get(p);
    if (first && first >= from && first < to) newPlayers++;
  }
  const n = mine.length;
  return { sessions: n, players: players.size, newPlayers, playMs, bounceRate: n ? bounces / n : null, avgMs: n ? playMs / n : null, perPlayer: players.size ? n / players.size : null, longestMs };
}

/** Change against the previous window, as a fraction (0.25 = up a quarter). Null when there is nothing to compare with. */
export function change(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return (now - before) / before;
}

/** Most people online at the same moment, from the sessions themselves. */
export function peakConcurrent(sessions: S[], from: Date, to: Date, now: Date): number {
  const marks: Array<[number, number]> = [];
  for (const s of sessions) {
    const a = Math.max(s.joinedAt.getTime(), from.getTime());
    const b = Math.min((s.leftAt ?? now).getTime(), to.getTime());
    if (b > a) marks.push([a, 1], [b, -1]);
  }
  marks.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // at the same instant, a leave comes before a join
  let cur = 0;
  let peak = 0;
  for (const [, d] of marks) {
    cur += d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

// ---- time in the UK, where the group lives -------------------------------------------------------------

const UK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hour12: false });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ukParts(d: Date): { day: string; hour: number; weekday: number } {
  const p = Object.fromEntries(UK.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: WEEKDAYS.indexOf(p.weekday ?? "Mon") };
}

export type Slot = { key: string; label: string; start: Date; end: Date };

/** The slots of a chart, oldest first. Hours and days follow UK clocks; a week is seven days counted back from now. */
export function slots(range: Range): Slot[] {
  const out: Slot[] = [];
  if (range.bucket === "week") {
    for (let end = range.to.getTime(); end > range.from.getTime(); end -= 7 * DAY) {
      const start = new Date(Math.max(range.from.getTime(), end - 7 * DAY));
      out.unshift({ key: `w${start.toISOString()}`, label: `week from ${ukParts(start).day.slice(5).split("-").reverse().join("/")}`, start, end: new Date(end) });
    }
    return out;
  }
  // docs/35 R-26: the real hours and days of the UK's clock. Each slot ends where the next starts and the first
  // starts with the range, so no minute is in two bars. UK time is a whole number of hours from UTC, so every hour
  // and every midnight there falls on a UTC hour: walk those (a day of 23 or 25 hours is still found once).
  const keyAt = (t: number) => {
    const p = ukParts(new Date(t));
    return range.bucket === "hour" ? { key: `${p.day} ${String(p.hour).padStart(2, "0")}`, label: `${String(p.hour).padStart(2, "0")}:00` } : { key: p.day, label: p.day.slice(5).split("-").reverse().join("/") };
  };
  const seen = new Set<string>();
  let t = Math.floor(range.from.getTime() / HOUR) * HOUR;
  for (; t <= range.to.getTime(); t += HOUR) {
    const { key, label } = keyAt(t);
    if (seen.has(key)) continue;
    seen.add(key);
    const start = new Date(Math.max(t, range.from.getTime()));
    const before = out.at(-1);
    if (before) before.end = start;
    out.push({ key, label, start, end: start });
  }
  // the last slot runs to the end of its own hour or day, wherever the range stops
  const last = out.at(-1);
  if (last) {
    while (keyAt(t).key === last.key) t += HOUR;
    last.end = new Date(t);
  }
  return out;
}

export function slotKey(d: Date, range: Range, all: Slot[]): string | null {
  if (range.bucket === "week") return all.find((s) => d >= s.start && d < s.end)?.key ?? (d.getTime() === range.to.getTime() ? (all.at(-1)?.key ?? null) : null);
  const p = ukParts(d);
  return range.bucket === "hour" ? `${p.day} ${String(p.hour).padStart(2, "0")}` : p.day;
}

export type Point = { slot: Slot; sessions: number; peak: number };

/** Per slot: sessions started, and the most people online at once. */
export function series(sessions: S[], range: Range, now: Date): Point[] {
  const all = slots(range);
  const byKey = new Map(all.map((s) => [s.key, { slot: s, sessions: 0, peak: 0 }]));
  for (const s of sessions) {
    if (!startedIn(s, range.from, range.to)) continue;
    const k = slotKey(s.joinedAt, range, all);
    const p = k ? byKey.get(k) : undefined;
    if (p) p.sessions++;
  }
  // the peak of a slot is the most people on at once within that slot
  for (const p of byKey.values()) {
    const from = new Date(Math.max(p.slot.start.getTime(), range.from.getTime()));
    const to = new Date(Math.min(p.slot.end.getTime(), range.to.getTime()));
    if (to > from) p.peak = peakConcurrent(sessions, from, to, now);
  }
  return all.map((s) => byKey.get(s.key)!);
}

// ---- who, where, when --------------------------------------------------------------------------------------

export type PlayerRow = { mcUuid: string; mcName: string; userId: string | null; playMs: number; sessions: number; lastSeen: Date; share: number };

export function byPlayer(sessions: S[], from: Date, to: Date, now: Date): PlayerRow[] {
  const rows = new Map<string, PlayerRow>();
  let total = 0;
  for (const s of sessions) {
    if (!startedIn(s, from, to)) continue;
    const ms = lengthOf(s, now);
    total += ms;
    const end = s.leftAt ?? now;
    const r = rows.get(s.mcUuid);
    if (!r) rows.set(s.mcUuid, { mcUuid: s.mcUuid, mcName: s.mcName, userId: s.userId, playMs: ms, sessions: 1, lastSeen: end, share: 0 });
    else {
      r.playMs += ms;
      r.sessions++;
      if (end >= r.lastSeen) {
        r.lastSeen = end;
        r.mcName = s.mcName; // the name they use now
      }
      r.userId = r.userId ?? s.userId;
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.share = total ? r.playMs / total : 0;
  return out.sort((a, b) => b.playMs - a.playMs || a.mcName.localeCompare(b.mcName));
}

export type SortKey = "time" | "sessions" | "seen" | "name";
export function sortPlayers(rows: PlayerRow[], key: string | undefined, dir: string | undefined): PlayerRow[] {
  const k: SortKey = key === "sessions" || key === "seen" || key === "name" ? key : "time";
  const sign = dir === "asc" ? 1 : -1;
  const value = (r: PlayerRow) => (k === "time" ? r.playMs : k === "sessions" ? r.sessions : k === "seen" ? r.lastSeen.getTime() : 0);
  return [...rows].sort((a, b) => (k === "name" ? sign * -1 * b.mcName.localeCompare(a.mcName) : sign * (value(a) - value(b))) || a.mcName.localeCompare(b.mcName));
}

export type CountryRow = { code: string; players: number; sessions: number; playMs: number };

export function byCountry(sessions: S[], from: Date, to: Date, now: Date): { rows: CountryRow[]; unknown: number } {
  const rows = new Map<string, { players: Set<string>; sessions: number; playMs: number }>();
  let unknown = 0;
  for (const s of sessions) {
    if (!startedIn(s, from, to)) continue;
    if (!s.country) {
      unknown++;
      continue;
    }
    const r = rows.get(s.country) ?? { players: new Set<string>(), sessions: 0, playMs: 0 };
    r.players.add(s.mcUuid);
    r.sessions++;
    r.playMs += lengthOf(s, now);
    rows.set(s.country, r);
  }
  return { rows: [...rows].map(([code, r]) => ({ code, players: r.players.size, sessions: r.sessions, playMs: r.playMs })).sort((a, b) => b.playMs - a.playMs || a.code.localeCompare(b.code)), unknown };
}

/** Minutes played in each hour of the week, UK time: [weekday 0 = Monday][hour]. */
export function heatmap(sessions: S[], from: Date, to: Date, now: Date): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const s of sessions) {
    let a = Math.max(s.joinedAt.getTime(), from.getTime());
    const b = Math.min((s.leftAt ?? now).getTime(), to.getTime());
    while (a < b) {
      const next = Math.min(b, (Math.floor(a / HOUR) + 1) * HOUR); // UK offsets are whole hours, so hour edges line up
      const p = ukParts(new Date(a));
      grid[p.weekday]![p.hour]! += (next - a) / 60_000;
      a = next;
    }
  }
  return grid.map((row) => row.map((v) => Math.round(v)));
}

export type Pair = { a: string; b: string; minutes: number };

/** Who plays together: pairs by the minutes both were online at once. */
export function together(sessions: S[], from: Date, to: Date, now: Date, top = 10): Pair[] {
  const spans = sessions
    .map((s) => ({ p: s.mcUuid, a: Math.max(s.joinedAt.getTime(), from.getTime()), b: Math.min((s.leftAt ?? now).getTime(), to.getTime()) }))
    .filter((s) => s.b > s.a)
    .sort((x, y) => x.a - y.a);
  const minutes = new Map<string, number>();
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const x = spans[i]!;
      const y = spans[j]!;
      if (y.a >= x.b) break; // sorted by start: nothing later overlaps x either
      if (x.p === y.p) continue;
      const overlap = Math.min(x.b, y.b) - y.a;
      if (overlap <= 0) continue;
      const key = x.p < y.p ? `${x.p}|${y.p}` : `${y.p}|${x.p}`;
      minutes.set(key, (minutes.get(key) ?? 0) + overlap / 60_000);
    }
  }
  return [...minutes]
    .map(([k, m]) => ({ a: k.split("|")[0]!, b: k.split("|")[1]!, minutes: Math.round(m) }))
    .filter((p) => p.minutes >= 1)
    .sort((x, y) => y.minutes - x.minutes)
    .slice(0, top);
}

// ---- words ---------------------------------------------------------------------------------------------------

export function hours(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return ms > 0 ? "under a minute" : "0 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 100) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return `${h.toLocaleString("en-GB")} h`;
}

export const percent = (f: number | null, digits = 0) => (f === null ? "–" : `${(f * 100).toFixed(digits)}%`);

/** 🇬🇧 from "GB". Regional-indicator letters: no image files needed. */
export function flag(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
}

// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/20 §7 and docs/34 §4, §5: what the portal reads of a season file (modpack/seasons/<id>.json), and everything
// that is worked out from it and from the clears: which boss or trial a console title means, the week, the days
// left, what is open, the scoreboard, the goal. The file's full schema and its lint are packages/modpack's
// (seasons.ts); CI refuses a file with errors, so this reader takes what it needs and is lenient about the rest.

import { z } from "zod";

const when = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

const bossSchema = z.object({
  id: z.string(),
  title: z.string(),
  entity: z.string().default(""),
  tier: z.number().int().default(1),
  points: z.number().int().default(0),
  opensAt: when.optional(),
  where: z.string().default(""),
  hint: z.string().default(""),
  trophy: z.object({ item: z.string(), name: z.string() }).optional(),
});

const trialSchema = z.object({
  id: z.string(),
  title: z.string(),
  opensAt: when,
  points: z.number().int().default(0),
  solo: z.boolean().default(true),
  hint: z.string().default(""),
  icon: z.string().default("minecraft:paper"),
});

export const seasonFileSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,32}$/),
  name: z.string(),
  startsAt: when,
  endsAt: when,
  accent: z.string().optional(),
  icon: z.string().default("minecraft:netherite_sword"),
  /** Who shares a kill: within this many blocks of the killer. */
  groupRadius: z.number().int().default(48),
  frontier: z.object({ dimension: z.string(), noise: z.string(), radius: z.number().int() }).optional(),
  bosses: z.array(bossSchema).default([]),
  trials: z.array(trialSchema).default([]),
  goal: z.object({ title: z.string(), count: z.literal("boss_kills"), target: z.number().int().min(1) }).optional(),
  finale: z.object({ at: when, title: z.string(), boss: z.string() }).optional(),
});
export type SeasonFile = z.infer<typeof seasonFileSchema>;
export type SeasonFileBoss = SeasonFile["bosses"][number];
export type SeasonFileTrial = SeasonFile["trials"][number];

export const seasonIndexFileSchema = z.object({ current: z.string().nullable().default(null) });

export type SeasonState = "upcoming" | "running" | "ended";
export type ClearKind = "boss" | "trial";
/** A row of SeasonClear, as far as the arithmetic needs it. */
export type Clear = { kind: ClearKind; itemId: string; mcUuid: string; mcName: string; at: Date; first: boolean; early: boolean };

/** The title of the hidden advancement a boss's first hit gives (docs/21 §6). Must agree with packages/modpack. */
export const wakeTitle = (bossTitle: string) => `Woke ${bossTitle}`;

/**
 * The server's console line for an advancement carries only its title. Titles are unique across every season file
 * (lint), so the title says which boss or trial it was, or that a boss was woken.
 */
export function findByTitle(s: SeasonFile, title: string): { kind: ClearKind | "wake"; id: string; title: string } | null {
  const t = title.trim().toLowerCase();
  for (const b of s.bosses) {
    if (b.title.toLowerCase() === t) return { kind: "boss", id: b.id, title: b.title };
    if (wakeTitle(b.title).toLowerCase() === t) return { kind: "wake", id: b.id, title: b.title };
  }
  for (const x of s.trials) if (x.title.toLowerCase() === t) return { kind: "trial", id: x.id, title: x.title };
  return null;
}

/** When a boss or trial joins the ladder: its own opensAt, else the season's start. */
export const opensAt = (s: SeasonFile, item: { opensAt?: string }): Date => new Date(item.opensAt ?? s.startsAt);

/** The UK calendar day of an instant, as a count of days: a week turns over at midnight in the UK, summer and winter. */
export function ukDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000);
}

/** "Week 3 of 4", and the days left: by the UK's calendar, so the hour the clocks change makes no difference. */
export function seasonClock(s: SeasonFile, now: Date): { week: number; weeks: number; daysLeft: number } {
  const start = ukDay(new Date(s.startsAt));
  const end = ukDay(new Date(s.endsAt));
  const today = ukDay(now);
  const weeks = Math.max(1, Math.ceil((end - start) / 7));
  const week = Math.min(weeks, Math.max(1, Math.floor((today - start) / 7) + 1));
  return { week, weeks, daysLeft: Math.max(0, end - today) };
}

export type SeasonNext = { kind: ClearKind | "finale" | "end"; title: string; at: string };

/** What opens next, and when: the nearest of a trial's or a boss's opening, the finale, the season's end. */
export function nextUp(s: SeasonFile, now: Date): SeasonNext | null {
  const t = now.getTime();
  const all: SeasonNext[] = [
    ...s.trials.map((x): SeasonNext => ({ kind: "trial", title: x.title, at: x.opensAt })),
    ...s.bosses.filter((b) => b.opensAt).map((b): SeasonNext => ({ kind: "boss", title: b.title, at: b.opensAt! })),
    ...(s.finale ? [{ kind: "finale" as const, title: s.finale.title, at: s.finale.at }] : []),
    { kind: "end", title: s.name, at: s.endsAt },
  ];
  return all.filter((x) => Date.parse(x.at) > t).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
}

/** The trial that opened most recently (this week's), and the bosses that have opened since the week began. */
export function thisWeek(s: SeasonFile, now: Date): { trial: { id: string; title: string; hint: string } | null; bosses: Array<{ id: string; title: string }> } {
  const t = now.getTime();
  const open = s.trials.filter((x) => Date.parse(x.opensAt) <= t).sort((a, b) => Date.parse(b.opensAt) - Date.parse(a.opensAt))[0];
  const weekAgo = t - 7 * 86_400_000;
  const bosses = s.bosses.filter((b) => { const o = opensAt(s, b).getTime(); return o <= t && o > weekAgo; }).map((b) => ({ id: b.id, title: b.title }));
  return { trial: open ? { id: open.id, title: open.title, hint: open.hint } : null, bosses };
}

export type SeasonCurrent =
  | { state: "none" }
  | { state: SeasonState; id: string; name: string; startsAt: string; endsAt: string; week: number; weeks: number; daysLeft: number; thisWeek: ReturnType<typeof thisWeek>; next: SeasonNext | null };

/** GET /api/season/current (docs/20 §7): for the site's Home line and the app's banner. */
export function seasonCurrent(s: SeasonFile | null, state: SeasonState | null, now: Date): SeasonCurrent {
  if (!s || !state) return { state: "none" };
  const clock = seasonClock(s, now);
  return {
    state, id: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, ...clock,
    thisWeek: state === "running" ? thisWeek(s, now) : { trial: null, bosses: [] },
    next: state === "ended" ? null : state === "upcoming" ? { kind: "end", title: s.name, at: s.startsAt } : nextUp(s, now),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line for Home and for the app's banner: the same words in both. */
export function seasonLine(c: SeasonCurrent, at: (iso: string) => string): string | null {
  if (c.state === "none") return null;
  if (c.state === "upcoming") return `${c.name} opens ${at(c.startsAt)}.`;
  if (c.state === "ended") return `${c.name} is over. The results are on the Season page.`;
  const left = c.daysLeft === 0 ? "ends today" : `${plural(c.daysLeft, "day")} left`;
  const trial = c.thisWeek.trial ? ` This week's trial: ${c.thisWeek.trial.title}.` : "";
  const next = c.next && c.next.kind !== "end" ? ` Next: ${c.next.kind === "finale" ? "the finale" : c.next.title}, ${at(c.next.at)}.` : "";
  return `${c.name} · week ${c.week} of ${c.weeks}, ${left}.${trial}${next}`;
}

export type ScoreRow = { mcUuid: string; mcName: string; points: number; bosses: number; trials: number; firsts: number; lastAt: Date };

/**
 * The scoreboard (docs/34 §4): a boss's or trial's points per the file, twice for whoever did it first on the
 * server. Ordered by points, then by who got there sooner. Clears of things the file no longer has count nothing.
 */
export function scoreboard(s: SeasonFile, clears: Clear[]): ScoreRow[] {
  const points = new Map<string, number>();
  for (const b of s.bosses) points.set(`boss:${b.id}`, b.points);
  for (const x of s.trials) points.set(`trial:${x.id}`, x.points);
  const rows = new Map<string, ScoreRow>();
  for (const c of clears) {
    const p = points.get(`${c.kind}:${c.itemId}`);
    if (p === undefined) continue;
    const row = rows.get(c.mcUuid) ?? { mcUuid: c.mcUuid, mcName: c.mcName, points: 0, bosses: 0, trials: 0, firsts: 0, lastAt: c.at };
    row.points += c.first ? p * 2 : p;
    if (c.kind === "boss") row.bosses += 1;
    else row.trials += 1;
    if (c.first) row.firsts += 1;
    if (c.at > row.lastAt) { row.lastAt = c.at; row.mcName = c.mcName; }
    rows.set(c.mcUuid, row);
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || a.lastAt.getTime() - b.lastAt.getTime() || a.mcName.localeCompare(b.mcName));
}

/** The shared goal: every player's tick on a boss is one kill "between us". */
export function goalProgress(s: SeasonFile, clears: Clear[]): { title: string; count: number; target: number; percent: number } | null {
  if (!s.goal) return null;
  const ids = new Set(s.bosses.map((b) => b.id));
  const count = clears.filter((c) => c.kind === "boss" && ids.has(c.itemId)).length;
  return { title: s.goal.title, count, target: s.goal.target, percent: Math.min(100, Math.floor((count / s.goal.target) * 100)) };
}

/** The quarter marks a goal has passed (25, 50, 75, 100), for the one line each of them gets. */
export const goalMarks = (percent: number): number[] => [25, 50, 75, 100].filter((m) => percent >= m);

/** "Anna", "Anna and Ben", "Anna, Ben and Cy". */
export function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** A season's frozen result (Season.resultJson), written once by End season. */
export type SeasonResult = { endedAt: string; scoreboard: Array<Omit<ScoreRow, "lastAt"> & { lastAt: string }>; goal: ReturnType<typeof goalProgress>; firsts: Array<{ kind: ClearKind; itemId: string; title: string; names: string[]; at: string }> };

export function seasonResult(s: SeasonFile, clears: Clear[], endedAt: Date): SeasonResult {
  const titles = new Map<string, string>([...s.bosses.map((b) => [`boss:${b.id}`, b.title] as const), ...s.trials.map((x) => [`trial:${x.id}`, x.title] as const)]);
  const firsts = new Map<string, { kind: ClearKind; itemId: string; title: string; names: string[]; at: string }>();
  for (const c of clears.filter((x) => x.first).sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const key = `${c.kind}:${c.itemId}`;
    const title = titles.get(key);
    if (!title) continue;
    const f = firsts.get(key) ?? { kind: c.kind, itemId: c.itemId, title, names: [], at: c.at.toISOString() };
    f.names.push(c.mcName);
    firsts.set(key, f);
  }
  return {
    endedAt: endedAt.toISOString(),
    scoreboard: scoreboard(s, clears).map((r) => ({ ...r, lastAt: r.lastAt.toISOString() })),
    goal: goalProgress(s, clears),
    firsts: [...firsts.values()],
  };
}
